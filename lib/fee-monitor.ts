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
import * as fs from "fs";
import * as path from "path";
import { withRetryAndTimeout, sleep } from "./rpc-utils";

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
  stateFile?: string;        // Path to persist state (default: .daemon-state.json)
  txLimit?: number;          // Max transactions per poll (default: 50)
  // Adaptive polling config
  minPollInterval?: number;  // Minimum poll interval (default: 3000 = 3s)
  maxPollInterval?: number;  // Maximum poll interval (default: 30000 = 30s)
  adaptivePolling?: boolean; // Enable adaptive polling (default: true)
}

// State persistence interface
interface DaemonState {
  lastSignatures: Record<string, string>;
  lastUpdated: string;
  version: number;
}

/**
 * Result of a flush operation - exported for use by orchestrator
 */
export interface FlushResult {
  success: boolean;
  tokensUpdated: number;
  tokensFailed: number;
  totalFlushed: number;
  remainingPending: number;
  details: Array<{
    symbol: string;
    mint: string;
    amount: number;
    success: boolean;
    error?: string;
  }>;
}

const STATE_VERSION = 1;
const DEFAULT_STATE_FILE = ".daemon-state.json";
const DEFAULT_TX_LIMIT = 50;  // Increased from 10 for scalability

// PumpFun program IDs
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const PUMPSWAP_PROGRAM = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

// ASDF-DAT program - transactions from this program are internal operations
// (buyback, burn, collect) and do NOT generate Pump.fun creator fees
const ASDF_PROGRAM = new PublicKey("ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui");

export class PumpFunFeeMonitor {
  private connection: Connection;
  private program: Program;
  private tokens: Map<string, TokenConfig>;  // keyed by mint
  private pendingFees: Map<string, bigint>;  // keyed by mint
  private lastSignatures: Map<string, string>;  // keyed by mint -> last processed signature
  private processedSignatures: Set<string>;  // Deduplication: track all processed signatures
  private signatureQueue: string[];  // FIFO queue for memory-bounded cleanup
  private readonly MAX_SIGNATURES = 10000;  // Maximum signatures to keep in memory
  private pollInterval: number;
  private updateInterval: number;
  private verbose: boolean;
  private pollTimer: NodeJS.Timeout | null;
  private updateTimer: NodeJS.Timeout | null;
  private isRunning: boolean = false;
  private stateFile: string;
  private txLimit: number;
  // Adaptive polling state
  private minPollInterval: number;
  private maxPollInterval: number;
  private adaptivePolling: boolean;
  private currentPollInterval: number;
  private consecutiveErrors: number = 0;
  private consecutiveSuccess: number = 0;
  // Health metrics
  private pollCount: number = 0;
  private errorCount: number = 0;
  private feesCaptured: number = 0;
  private lastPollTime: number = 0;

  constructor(config: MonitorConfig) {
    this.connection = config.connection;
    this.program = config.program;
    this.tokens = new Map();
    this.pendingFees = new Map();
    this.lastSignatures = new Map();
    this.processedSignatures = new Set();
    this.signatureQueue = [];
    this.pollInterval = config.pollInterval || 5000;  // 5 seconds
    this.updateInterval = config.updateInterval || 30000;  // 30 seconds
    this.verbose = config.verbose || false;
    this.pollTimer = null;
    this.updateTimer = null;
    this.stateFile = config.stateFile || DEFAULT_STATE_FILE;
    this.txLimit = config.txLimit || DEFAULT_TX_LIMIT;
    // Adaptive polling
    this.minPollInterval = config.minPollInterval || 3000;   // 3s minimum
    this.maxPollInterval = config.maxPollInterval || 30000;  // 30s maximum
    this.adaptivePolling = config.adaptivePolling !== false; // default true
    this.currentPollInterval = this.pollInterval;

    // Initialize token map (keyed by mint)
    for (const token of config.tokens) {
      this.tokens.set(token.mint.toBase58(), token);
      this.pendingFees.set(token.mint.toBase58(), 0n);
    }

    // Load persisted state if exists
    this.loadState();
  }

  /**
   * Load persisted state from disk with backup fallback
   */
  private loadState(): void {
    const backupFile = this.stateFile.replace('.json', '.backup.json');

    // Try main file first, then backup
    for (const file of [this.stateFile, backupFile]) {
      try {
        if (!fs.existsSync(file)) continue;

        const data = fs.readFileSync(file, 'utf8');
        const state: DaemonState = JSON.parse(data);

        if (state.version === STATE_VERSION) {
          // Restore last signatures for known tokens only
          let restoredCount = 0;
          for (const [mintKey, signature] of Object.entries(state.lastSignatures)) {
            if (this.tokens.has(mintKey)) {
              this.lastSignatures.set(mintKey, signature);
              restoredCount++;
            }
          }

          const source = file === backupFile ? 'backup' : 'state';
          this.log(`📂 Loaded ${source} from ${file} (${restoredCount}/${Object.keys(state.lastSignatures).length} signatures)`);

          // If loaded from backup, immediately save to restore main file
          if (file === backupFile) {
            this.log(`🔧 Restoring main state file from backup...`);
            this.saveState();
          }
          return; // Successfully loaded
        } else {
          this.log(`⚠️ ${file}: version mismatch (v${state.version} vs v${STATE_VERSION})`);
        }
      } catch (error: any) {
        this.log(`⚠️ Failed to load ${file}: ${error.message}`);
      }
    }

    this.log(`📝 No valid state found, starting fresh`);
  }

  /**
   * Save current state to disk with atomic write and backup
   * Uses temp file + fsync + rename pattern for crash safety
   */
  private saveState(): void {
    try {
      const state: DaemonState = {
        lastSignatures: Object.fromEntries(this.lastSignatures),
        lastUpdated: new Date().toISOString(),
        version: STATE_VERSION,
      };

      const stateJson = JSON.stringify(state, null, 2);
      const backupFile = this.stateFile.replace('.json', '.backup.json');

      // Create backup of existing state before overwriting
      if (fs.existsSync(this.stateFile)) {
        try {
          fs.copyFileSync(this.stateFile, backupFile);
        } catch {
          // Ignore backup errors, proceed with save
        }
      }

      // Atomic write: temp file → fsync → rename
      const tempFile = `${this.stateFile}.tmp.${process.pid}`;
      const fd = fs.openSync(tempFile, 'w');
      try {
        fs.writeSync(fd, stateJson);
        fs.fsyncSync(fd); // Flush to disk before rename
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tempFile, this.stateFile);
    } catch (error: any) {
      if (this.verbose) {
        console.error(`Error saving state: ${error.message}`);
      }
    }
  }

  /**
   * Start monitoring all configured tokens
   */
  async start(): Promise<void> {
    this.log("🔍 Starting PumpFun Fee Monitor v2 (Balance Polling)...");
    this.log(`📊 Monitoring ${this.tokens.size} tokens (limit: ${this.txLimit} TX/poll)`);
    if (this.adaptivePolling) {
      this.log(`🔄 Adaptive polling enabled (${this.minPollInterval/1000}s - ${this.maxPollInterval/1000}s)`);
    }

    // Initialize last known signatures for tokens WITHOUT persisted state
    let loadedCount = 0;
    let initializedCount = 0;

    for (const [mintKey, token] of this.tokens.entries()) {
      // Skip if already loaded from persisted state
      if (this.lastSignatures.has(mintKey)) {
        loadedCount++;
        this.log(`   📂 ${token.symbol}: Restored from state`);
        continue;
      }

      // Initialize from blockchain with retry
      const poolAddress = this.getPoolAddress(token);
      try {
        const sigs = await withRetryAndTimeout(
          () => this.connection.getSignaturesForAddress(poolAddress, { limit: 1 }),
          { maxRetries: 3, baseDelayMs: 1000 },
          10000
        );
        if (sigs.length > 0) {
          this.lastSignatures.set(mintKey, sigs[0].signature);
          initializedCount++;
          this.log(`   📡 ${token.symbol}: Initialized at signature ${sigs[0].signature.slice(0, 20)}...`);
        }
      } catch (error: any) {
        this.log(`   ⚠️ ${token.symbol}: Could not initialize signature: ${error.message}`);
      }
    }

    if (loadedCount > 0) {
      this.log(`📂 Restored ${loadedCount} tokens from state, initialized ${initializedCount} new`);
    }

    this.isRunning = true;

    // Start adaptive polling loop (instead of fixed interval)
    this.startAdaptivePolling();
    this.log(`⏰ Poll loop started (initial: ${this.currentPollInterval / 1000}s)`);

    // Start periodic flush timer
    this.updateTimer = setInterval(() => this.flushPendingFees(), this.updateInterval);
    this.log(`⏰ Flush timer started (interval: ${this.updateInterval / 1000}s)`);

    this.log("✅ Monitor started successfully");
  }

  /**
   * Start adaptive polling loop
   * Adjusts poll interval based on success/error rates
   */
  private async startAdaptivePolling(): Promise<void> {
    while (this.isRunning) {
      const startTime = Date.now();
      this.lastPollTime = startTime;
      this.pollCount++;

      try {
        await this.pollAllTokens();

        // Track success for adaptive interval
        if (this.adaptivePolling) {
          this.consecutiveSuccess++;
          this.consecutiveErrors = 0;

          // Decrease interval on sustained success (speed up)
          if (this.consecutiveSuccess >= 5) {
            this.currentPollInterval = Math.max(
              this.minPollInterval,
              this.currentPollInterval * 0.9
            );
            this.consecutiveSuccess = 0;
          }
        }
      } catch (error: any) {
        this.errorCount++;

        if (this.adaptivePolling) {
          this.consecutiveErrors++;
          this.consecutiveSuccess = 0;

          // Increase interval on errors (back off)
          if (this.consecutiveErrors >= 2) {
            this.currentPollInterval = Math.min(
              this.maxPollInterval,
              this.currentPollInterval * 1.5
            );
            this.log(`⚠️ Backing off poll interval to ${(this.currentPollInterval/1000).toFixed(1)}s due to errors`);
          }
        }

        if (this.verbose) {
          console.error(`Poll cycle error: ${error.message}`);
        }
      }

      // Wait for next poll (accounting for execution time)
      const elapsed = Date.now() - startTime;
      const waitTime = Math.max(100, this.currentPollInterval - elapsed);
      await sleep(waitTime);
    }
  }

  /**
   * Stop monitoring and cleanup
   */
  async stop(): Promise<void> {
    this.log("🛑 Stopping monitor...");
    this.isRunning = false;

    // Stop flush timer
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }

    // Wait for current poll to finish (max 5s)
    await sleep(Math.min(this.currentPollInterval, 5000));

    // Flush any remaining pending fees
    await this.flushPendingFees();

    // Save state for next startup
    this.saveState();
    this.log(`💾 State saved to ${this.stateFile}`);

    // Log health metrics
    const errorRate = this.pollCount > 0 ? (this.errorCount / this.pollCount * 100).toFixed(1) : '0';
    this.log(`📊 Session stats: ${this.pollCount} polls, ${this.errorCount} errors (${errorRate}%), ${this.feesCaptured} fees captured`);

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

    // Get recent signatures since last known with retry
    // 30s timeout for mainnet resilience
    const sigs = await withRetryAndTimeout(
      () => this.connection.getSignaturesForAddress(
        poolAddress,
        { limit: this.txLimit, until: lastSig }
      ),
      { maxRetries: 3, baseDelayMs: 1000 },
      30000
    );

    if (sigs.length === 0) return;

    // Warn if we hit the limit (might have missed transactions)
    if (sigs.length >= this.txLimit) {
      this.log(`⚠️ ${token.symbol}: Hit TX limit (${this.txLimit}), may have missed older transactions`);
    }

    // Process new transactions (oldest first for correct ordering)
    let feesInBatch = 0;
    const processedInBatch: string[] = [];

    for (const sig of sigs.reverse()) {
      // Deduplication: Skip if already processed (prevents double-counting)
      if (this.processedSignatures.has(sig.signature)) {
        if (this.verbose) {
          console.log(`   ⏭️ Skipping duplicate signature: ${sig.signature.slice(0, 20)}...`);
        }
        continue;
      }

      const fee = await this.extractFeeFromBalances(sig.signature, token);
      if (fee > 0) {
        feesInBatch++;
        this.feesCaptured++;
        const currentPending = this.pendingFees.get(mintKey) || 0n;
        const newPending = currentPending + BigInt(fee);
        this.pendingFees.set(mintKey, newPending);

        this.log(
          `💰 ${token.symbol}: +${(fee / 1e9).toFixed(6)} SOL ` +
          `(pending: ${(Number(newPending) / 1e9).toFixed(6)} SOL)`
        );
      }

      // Track processed signatures for deduplication
      processedInBatch.push(sig.signature);
      this.processedSignatures.add(sig.signature);
      this.signatureQueue.push(sig.signature);
    }

    // Memory cleanup: remove oldest signatures when exceeding limit
    // Done outside loop for efficiency (batch cleanup)
    while (this.signatureQueue.length > this.MAX_SIGNATURES) {
      const oldest = this.signatureQueue.shift();
      if (oldest) {
        this.processedSignatures.delete(oldest);
      }
    }

    // CRITICAL: Save state BEFORE updating lastSignatures to prevent duplication on crash
    // If we crash after this save but before lastSignatures update, we'll re-process
    // but the processedSignatures Set will filter duplicates
    this.saveState();

    // Update last signature to most recent
    this.lastSignatures.set(mintKey, sigs[0].signature);

    if (this.verbose && feesInBatch > 0) {
      this.log(`   📈 ${token.symbol}: Processed ${sigs.length} txs, ${feesInBatch} with fees`);
    }
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
      const tx = await withRetryAndTimeout(
        () => this.connection.getTransaction(signature, {
          maxSupportedTransactionVersion: 0,
        }),
        { maxRetries: 2, baseDelayMs: 300 },
        10000
      );

      if (!tx || !tx.meta) return 0;

      // Filter out ASDF-DAT program transactions
      // These are internal operations (buyback, burn, collect) that do NOT generate creator fees
      // Only real Pump.fun trades generate fees
      const accountKeys = tx.transaction.message.staticAccountKeys;
      const isASDFTransaction = accountKeys.some(
        (key: PublicKey) => key.equals(ASDF_PROGRAM)
      );

      if (isASDFTransaction) {
        if (this.verbose) {
          console.log(`   ⏭️ Skipping ASDF-DAT transaction: ${signature.slice(0, 20)}...`);
        }
        return 0;
      }

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
   * CRITICAL: Only reset pending AFTER successful on-chain update
   * If flush fails, fees remain in pending for retry on next flush cycle
   * @returns FlushResult with detailed status of what was flushed
   */
  private async flushPendingFees(): Promise<FlushResult> {
    const result: FlushResult = {
      success: true,
      tokensUpdated: 0,
      tokensFailed: 0,
      totalFlushed: 0,
      remainingPending: 0,
      details: [],
    };

    for (const [mintKey, pendingAmount] of this.pendingFees.entries()) {
      if (pendingAmount === 0n) continue;

      const token = this.tokens.get(mintKey);
      if (!token) continue;

      try {
        // Call update_pending_fees instruction
        await this.updatePendingFeesOnChain(token.mint, Number(pendingAmount));

        // ONLY reset pending after SUCCESSFUL on-chain update
        // This prevents fee loss if flush fails
        this.pendingFees.set(mintKey, 0n);

        result.tokensUpdated++;
        result.totalFlushed += Number(pendingAmount);
        result.details.push({
          symbol: token.symbol,
          mint: mintKey,
          amount: Number(pendingAmount),
          success: true,
        });

        this.log(
          `✅ ${token.symbol}: Flushed ${(Number(pendingAmount) / 1e9).toFixed(6)} SOL to on-chain`
        );
      } catch (error: any) {
        // DO NOT reset pendingFees on error - fees will be retried on next flush
        result.success = false;
        result.tokensFailed++;
        result.remainingPending += Number(pendingAmount);
        result.details.push({
          symbol: token.symbol,
          mint: mintKey,
          amount: Number(pendingAmount),
          success: false,
          error: error.message,
        });

        console.error(
          `❌ ${token.symbol}: Failed to flush ${(Number(pendingAmount) / 1e9).toFixed(6)} SOL: ${error.message}. ` +
          `Will retry on next flush cycle.`
        );
      }
    }

    return result;
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

    // Use retry for on-chain update (important for reliability)
    const tx = await withRetryAndTimeout(
      () => this.program.methods
        .updatePendingFees(new BN(amountLamports))
        .accounts({
          datState,
          tokenStats,
          mint,
          admin: (this.program.provider as AnchorProvider).wallet.publicKey,
        })
        .rpc(),
      { maxRetries: 3, baseDelayMs: 1000 },
      30000
    );

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

  /**
   * Force immediate flush of all pending fees to on-chain
   * Called by cycle orchestrator before execution to ensure synchronization
   * @returns FlushResult with detailed status of what was flushed
   */
  public async forceFlush(): Promise<FlushResult> {
    this.log("🔄 Force flush triggered by cycle orchestrator");
    return await this.flushPendingFees();
  }

  /**
   * Get health metrics for monitoring/alerting
   */
  public getHealthMetrics(): {
    isRunning: boolean;
    pollCount: number;
    errorCount: number;
    errorRate: number;
    feesCaptured: number;
    currentPollInterval: number;
    lastPollTime: number;
    timeSinceLastPoll: number;
    tokensMonitored: number;
  } {
    return {
      isRunning: this.isRunning,
      pollCount: this.pollCount,
      errorCount: this.errorCount,
      errorRate: this.pollCount > 0 ? this.errorCount / this.pollCount : 0,
      feesCaptured: this.feesCaptured,
      currentPollInterval: this.currentPollInterval,
      lastPollTime: this.lastPollTime,
      timeSinceLastPoll: this.lastPollTime > 0 ? Date.now() - this.lastPollTime : 0,
      tokensMonitored: this.tokens.size,
    };
  }

  /**
   * Check if monitor is healthy (useful for orchestrator)
   */
  public isHealthy(): boolean {
    const metrics = this.getHealthMetrics();

    // Not running = not healthy
    if (!metrics.isRunning) return false;

    // Too many errors = not healthy
    if (metrics.errorRate > 0.3) return false;

    // Haven't polled recently = not healthy (allow 2x current interval)
    if (metrics.timeSinceLastPoll > this.currentPollInterval * 2 + 5000) return false;

    return true;
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
