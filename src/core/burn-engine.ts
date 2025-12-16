/**
 * ASDF Burn Engine - Core Engine
 *
 * The unified execution engine for flush cycles.
 * Uses daemon internal state as source of truth.
 *
 * Features:
 * - Single source of truth (internal state, not on-chain TokenStats)
 * - Direct execution (no subprocess spawn)
 * - Simulation safeguard before sending
 * - Crash recovery with progress persistence
 * - Retry with exponential backoff
 */

import {
  PublicKey,
  Connection,
  Keypair,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import * as fs from "fs";
import {
  AllocationCalculator,
  TokenAllocationExtended,
  AllocationResult,
} from "./allocation-calculator";
import { TransactionBuilder, TokenConfig } from "./transaction-builder";
import { TrackedToken, CycleResult, TokenCycleResult, CycleError } from "../types";
import { PROGRAM_ID, DAT_AUTHORITY_SEED } from "./constants";
import { createLogger } from "../utils/logger";

const log = createLogger("burn-engine");

// ============================================================================
// Crash Recovery Types
// ============================================================================

interface CycleProgress {
  cycleId: string;
  phase: "pre" | "secondaries" | "root" | "finalize";
  completedTokens: string[]; // mints of completed tokens
  startedAt: number;
}

const CYCLE_PROGRESS_FILE = ".cycle-progress.json";
const PROGRESS_STALE_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// Engine Configuration
// ============================================================================

export interface BurnEngineConfig {
  /** Maximum retries per token */
  maxRetries: number;

  /** Base delay for exponential backoff (ms) */
  baseDelayMs: number;

  /** Transaction timeout (ms) */
  txTimeoutMs: number;

  /** Simulation timeout (ms) */
  simulationTimeoutMs: number;

  /** Network for logging */
  network: "devnet" | "mainnet";
}

const DEFAULT_CONFIG: BurnEngineConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  txTimeoutMs: 45000,
  simulationTimeoutMs: 30000,
  network: "devnet",
};

// ============================================================================
// Burn Engine
// ============================================================================

export class BurnEngine {
  private allocator: AllocationCalculator;
  private txBuilder: TransactionBuilder;
  private config: BurnEngineConfig;

  constructor(
    private program: Program,
    private connection: Connection,
    private wallet: Keypair,
    config: Partial<BurnEngineConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.allocator = new AllocationCalculator();
    this.txBuilder = new TransactionBuilder(program);
  }

  /**
   * Execute a complete flush cycle
   *
   * Uses internal daemon state (TrackedToken) not on-chain TokenStats.
   * This ensures fees tracked by daemon = fees used for allocation.
   *
   * @param tokens - Tracked tokens from daemon internal state
   * @param vaultBalance - Current creator vault balance
   * @param rootMint - Root token mint for treasury routing
   */
  async executeCycle(
    tokens: TrackedToken[],
    vaultBalance: bigint,
    rootMint: PublicKey
  ): Promise<CycleResult> {
    const cycleId = `cycle-${Date.now()}`;
    const startedAt = Date.now();

    log.info("Starting burn cycle", {
      cycleId,
      tokenCount: tokens.length,
      vaultBalance: this.formatSOL(vaultBalance),
    });

    // Initialize progress for crash recovery
    const progress: CycleProgress = {
      cycleId,
      phase: "pre",
      completedTokens: [],
      startedAt,
    };
    await this.persistProgress(progress);

    const tokenResults: TokenCycleResult[] = [];
    const errors: CycleError[] = [];
    let totalFlushedLamports = 0n;
    let totalBurnedTokens = 0n;

    try {
      // Step 1: Calculate allocations from internal state
      log.info("Calculating allocations from internal state");
      const allocation = this.allocator.calculate(tokens, vaultBalance);

      if (allocation.viable.length === 0) {
        log.info("No viable tokens for this cycle");
        await this.clearProgress();
        return {
          success: true,
          cycleId,
          startedAt,
          completedAt: Date.now(),
          totalFlushedLamports: 0n,
          totalBurnedTokens: 0n,
          tokenResults: [],
          errors: [],
        };
      }

      // Step 2: Get current slot for selection
      const currentSlot = await this.connection.getSlot();

      // Step 3: Select token for this cycle (O(1) probabilistic)
      const eligible = this.allocator.getEligibleTokens(allocation.viable);
      const selection = this.allocator.selectForCycle(eligible, currentSlot);

      if (!selection.selected) {
        log.info("No eligible tokens for selection");
        await this.clearProgress();
        return {
          success: true,
          cycleId,
          startedAt,
          completedAt: Date.now(),
          totalFlushedLamports: 0n,
          totalBurnedTokens: 0n,
          tokenResults: [],
          errors: [],
        };
      }

      // Step 4: Execute selected secondary token
      progress.phase = "secondaries";
      await this.persistProgress(progress);

      log.info("Executing selected token", {
        selected: selection.selected.symbol,
        allocation: this.formatSOL(selection.selected.allocation),
        eligibleCount: selection.eligible.length,
      });

      const result = await this.executeTokenWithRetry(
        selection.selected,
        rootMint,
        false // isRoot
      );

      tokenResults.push(result);
      progress.completedTokens.push(selection.selected.mint.toBase58());
      await this.persistProgress(progress);

      if (result.error) {
        errors.push({
          mint: selection.selected.mint,
          phase: "buy",
          message: result.error,
        });
      } else {
        totalFlushedLamports += selection.selected.allocation;
        totalBurnedTokens += result.burnedTokens;
      }

      // Step 5: Execute root token if it has allocation
      if (allocation.rootAllocation && allocation.rootAllocation.allocation > 0n) {
        progress.phase = "root";
        await this.persistProgress(progress);

        log.info("Executing root token", {
          symbol: allocation.rootAllocation.symbol,
          allocation: this.formatSOL(allocation.rootAllocation.allocation),
        });

        const rootResult = await this.executeTokenWithRetry(
          allocation.rootAllocation,
          rootMint,
          true // isRoot
        );

        tokenResults.push(rootResult);

        if (rootResult.error) {
          errors.push({
            mint: allocation.rootAllocation.mint,
            phase: "buy",
            message: rootResult.error,
          });
        } else {
          totalFlushedLamports += allocation.rootAllocation.allocation;
          totalBurnedTokens += rootResult.burnedTokens;
        }
      }

      // Step 6: Finalize deferred tokens (preserve pending_fees)
      progress.phase = "finalize";
      await this.persistProgress(progress);

      for (const deferred of allocation.deferred) {
        try {
          await this.finalizeDeferredToken(deferred.mint);
          log.debug("Deferred token finalized", {
            symbol: deferred.symbol,
            reason: deferred.deferReason,
          });
        } catch (error) {
          log.warn("Failed to finalize deferred token", {
            symbol: deferred.symbol,
            error: (error as Error).message,
          });
        }
      }

      // Success - clear progress
      await this.clearProgress();

      const completedAt = Date.now();
      log.info("Cycle completed", {
        cycleId,
        duration: completedAt - startedAt,
        tokenCount: tokenResults.length,
        flushed: this.formatSOL(totalFlushedLamports),
        burned: totalBurnedTokens.toString(),
        errors: errors.length,
      });

      return {
        success: errors.length === 0,
        cycleId,
        startedAt,
        completedAt,
        totalFlushedLamports,
        totalBurnedTokens,
        tokenResults,
        errors,
      };
    } catch (error) {
      // Leave progress file for recovery analysis
      const errorMessage = (error as Error).message;
      log.error("Cycle failed", { cycleId, error: errorMessage });

      errors.push({
        phase: "collect",
        message: errorMessage,
      });

      return {
        success: false,
        cycleId,
        startedAt,
        completedAt: Date.now(),
        totalFlushedLamports,
        totalBurnedTokens,
        tokenResults,
        errors,
      };
    }
  }

  /**
   * Execute a single token with retry logic
   */
  private async executeTokenWithRetry(
    allocation: TokenAllocationExtended,
    rootMint: PublicKey,
    isRoot: boolean
  ): Promise<TokenCycleResult> {
    const result: TokenCycleResult = {
      mint: allocation.mint,
      symbol: allocation.symbol,
      flushedLamports: 0n,
      burnedTokens: 0n,
    };

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        log.debug("Executing token", {
          symbol: allocation.symbol,
          attempt,
          isRoot,
        });

        // Convert TrackedToken to TokenConfig for TransactionBuilder
        const tokenConfig = this.trackedToConfig(allocation.token);

        // Build instructions
        const instructions = isRoot
          ? await this.txBuilder.buildRootBatch({
              token: tokenConfig,
              allocation: allocation.allocation,
              adminPubkey: this.wallet.publicKey,
            })
          : await this.txBuilder.buildSecondaryBatch({
              token: tokenConfig,
              allocation: allocation.allocation,
              adminPubkey: this.wallet.publicKey,
              rootMint,
            });

        // Create transaction
        const tx = new Transaction();
        instructions.forEach((ix) => tx.add(ix));

        // Get blockhash
        const { blockhash, lastValidBlockHeight } =
          await this.connection.getLatestBlockhash("confirmed");
        tx.recentBlockhash = blockhash;
        tx.lastValidBlockHeight = lastValidBlockHeight;
        tx.feePayer = this.wallet.publicKey;

        // Sign
        tx.sign(this.wallet);

        // Simulate first (safety)
        log.debug("Simulating transaction", { symbol: allocation.symbol });
        const simulation = await this.connection.simulateTransaction(tx);

        if (simulation.value.err) {
          const errStr = JSON.stringify(simulation.value.err);
          const logs = simulation.value.logs || [];

          // Check if buy failed - don't retry as state may be corrupted
          const isBuyFailure = logs.some(
            (l) =>
              l.includes("execute_buy") ||
              l.includes("slippage") ||
              l.includes("insufficient")
          );

          if (isBuyFailure) {
            throw new Error(`Buy simulation failed: ${errStr}`);
          }

          throw new Error(`Simulation failed: ${errStr}`);
        }

        log.debug("Simulation passed, sending transaction");

        // Send (skip preflight since we already simulated)
        const signature = await this.connection.sendRawTransaction(
          tx.serialize(),
          {
            skipPreflight: true,
            preflightCommitment: "confirmed",
          }
        );

        // Confirm
        await this.connection.confirmTransaction(
          {
            signature,
            blockhash,
            lastValidBlockHeight,
          },
          "confirmed"
        );

        result.burnSignature = signature;
        result.flushedLamports = allocation.allocation;
        // TODO: Fetch actual burned amount from TokenStats after confirmation

        log.info("Token executed successfully", {
          symbol: allocation.symbol,
          signature: signature.slice(0, 16) + "...",
        });

        return result;
      } catch (error) {
        const errorMessage = (error as Error).message;

        if (attempt < this.config.maxRetries && this.isTransientError(error)) {
          const delay = this.config.baseDelayMs * Math.pow(2, attempt - 1);
          log.warn("Transient error, retrying", {
            symbol: allocation.symbol,
            attempt,
            delay,
            error: errorMessage,
          });
          await this.sleep(delay);
          continue;
        }

        log.error("Token execution failed", {
          symbol: allocation.symbol,
          attempt,
          error: errorMessage,
        });

        result.error = errorMessage;
        return result;
      }
    }

    result.error = "Max retries exceeded";
    return result;
  }

  /**
   * Finalize a deferred token (preserve pending_fees)
   */
  private async finalizeDeferredToken(tokenMint: PublicKey): Promise<void> {
    const ix = await this.txBuilder.buildDeferredFinalize(
      tokenMint,
      this.wallet.publicKey
    );

    const tx = new Transaction().add(ix);
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = this.wallet.publicKey;
    tx.sign(this.wallet);

    const signature = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
    });

    await this.connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed"
    );
  }

  /**
   * Recover from crash - called on daemon startup
   */
  async recoverFromCrash(): Promise<{
    recovered: boolean;
    cycleId?: string;
    action: string;
  }> {
    const progress = await this.loadProgress();

    if (!progress) {
      return { recovered: false, action: "No crash detected" };
    }

    const elapsed = Date.now() - progress.startedAt;

    if (elapsed > PROGRESS_STALE_MS) {
      log.warn("Stale cycle detected, cleaning up", {
        cycleId: progress.cycleId,
        elapsed: `${(elapsed / 1000).toFixed(0)}s`,
      });
      await this.clearProgress();
      return {
        recovered: true,
        cycleId: progress.cycleId,
        action: "Stale cycle cleared",
      };
    }

    // For Phase 1: just clear and let next cycle handle
    // Phase 2 could resume partial cycles
    log.warn("Crash recovery: cycle was in progress", {
      cycleId: progress.cycleId,
      phase: progress.phase,
      completedTokens: progress.completedTokens.length,
    });

    await this.clearProgress();

    return {
      recovered: true,
      cycleId: progress.cycleId,
      action: `Cleared ${progress.phase} phase cycle`,
    };
  }

  // ============================================================================
  // Progress Persistence (Crash Recovery)
  // ============================================================================

  private async persistProgress(progress: CycleProgress): Promise<void> {
    try {
      await fs.promises.writeFile(
        CYCLE_PROGRESS_FILE,
        JSON.stringify(progress, null, 2)
      );
    } catch (error) {
      log.warn("Failed to persist progress", {
        error: (error as Error).message,
      });
    }
  }

  private async loadProgress(): Promise<CycleProgress | null> {
    try {
      const data = await fs.promises.readFile(CYCLE_PROGRESS_FILE, "utf-8");
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  private async clearProgress(): Promise<void> {
    try {
      await fs.promises.unlink(CYCLE_PROGRESS_FILE);
    } catch {
      // File may not exist
    }
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private trackedToConfig(token: TrackedToken): TokenConfig {
    return {
      mint: token.mint,
      symbol: token.symbol,
      bondingCurve: token.bondingCurve,
      poolType: token.poolType,
      creator: token.bondingCurve, // Derived from BC in Phase 1
      isToken2022: false, // TODO: Detect from token
      mayhemMode: false, // TODO: Detect from BC
    };
  }

  private isTransientError(error: unknown): boolean {
    const message = (error as Error).message?.toLowerCase() || "";
    return (
      message.includes("blockhash") ||
      message.includes("timeout") ||
      message.includes("429") ||
      message.includes("rate") ||
      message.includes("network") ||
      message.includes("socket")
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private formatSOL(lamports: bigint): string {
    return `${(Number(lamports) / LAMPORTS_PER_SOL).toFixed(6)} SOL`;
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createBurnEngine(
  program: Program,
  connection: Connection,
  wallet: Keypair,
  config?: Partial<BurnEngineConfig>
): BurnEngine {
  return new BurnEngine(program, connection, wallet, config);
}
