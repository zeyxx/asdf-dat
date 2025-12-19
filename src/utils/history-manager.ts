/**
 * Proof-of-History Chain Manager
 *
 * Tamper-proof record system using cryptographic hash chaining.
 * Each entry links to the previous via SHA-256, making retroactive
 * modifications immediately detectable.
 *
 * Inspired by asdf-validator PoH implementation.
 *
 * Structure:
 * Genesis → Entry1 → Entry2 → ... → EntryN
 *   ↓         ↓         ↓           ↓
 * hash0   hash1     hash2       hashN
 *           ↑         ↑           ↑
 *        prevHash  prevHash   prevHash
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { createLogger, Logger } from "./logger";

// Genesis hash - foundation of the chain
const GENESIS_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

export type EventType =
  | "fee_detected"           // Off-chain fee attribution (needs PoH proof)
  | "cycle_token_burn"       // Token selected and burned in cycle (NEW)
  | "daemon_start"           // Daemon started (rare = significant)
  | "daemon_stop"            // Daemon stopped (rare = significant)
  | "error";                 // Error event
// REMOVED: fee_attributed (redundant - on-chain signature)
// REMOVED: flush_executed (redundant - on-chain TX signatures)
// REMOVED: token_discovered (redundant - on-chain TokenStats init)

export interface HistoryEntry {
  sequence: number;
  prevHash: string;
  hash: string;
  timestamp: number;
  slot?: number;
  event: EventType;
  data: {
    mint?: string;
    symbol?: string;
    amount?: number;
    vault?: string;
    signature?: string;
    message?: string;
    [key: string]: any;
  };
}

export interface ChainMetadata {
  version: number;
  createdAt: number;
  lastUpdated: number;
  totalEntries: number;
  latestHash: string;
  totalFeesDetected: number;
  // Note: totalBurned removed - burns tracked on-chain, not in PoH
}

export interface ValidationResult {
  valid: boolean;
  entriesChecked: number;
  corruptionIndex?: number;
  corruptionDetails?: string;
}

export interface HistoryManagerConfig {
  dataDir?: string;
  historyFile?: string;
  metadataFile?: string;
  maxEntriesInMemory?: number;
  verbose?: boolean;
}

export class HistoryManager {
  private dataDir: string;
  private historyFile: string;
  private metadataFile: string;
  private metadata: ChainMetadata;
  private recentEntries: HistoryEntry[] = [];
  private maxEntriesInMemory: number;
  private logger: Logger;
  private initialized = false;

  constructor(config: HistoryManagerConfig = {}) {
    this.dataDir = config.dataDir ?? "./data/history";
    this.historyFile = config.historyFile ?? path.join(this.dataDir, "chain.jsonl");
    this.metadataFile = config.metadataFile ?? path.join(this.dataDir, "metadata.json");
    this.maxEntriesInMemory = config.maxEntriesInMemory ?? 1000;
    this.logger = createLogger("history");

    // Initialize metadata with defaults
    this.metadata = {
      version: 1,
      createdAt: Date.now(),
      lastUpdated: Date.now(),
      totalEntries: 0,
      latestHash: GENESIS_HASH,
      totalFeesDetected: 0,
    };
  }

  /**
   * Initialize the history manager
   * Creates data directory and loads existing chain if present
   */
  async initialize(): Promise<void> {
    // Create data directory
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      this.logger.info(`Created history directory: ${this.dataDir}`);
    }

    // Load existing metadata
    if (fs.existsSync(this.metadataFile)) {
      try {
        const data = fs.readFileSync(this.metadataFile, "utf-8");
        this.metadata = JSON.parse(data);
        this.logger.info(`Loaded metadata: ${this.metadata.totalEntries} entries`);
      } catch (err: any) {
        this.logger.warn("Failed to load metadata, starting fresh", { error: err.message });
      }
    }

    // Load recent entries for validation
    if (fs.existsSync(this.historyFile)) {
      await this.loadRecentEntries();
    }

    // Validate chain integrity on startup
    if (this.metadata.totalEntries > 0) {
      const validation = await this.validateChain();
      if (!validation.valid) {
        this.logger.error("Chain corruption detected!", {
          index: validation.corruptionIndex,
          details: validation.corruptionDetails,
        });
        throw new Error(`Chain corruption at entry ${validation.corruptionIndex}`);
      }
      this.logger.info("Chain integrity verified");
    }

    this.initialized = true;
    this.logger.info("History manager initialized");
  }

  /**
   * Compute SHA-256 hash of entry data
   */
  private computeEntryHash(entry: Omit<HistoryEntry, "hash">): string {
    const data = JSON.stringify({
      sequence: entry.sequence,
      prevHash: entry.prevHash,
      timestamp: entry.timestamp,
      slot: entry.slot,
      event: entry.event,
      data: entry.data,
    });
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  /**
   * Append a new entry to the chain
   */
  async append(event: EventType, data: HistoryEntry["data"], slot?: number): Promise<HistoryEntry> {
    if (!this.initialized) {
      throw new Error("HistoryManager not initialized. Call initialize() first.");
    }

    const sequence = this.metadata.totalEntries + 1;
    const prevHash = this.metadata.latestHash;
    const timestamp = Date.now();

    const entry: Omit<HistoryEntry, "hash"> = {
      sequence,
      prevHash,
      timestamp,
      slot,
      event,
      data,
    };

    const hash = this.computeEntryHash(entry);
    const fullEntry: HistoryEntry = { ...entry, hash };

    // Append to file (JSON Lines format)
    fs.appendFileSync(this.historyFile, JSON.stringify(fullEntry) + "\n");

    // Update metadata
    this.metadata.totalEntries = sequence;
    this.metadata.latestHash = hash;
    this.metadata.lastUpdated = timestamp;

    // Update totals based on event type
    if (event === "fee_detected") {
      this.metadata.totalFeesDetected += data.amount ?? 0;
    }
    // Note: Burns tracked on-chain, not in PoH

    // Persist metadata
    fs.writeFileSync(this.metadataFile, JSON.stringify(this.metadata, null, 2));

    // Keep in memory cache
    this.recentEntries.push(fullEntry);
    if (this.recentEntries.length > this.maxEntriesInMemory) {
      this.recentEntries.shift();
    }

    this.logger.debug(`Appended entry #${sequence}`, { event, hash: hash.slice(0, 12) });

    return fullEntry;
  }

  /**
   * Load recent entries into memory
   */
  private async loadRecentEntries(): Promise<void> {
    try {
      const content = fs.readFileSync(this.historyFile, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      // Load last N entries
      const start = Math.max(0, lines.length - this.maxEntriesInMemory);
      for (let i = start; i < lines.length; i++) {
        try {
          const entry = JSON.parse(lines[i]) as HistoryEntry;
          this.recentEntries.push(entry);
        } catch (err: any) {
          this.logger.warn(`Failed to parse entry at line ${i + 1}`, { error: err.message });
        }
      }

      this.logger.debug(`Loaded ${this.recentEntries.length} recent entries`);
    } catch (err: any) {
      this.logger.error("Failed to load history file", { error: err.message });
    }
  }

  /**
   * Validate chain integrity
   * Verifies each entry's hash and prevHash linkage
   */
  async validateChain(fullValidation = false): Promise<ValidationResult> {
    const entries = fullValidation ? await this.getAllEntries() : this.recentEntries;

    if (entries.length === 0) {
      return { valid: true, entriesChecked: 0 };
    }

    let prevHash = GENESIS_HASH;

    // If not full validation, get the prevHash of first entry in cache
    if (!fullValidation && this.recentEntries.length > 0) {
      prevHash = this.recentEntries[0].prevHash;
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      // PoH Validation 1: Verify prevHash links to previous entry
      if (i > 0 || fullValidation) {
        if (entry.prevHash !== prevHash) {
          return {
            valid: false,
            entriesChecked: i,
            corruptionIndex: entry.sequence,
            corruptionDetails: `prevHash mismatch at entry ${entry.sequence}`,
          };
        }
      }

      // PoH Validation 2: Verify entry hash is correct
      const { hash, ...entryWithoutHash } = entry;
      const computedHash = this.computeEntryHash(entryWithoutHash);
      if (hash !== computedHash) {
        return {
          valid: false,
          entriesChecked: i,
          corruptionIndex: entry.sequence,
          corruptionDetails: `Hash mismatch at entry ${entry.sequence}: expected ${computedHash.slice(0, 12)}..., got ${hash.slice(0, 12)}...`,
        };
      }

      prevHash = entry.hash;
    }

    return {
      valid: true,
      entriesChecked: entries.length,
    };
  }

  /**
   * Get all entries (for full validation)
   */
  private async getAllEntries(): Promise<HistoryEntry[]> {
    if (!fs.existsSync(this.historyFile)) {
      return [];
    }

    const content = fs.readFileSync(this.historyFile, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    return lines.map((line, i) => {
      try {
        return JSON.parse(line) as HistoryEntry;
      } catch {
        throw new Error(`Failed to parse entry at line ${i + 1}`);
      }
    });
  }

  /**
   * Get recent entries
   */
  getRecentEntries(count?: number): HistoryEntry[] {
    if (!count) return [...this.recentEntries];
    return this.recentEntries.slice(-count);
  }

  /**
   * Get entries by event type
   */
  getEntriesByType(eventType: EventType, count = 100): HistoryEntry[] {
    return this.recentEntries
      .filter((e) => e.event === eventType)
      .slice(-count);
  }

  /**
   * Get entries for a specific token
   */
  getEntriesForToken(mint: string, count = 100): HistoryEntry[] {
    return this.recentEntries
      .filter((e) => e.data.mint === mint)
      .slice(-count);
  }

  /**
   * Get chain metadata
   */
  getMetadata(): ChainMetadata {
    return { ...this.metadata };
  }

  /**
   * Get attestation for current state
   * Note: Burns not included - tracked on-chain with TX signatures
   */
  getAttestation(): {
    hash: string;
    sequence: number;
    timestamp: number;
    totalFeesDetected: number;
  } {
    return {
      hash: this.metadata.latestHash,
      sequence: this.metadata.totalEntries,
      timestamp: this.metadata.lastUpdated,
      totalFeesDetected: this.metadata.totalFeesDetected,
    };
  }

  /**
   * Export chain for external verification
   */
  async exportChain(outputPath: string): Promise<void> {
    const entries = await this.getAllEntries();
    fs.writeFileSync(outputPath, JSON.stringify({
      metadata: this.metadata,
      entries,
    }, null, 2));
    this.logger.info(`Exported ${entries.length} entries to ${outputPath}`);
  }

  /**
   * Record fee detection event
   */
  async recordFeeDetected(
    mint: string,
    symbol: string,
    amount: number,
    vault: string,
    slot: number
  ): Promise<HistoryEntry> {
    return this.append("fee_detected", {
      mint,
      symbol,
      amount,
      vault,
    }, slot);
  }

  /**
   * Record cycle token burn event (per-token granularity)
   * Called when a token is selected and burned in a cycle
   */
  async recordCycleTokenBurn(
    mint: string,
    symbol: string,
    solAmount: number,
    tokensBurned: number,
    signature: string,
    isRoot: boolean
  ): Promise<HistoryEntry> {
    return this.append("cycle_token_burn", {
      mint,
      symbol,
      solAmount,
      tokensBurned,
      signature,
      isRoot,
    });
  }

  /**
   * Record daemon lifecycle events (rare = significant for audit)
   */
  async recordDaemonStart(): Promise<HistoryEntry> {
    return this.append("daemon_start", {
      message: "Daemon started",
      pid: process.pid,
    });
  }

  async recordDaemonStop(): Promise<HistoryEntry> {
    return this.append("daemon_stop", {
      message: "Daemon stopped",
      pid: process.pid,
    });
  }

  /**
   * Record error
   */
  async recordError(message: string, details?: any): Promise<HistoryEntry> {
    return this.append("error", {
      message,
      details,
    });
  }
}

/**
 * Singleton instance for global access
 */
let historyInstance: HistoryManager | null = null;

export function initHistory(config?: HistoryManagerConfig): HistoryManager {
  historyInstance = new HistoryManager(config);
  return historyInstance;
}

export function getHistory(): HistoryManager | null {
  return historyInstance;
}
