/**
 * Real-time Fee Tracker
 *
 * WebSocket-based fee detection with ~400ms latency.
 * Monitors vault account changes and attributes fees to tokens.
 *
 * Inspired by asdf-validator RealtimeTracker.
 *
 * Flow:
 * 1. Subscribe to vault account changes via WebSocket
 * 2. Detect balance increases (incoming fees)
 * 3. Fetch recent transactions to attribute fee to specific token
 * 4. Record in PoH chain for tamper-proof history
 * 5. Emit events for downstream processing
 */

import {
  Connection,
  PublicKey,
  ParsedTransactionWithMeta,
} from "@solana/web3.js";
import { EventEmitter } from "events";
import { WebSocketManager, AccountUpdate } from "../utils/websocket-manager";
import { HistoryManager, initHistory, getHistory } from "../utils/history-manager";
import { createLogger, Logger } from "../observability/logger";
import { withRetryAndTimeout } from "../network/rpc-utils";

// WSOL mint - used to filter out SOL transfers when identifying token mints
const WSOL_MINT = "So11111111111111111111111111111111111111112";

// Slot tolerance for transaction matching
const SLOT_TOLERANCE = 5;

export interface TokenInfo {
  mint: string;
  symbol: string;
  name: string;
  creator: string;
  bondingCurve?: string;
  pool?: string;
}

export interface FeeEvent {
  type: "fee_detected" | "fee_attributed" | "orphaned_fee";
  vault: string;
  amount: number;
  slot: number;
  timestamp: number;
  mint?: string;
  symbol?: string;
  signature?: string;
}

export interface TokenStats {
  mint: string;
  symbol: string;
  totalFees: number;
  feeCount: number;
  lastFeeSlot: number;
  lastFeeTimestamp: number;
}

export interface RealtimeTrackerConfig {
  connection: Connection;
  creatorAddress: string;
  bcVault: string;        // Bonding curve vault (native SOL)
  ammVault?: string;      // AMM vault (WSOL ATA) - optional if no migrated tokens
  knownTokens?: TokenInfo[];
  verbose?: boolean;
  enableHistory?: boolean;
  historyDir?: string;
  maxTokensInCache?: number;
}

export class RealtimeTracker extends EventEmitter {
  private connection: Connection;
  private creatorAddress: string;
  private bcVault: PublicKey;
  private ammVault: PublicKey | null;
  private wsManager: WebSocketManager;
  private history: HistoryManager | null = null;
  private logger: Logger;
  private verbose: boolean;

  // State
  private isRunning = false;
  private lastBcBalance = 0;
  private lastAmmBalance = 0;
  private lastBcSlot = 0;
  private lastAmmSlot = 0;

  // Token tracking
  private knownTokens: Map<string, TokenInfo> = new Map();
  private tokenStats: Map<string, TokenStats> = new Map();
  private maxTokensInCache: number;

  // Totals
  private totalBcFees = 0;
  private totalAmmFees = 0;
  private totalAttributed = 0;
  private totalOrphaned = 0;

  constructor(config: RealtimeTrackerConfig) {
    super();
    this.connection = config.connection;
    this.creatorAddress = config.creatorAddress;
    this.bcVault = new PublicKey(config.bcVault);
    this.ammVault = config.ammVault ? new PublicKey(config.ammVault) : null;
    this.verbose = config.verbose ?? false;
    this.maxTokensInCache = config.maxTokensInCache ?? 1000;

    this.logger = createLogger("realtime", {
      level: this.verbose ? "debug" : "info",
      console: true,
    });

    // Initialize WebSocket manager
    this.wsManager = new WebSocketManager({
      connection: this.connection,
      verbose: this.verbose,
    });

    // Initialize known tokens
    if (config.knownTokens) {
      for (const token of config.knownTokens) {
        this.knownTokens.set(token.mint, token);
        this.tokenStats.set(token.mint, {
          mint: token.mint,
          symbol: token.symbol,
          totalFees: 0,
          feeCount: 0,
          lastFeeSlot: 0,
          lastFeeTimestamp: 0,
        });
      }
    }

    // Initialize history manager if enabled
    if (config.enableHistory !== false) {
      this.history = initHistory({
        dataDir: config.historyDir ?? "./data/history",
        verbose: this.verbose,
      });
    }
  }

  /**
   * Start real-time tracking
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn("Tracker already running");
      return;
    }

    this.logger.info("Starting real-time tracker...");

    // Initialize history if enabled
    if (this.history) {
      await this.history.initialize();
      await this.history.recordDaemonStart();
    }

    // Get initial balances
    await this.fetchInitialBalances();

    // Subscribe to vault accounts
    await this.subscribeToVaults();

    this.isRunning = true;
    this.logger.info("Real-time tracker started");
    this.emit("started");
  }

  /**
   * Stop tracking
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.logger.info("Stopping real-time tracker...");

    if (this.history) {
      await this.history.recordDaemonStop();
    }

    await this.wsManager.shutdown();
    this.isRunning = false;

    this.logger.info("Real-time tracker stopped");
    this.emit("stopped");
  }

  /**
   * Fetch initial vault balances
   */
  private async fetchInitialBalances(): Promise<void> {
    try {
      // BC vault (native SOL)
      const bcBalance = await withRetryAndTimeout(
        () => this.connection.getBalance(this.bcVault),
        { maxRetries: 3 },
        10000
      );
      this.lastBcBalance = bcBalance;
      this.logger.debug(`Initial BC vault balance: ${bcBalance / 1e9} SOL`);

      // AMM vault (if configured)
      if (this.ammVault) {
        const ammInfo = await withRetryAndTimeout(
          () => this.connection.getAccountInfo(this.ammVault!),
          { maxRetries: 3 },
          10000
        );
        this.lastAmmBalance = ammInfo?.lamports ?? 0;
        this.logger.debug(`Initial AMM vault balance: ${this.lastAmmBalance / 1e9} SOL`);
      }
    } catch (err: any) {
      this.logger.error("Failed to fetch initial balances", { error: err.message });
      throw err;
    }
  }

  /**
   * Subscribe to vault account changes
   */
  private async subscribeToVaults(): Promise<void> {
    // Subscribe to BC vault
    await this.wsManager.subscribeToAccount(
      this.bcVault,
      (update) => this.handleBcUpdate(update)
    );
    this.logger.info(`Subscribed to BC vault: ${this.bcVault.toBase58().slice(0, 8)}...`);

    // Subscribe to AMM vault if configured
    if (this.ammVault) {
      await this.wsManager.subscribeToAccount(
        this.ammVault,
        (update) => this.handleAmmUpdate(update)
      );
      this.logger.info(`Subscribed to AMM vault: ${this.ammVault.toBase58().slice(0, 8)}...`);
    }
  }

  /**
   * Handle bonding curve vault update
   */
  private async handleBcUpdate(update: AccountUpdate): Promise<void> {
    try {
      const delta = update.lamports - this.lastBcBalance;

      if (delta > 0) {
        // Positive delta = incoming fee
        this.logger.info(`BC fee detected: +${delta / 1e9} SOL at slot ${update.slot}`);
        this.totalBcFees += delta;

        const event: FeeEvent = {
          type: "fee_detected",
          vault: "bc",
          amount: delta,
          slot: update.slot,
          timestamp: update.timestamp,
        };

        this.emit("fee_detected", event);

        // Attribute fee to token
        await this.attributeFee(delta, update.slot, "bc");
      }

      this.lastBcBalance = update.lamports;
      this.lastBcSlot = update.slot;
    } catch (err: any) {
      this.logger.error("Error handling BC update", { error: err.message });
    }
  }

  /**
   * Handle AMM vault update
   */
  private async handleAmmUpdate(update: AccountUpdate): Promise<void> {
    try {
      const delta = update.lamports - this.lastAmmBalance;

      if (delta > 0) {
        // Positive delta = incoming fee
        this.logger.info(`AMM fee detected: +${delta / 1e9} SOL at slot ${update.slot}`);
        this.totalAmmFees += delta;

        const event: FeeEvent = {
          type: "fee_detected",
          vault: "amm",
          amount: delta,
          slot: update.slot,
          timestamp: update.timestamp,
        };

        this.emit("fee_detected", event);

        // Attribute fee to token
        await this.attributeFee(delta, update.slot, "amm");
      }

      this.lastAmmBalance = update.lamports;
      this.lastAmmSlot = update.slot;
    } catch (err: any) {
      this.logger.error("Error handling AMM update", { error: err.message });
    }
  }

  /**
   * Attribute fee to specific token
   * Fetches recent transactions and identifies which token generated the fee
   */
  private async attributeFee(
    amount: number,
    slot: number,
    vaultType: "bc" | "amm"
  ): Promise<void> {
    const vault = vaultType === "bc" ? this.bcVault : this.ammVault!;

    try {
      // Fetch recent transactions for the vault
      const signatures = await withRetryAndTimeout(
        () => this.connection.getSignaturesForAddress(vault, { limit: 20 }),
        { maxRetries: 3 },
        15000
      );

      // Find transaction within slot tolerance
      const matchingTx = signatures.find(
        (sig) => Math.abs(sig.slot - slot) <= SLOT_TOLERANCE
      );

      if (!matchingTx) {
        this.logger.warn(`No matching transaction found for fee at slot ${slot}`);
        await this.recordOrphanedFee(amount, slot, vaultType);
        return;
      }

      // Fetch full transaction to extract token mint
      const tx = await withRetryAndTimeout(
        () => this.connection.getParsedTransaction(matchingTx.signature, {
          maxSupportedTransactionVersion: 0,
        }),
        { maxRetries: 3 },
        15000
      );

      if (!tx) {
        this.logger.warn(`Transaction not found: ${matchingTx.signature.slice(0, 8)}...`);
        await this.recordOrphanedFee(amount, slot, vaultType);
        return;
      }

      // Extract token mint from transaction
      const mint = this.extractMintFromTransaction(tx);

      if (!mint) {
        this.logger.warn(`Could not extract mint from tx ${matchingTx.signature.slice(0, 8)}...`);
        await this.recordOrphanedFee(amount, slot, vaultType);
        return;
      }

      // Get or discover token info
      let tokenInfo: TokenInfo | undefined = this.knownTokens.get(mint);
      if (!tokenInfo) {
        const discovered = await this.discoverToken(mint);
        tokenInfo = discovered ?? undefined;
      }

      if (!tokenInfo) {
        this.logger.warn(`Could not get info for mint ${mint.slice(0, 8)}...`);
        await this.recordOrphanedFee(amount, slot, vaultType);
        return;
      }

      // Record attributed fee
      await this.recordAttributedFee(
        tokenInfo,
        amount,
        slot,
        matchingTx.signature,
        vaultType
      );

    } catch (err: any) {
      this.logger.error("Error attributing fee", { error: err.message, slot });
      await this.recordOrphanedFee(amount, slot, vaultType);
    }
  }

  /**
   * Extract token mint from parsed transaction
   * Looks for non-WSOL token balance changes
   */
  private extractMintFromTransaction(tx: ParsedTransactionWithMeta): string | null {
    const meta = tx.meta;
    if (!meta) return null;

    // Check post token balances for non-WSOL mints
    const postTokenBalances = meta.postTokenBalances ?? [];

    for (const balance of postTokenBalances) {
      if (balance.mint && balance.mint !== WSOL_MINT) {
        return balance.mint;
      }
    }

    // Check pre token balances as fallback
    const preTokenBalances = meta.preTokenBalances ?? [];

    for (const balance of preTokenBalances) {
      if (balance.mint && balance.mint !== WSOL_MINT) {
        return balance.mint;
      }
    }

    return null;
  }

  /**
   * Discover token info from mint address
   */
  private async discoverToken(mint: string): Promise<TokenInfo | null> {
    try {
      // TODO: Integrate with token-discovery.ts for full metadata fetch
      // For now, create minimal info
      const tokenInfo: TokenInfo = {
        mint,
        symbol: mint.slice(0, 4).toUpperCase(),
        name: `Token ${mint.slice(0, 8)}`,
        creator: this.creatorAddress,
      };

      // Cache token
      this.knownTokens.set(mint, tokenInfo);

      // Initialize stats
      this.tokenStats.set(mint, {
        mint,
        symbol: tokenInfo.symbol,
        totalFees: 0,
        feeCount: 0,
        lastFeeSlot: 0,
        lastFeeTimestamp: 0,
      });

      // Evict oldest if cache is full
      if (this.knownTokens.size > this.maxTokensInCache) {
        const oldest = this.knownTokens.keys().next().value;
        if (oldest) {
          this.knownTokens.delete(oldest);
          this.tokenStats.delete(oldest);
        }
      }

      // Note: Token discovery no longer recorded in PoH (redundant - on-chain TokenStats init)
      this.logger.info(`Discovered new token: ${tokenInfo.symbol} (${mint.slice(0, 8)}...)`);
      this.emit("token_discovered", tokenInfo);

      return tokenInfo;
    } catch (err: any) {
      this.logger.error("Error discovering token", { mint, error: err.message });
      return null;
    }
  }

  /**
   * Record attributed fee
   */
  private async recordAttributedFee(
    token: TokenInfo,
    amount: number,
    slot: number,
    signature: string,
    vaultType: "bc" | "amm"
  ): Promise<void> {
    // Update stats
    const stats = this.tokenStats.get(token.mint);
    if (stats) {
      stats.totalFees += amount;
      stats.feeCount++;
      stats.lastFeeSlot = slot;
      stats.lastFeeTimestamp = Date.now();
    }

    this.totalAttributed += amount;

    // Note: Fee attribution no longer recorded in PoH (redundant - on-chain signature)

    const event: FeeEvent = {
      type: "fee_attributed",
      vault: vaultType,
      amount,
      slot,
      timestamp: Date.now(),
      mint: token.mint,
      symbol: token.symbol,
      signature,
    };

    this.logger.info(`Fee attributed: ${token.symbol} +${amount / 1e9} SOL`);
    this.emit("fee_attributed", event);
  }

  /**
   * Record orphaned fee (could not attribute to specific token)
   */
  private async recordOrphanedFee(
    amount: number,
    slot: number,
    vaultType: "bc" | "amm"
  ): Promise<void> {
    this.totalOrphaned += amount;

    if (this.history) {
      await this.history.recordError("orphaned_fee", {
        amount,
        slot,
        vault: vaultType,
      });
    }

    const event: FeeEvent = {
      type: "orphaned_fee",
      vault: vaultType,
      amount,
      slot,
      timestamp: Date.now(),
    };

    this.emit("orphaned_fee", event);
  }

  /**
   * Register a known token
   */
  registerToken(token: TokenInfo): void {
    this.knownTokens.set(token.mint, token);

    if (!this.tokenStats.has(token.mint)) {
      this.tokenStats.set(token.mint, {
        mint: token.mint,
        symbol: token.symbol,
        totalFees: 0,
        feeCount: 0,
        lastFeeSlot: 0,
        lastFeeTimestamp: 0,
      });
    }

    this.logger.debug(`Registered token: ${token.symbol}`);
  }

  /**
   * Get stats for all tracked tokens
   */
  getTokenStats(): Map<string, TokenStats> {
    return new Map(this.tokenStats);
  }

  /**
   * Get stats for a specific token
   */
  getTokenStat(mint: string): TokenStats | undefined {
    return this.tokenStats.get(mint);
  }

  /**
   * Get total fees by vault type
   */
  getTotals(): {
    bcFees: number;
    ammFees: number;
    totalFees: number;
    attributed: number;
    orphaned: number;
  } {
    return {
      bcFees: this.totalBcFees,
      ammFees: this.totalAmmFees,
      totalFees: this.totalBcFees + this.totalAmmFees,
      attributed: this.totalAttributed,
      orphaned: this.totalOrphaned,
    };
  }

  /**
   * Get current vault balances
   */
  getVaultBalances(): { bc: number; amm: number; bcSlot: number; ammSlot: number } {
    return {
      bc: this.lastBcBalance,
      amm: this.lastAmmBalance,
      bcSlot: this.lastBcSlot,
      ammSlot: this.lastAmmSlot,
    };
  }

  /**
   * Check if tracker is running
   */
  isTracking(): boolean {
    return this.isRunning;
  }

  /**
   * Get history attestation
   */
  getHistoryAttestation(): ReturnType<HistoryManager["getAttestation"]> | null {
    return this.history?.getAttestation() ?? null;
  }

  /**
   * Get recent history entries
   */
  getRecentHistory(count = 50): ReturnType<HistoryManager["getRecentEntries"]> {
    return this.history?.getRecentEntries(count) ?? [];
  }
}
