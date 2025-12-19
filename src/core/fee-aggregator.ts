/**
 * Fee Aggregator - Central Deduplication & Attribution
 *
 * Receives fee events from multiple sources (polling, WebSocket)
 * and ensures accurate, deduplicated fee tracking.
 *
 * Key responsibilities:
 * - Signature-based deduplication (LRU cache)
 * - Token attribution (mint detection)
 * - Pending fee accumulation
 * - PoH chain recording
 *
 * THIS IS FINE 🔥
 */

import { PublicKey } from "@solana/web3.js";
import { EventEmitter } from "events";
import { createLogger } from "../utils/logger";
import { HistoryManager } from "../utils/history-manager";

const log = createLogger("aggregator");

// LRU Cache size for signature deduplication
const DEFAULT_CACHE_SIZE = 10_000;

export interface FeeEvent {
  signature: string;
  mint: PublicKey;
  amountLamports: bigint;
  slot: number;
  timestamp: number;
  source: "polling" | "websocket" | "backfill";
}

export interface TokenFeeState {
  mint: PublicKey;
  symbol: string;
  pendingFeesLamports: bigint;
  totalCollectedLamports: bigint;
  feeCount: number;
  lastSlot: number;
  lastTimestamp: number;
}

export interface AggregatorStats {
  totalEventsReceived: number;
  duplicatesSkipped: number;
  eventsFromPolling: number;
  eventsFromWebSocket: number;
  eventsFromBackfill: number;
  cacheSize: number;
  cacheHitRate: number;
}

/**
 * LRU Cache for signature deduplication
 */
class LRUCache<K, V> {
  private cache: Map<K, V> = new Map();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    // Delete if exists (to update position)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    // Evict oldest if at capacity
    else if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }
    this.cache.set(key, value);
  }

  size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }
}

export interface FeeAggregatorConfig {
  cacheSize?: number;
  history?: HistoryManager;
  onFeeProcessed?: (event: FeeEvent, token: TokenFeeState) => void;
}

/**
 * Central fee aggregator for hybrid tracking
 */
export class FeeAggregator extends EventEmitter {
  private signatureCache: LRUCache<string, boolean>;
  private tokenStates: Map<string, TokenFeeState> = new Map();
  private history: HistoryManager | null;

  // Stats
  private totalEventsReceived = 0;
  private duplicatesSkipped = 0;
  private eventsFromPolling = 0;
  private eventsFromWebSocket = 0;
  private eventsFromBackfill = 0;
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(config: FeeAggregatorConfig = {}) {
    super();
    this.signatureCache = new LRUCache(config.cacheSize ?? DEFAULT_CACHE_SIZE);
    this.history = config.history ?? null;

    if (config.onFeeProcessed) {
      this.on("fee_processed", config.onFeeProcessed);
    }

    log.info("FeeAggregator initialized", {
      cacheSize: config.cacheSize ?? DEFAULT_CACHE_SIZE,
      historyEnabled: this.history !== null,
    });
  }

  /**
   * Register a token for tracking
   */
  registerToken(mint: PublicKey, symbol: string): void {
    const mintStr = mint.toBase58();
    if (!this.tokenStates.has(mintStr)) {
      this.tokenStates.set(mintStr, {
        mint,
        symbol,
        pendingFeesLamports: 0n,
        totalCollectedLamports: 0n,
        feeCount: 0,
        lastSlot: 0,
        lastTimestamp: 0,
      });
      log.debug("Token registered", { mint: mintStr, symbol });
    }
  }

  /**
   * Process a fee event
   * Returns true if processed, false if duplicate
   */
  async process(event: FeeEvent): Promise<boolean> {
    this.totalEventsReceived++;

    // Track source
    switch (event.source) {
      case "polling":
        this.eventsFromPolling++;
        break;
      case "websocket":
        this.eventsFromWebSocket++;
        break;
      case "backfill":
        this.eventsFromBackfill++;
        break;
    }

    // Check for duplicate
    if (this.signatureCache.has(event.signature)) {
      this.duplicatesSkipped++;
      this.cacheHits++;
      log.debug("Duplicate signature skipped", {
        signature: event.signature.slice(0, 12),
        source: event.source,
      });
      return false;
    }

    this.cacheMisses++;

    // Mark as processed
    this.signatureCache.set(event.signature, true);

    // Get or create token state
    const mintStr = event.mint.toBase58();
    let tokenState = this.tokenStates.get(mintStr);

    if (!tokenState) {
      // Auto-register unknown token
      tokenState = {
        mint: event.mint,
        symbol: mintStr.slice(0, 6),
        pendingFeesLamports: 0n,
        totalCollectedLamports: 0n,
        feeCount: 0,
        lastSlot: 0,
        lastTimestamp: 0,
      };
      this.tokenStates.set(mintStr, tokenState);
      log.info("Auto-registered new token", { mint: mintStr });
    }

    // Accumulate fee
    tokenState.pendingFeesLamports += event.amountLamports;
    tokenState.feeCount++;
    tokenState.lastSlot = event.slot;
    tokenState.lastTimestamp = event.timestamp;

    // Record in PoH chain
    if (this.history) {
      await this.history.recordFeeDetected(
        mintStr,
        tokenState.symbol,
        Number(event.amountLamports),
        "aggregator",
        event.slot
      );
    }

    log.debug("Fee processed", {
      signature: event.signature.slice(0, 12),
      mint: mintStr.slice(0, 8),
      amount: Number(event.amountLamports),
      source: event.source,
      pending: Number(tokenState.pendingFeesLamports),
    });

    // Emit event
    this.emit("fee_processed", event, tokenState);

    return true;
  }

  /**
   * Process multiple events (batch)
   */
  async processBatch(events: FeeEvent[]): Promise<{
    processed: number;
    duplicates: number;
  }> {
    let processed = 0;
    let duplicates = 0;

    for (const event of events) {
      const wasProcessed = await this.process(event);
      if (wasProcessed) {
        processed++;
      } else {
        duplicates++;
      }
    }

    return { processed, duplicates };
  }

  /**
   * Get token state
   */
  getTokenState(mint: PublicKey | string): TokenFeeState | undefined {
    const mintStr = typeof mint === "string" ? mint : mint.toBase58();
    return this.tokenStates.get(mintStr);
  }

  /**
   * Get all token states
   */
  getAllTokenStates(): TokenFeeState[] {
    return Array.from(this.tokenStates.values());
  }

  /**
   * Get pending fees for a token
   */
  getPendingFees(mint: PublicKey | string): bigint {
    const state = this.getTokenState(mint);
    return state?.pendingFeesLamports ?? 0n;
  }

  /**
   * Get total pending fees across all tokens
   */
  getTotalPendingFees(): bigint {
    let total = 0n;
    for (const state of this.tokenStates.values()) {
      total += state.pendingFeesLamports;
    }
    return total;
  }

  /**
   * Reset pending fees after cycle execution
   * Moves pending to totalCollected
   */
  resetPendingFees(mint: PublicKey | string, amountUsed: bigint): void {
    const mintStr = typeof mint === "string" ? mint : mint.toBase58();
    const state = this.tokenStates.get(mintStr);

    if (state) {
      state.totalCollectedLamports += amountUsed;
      state.pendingFeesLamports -= amountUsed;
      if (state.pendingFeesLamports < 0n) {
        state.pendingFeesLamports = 0n;
      }

      log.info("Pending fees reset", {
        mint: mintStr.slice(0, 8),
        used: Number(amountUsed),
        remaining: Number(state.pendingFeesLamports),
        totalCollected: Number(state.totalCollectedLamports),
      });
    }
  }

  /**
   * Check if signature was already processed
   */
  isProcessed(signature: string): boolean {
    return this.signatureCache.has(signature);
  }

  /**
   * Get aggregator statistics
   */
  getStats(): AggregatorStats {
    const totalLookups = this.cacheHits + this.cacheMisses;
    return {
      totalEventsReceived: this.totalEventsReceived,
      duplicatesSkipped: this.duplicatesSkipped,
      eventsFromPolling: this.eventsFromPolling,
      eventsFromWebSocket: this.eventsFromWebSocket,
      eventsFromBackfill: this.eventsFromBackfill,
      cacheSize: this.signatureCache.size(),
      cacheHitRate: totalLookups > 0 ? this.cacheHits / totalLookups : 0,
    };
  }

  /**
   * Export state for persistence
   */
  exportState(): {
    tokenStates: Array<{
      mint: string;
      symbol: string;
      pendingFeesLamports: string;
      totalCollectedLamports: string;
      feeCount: number;
      lastSlot: number;
    }>;
    stats: AggregatorStats;
  } {
    return {
      tokenStates: Array.from(this.tokenStates.values()).map((s) => ({
        mint: s.mint.toBase58(),
        symbol: s.symbol,
        pendingFeesLamports: s.pendingFeesLamports.toString(),
        totalCollectedLamports: s.totalCollectedLamports.toString(),
        feeCount: s.feeCount,
        lastSlot: s.lastSlot,
      })),
      stats: this.getStats(),
    };
  }

  /**
   * Import state from persistence
   */
  importState(state: {
    tokenStates: Array<{
      mint: string;
      symbol: string;
      pendingFeesLamports: string;
      totalCollectedLamports: string;
      feeCount: number;
      lastSlot: number;
    }>;
  }): void {
    for (const s of state.tokenStates) {
      this.tokenStates.set(s.mint, {
        mint: new PublicKey(s.mint),
        symbol: s.symbol,
        pendingFeesLamports: BigInt(s.pendingFeesLamports),
        totalCollectedLamports: BigInt(s.totalCollectedLamports),
        feeCount: s.feeCount,
        lastSlot: s.lastSlot,
        lastTimestamp: 0,
      });
    }
    log.info("State imported", { tokens: state.tokenStates.length });
  }

  /**
   * Clear all state (for testing)
   */
  clear(): void {
    this.signatureCache.clear();
    this.tokenStates.clear();
    this.totalEventsReceived = 0;
    this.duplicatesSkipped = 0;
    this.eventsFromPolling = 0;
    this.eventsFromWebSocket = 0;
    this.eventsFromBackfill = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }
}

// Singleton instance
let aggregatorInstance: FeeAggregator | null = null;

export function initFeeAggregator(config?: FeeAggregatorConfig): FeeAggregator {
  aggregatorInstance = new FeeAggregator(config);
  return aggregatorInstance;
}

export function getFeeAggregator(): FeeAggregator | null {
  return aggregatorInstance;
}
