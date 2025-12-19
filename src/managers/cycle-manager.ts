/**
 * ASDF Burn Engine - Cycle Manager
 *
 * Manages flush/burn cycle execution.
 * Uses unified BurnEngine for direct execution (no subprocess).
 *
 * Architecture:
 * - Internal state (daemon tracked fees) = source of truth
 * - BurnEngine executes directly within daemon process
 * - Single source of truth eliminates desync issues
 */

import { PublicKey, Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";
import { RpcManager } from "./rpc-manager";
import { TokenManager } from "./token-manager";
import { FeeTracker } from "./fee-tracker";
import { WebSocketServer } from "../api/websocket";
import { createLogger } from "../utils/logger";
import { BurnEngine, createBurnEngine } from "../core/burn-engine";
import { PROGRAM_ID } from "../core/constants";
import {
  CycleResult,
  TokenCycleResult,
  TrackedToken,
  FLUSH_THRESHOLD,
} from "../types";

const log = createLogger("cycle");

/**
 * Record of a burn execution
 */
export interface BurnRecord {
  txSignature: string;
  amount: number;
  tokenSymbol: string;
  tokenMint: string;
  timestamp: number;
  network: string;
}

// Minimum threshold for cycle execution (per token)
// Devnet: 0.006 SOL for testing, Mainnet: 0.1 SOL for efficiency
const DEVNET_THRESHOLD = 6_000_000n;   // 0.006 SOL (devnet-friendly)
const MAINNET_THRESHOLD = 100_000_000n; // 0.1 SOL (matches FLUSH_THRESHOLD)

export interface CycleManagerConfig {
  network: "devnet" | "mainnet";
  walletPath: string;
  dryRun?: boolean;
  wsServer?: WebSocketServer;
}

// Maximum burns to keep in memory
const MAX_BURNS_HISTORY = 100;

export class CycleManager {
  private rpc: RpcManager;
  private tokenManager: TokenManager;
  private feeTracker: FeeTracker;
  private config: CycleManagerConfig;
  private lastCycleAt: number = 0;
  private cycleCount: number = 0;
  private burns: BurnRecord[] = [];

  // Unified burn engine
  private burnEngine: BurnEngine | null = null;
  private wallet: Keypair | null = null;
  private program: Program | null = null;

  constructor(
    rpc: RpcManager,
    tokenManager: TokenManager,
    feeTracker: FeeTracker,
    config: CycleManagerConfig
  ) {
    this.rpc = rpc;
    this.tokenManager = tokenManager;
    this.feeTracker = feeTracker;
    this.config = config;

    // Initialize burn engine (lazy - on first cycle)
    this.initializeBurnEngine();
  }

  /**
   * Initialize the burn engine with wallet and program
   */
  private async initializeBurnEngine(): Promise<void> {
    try {
      // Load wallet from path
      const walletData = JSON.parse(
        fs.readFileSync(this.config.walletPath, "utf-8")
      );
      this.wallet = Keypair.fromSecretKey(Uint8Array.from(walletData));

      // Create program with provider
      const connection = this.rpc.getConnection();
      const walletAdapter = new Wallet(this.wallet);
      const provider = new AnchorProvider(connection, walletAdapter, {
        commitment: "confirmed",
      });

      // Load IDL
      const idlPath = path.join(__dirname, "../../target/idl/asdf_burn_engine.json");
      if (!fs.existsSync(idlPath)) {
        log.warn("IDL not found, BurnEngine disabled until IDL available", {
          path: idlPath,
        });
        return;
      }
      const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
      this.program = new Program(idl, provider);

      // Create burn engine
      this.burnEngine = createBurnEngine(
        this.program,
        connection,
        this.wallet,
        { network: this.config.network }
      );

      // Check for crash recovery
      const recovery = await this.burnEngine.recoverFromCrash();
      if (recovery.recovered) {
        log.info("Crash recovery completed", recovery);
      }

      log.info("BurnEngine initialized", {
        wallet: this.wallet.publicKey.toBase58().slice(0, 8) + "...",
        network: this.config.network,
      });
    } catch (error) {
      log.error("Failed to initialize BurnEngine", {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Get network-specific threshold per token
   */
  private getThreshold(): bigint {
    return this.config.network === "mainnet" ? MAINNET_THRESHOLD : DEVNET_THRESHOLD;
  }

  /**
   * Check if cycle is ready to execute
   * Returns eligible tokens and total pending fees
   */
  async checkCycleReadiness(): Promise<{
    ready: boolean;
    eligibleTokens: TrackedToken[];
    totalPending: bigint;
    reason?: string;
  }> {
    const tokens = this.tokenManager.getTrackedTokens();
    const threshold = this.getThreshold();

    if (tokens.length === 0) {
      return {
        ready: false,
        eligibleTokens: [],
        totalPending: 0n,
        reason: "No tokens tracked",
      };
    }

    // Get total pending fees
    const totals = this.feeTracker.getTotals();
    const totalPending = totals.pendingLamports;

    // Find eligible tokens (above per-token threshold)
    const eligibleTokens = tokens.filter(
      t => t.pendingFeesLamports >= threshold
    );

    if (eligibleTokens.length === 0) {
      return {
        ready: false,
        eligibleTokens: [],
        totalPending,
        reason: `No tokens above threshold (${Number(threshold) / LAMPORTS_PER_SOL} SOL per token)`,
      };
    }

    // Check cooldown (60 seconds minimum between cycles)
    const timeSinceLastCycle = Date.now() - this.lastCycleAt;
    if (timeSinceLastCycle < 60000 && this.lastCycleAt > 0) {
      return {
        ready: false,
        eligibleTokens,
        totalPending,
        reason: `Cooldown: ${Math.ceil((60000 - timeSinceLastCycle) / 1000)}s remaining`,
      };
    }

    return {
      ready: true,
      eligibleTokens,
      totalPending,
    };
  }

  /**
   * Execute a flush cycle
   * Uses probabilistic O(1) selection: currentSlot % eligibleTokens
   */
  async executeCycle(): Promise<CycleResult> {
    const cycleId = `cycle-${Date.now()}`;
    const startedAt = Date.now();

    log.info("Starting cycle", { cycleId });

    const readiness = await this.checkCycleReadiness();
    if (!readiness.ready) {
      log.info("Cycle not ready", { reason: readiness.reason });
      return {
        success: false,
        cycleId,
        startedAt,
        completedAt: Date.now(),
        totalFlushedLamports: 0n,
        totalBurnedTokens: 0n,
        tokenResults: [],
        errors: [{ phase: "collect", message: readiness.reason || "Not ready" }],
      };
    }

    if (this.config.dryRun) {
      log.info("Dry run - would execute cycle", {
        eligibleTokens: readiness.eligibleTokens.map(t => t.symbol),
        totalPending: Number(readiness.totalPending) / LAMPORTS_PER_SOL,
      });
      return {
        success: true,
        cycleId,
        startedAt,
        completedAt: Date.now(),
        totalFlushedLamports: readiness.totalPending,
        totalBurnedTokens: 0n,
        tokenResults: readiness.eligibleTokens.map(t => ({
          mint: t.mint,
          symbol: t.symbol,
          flushedLamports: t.pendingFeesLamports,
          burnedTokens: 0n,
        })),
        errors: [],
      };
    }

    // Broadcast cycle start
    if (this.config.wsServer) {
      this.config.wsServer.broadcastCycleStart({
        cycleId,
        tokenCount: readiness.eligibleTokens.length,
        totalPendingSOL: Number(readiness.totalPending) / LAMPORTS_PER_SOL,
      });
    }

    // PRE-CYCLE VERIFICATION: "Don't trust, verify"
    // Verify internal state matches on-chain reality before execution
    const verification = await this.feeTracker.preCycleVerification();
    if (!verification.safeToExecute) {
      log.warn("Pre-cycle verification failed, cycle aborted", {
        reconciled: verification.reconciled,
        details: verification.details,
      });
      return {
        success: false,
        cycleId,
        startedAt,
        completedAt: Date.now(),
        totalFlushedLamports: 0n,
        totalBurnedTokens: 0n,
        tokenResults: [],
        errors: [{ phase: "verify", message: `State desync detected and reconciled: ${verification.details}` }],
      };
    }

    log.info("Pre-cycle verification passed", { details: verification.details });

    // Execute directly via BurnEngine (unified architecture)
    // Uses internal daemon state as source of truth
    try {
      const result = await this.executeDirectly();

      this.lastCycleAt = Date.now();
      this.cycleCount++;

      log.info("Cycle completed", {
        cycleId,
        success: result.success,
        duration: Date.now() - startedAt,
      });

      // Broadcast cycle complete
      if (this.config.wsServer) {
        this.config.wsServer.broadcastCycleComplete(result);
      }

      return result;
    } catch (error) {
      // Set lastCycleAt even on failure to prevent rapid retries
      this.lastCycleAt = Date.now();

      log.error("Cycle failed", {
        cycleId,
        error: (error as Error).message,
      });

      return {
        success: false,
        cycleId,
        startedAt,
        completedAt: Date.now(),
        totalFlushedLamports: 0n,
        totalBurnedTokens: 0n,
        tokenResults: [],
        errors: [{ phase: "collect", message: (error as Error).message }],
      };
    }
  }

  /**
   * Execute cycle directly via BurnEngine
   * Uses daemon internal state as single source of truth
   */
  private async executeDirectly(): Promise<CycleResult> {
    // Ensure burn engine is initialized
    if (!this.burnEngine) {
      await this.initializeBurnEngine();
    }

    if (!this.burnEngine) {
      throw new Error("BurnEngine not available - check IDL and wallet");
    }

    // Get internal state (source of truth)
    const tokens = this.tokenManager.getTrackedTokens();

    // Get vault balance for verification
    const vaultBalance = await this.feeTracker.getVaultBalance();

    // Get root token mint
    const rootToken = tokens.find((t) => t.isRoot);
    if (!rootToken) {
      throw new Error("No root token configured");
    }

    // Execute cycle via BurnEngine
    log.info("Executing cycle via BurnEngine", {
      tokens: tokens.length,
      vaultBalance: Number(vaultBalance) / LAMPORTS_PER_SOL,
    });

    const result = await this.burnEngine.executeCycle(
      tokens,
      vaultBalance,
      rootToken.mint
    );

    // Process results for burn tracking and fee reset
    for (const tokenResult of result.tokenResults) {
      if (tokenResult.burnSignature) {
        // Record burn
        this.addBurn({
          txSignature: tokenResult.burnSignature,
          amount: Number(tokenResult.burnedTokens),
          tokenSymbol: tokenResult.symbol,
          tokenMint: tokenResult.mint.toBase58(),
          timestamp: Date.now(),
          network: this.config.network,
        });

        // Reset pending fees for this token
        this.tokenManager.resetTokenFees(
          tokenResult.mint,
          tokenResult.burnSignature
        );

        log.info("Token cycle completed", {
          symbol: tokenResult.symbol,
          flushed: Number(tokenResult.flushedLamports) / LAMPORTS_PER_SOL,
          signature: tokenResult.burnSignature.slice(0, 16) + "...",
        });
      }
    }

    return result;
  }

  /**
   * Force flush all pending fees to on-chain state
   * Called before cycle execution to ensure synchronization
   */
  async forceFlush(): Promise<{ flushed: number; errors: string[] }> {
    log.info("Force flushing pending fees to on-chain");

    // In Phase 1, this triggers the fee tracker to update on-chain TokenStats
    // The actual logic is in the daemon's flush cycle

    const tokens = this.tokenManager.getTrackedTokens();
    let flushed = 0;
    const errors: string[] = [];

    for (const token of tokens) {
      if (token.pendingFeesLamports > 0n) {
        try {
          // Update on-chain TokenStats.pending_fees
          // This would be done via program instruction
          // For Phase 1, the script handles this
          flushed++;
        } catch (error) {
          errors.push(`${token.symbol}: ${(error as Error).message}`);
        }
      }
    }

    log.info("Force flush complete", { flushed, errors: errors.length });
    return { flushed, errors };
  }

  /**
   * Get cycle statistics
   */
  getStats(): {
    cycleCount: number;
    lastCycleAt: number;
    timeSinceLastCycle: number;
  } {
    return {
      cycleCount: this.cycleCount,
      lastCycleAt: this.lastCycleAt,
      timeSinceLastCycle: this.lastCycleAt > 0 ? Date.now() - this.lastCycleAt : -1,
    };
  }

  /**
   * Add a burn record
   * Note: Burns are NOT recorded in PoH - they're already on-chain with TX signatures
   */
  addBurn(burn: BurnRecord): void {
    this.burns.unshift(burn); // Add to beginning (most recent first)

    // Trim to max history
    if (this.burns.length > MAX_BURNS_HISTORY) {
      this.burns = this.burns.slice(0, MAX_BURNS_HISTORY);
    }

    log.info("Burn recorded", {
      symbol: burn.tokenSymbol,
      tx: burn.txSignature.slice(0, 16) + "...",
    });

    // Broadcast burn event to WebSocket clients
    if (this.config.wsServer) {
      this.config.wsServer.broadcastBurn(
        burn.tokenMint,
        burn.tokenSymbol,
        burn.amount,
        burn.txSignature
      );
    }
  }

  /**
   * Get burn history
   */
  getBurns(limit: number = 20): BurnRecord[] {
    return this.burns.slice(0, Math.min(limit, this.burns.length));
  }

  /**
   * Get total burns count
   */
  getTotalBurnsCount(): number {
    return this.burns.length;
  }
}
