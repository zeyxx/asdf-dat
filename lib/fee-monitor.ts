/**
 * PumpFun Fee Monitor
 *
 * Monitors PumpFun transactions in real-time to capture exact fee amounts
 * and update on-chain TokenStats.pending_fees for accurate per-token attribution.
 *
 * Architecture:
 * - Subscribes to bonding curve account changes
 * - Parses transaction logs to extract creator vault deposits
 * - Updates TokenStats via update_pending_fees instruction
 */

import {
  Connection,
  PublicKey,
  ParsedTransactionWithMeta,
  AccountInfo,
  Context,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { BN } from "bn.js";

export interface FeeCapture {
  token: PublicKey;
  amount: number;  // lamports
  timestamp: number;
  signature: string;
  slot: number;
}

export interface TokenConfig {
  mint: PublicKey;
  bondingCurve: PublicKey;
  creator: PublicKey;
  symbol: string;
  name: string;
}

export interface MonitorConfig {
  connection: Connection;
  program: Program;
  tokens: TokenConfig[];
  updateInterval?: number;  // ms between batch updates (default: 30000 = 30s)
  verbose?: boolean;
}

export class PumpFunFeeMonitor {
  private connection: Connection;
  private program: Program;
  private tokens: Map<string, TokenConfig>;
  private subscriptions: Map<string, number>;
  private pendingFees: Map<string, bigint>;
  private updateInterval: number;
  private verbose: boolean;
  private updateTimer: NodeJS.Timeout | null;

  constructor(config: MonitorConfig) {
    this.connection = config.connection;
    this.program = config.program;
    this.tokens = new Map();
    this.subscriptions = new Map();
    this.pendingFees = new Map();
    this.updateInterval = config.updateInterval || 30000; // 30 seconds default
    this.verbose = config.verbose || false;
    this.updateTimer = null;

    // Initialize token map
    for (const token of config.tokens) {
      this.tokens.set(token.bondingCurve.toBase58(), token);
      this.pendingFees.set(token.mint.toBase58(), 0n);
    }
  }

  /**
   * Start monitoring all configured tokens
   */
  async start(): Promise<void> {
    this.log("🔍 Starting PumpFun Fee Monitor...");
    this.log(`📊 Monitoring ${this.tokens.size} tokens`);

    // Subscribe to each bonding curve
    for (const [curveKey, token] of this.tokens.entries()) {
      await this.subscribeToBondingCurve(new PublicKey(curveKey), token);
    }

    // Start periodic update timer
    this.startUpdateTimer();

    this.log("✅ Monitor started successfully");
  }

  /**
   * Stop monitoring and cleanup
   */
  async stop(): Promise<void> {
    this.log("🛑 Stopping monitor...");

    // Cancel all subscriptions
    for (const [curve, subId] of this.subscriptions.entries()) {
      await this.connection.removeAccountChangeListener(subId);
      this.log(`   Unsubscribed from ${curve}`);
    }

    // Stop update timer
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }

    // Flush any pending fees
    await this.flushPendingFees();

    this.log("✅ Monitor stopped");
  }

  /**
   * Subscribe to bonding curve account changes
   */
  private async subscribeToBondingCurve(
    bondingCurve: PublicKey,
    token: TokenConfig
  ): Promise<void> {
    const subId = this.connection.onAccountChange(
      bondingCurve,
      async (accountInfo: AccountInfo<Buffer>, context: Context) => {
        await this.handleBondingCurveChange(
          bondingCurve,
          token,
          accountInfo,
          context
        );
      },
      "confirmed"
    );

    this.subscriptions.set(bondingCurve.toBase58(), subId);
    this.log(`   📡 Subscribed to ${token.symbol} bonding curve`);
  }

  /**
   * Handle bonding curve account change (indicates a trade happened)
   */
  private async handleBondingCurveChange(
    bondingCurve: PublicKey,
    token: TokenConfig,
    accountInfo: AccountInfo<Buffer>,
    context: Context
  ): Promise<void> {
    try {
      // Get recent signature for this bonding curve
      const signatures = await this.connection.getSignaturesForAddress(
        bondingCurve,
        { limit: 1 },
        "confirmed"
      );

      if (signatures.length === 0) return;

      const signature = signatures[0].signature;

      // Parse transaction to extract fee
      const feeAmount = await this.extractFeeFromTransaction(signature, token);

      if (feeAmount > 0) {
        // Accumulate pending fees
        const currentPending = this.pendingFees.get(token.mint.toBase58()) || 0n;
        this.pendingFees.set(token.mint.toBase58(), currentPending + BigInt(feeAmount));

        this.log(
          `💰 ${token.symbol}: +${(feeAmount / 1e9).toFixed(6)} SOL ` +
          `(total pending: ${(Number(currentPending + BigInt(feeAmount)) / 1e9).toFixed(6)} SOL)`
        );

        // Emit capture event
        const capture: FeeCapture = {
          token: token.mint,
          amount: feeAmount,
          timestamp: Date.now(),
          signature,
          slot: context.slot,
        };
      }
    } catch (error: any) {
      console.error(`Error handling bonding curve change for ${token.symbol}:`, error.message);
    }
  }

  /**
   * Extract fee amount from transaction logs
   *
   * PumpFun logs contain: "Transfer X lamports to creator vault [address]"
   * We parse this to get exact fee amount
   */
  private async extractFeeFromTransaction(
    signature: string,
    token: TokenConfig
  ): Promise<number> {
    try {
      const tx = await this.connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });

      if (!tx || !tx.meta || !tx.meta.logMessages) {
        return 0;
      }

      // Derive creator vault address
      const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
      const [creatorVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("creator-vault"), token.creator.toBuffer()],
        PUMP_PROGRAM
      );

      // Parse logs for creator vault transfer
      for (const log of tx.meta.logMessages) {
        // Look for transfer to creator vault
        // Format: "Transfer: X lamports from Y to creator-vault [address]"
        if (log.includes("creator-vault") && log.includes(creatorVault.toBase58())) {
          const match = log.match(/(\d+)\s+lamports/);
          if (match) {
            return parseInt(match[1], 10);
          }
        }

        // Alternative format: System program transfer logs
        // "Program log: Transfer: {...}"
        if (log.includes(creatorVault.toBase58()) && log.includes("lamports")) {
          const match = log.match(/(\d+)/);
          if (match) {
            return parseInt(match[1], 10);
          }
        }
      }

      return 0;
    } catch (error: any) {
      if (this.verbose) {
        console.error(`Error extracting fee from tx ${signature}:`, error.message);
      }
      return 0;
    }
  }

  /**
   * Start periodic update timer
   */
  private startUpdateTimer(): void {
    this.updateTimer = setInterval(async () => {
      await this.flushPendingFees();
    }, this.updateInterval);

    this.log(`⏰ Update timer started (interval: ${this.updateInterval / 1000}s)`);
  }

  /**
   * Flush pending fees to on-chain TokenStats
   */
  private async flushPendingFees(): Promise<void> {
    for (const [mintKey, pendingAmount] of this.pendingFees.entries()) {
      if (pendingAmount === 0n) continue;

      try {
        const mint = new PublicKey(mintKey);
        const token = Array.from(this.tokens.values()).find(
          t => t.mint.toBase58() === mintKey
        );

        if (!token) continue;

        // Call update_pending_fees instruction
        await this.updatePendingFeesOnChain(mint, Number(pendingAmount));

        // Reset pending after successful update
        this.pendingFees.set(mintKey, 0n);

        this.log(
          `✅ ${token.symbol}: Flushed ${(Number(pendingAmount) / 1e9).toFixed(6)} SOL to on-chain`
        );
      } catch (error: any) {
        console.error(`Error flushing fees for ${mintKey}:`, error.message);
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

  private log(message: string): void {
    if (this.verbose || message.includes("✅") || message.includes("❌") || message.includes("🔍")) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] ${message}`);
    }
  }
}
