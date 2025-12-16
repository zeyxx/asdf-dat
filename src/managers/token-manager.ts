/**
 * ASDF Burn Engine Token Manager
 *
 * Auto-discovery of tokens via getProgramAccounts on Pump.fun.
 * - Discovers tokens by creator pubkey (offset 49 in bonding curve)
 * - Supports both bonding curve and PumpSwap AMM tokens
 * - Metadata caching with LRU eviction
 * - Fallback to vault transaction history scanning
 *
 * Architecture: "Don't trust, verify"
 * - Uses token-verifier.ts for on-chain verification
 * - StoredToken stores minimal data (mint + isRoot)
 * - VerifiedToken contains all derived/verified data
 */

import {
  PublicKey,
  GetProgramAccountsFilter,
  AccountInfo,
  Connection,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { RpcManager } from "./rpc-manager";
import { createLogger } from "../utils/logger";
import {
  DiscoveredToken,
  TrackedToken,
  TokenMetadata,
  PoolType,
  StoredToken,
  VerifiedToken,
  PUMP_BONDING_PROGRAM,
  PUMPSWAP_AMM_PROGRAM,
  WSOL_MINT,
} from "../types";
import {
  verifyToken,
  verifyTokens,
  discoverAndVerifyTokens as coreDiscoverAndVerify,
  deriveTokenAddresses,
} from "../core/token-verifier";

const log = createLogger("tokens");

// Metadata cache config
const METADATA_CACHE_MAX = 500;
const METADATA_CACHE_TTL = 3600000; // 1 hour

// Metaplex program ID
const METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

interface CachedMetadata {
  metadata: TokenMetadata;
  cachedAt: number;
}

export class TokenManager {
  private rpc: RpcManager;
  private creatorPubkey: PublicKey;
  private network: "devnet" | "mainnet";

  // Token storage
  private discoveredTokens: Map<string, DiscoveredToken> = new Map();
  private trackedTokens: Map<string, TrackedToken> = new Map();

  // Metadata cache (LRU)
  private metadataCache: Map<string, CachedMetadata> = new Map();

  // Root token (determined by isRoot flag or first discovered)
  private rootTokenMint: PublicKey | null = null;

  constructor(
    rpc: RpcManager,
    creatorPubkey: PublicKey,
    network: "devnet" | "mainnet",
    rootTokenMint?: PublicKey
  ) {
    this.rpc = rpc;
    this.creatorPubkey = creatorPubkey;
    this.network = network;
    this.rootTokenMint = rootTokenMint ?? null;
  }

  /**
   * Discover tokens created by the creator
   * Uses getProgramAccounts with creator at offset 49 (correct Pump.fun layout)
   * Falls back to vault transaction history if getProgramAccounts fails
   */
  async discoverTokens(): Promise<DiscoveredToken[]> {
    const endTimer = log.time("Token discovery");
    const discovered: DiscoveredToken[] = [];

    try {
      // Method 1: getProgramAccounts with creator filter at offset 49
      const programDiscovered = await this.discoverFromProgramAccounts();

      for (const token of programDiscovered) {
        if (!this.discoveredTokens.has(token.mint.toBase58())) {
          discovered.push(token);
          this.discoveredTokens.set(token.mint.toBase58(), token);
        }
      }

      // Method 2: Scan vault transaction history (catches migrated AMM tokens)
      if (discovered.length === 0) {
        log.info("No tokens from program accounts, scanning vault history...");
        const vaultDiscovered = await this.discoverFromVaultHistory();

        for (const token of vaultDiscovered) {
          if (!this.discoveredTokens.has(token.mint.toBase58())) {
            discovered.push(token);
            this.discoveredTokens.set(token.mint.toBase58(), token);
          }
        }
      }

      log.info("Token discovery complete", {
        found: discovered.length,
        classic: discovered.filter(t => t.poolType === "bonding_curve").length,
        amm: discovered.filter(t => t.poolType === "pumpswap_amm").length,
      });

    } catch (error) {
      log.error("Token discovery failed", {
        error: (error as Error).message,
      });
      return Array.from(this.discoveredTokens.values());
    }

    endTimer();
    return discovered;
  }

  /**
   * Discover tokens via getProgramAccounts
   * Creator is at offset 49 in Pump.fun bonding curve layout
   */
  private async discoverFromProgramAccounts(): Promise<DiscoveredToken[]> {
    const pumpProgramId = new PublicKey(PUMP_BONDING_PROGRAM);
    const discovered: DiscoveredToken[] = [];

    // Filter by creator at offset 49
    const filters: GetProgramAccountsFilter[] = [
      {
        memcmp: {
          offset: 49, // Creator offset in bonding curve (after discriminator + mint + virtual_token_reserves + virtual_sol_reserves + real_token_reserves + real_sol_reserves + token_total_supply)
          bytes: this.creatorPubkey.toBase58(),
        },
      },
    ];

    try {
      const accounts = await this.rpc.execute(() =>
        this.rpc.getConnection().getProgramAccounts(pumpProgramId, { filters })
      );

      for (const { pubkey, account } of accounts) {
        const token = this.parseBondingCurveAccount(pubkey, account);
        if (token) {
          discovered.push(token);
        }
      }

      log.debug("getProgramAccounts found", { count: discovered.length });
    } catch (error) {
      log.warn("getProgramAccounts failed", {
        error: (error as Error).message,
      });
    }

    return discovered;
  }

  /**
   * Discover tokens by scanning vault transaction history
   * This catches tokens that may have migrated to AMM
   */
  private async discoverFromVaultHistory(): Promise<DiscoveredToken[]> {
    const discovered: DiscoveredToken[] = [];
    const seenMints = new Set<string>();

    // Scan both vault types
    const bcVault = this.getCreatorVaultPda();
    const ammVault = this.getAmmCreatorVaultPda();

    for (const { vault, name } of [
      { vault: bcVault, name: "BC" },
      { vault: ammVault, name: "AMM" },
    ]) {
      try {
        const signatures = await this.rpc.execute(() =>
          this.rpc.getConnection().getSignaturesForAddress(vault, { limit: 100 })
        );

        for (const sig of signatures) {
          try {
            const tx = await this.rpc.execute(() =>
              this.rpc.getConnection().getTransaction(sig.signature, {
                maxSupportedTransactionVersion: 0,
              })
            );

            if (!tx?.meta?.postTokenBalances) continue;

            for (const balance of tx.meta.postTokenBalances) {
              if (!balance.mint || seenMints.has(balance.mint)) continue;
              if (balance.mint === WSOL_MINT) continue;

              seenMints.add(balance.mint);

              // Derive bonding curve and check pool type
              const mintPubkey = new PublicKey(balance.mint);
              const bondingCurve = this.deriveBondingCurve(mintPubkey);
              const poolType = await this.detectPoolType(bondingCurve);

              // Verify creator matches
              const creatorMatch = await this.verifyCreator(
                bondingCurve,
                this.deriveAmmPool(mintPubkey),
                poolType
              );

              if (!creatorMatch) continue;

              discovered.push({
                mint: mintPubkey,
                bondingCurve,
                pool: poolType === "pumpswap_amm" ? this.deriveAmmPool(mintPubkey) : undefined,
                poolType,
                discoveredAt: Date.now(),
              });
            }
          } catch {
            // Skip failed transactions
          }
        }

        log.debug(`${name} vault scan complete`, { signatures: signatures.length });
      } catch (error) {
        log.warn(`${name} vault scan failed`, {
          error: (error as Error).message,
        });
      }
    }

    return discovered;
  }

  /**
   * Parse bonding curve account data to extract token info
   * Layout: [8 discriminator][32 mint][8 virtual_token][8 virtual_sol][8 real_token][8 real_sol][8 supply][32 creator]
   */
  private parseBondingCurveAccount(
    pubkey: PublicKey,
    account: AccountInfo<Buffer>
  ): DiscoveredToken | null {
    try {
      const data = account.data;

      // Bonding curve layout:
      // 0-8: discriminator (8 bytes)
      // 8-40: mint (32 bytes)
      // 40-48: virtual_token_reserves (8 bytes)
      // 48-49: virtual_sol_reserves partial...
      // Actually: mint is at offset 8-40

      if (data.length < 81) {
        return null;
      }

      // Mint is at offset 8 (after 8-byte discriminator)
      const mint = new PublicKey(data.slice(8, 40));

      return {
        mint,
        bondingCurve: pubkey,
        poolType: "bonding_curve",
        discoveredAt: Date.now(),
      };
    } catch (error) {
      log.warn("Failed to parse bonding curve", {
        pubkey: pubkey.toBase58(),
        error: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Derive bonding curve PDA from mint
   * Seeds: ["bonding-curve", mint]
   */
  private deriveBondingCurve(mint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), mint.toBuffer()],
      new PublicKey(PUMP_BONDING_PROGRAM)
    )[0];
  }

  /**
   * Derive PumpSwap AMM pool PDA from mint
   * Seeds: ["pool", mint, wsol_mint]
   */
  private deriveAmmPool(mint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), mint.toBuffer(), new PublicKey(WSOL_MINT).toBuffer()],
      new PublicKey(PUMPSWAP_AMM_PROGRAM)
    )[0];
  }

  /**
   * Detect pool type by checking if bonding curve exists
   */
  private async detectPoolType(bondingCurve: PublicKey): Promise<PoolType> {
    try {
      const info = await this.rpc.execute(() =>
        this.rpc.getConnection().getAccountInfo(bondingCurve)
      );
      if (info && info.data.length > 8) {
        return "bonding_curve";
      }
      return "pumpswap_amm";
    } catch {
      return "pumpswap_amm";
    }
  }

  /**
   * Verify creator matches by reading on-chain pool data
   */
  private async verifyCreator(
    bondingCurve: PublicKey,
    ammPool: PublicKey,
    poolType: PoolType
  ): Promise<boolean> {
    try {
      if (poolType === "bonding_curve") {
        const bcInfo = await this.rpc.execute(() =>
          this.rpc.getConnection().getAccountInfo(bondingCurve)
        );
        if (bcInfo && bcInfo.data.length >= 81) {
          const creator = new PublicKey(bcInfo.data.slice(49, 81));
          return creator.equals(this.creatorPubkey);
        }
      } else {
        const poolInfo = await this.rpc.execute(() =>
          this.rpc.getConnection().getAccountInfo(ammPool)
        );
        if (poolInfo && poolInfo.data.length >= 243) {
          const coinCreator = new PublicKey(poolInfo.data.slice(49, 81));
          const ctoCreator = new PublicKey(poolInfo.data.slice(211, 243));
          const activeCreator = !ctoCreator.equals(PublicKey.default) ? ctoCreator : coinCreator;
          return activeCreator.equals(this.creatorPubkey);
        }
      }
    } catch {
      // Fall through
    }
    return false;
  }

  /**
   * Discover token from transaction (fallback method)
   */
  async discoverFromTransaction(signature: string): Promise<DiscoveredToken | null> {
    try {
      const tx = await this.rpc.execute(() =>
        this.rpc.getConnection().getParsedTransaction(signature, {
          maxSupportedTransactionVersion: 0,
        })
      );

      if (!tx?.meta || !tx.transaction) {
        return null;
      }

      return this.discoverFromParsedTransaction(tx);
    } catch (error) {
      log.debug("Transaction parsing failed", {
        signature,
        error: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Discover token from already-parsed transaction
   * Used by FeeTracker for dynamic discovery when fees detected for unknown mint
   */
  async discoverFromParsedTransaction(
    tx: import("@solana/web3.js").ParsedTransactionWithMeta
  ): Promise<DiscoveredToken | null> {
    if (!tx?.meta || !tx.transaction) {
      return null;
    }

    const pumpProgramId = PUMP_BONDING_PROGRAM;

    log.info("🔎 Discovery: Scanning transaction", {
      instructionCount: tx.transaction.message.instructions.length,
    });

    // Strategy 1: Look for Pump.fun program instructions
    for (const ix of tx.transaction.message.instructions) {
      const isPump = "programId" in ix && ix.programId.toBase58() === pumpProgramId;
      log.debug("🔎 Discovery: Checking instruction", {
        programId: "programId" in ix ? ix.programId.toBase58().slice(0, 8) : "N/A",
        isPump,
        hasAccounts: "accounts" in ix,
        accountCount: "accounts" in ix ? ix.accounts.length : 0,
      });

      if (isPump) {
        // Parse accounts from instruction
        // Pump.fun buy/sell instruction structure varies:
        // - Buy: [..., mint (index 2), bondingCurve (index 3), ...]
        // - Sell: [..., mint (index 2), bondingCurve (index 3), ...]
        // We need at least 4 accounts to extract mint and bonding curve
        if ("accounts" in ix && ix.accounts.length >= 4) {
          // Extract mint and bonding curve from correct positions
          // NOTE: In parsed transactions, accounts are PublicKey objects
          // But in some cases they might be strings - handle both
          const rawMint = ix.accounts[2];
          const rawBc = ix.accounts[3];

          // Convert to string (base58) - handle both PublicKey and string
          const mintStr = typeof rawMint === "string"
            ? rawMint
            : (rawMint as PublicKey).toBase58();
          const bcStr = typeof rawBc === "string"
            ? rawBc
            : (rawBc as PublicKey).toBase58();

          // Skip if already tracked
          if (this.trackedTokens.has(mintStr)) {
            return null;
          }

          // Skip if already discovered
          if (this.discoveredTokens.has(mintStr)) {
            return null;
          }

          // Convert to PublicKey for further operations
          const mint = new PublicKey(mintStr);
          const bondingCurve = new PublicKey(bcStr);

          // Verify creator matches before adding
          const creatorMatch = await this.verifyCreator(
            bondingCurve,
            this.deriveAmmPool(mint),
            "bonding_curve"
          );

          if (!creatorMatch) {
            log.debug("Creator mismatch for discovered token", {
              mint: mintStr.slice(0, 8),
            });
            return null;
          }

          const token: DiscoveredToken = {
            mint,
            bondingCurve,
            poolType: "bonding_curve",
            discoveredAt: Date.now(),
          };

          this.discoveredTokens.set(mintStr, token);

          log.info("🔍 Dynamic token discovery", {
            mint: mintStr.slice(0, 8) + "...",
            bondingCurve: bcStr.slice(0, 8) + "...",
          });

          return token;
        }
      }
    }

    // Strategy 2: Extract mints from token balances
    const tokenBalances = [
      ...(tx.meta.preTokenBalances || []),
      ...(tx.meta.postTokenBalances || []),
    ];

    for (const balance of tokenBalances) {
      if (!balance.mint) continue;
      if (balance.mint === WSOL_MINT) continue;
      if (this.trackedTokens.has(balance.mint)) continue;
      if (this.discoveredTokens.has(balance.mint)) continue;

      const mint = new PublicKey(balance.mint);
      const bondingCurve = this.deriveBondingCurve(mint);
      const poolType = await this.detectPoolType(bondingCurve);

      // Verify creator matches
      const creatorMatch = await this.verifyCreator(
        bondingCurve,
        this.deriveAmmPool(mint),
        poolType
      );

      if (!creatorMatch) {
        continue;
      }

      const token: DiscoveredToken = {
        mint,
        bondingCurve,
        pool: poolType === "pumpswap_amm" ? this.deriveAmmPool(mint) : undefined,
        poolType,
        discoveredAt: Date.now(),
      };

      this.discoveredTokens.set(mint.toBase58(), token);

      log.info("🔍 Dynamic token discovery from balances", {
        mint: mint.toBase58().slice(0, 8) + "...",
        poolType,
      });

      return token;
    }

    return null;
  }

  /**
   * Fetch token metadata from on-chain
   * Supports: Metaplex metadata, Token-2022 metadata extension, URI fetch, fallback
   * NEVER returns null - always provides at least a fallback
   */
  async fetchMetadata(mint: PublicKey): Promise<TokenMetadata> {
    const mintStr = mint.toBase58();

    // Check cache
    const cached = this.metadataCache.get(mintStr);
    if (cached && Date.now() - cached.cachedAt < METADATA_CACHE_TTL) {
      return cached.metadata;
    }

    let symbol = "UNKNOWN";
    let name = "Unknown Token";
    let uri: string | undefined;

    try {
      // Fetch mint info (also checks if Token-2022)
      const mintInfo = await this.rpc.execute(() =>
        this.rpc.getConnection().getParsedAccountInfo(mint)
      );

      // Try Token-2022 metadata extension first (embedded in mint account)
      if (mintInfo.value?.data && typeof mintInfo.value.data === "object" && "parsed" in mintInfo.value.data) {
        const parsed = mintInfo.value.data.parsed;
        if (parsed?.info?.extensions) {
          const metadataExt = parsed.info.extensions.find(
            (ext: any) => ext.extension === "tokenMetadata"
          );
          if (metadataExt?.state) {
            symbol = metadataExt.state.symbol || symbol;
            name = metadataExt.state.name || name;
            uri = metadataExt.state.uri;
            log.debug("Token-2022 metadata found", { mint: mintStr, symbol });
          }
        }
      }

      // If still UNKNOWN, try Metaplex metadata
      if (symbol === "UNKNOWN") {
        const metadataPda = this.getMetadataPda(mint);
        const metadataAccount = await this.rpc.execute(() =>
          this.rpc.getConnection().getAccountInfo(metadataPda)
        );

        if (metadataAccount?.data) {
          const parsed = this.parseMetaplexMetadata(metadataAccount.data);
          if (parsed) {
            symbol = parsed.symbol;
            name = parsed.name;
            uri = parsed.uri;
            log.debug("Metaplex metadata found", { mint: mintStr, symbol });
          }
        }
      }

      // If still UNKNOWN but have URI, fetch from IPFS/Arweave
      if (symbol === "UNKNOWN" && uri) {
        const uriMetadata = await this.fetchUriMetadata(uri);
        if (uriMetadata) {
          symbol = uriMetadata.symbol || symbol;
          name = uriMetadata.name || name;
          log.debug("URI metadata found", { mint: mintStr, symbol, uri });
        }
      }

    } catch (error) {
      log.warn("Metadata fetch error, using fallback", {
        mint: mintStr,
        error: (error as Error).message,
      });
    }

    // If still UNKNOWN, use short mint address as symbol
    if (symbol === "UNKNOWN") {
      symbol = mintStr.slice(0, 4).toUpperCase();
      name = `Token ${mintStr.slice(0, 8)}...`;
      log.debug("Using fallback metadata", { mint: mintStr, symbol });
    }

    const isRoot = this.rootTokenMint
      ? mint.equals(this.rootTokenMint)
      : false;

    const metadata: TokenMetadata = {
      mint,
      symbol,
      name,
      uri,
      isRoot,
    };

    // Cache with LRU eviction
    this.cacheMetadata(mintStr, metadata);

    return metadata;
  }

  /**
   * Get Metaplex metadata PDA for a mint
   */
  private getMetadataPda(mint: PublicKey): PublicKey {
    const METADATA_PROGRAM_ID = new PublicKey(
      "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
    );

    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        METADATA_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
      ],
      METADATA_PROGRAM_ID
    );

    return pda;
  }

  /**
   * Parse Metaplex metadata account data
   */
  private parseMetaplexMetadata(
    data: Buffer
  ): { symbol: string; name: string; uri: string } | null {
    try {
      // Skip discriminator (1 byte) + update authority (32 bytes) + mint (32 bytes)
      let offset = 1 + 32 + 32;

      // Read name (4-byte length prefix + string)
      const nameLen = data.readUInt32LE(offset);
      offset += 4;
      const name = data.slice(offset, offset + nameLen).toString("utf-8").replace(/\0/g, "").trim();
      offset += nameLen;

      // Read symbol (4-byte length prefix + string)
      const symbolLen = data.readUInt32LE(offset);
      offset += 4;
      const symbol = data.slice(offset, offset + symbolLen).toString("utf-8").replace(/\0/g, "").trim();
      offset += symbolLen;

      // Read URI (4-byte length prefix + string)
      const uriLen = data.readUInt32LE(offset);
      offset += 4;
      const uri = data.slice(offset, offset + uriLen).toString("utf-8").replace(/\0/g, "").trim();

      return { symbol, name, uri };
    } catch {
      return null;
    }
  }

  /**
   * Fetch metadata from URI (IPFS/Arweave/HTTP)
   * Returns name/symbol if found
   */
  private async fetchUriMetadata(uri: string): Promise<{ name?: string; symbol?: string } | null> {
    try {
      // Convert IPFS URI to HTTP gateway
      let fetchUrl = uri;
      if (uri.startsWith("ipfs://")) {
        fetchUrl = `https://ipfs.io/ipfs/${uri.slice(7)}`;
      } else if (uri.startsWith("ar://")) {
        fetchUrl = `https://arweave.net/${uri.slice(5)}`;
      }

      // Fetch with timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(fetchUrl, {
        signal: controller.signal,
        headers: { "Accept": "application/json" },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        return null;
      }

      const json = await response.json();
      return {
        name: json.name,
        symbol: json.symbol,
      };
    } catch (error) {
      log.debug("URI fetch failed", { uri, error: (error as Error).message });
      return null;
    }
  }

  /**
   * Cache metadata with LRU eviction
   */
  private cacheMetadata(mintStr: string, metadata: TokenMetadata): void {
    // Evict oldest if at capacity
    if (this.metadataCache.size >= METADATA_CACHE_MAX) {
      const oldest = this.metadataCache.keys().next().value;
      if (oldest) {
        this.metadataCache.delete(oldest);
      }
    }

    this.metadataCache.set(mintStr, {
      metadata,
      cachedAt: Date.now(),
    });
  }

  /**
   * Initialize tracking for a discovered token
   * Always succeeds - fetchMetadata provides fallback if needed
   */
  async initializeTracking(discovered: DiscoveredToken): Promise<TrackedToken> {
    const mintStr = discovered.mint.toBase58();

    // Already tracked?
    if (this.trackedTokens.has(mintStr)) {
      return this.trackedTokens.get(mintStr)!;
    }

    // Fetch metadata (always returns valid metadata with fallback)
    const metadata = await this.fetchMetadata(discovered.mint);

    const tracked: TrackedToken = {
      mint: discovered.mint,
      symbol: metadata.symbol,
      name: metadata.name,
      isRoot: metadata.isRoot,
      bondingCurve: discovered.bondingCurve,
      poolType: discovered.poolType,
      pendingFeesLamports: 0n,
      totalCollectedLamports: 0n,
      totalBurnedTokens: 0n,
      lastFeeUpdateSlot: 0,
      discoveredAt: discovered.discoveredAt,
      lastUpdatedAt: Date.now(),
    };

    this.trackedTokens.set(mintStr, tracked);

    log.info("Token tracking initialized", {
      mint: mintStr,
      symbol: metadata.symbol,
      isRoot: metadata.isRoot,
    });

    return tracked;
  }

  /**
   * Set root token manually
   */
  setRootToken(mint: PublicKey): void {
    this.rootTokenMint = mint;
    const mintStr = mint.toBase58();

    // Update tracked token if exists
    const tracked = this.trackedTokens.get(mintStr);
    if (tracked) {
      tracked.isRoot = true;
    }

    log.info("Root token set", { mint: mintStr });
  }

  /**
   * Get all tracked tokens
   */
  getTrackedTokens(): TrackedToken[] {
    return Array.from(this.trackedTokens.values());
  }

  /**
   * Get root token (tracked)
   */
  getRootToken(): TrackedToken | null {
    for (const token of this.trackedTokens.values()) {
      if (token.isRoot) {
        return token;
      }
    }
    return null;
  }

  /**
   * Get root token mint (even if not tracked)
   */
  getRootTokenMint(): PublicKey | null {
    return this.rootTokenMint;
  }

  /**
   * Get secondary tokens (non-root)
   */
  getSecondaryTokens(): TrackedToken[] {
    return Array.from(this.trackedTokens.values()).filter((t) => !t.isRoot);
  }

  /**
   * Get token by mint
   */
  getToken(mint: PublicKey): TrackedToken | undefined {
    return this.trackedTokens.get(mint.toBase58());
  }

  /**
   * Update token fees
   */
  updateTokenFees(mint: PublicKey, fees: bigint, slot: number): void {
    const token = this.trackedTokens.get(mint.toBase58());
    if (token) {
      token.pendingFeesLamports += fees;
      token.lastFeeUpdateSlot = slot;
      token.lastUpdatedAt = Date.now();
    }
  }

  /**
   * Reset token fees after flush
   */
  resetTokenFees(mint: PublicKey, burnSignature: string): void {
    const token = this.trackedTokens.get(mint.toBase58());
    if (token) {
      token.totalCollectedLamports += token.pendingFeesLamports;
      token.pendingFeesLamports = 0n;
      token.lastBurnSignature = burnSignature;
      token.lastUpdatedAt = Date.now();
    }
  }

  /**
   * Load pre-existing tracked tokens (for crash recovery)
   */
  loadTrackedTokens(tokens: TrackedToken[]): void {
    for (const token of tokens) {
      this.trackedTokens.set(token.mint.toBase58(), token);
      if (token.isRoot) {
        this.rootTokenMint = token.mint;
      }
    }
    log.info("Loaded tracked tokens", { count: tokens.length });
  }

  /**
   * Get creator vault PDA
   */
  getCreatorVaultPda(): PublicKey {
    // Bonding curve vault: ["creator-vault", creator]
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator-vault"), this.creatorPubkey.toBuffer()],
      new PublicKey(PUMP_BONDING_PROGRAM)
    );
    return pda;
  }

  /**
   * Get AMM creator vault PDA
   */
  getAmmCreatorVaultPda(): PublicKey {
    // PumpSwap vault: ["creator_vault", creator]
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator_vault"), this.creatorPubkey.toBuffer()],
      new PublicKey(PUMPSWAP_AMM_PROGRAM)
    );
    return pda;
  }

  // ============================================================================
  // NEW: "Don't trust, verify" architecture methods
  // These methods use the new token-verifier.ts for trustless verification
  // ============================================================================

  /**
   * Get stored tokens in minimal format
   * Only stores: mint + isRoot + optional metadata cache
   */
  getStoredTokens(): StoredToken[] {
    return Array.from(this.trackedTokens.values()).map(t => ({
      mint: t.mint.toBase58(),
      isRoot: t.isRoot,
      symbol: t.symbol,
      name: t.name,
    }));
  }

  /**
   * Verify a single token on-chain
   * Returns VerifiedToken with all derived/verified data
   */
  async verifyTokenOnChain(mint: PublicKey): Promise<VerifiedToken | null> {
    const tracked = this.trackedTokens.get(mint.toBase58());
    const stored: StoredToken = tracked
      ? {
          mint: tracked.mint.toBase58(),
          isRoot: tracked.isRoot,
          symbol: tracked.symbol,
          name: tracked.name,
        }
      : {
          mint: mint.toBase58(),
          isRoot: this.rootTokenMint?.equals(mint) ?? false,
        };

    return verifyToken(
      this.rpc.getConnection(),
      stored,
      this.creatorPubkey
    );
  }

  /**
   * Verify all tracked tokens on-chain
   * Returns only tokens that pass verification
   */
  async verifyAllTokensOnChain(): Promise<VerifiedToken[]> {
    const stored = this.getStoredTokens();
    return verifyTokens(
      this.rpc.getConnection(),
      stored,
      this.creatorPubkey
    );
  }

  /**
   * Discover and verify all tokens for the creator
   * This is the trustless discovery method
   */
  async discoverAndVerifyAll(): Promise<VerifiedToken[]> {
    return coreDiscoverAndVerify(
      this.rpc.getConnection(),
      this.creatorPubkey,
      this.rootTokenMint ?? undefined
    );
  }

  /**
   * Get derived addresses for a token
   * Useful for scripts that need PDAs without full verification
   */
  deriveAddresses(mint: PublicKey): {
    bondingCurve: PublicKey;
    ammPool: PublicKey;
    tokenStatsPda: PublicKey;
  } {
    return deriveTokenAddresses(mint);
  }

  /**
   * Convert TrackedToken to StoredToken (minimal format)
   */
  static toStored(tracked: TrackedToken): StoredToken {
    return {
      mint: tracked.mint.toBase58(),
      isRoot: tracked.isRoot,
      symbol: tracked.symbol,
      name: tracked.name,
    };
  }

  /**
   * Get creator pubkey
   */
  getCreatorPubkey(): PublicKey {
    return this.creatorPubkey;
  }

  /**
   * Get network
   */
  getNetwork(): "devnet" | "mainnet" {
    return this.network;
  }
}
