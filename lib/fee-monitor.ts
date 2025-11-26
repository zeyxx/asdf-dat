/**
 * PumpFun Fee Monitor v2
 *
 * Monitors PumpFun transactions to capture exact fee amounts per token
 * and update on-chain TokenStats.pending_fees for accurate per-token attribution.
 *
 * Architecture v2 - Balance Polling:
 * - Polls each bonding curve/pool for new transactions
 * - Extracts fees from preBalances/postBalances (BC) or preTokenBalances/postTokenBalances (AMM)
 * - Updates TokenStats via update_pending_fees instruction
 *
 * Key insight: All tokens share the same creator vault, but each has a unique
 * bonding curve/pool. By monitoring each BC/pool, we can attribute fees correctly.
 */

import {
  Connection,
  PublicKey,
  VersionedTransactionResponse,
} from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { BN } from "bn.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

export type PoolType = 'bonding_curve' | 'pumpswap_amm';

export interface FeeCapture {
  token: PublicKey;
  amount: number;  // lamports
  timestamp: number;
  signature: string;
  slot: number;
}

export interface TokenConfig {
  mint: PublicKey;
  bondingCurve: PublicKey;  // For BC tokens
  pool?: PublicKey;          // For AMM tokens
  creator: PublicKey;
  symbol: string;
  name: string;
  poolType: PoolType;
}

export interface MonitorConfig {
  connection: Connection;
  program: Program;
  tokens: TokenConfig[];
  pollInterval?: number;     // ms between polls (default: 5000 = 5s)
  updateInterval?: number;   // ms between batch updates (default: 30000 = 30s)
  verbose?: boolean;
}

// PumpFun program IDs
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const PUMPSWAP_PROGRAM = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

export class PumpFunFeeMonitor {
  private connection: Connection;
  private program: Program;
  private tokens: Map<string, TokenConfig>;  // keyed by mint
  private pendingFees: Map<string, bigint>;  // keyed by mint
  private lastSignatures: Map<string, string>;  // keyed by mint -> last processed signature
  private pollInterval: number;
  private updateInterval: number;
  private verbose: boolean;
  private pollTimer: NodeJS.Timeout | null;
  private updateTimer: NodeJS.Timeout | null;
  private isRunning: boolean = false;

  constructor(config: MonitorConfig) {
    this.connection = config.connection;
    this.program = config.program;
    this.tokens = new Map();
    this.pendingFees = new Map();
    this.lastSignatures = new Map();
    this.pollInterval = config.pollInterval || 5000;  // 5 seconds
    this.updateInterval = config.updateInterval || 30000;  // 30 seconds
    this.verbose = config.verbose || false;
    this.pollTimer = null;
    this.updateTimer = null;

    // Initialize token map (keyed by mint)
    for (const token of config.tokens) {
      this.tokens.set(token.mint.toBase58(), token);
      this.pendingFees.set(token.mint.toBase58(), 0n);
    }
  }

  /**
   * Start monitoring all configured tokens
   */
  async start(): Promise<void> {
    this.log("🔍 Starting PumpFun Fee Monitor v2 (Balance Polling)...");
    this.log(`📊 Monitoring ${this.tokens.size} tokens`);

    // Initialize last known signatures for each token
    for (const [mintKey, token] of this.tokens.entries()) {
      const poolAddress = this.getPoolAddress(token);
      try {
        const sigs = await this.connection.getSignaturesForAddress(
          poolAddress,
          { limit: 1 }
        );
        if (sigs.length > 0) {
          this.lastSignatures.set(mintKey, sigs[0].signature);
          this.log(`   📡 ${token.symbol}: Initialized at signature ${sigs[0].signature.slice(0, 20)}...`);
        }
      } catch (error: any) {
        this.log(`   ⚠️ ${token.symbol}: Could not initialize signature`);
      }
    }

    this.isRunning = true;

    // Start polling timer (replaces WebSocket subscriptions)
    this.pollTimer = setInterval(() => this.pollAllTokens(), this.pollInterval);
    this.log(`⏰ Poll timer started (interval: ${this.pollInterval / 1000}s)`);

    // Start periodic flush timer
    this.updateTimer = setInterval(() => this.flushPendingFees(), this.updateInterval);
    this.log(`⏰ Flush timer started (interval: ${this.updateInterval / 1000}s)`);

    this.log("✅ Monitor started successfully");
  }

  /**
   * Stop monitoring and cleanup
   */
  async stop(): Promise<void> {
    this.log("🛑 Stopping monitor...");
    this.isRunning = false;

    // Stop timers
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }

    // Flush any remaining pending fees
    await this.flushPendingFees();

    this.log("✅ Monitor stopped");
  }

  /**
   * Get the pool/bonding curve address for a token
   */
  private getPoolAddress(token: TokenConfig): PublicKey {
    if (token.poolType === 'pumpswap_amm' && token.pool) {
      return token.pool;
    }
    return token.bondingCurve;
  }

  /**
   * Derive creator vault address for bonding curve (native SOL)
   */
  private getBcCreatorVault(creator: PublicKey): PublicKey {
    const [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator-vault"), creator.toBuffer()],
      PUMP_PROGRAM
    );
    return vault;
  }

  /**
   * Derive creator vault ATA for AMM (WSOL)
   */
  private getAmmCreatorVaultAta(creator: PublicKey): PublicKey {
    const [vaultAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator_vault"), creator.toBuffer()],
      PUMPSWAP_PROGRAM
    );
    return getAssociatedTokenAddressSync(WSOL_MINT, vaultAuthority, true);
  }

  /**
   * Poll all tokens for new transactions
   */
  private async pollAllTokens(): Promise<void> {
    if (!this.isRunning) return;

    for (const [mintKey, token] of this.tokens.entries()) {
      try {
        await this.pollToken(mintKey, token);
      } catch (error: any) {
        if (this.verbose) {
          console.warn(`Poll error for ${token.symbol}:`, error.message);
        }
      }
    }
  }

  /**
   * Poll a single token for new transactions
   */
  private async pollToken(mintKey: string, token: TokenConfig): Promise<void> {
    const poolAddress = this.getPoolAddress(token);
    const lastSig = this.lastSignatures.get(mintKey);

    // Get recent signatures since last known
    const sigs = await this.connection.getSignaturesForAddress(
      poolAddress,
      { limit: 10, until: lastSig }
    );

    if (sigs.length === 0) return;

    // Process new transactions (oldest first for correct ordering)
    for (const sig of sigs.reverse()) {
      const fee = await this.extractFeeFromBalances(sig.signature, token);
      if (fee > 0) {
        const currentPending = this.pendingFees.get(mintKey) || 0n;
        const newPending = currentPending + BigInt(fee);
        this.pendingFees.set(mintKey, newPending);

        this.log(
          `💰 ${token.symbol}: +${(fee / 1e9).toFixed(6)} SOL ` +
          `(pending: ${(Number(newPending) / 1e9).toFixed(6)} SOL)`
        );
      }
    }

    // Update last signature to most recent
    this.lastSignatures.set(mintKey, sigs[0].signature);
  }

  /**
   * Extract fee from transaction balance changes
   * This is the key improvement over log parsing - it actually works!
   */
  private async extractFeeFromBalances(
    signature: string,
    token: TokenConfig
  ): Promise<number> {
    try {
      const tx = await this.connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      });

      if (!tx || !tx.meta) return 0;

      if (token.poolType === 'bonding_curve') {
        return this.extractBcFee(tx, token);
      } else {
        return this.extractAmmFee(tx, token);
      }
    } catch (error: any) {
      if (this.verbose) {
        console.error(`Error extracting fee from tx ${signature}:`, error.message);
      }
      return 0;
    }
  }

  /**
   * Extract fee from bonding curve transaction (native SOL balance change)
   */
  private extractBcFee(
    tx: VersionedTransactionResponse,
    token: TokenConfig
  ): number {
    if (!tx.meta) return 0;

    // Get creator vault address
    const creatorVault = this.getBcCreatorVault(token.creator);

    // Find vault in account keys
    const keys = tx.transaction.message.staticAccountKeys;
    const vaultIdx = keys.findIndex(
      (k: PublicKey) => k.toBase58() === creatorVault.toBase58()
    );

    if (vaultIdx < 0) return 0;

    // Calculate fee from balance change
    const preBalance = tx.meta.preBalances[vaultIdx];
    const postBalance = tx.meta.postBalances[vaultIdx];
    const delta = postBalance - preBalance;

    // Only positive deltas are fees (negative = collection)
    return delta > 0 ? delta : 0;
  }

  /**
   * Extract fee from AMM transaction (WSOL token balance change)
   */
  private extractAmmFee(
    tx: VersionedTransactionResponse,
    token: TokenConfig
  ): number {
    if (!tx.meta || !tx.meta.postTokenBalances) return 0;

    // Get creator vault WSOL ATA
    const vaultAta = this.getAmmCreatorVaultAta(token.creator);
    const vaultAtaStr = vaultAta.toBase58();

    // Find WSOL balance for vault ATA
    for (const postBalance of tx.meta.postTokenBalances) {
      // Check if this is WSOL for our vault
      if (postBalance.mint !== WSOL_MINT.toBase58()) continue;

      // Find corresponding account key
      const keys = tx.transaction.message.staticAccountKeys;
      if (postBalance.accountIndex >= keys.length) continue;

      const accountKey = keys[postBalance.accountIndex].toBase58();
      if (accountKey !== vaultAtaStr) continue;

      // Find pre-balance
      const preBalance = tx.meta.preTokenBalances?.find(
        b => b.accountIndex === postBalance.accountIndex
      );

      const postAmount = Number(postBalance.uiTokenAmount.amount);
      const preAmount = preBalance ? Number(preBalance.uiTokenAmount.amount) : 0;
      const delta = postAmount - preAmount;

      // Only positive deltas are fees
      return delta > 0 ? delta : 0;
    }

    return 0;
  }

  /**
   * Flush pending fees to on-chain TokenStats
   */
  private async flushPendingFees(): Promise<void> {
    for (const [mintKey, pendingAmount] of this.pendingFees.entries()) {
      if (pendingAmount === 0n) continue;

      const token = this.tokens.get(mintKey);
      if (!token) continue;

      try {
        // Call update_pending_fees instruction
        await this.updatePendingFeesOnChain(token.mint, Number(pendingAmount));

        // Reset pending after successful update
        this.pendingFees.set(mintKey, 0n);

        this.log(
          `✅ ${token.symbol}: Flushed ${(Number(pendingAmount) / 1e9).toFixed(6)} SOL to on-chain`
        );
      } catch (error: any) {
        console.error(`Error flushing fees for ${token.symbol}:`, error.message);
      }
    }
  }

  /**
   * Update pending fees on-chain via update_pending_fees instruction
   */
  private async updatePendingFeesOnChain(
    mint: PublicKey,
    amountLamports: number
  ): Promise<string> {
    const DAT_STATE_SEED = Buffer.from("dat_v3");
    const TOKEN_STATS_SEED = Buffer.from("token_stats_v1");

    const [datState] = PublicKey.findProgramAddressSync(
      [DAT_STATE_SEED],
      this.program.programId
    );

    const [tokenStats] = PublicKey.findProgramAddressSync(
      [TOKEN_STATS_SEED, mint.toBuffer()],
      this.program.programId
    );

    const tx = await this.program.methods
      .updatePendingFees(new BN(amountLamports))
      .accounts({
        datState,
        tokenStats,
        mint,
        admin: (this.program.provider as AnchorProvider).wallet.publicKey,
      })
      .rpc();

    return tx;
  }

  /**
   * Get current pending fees for a token (not yet flushed to on-chain)
   */
  public getPendingFees(mint: PublicKey): number {
    return Number(this.pendingFees.get(mint.toBase58()) || 0n);
  }

  /**
   * Get total pending fees across all tokens
   */
  public getTotalPendingFees(): number {
    let total = 0n;
    for (const amount of this.pendingFees.values()) {
      total += amount;
    }
    return Number(total);
  }

  /**
   * Get pending fees breakdown by token
   */
  public getPendingFeesBreakdown(): Map<string, { symbol: string; amount: number }> {
    const breakdown = new Map<string, { symbol: string; amount: number }>();
    for (const [mintKey, amount] of this.pendingFees.entries()) {
      const token = this.tokens.get(mintKey);
      if (token) {
        breakdown.set(mintKey, {
          symbol: token.symbol,
          amount: Number(amount),
        });
      }
    }
    return breakdown;
  }

  private log(message: string): void {
    // Always log important messages, verbose logs only in verbose mode
    const isImportant = message.includes("✅") ||
                        message.includes("❌") ||
                        message.includes("🔍") ||
                        message.includes("💰") ||
                        message.includes("🛑");

    if (this.verbose || isImportant) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] ${message}`);
    }
  }
}
