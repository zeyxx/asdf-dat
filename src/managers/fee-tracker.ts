/**
 * ASDF Burn Engine Fee Tracker
 *
 * Polls creator vault for balance changes and attributes fees to tokens.
 * - Signature-based polling with deduplication
 * - Balance change detection
 * - Per-token fee attribution via transaction parsing
 */

import { PublicKey, ParsedTransactionWithMeta } from "@solana/web3.js";
import { RpcManager } from "./rpc-manager";
import { TokenManager } from "./token-manager";
import { createLogger } from "../utils/logger";
import { HistoryManager } from "../utils/history-manager";
import {
  FeeEvent,
  FeeRecord,
  FeeTotals,
  TrackedToken,
  LAMPORTS_PER_SOL,
  MAX_PROCESSED_SIGNATURES,
} from "../types";

const log = createLogger("fees");

// Polling config
const DEFAULT_POLL_LIMIT = 50;
const SIGNATURE_CACHE_SIZE = MAX_PROCESSED_SIGNATURES;

export class FeeTracker {
  private rpc: RpcManager;
  private tokenManager: TokenManager;
  private creatorVault: PublicKey;
  private history: HistoryManager | null;

  // State
  private lastProcessedSignature?: string;
  private processedSignatures: Set<string> = new Set();
  private lastKnownBalance: bigint = 0n;

  // Stats
  private pollCount: number = 0;
  private errorCount: number = 0;
  private lastPollAt?: number;

  constructor(
    rpc: RpcManager,
    tokenManager: TokenManager,
    creatorVault: PublicKey,
    history?: HistoryManager
  ) {
    this.rpc = rpc;
    this.tokenManager = tokenManager;
    this.creatorVault = creatorVault;
    this.history = history || null;
  }

  /**
   * Poll for new fees
   */
  async poll(): Promise<FeeEvent[]> {
    const endTimer = log.time("Fee poll");
    const events: FeeEvent[] = [];

    try {
      this.pollCount++;
      this.lastPollAt = Date.now();

      // Get signatures since last poll
      const signatures = await this.getNewSignatures();

      if (signatures.length === 0) {
        endTimer();
        return events;
      }

      log.debug("Processing signatures", { count: signatures.length });

      // Process each signature
      for (const sigInfo of signatures) {
        if (this.processedSignatures.has(sigInfo.signature)) {
          continue;
        }

        const event = await this.processSignature(sigInfo.signature);
        if (event) {
          events.push(event);
          this.tokenManager.updateTokenFees(
            event.mint,
            event.amountLamports,
            event.slot
          );

          // Record in PoH chain
          if (this.history) {
            const token = this.tokenManager.getToken(event.mint);
            await this.history.recordFeeDetected(
              event.mint.toBase58(),
              token?.symbol || "UNKNOWN",
              Number(event.amountLamports),
              this.creatorVault.toBase58(),
              event.slot
            );
          }
        }

        // Mark as processed
        this.addProcessedSignature(sigInfo.signature);
      }

      // Update last processed
      if (signatures.length > 0) {
        this.lastProcessedSignature = signatures[0].signature;
      }

      log.info("Poll complete", {
        signatures: signatures.length,
        events: events.length,
      });

    } catch (error) {
      this.errorCount++;
      log.error("Poll failed", { error: (error as Error).message });
    }

    endTimer();
    return events;
  }

  /**
   * Get new signatures from vault
   */
  private async getNewSignatures(): Promise<
    { signature: string; slot: number; blockTime: number | null }[]
  > {
    const options: { limit: number; until?: string } = {
      limit: DEFAULT_POLL_LIMIT,
    };

    if (this.lastProcessedSignature) {
      options.until = this.lastProcessedSignature;
    }

    const signatures = await this.rpc.execute(() =>
      this.rpc.getConnection().getSignaturesForAddress(
        this.creatorVault,
        options
      )
    );

    // Filter out already processed
    return signatures
      .filter((s) => !this.processedSignatures.has(s.signature))
      .map((s) => ({
        signature: s.signature,
        slot: s.slot,
        blockTime: s.blockTime ?? null,
      }));
  }

  /**
   * Process a single signature to extract fee event
   */
  private async processSignature(signature: string): Promise<FeeEvent | null> {
    try {
      const tx = await this.rpc.execute(() =>
        this.rpc.getConnection().getParsedTransaction(signature, {
          maxSupportedTransactionVersion: 0,
        })
      );

      if (!tx?.meta) {
        return null;
      }

      // Find vault balance change
      const vaultChange = this.findVaultBalanceChange(tx);
      if (!vaultChange || vaultChange <= 0n) {
        return null; // No deposit to vault
      }

      log.warn("Vault change detected", {
        signature: signature.slice(0, 12),
        change: Number(vaultChange),
      });

      // Attribute to token by finding the bonding curve involved
      // Now async to support dynamic discovery of unknown tokens
      const mint = await this.attributeToToken(tx);
      if (!mint) {
        log.warn("Could not attribute fee to token", {
          signature: signature.slice(0, 12),
          vaultChange: Number(vaultChange),
        });
        return null;
      }

      log.warn("Fee attributed", {
        signature: signature.slice(0, 12),
        mint: mint.toBase58().slice(0, 8),
        lamports: Number(vaultChange),
      });

      return {
        mint,
        amountLamports: vaultChange,
        signature,
        slot: tx.slot,
        timestamp: tx.blockTime ? tx.blockTime * 1000 : Date.now(),
      };

    } catch (error) {
      log.debug("Failed to process signature", {
        signature,
        error: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Find balance change in creator vault
   */
  private findVaultBalanceChange(tx: ParsedTransactionWithMeta): bigint | null {
    if (!tx.meta) return null;

    const accountKeys = tx.transaction.message.accountKeys;
    const vaultStr = this.creatorVault.toBase58();

    // Find vault index
    // Handle both parsed format (pubkey is string) and legacy format (PublicKey)
    const vaultIndex = accountKeys.findIndex((key) => {
      if (typeof key === "object" && "pubkey" in key) {
        // Parsed format: { pubkey: string, ... }
        const pubkeyStr = typeof key.pubkey === "string"
          ? key.pubkey
          : (key.pubkey as PublicKey).toBase58();
        return pubkeyStr === vaultStr;
      }
      // Legacy format: PublicKey directly
      return (key as PublicKey).toBase58() === vaultStr;
    });

    if (vaultIndex === -1) {
      return null;
    }

    const preBal = BigInt(tx.meta.preBalances[vaultIndex] || 0);
    const postBal = BigInt(tx.meta.postBalances[vaultIndex] || 0);

    return postBal - preBal;
  }

  /**
   * Attribute a fee to a specific token by analyzing transaction
   * Now async to support dynamic discovery
   */
  private async attributeToToken(tx: ParsedTransactionWithMeta): Promise<PublicKey | null> {
    // Look for token program transfers or Pump.fun instructions
    const accountKeys = tx.transaction.message.accountKeys;

    // Build a set of all account key strings for fast lookup
    const accountKeySet = new Set<string>();
    for (const key of accountKeys) {
      if (typeof key === "object" && "pubkey" in key) {
        const pubkeyStr = typeof key.pubkey === "string"
          ? key.pubkey
          : (key.pubkey as PublicKey).toBase58();
        accountKeySet.add(pubkeyStr);
      } else {
        accountKeySet.add((key as PublicKey).toBase58());
      }
    }

    // Strategy 0 (NEW): Find token MINT directly in accountKeys
    // Critical for Token2022 tokens that don't have their own bonding curve
    // This is the most reliable method - the mint is always in the transaction
    for (const token of this.tokenManager.getTrackedTokens()) {
      const mintStr = token.mint.toBase58();
      if (accountKeySet.has(mintStr)) {
        return token.mint;
      }
    }

    // Strategy 1: Find bonding curve account in transaction (fallback for classic tokens)
    // Note: In parsed transactions, accountKeys can be:
    // - { pubkey: string, signer: boolean, source: string, writable: boolean } (parsed format)
    // - PublicKey (legacy format)
    for (const token of this.tokenManager.getTrackedTokens()) {
      const bcStr = token.bondingCurve.toBase58();
      if (accountKeySet.has(bcStr)) {
        return token.mint;
      }
    }

    // Strategy 2: Check inner instructions for mint
    if (tx.meta?.innerInstructions) {
      for (const inner of tx.meta.innerInstructions) {
        for (const ix of inner.instructions) {
          if ("parsed" in ix && ix.parsed?.type === "transfer") {
            // SPL token transfer - check mint
            const mint = ix.parsed.info?.mint;
            if (mint) {
              const token = this.tokenManager.getToken(new PublicKey(mint));
              if (token) {
                return token.mint;
              }
            }
          }
        }
      }
    }

    // Strategy 3: If only one token tracked, attribute to it
    const tokens = this.tokenManager.getTrackedTokens();
    if (tokens.length === 1) {
      return tokens[0].mint;
    }

    // Strategy 4: Dynamic discovery - synchronous to capture the fee
    const discoveredMint = await this.discoverAndTrack(tx);
    if (discoveredMint) {
      return discoveredMint;
    }

    return null;
  }

  /**
   * Attempt to discover and track a token from transaction
   * Returns the mint if successful so the fee can be attributed
   */
  private async discoverAndTrack(tx: ParsedTransactionWithMeta): Promise<PublicKey | null> {
    log.debug("🔎 Strategy 4: Attempting dynamic discovery", {
      slot: tx.slot,
    });

    try {
      const discovered = await this.tokenManager.discoverFromParsedTransaction(tx);

      if (discovered) {
        // Initialize tracking for the newly discovered token
        const tracked = await this.tokenManager.initializeTracking(discovered);

        log.info("🎯 New token auto-tracked", {
          mint: tracked.mint.toBase58().slice(0, 8) + "...",
          symbol: tracked.symbol,
        });

        return tracked.mint;
      }
    } catch (error) {
      log.debug("Dynamic discovery failed", {
        error: (error as Error).message,
      });
    }

    return null;
  }

  /**
   * Add signature to processed set with FIFO eviction
   */
  private addProcessedSignature(signature: string): void {
    this.processedSignatures.add(signature);

    // Evict oldest if over limit
    if (this.processedSignatures.size > SIGNATURE_CACHE_SIZE) {
      const first = this.processedSignatures.values().next().value;
      if (first) {
        this.processedSignatures.delete(first);
      }
    }
  }

  /**
   * Get current fee records for all tokens
   */
  getFeeRecords(): FeeRecord[] {
    return this.tokenManager.getTrackedTokens().map((token) => ({
      mint: token.mint,
      symbol: token.symbol,
      pendingLamports: token.pendingFeesLamports,
      pendingSOL: Number(token.pendingFeesLamports) / Number(LAMPORTS_PER_SOL),
      lastSignature: token.lastBurnSignature,
    }));
  }

  /**
   * Get fee totals
   */
  getTotals(): FeeTotals {
    const tokens = this.tokenManager.getTrackedTokens();
    let totalLamports = 0n;

    for (const token of tokens) {
      totalLamports += token.pendingFeesLamports;
    }

    return {
      pendingLamports: totalLamports,
      pendingSOL: Number(totalLamports) / Number(LAMPORTS_PER_SOL),
      tokenCount: tokens.length,
    };
  }

  /**
   * Get polling stats
   */
  getStats(): {
    pollCount: number;
    errorCount: number;
    errorRate: number;
    lastPollMs: number;
    processedSignatures: number;
  } {
    return {
      pollCount: this.pollCount,
      errorCount: this.errorCount,
      errorRate: this.pollCount > 0 ? this.errorCount / this.pollCount : 0,
      lastPollMs: this.lastPollAt ? Date.now() - this.lastPollAt : -1,
      processedSignatures: this.processedSignatures.size,
    };
  }

  /**
   * Load state for crash recovery
   */
  loadState(state: {
    lastProcessedSignature?: string;
    processedSignatures: Set<string>;
    pollCount: number;
    errorCount: number;
  }): void {
    this.lastProcessedSignature = state.lastProcessedSignature;
    this.processedSignatures = state.processedSignatures;
    this.pollCount = state.pollCount;
    this.errorCount = state.errorCount;

    log.info("Fee tracker state loaded", {
      signatures: this.processedSignatures.size,
      lastSignature: this.lastProcessedSignature?.slice(0, 8),
    });
  }

  /**
   * Cold start initialization
   * Marks all existing signatures as processed WITHOUT adding fees.
   * Use this on fresh daemon start when vault may contain already-collected fees.
   */
  async coldStartInit(): Promise<void> {
    log.info("Cold start: marking existing signatures as processed (without fees)");

    try {
      // Get recent signatures from vault
      const signatures = await this.rpc.execute(() =>
        this.rpc.getConnection().getSignaturesForAddress(this.creatorVault, { limit: 100 })
      );

      // Mark all as processed (without adding fees)
      for (const sig of signatures) {
        this.addProcessedSignature(sig.signature);
      }

      // Set last processed to most recent
      if (signatures.length > 0) {
        this.lastProcessedSignature = signatures[0].signature;
      }

      log.info("Cold start complete", {
        markedAsProcessed: signatures.length,
        lastSignature: this.lastProcessedSignature?.slice(0, 8),
      });
    } catch (error) {
      log.warn("Cold start failed", { error: (error as Error).message });
    }
  }

  /**
   * Get state for persistence
   */
  getState(): {
    lastProcessedSignature?: string;
    processedSignatures: Set<string>;
    pollCount: number;
    errorCount: number;
  } {
    return {
      lastProcessedSignature: this.lastProcessedSignature,
      processedSignatures: this.processedSignatures,
      pollCount: this.pollCount,
      errorCount: this.errorCount,
    };
  }

  /**
   * Get creator vault balance
   */
  async getVaultBalance(): Promise<bigint> {
    try {
      const balance = await this.rpc.execute(() =>
        this.rpc.getConnection().getBalance(this.creatorVault)
      );
      this.lastKnownBalance = BigInt(balance);
      return this.lastKnownBalance;
    } catch (error) {
      log.warn("Failed to get vault balance", {
        error: (error as Error).message,
      });
      return this.lastKnownBalance;
    }
  }

  // ============================================================================
  // STATE VERIFICATION & RECONCILIATION
  // "Don't trust, verify" - Core principle for CCM infrastructure
  // ============================================================================

  /**
   * Verify internal state against on-chain reality
   * Returns sync status with details
   */
  async verifySyncStatus(): Promise<{
    inSync: boolean;
    vaultBalance: bigint;
    expectedPending: bigint;
    discrepancy: bigint;
    discrepancyPercent: number;
  }> {
    const vaultBalance = await this.getVaultBalance();
    const expectedPending = this.getTotals().pendingLamports;

    // Calculate discrepancy (vault should have AT LEAST what we expect)
    // Note: vault may have MORE than expected (fees we haven't attributed yet)
    const discrepancy = expectedPending - vaultBalance;
    const discrepancyPercent = expectedPending > 0n
      ? Number(discrepancy * 100n / expectedPending)
      : 0;

    // Consider "in sync" if:
    // - Vault has at least 99% of expected (precision infrastructure)
    // - OR expected is very small (under threshold anyway)
    const MIN_SYNC_THRESHOLD = 1_000_000n; // 0.001 SOL
    const MAX_SYNC_DIVERGENCE = 1; // 1% max - divergence above this = bug
    const inSync = discrepancy <= 0n || // vault has more than expected (good)
                   expectedPending < MIN_SYNC_THRESHOLD || // too small to matter
                   discrepancyPercent < MAX_SYNC_DIVERGENCE; // within 1% tolerance

    return {
      inSync,
      vaultBalance,
      expectedPending,
      discrepancy,
      discrepancyPercent,
    };
  }

  /**
   * Auto-reconcile state when desync detected
   * Resets pending fees to match on-chain reality
   */
  async reconcileState(): Promise<{
    wasDesynced: boolean;
    previousPending: bigint;
    newPending: bigint;
    tokensReset: number;
  }> {
    const status = await this.verifySyncStatus();

    if (status.inSync) {
      return {
        wasDesynced: false,
        previousPending: status.expectedPending,
        newPending: status.expectedPending,
        tokensReset: 0,
      };
    }

    log.warn("🔄 State desync detected, initiating reconciliation", {
      vaultBalance: Number(status.vaultBalance) / 1e9,
      expectedPending: Number(status.expectedPending) / 1e9,
      discrepancy: Number(status.discrepancy) / 1e9,
      discrepancyPercent: status.discrepancyPercent,
    });

    // Reset all token pending fees to 0
    const tokens = this.tokenManager.getTrackedTokens();
    let tokensReset = 0;

    for (const token of tokens) {
      if (token.pendingFeesLamports > 0n) {
        // Don't call resetTokenFees (which moves to totalCollected)
        // Instead, just clear the pending without crediting
        token.pendingFeesLamports = 0n;
        token.lastUpdatedAt = Date.now();
        tokensReset++;
      }
    }

    // Mark all current signatures as processed to avoid re-accumulating
    await this.coldStartInit();

    log.info("✅ State reconciliation complete", {
      tokensReset,
      previousPending: Number(status.expectedPending) / 1e9,
      vaultBalance: Number(status.vaultBalance) / 1e9,
    });

    return {
      wasDesynced: true,
      previousPending: status.expectedPending,
      newPending: 0n,
      tokensReset,
    };
  }

  /**
   * Periodic reconciliation (10 minute interval recommended)
   * Internal state = source of truth, but on-chain can diverge
   * Warns if divergence > threshold, auto-reconciles if needed
   */
  async periodicReconciliation(): Promise<{
    reconciled: boolean;
    divergencePercent: number;
    details: string;
  }> {
    const status = await this.verifySyncStatus();

    const MAX_DIVERGENCE_PERCENT = 1; // 1% max - precision infrastructure, divergence = bug

    if (status.discrepancyPercent > MAX_DIVERGENCE_PERCENT) {
      log.warn("Significant state divergence detected", {
        vaultBalance: Number(status.vaultBalance) / 1e9,
        expectedPending: Number(status.expectedPending) / 1e9,
        divergencePercent: status.discrepancyPercent,
      });

      // Auto-reconcile
      const result = await this.reconcileState();

      return {
        reconciled: true,
        divergencePercent: status.discrepancyPercent,
        details: `Divergence ${status.discrepancyPercent.toFixed(1)}% exceeded threshold. Reset ${result.tokensReset} tokens.`,
      };
    }

    log.debug("Periodic reconciliation check passed", {
      divergencePercent: status.discrepancyPercent,
    });

    return {
      reconciled: false,
      divergencePercent: status.discrepancyPercent,
      details: `State in sync. Divergence: ${status.discrepancyPercent.toFixed(1)}%`,
    };
  }

  /**
   * Pre-cycle verification
   * Call this BEFORE executing any cycle to ensure state is valid
   * Returns true if safe to proceed, false if reconciliation was needed
   */
  async preCycleVerification(): Promise<{
    safeToExecute: boolean;
    reconciled: boolean;
    details: string;
  }> {
    const status = await this.verifySyncStatus();

    if (status.inSync) {
      log.debug("Pre-cycle verification passed", {
        vaultBalance: Number(status.vaultBalance) / 1e9,
        expectedPending: Number(status.expectedPending) / 1e9,
      });
      return {
        safeToExecute: true,
        reconciled: false,
        details: `Vault: ${(Number(status.vaultBalance) / 1e9).toFixed(4)} SOL, Expected: ${(Number(status.expectedPending) / 1e9).toFixed(4)} SOL`,
      };
    }

    // State is desynced - reconcile and prevent cycle
    log.warn("⚠️ Pre-cycle verification FAILED - state desync detected");

    const reconcileResult = await this.reconcileState();

    return {
      safeToExecute: false,
      reconciled: true,
      details: `Desync detected: expected ${(Number(status.expectedPending) / 1e9).toFixed(4)} SOL but vault has ${(Number(status.vaultBalance) / 1e9).toFixed(4)} SOL. State reconciled, ${reconcileResult.tokensReset} tokens reset.`,
    };
  }
}
