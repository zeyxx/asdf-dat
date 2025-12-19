/**
 * State Manager - Daemon State Persistence
 *
 * Manages saving and loading daemon state for crash recovery.
 * Implements atomic writes and versioned state format.
 *
 * Features:
 * - Atomic file writes (write to temp, rename)
 * - State versioning for migrations
 * - Auto-save on interval
 * - Graceful shutdown persistence
 *
 * THIS IS FINE 🔥
 */

import * as fs from "fs";
import * as path from "path";
import { PublicKey } from "@solana/web3.js";
import { createLogger } from "../utils/logger";

const log = createLogger("state");

// Current state version
const STATE_VERSION = 2;

// Default paths
const DEFAULT_STATE_FILE = ".asdf-state.json";
const DEFAULT_BACKUP_DIR = "./data/backups";

export interface TokenState {
  mint: string;
  symbol: string;
  name: string;
  bondingCurve: string;
  isRoot: boolean;
  pendingFeesLamports: string; // bigint as string
  totalCollectedLamports: string;
  feeCount: number;
  lastSlot: number;
  lastBurnSignature?: string;
}

export interface DaemonState {
  version: number;
  network: "devnet" | "mainnet";
  creatorPubkey: string;
  tokens: TokenState[];
  lastProcessedSignature?: string;
  lastCycleSlot?: number;
  lastCycleTimestamp?: number;
  cycleCount: number;
  pohLatestHash?: string;
  pohSequence?: number;
  stats: {
    pollCount: number;
    errorCount: number;
    heliusParsedCount: number;
    startedAt: number;
    lastSavedAt: number;
  };
}

export interface StateManagerConfig {
  stateFile?: string;
  backupDir?: string;
  autoSaveInterval?: number; // ms, 0 to disable
  maxBackups?: number;
}

/**
 * State Manager for daemon persistence
 */
export class StateManager {
  private stateFile: string;
  private backupDir: string;
  private autoSaveInterval: number;
  private maxBackups: number;
  private autoSaveTimer?: NodeJS.Timeout;
  private state: DaemonState | null = null;
  private isDirty = false;

  constructor(config: StateManagerConfig = {}) {
    this.stateFile = config.stateFile ?? DEFAULT_STATE_FILE;
    this.backupDir = config.backupDir ?? DEFAULT_BACKUP_DIR;
    this.autoSaveInterval = config.autoSaveInterval ?? 30_000; // 30s default
    this.maxBackups = config.maxBackups ?? 10;

    log.info("StateManager initialized", {
      stateFile: this.stateFile,
      autoSaveInterval: this.autoSaveInterval,
    });
  }

  /**
   * Initialize state manager
   * Loads existing state or creates new
   */
  async initialize(
    network: "devnet" | "mainnet",
    creatorPubkey: string
  ): Promise<DaemonState> {
    // Try to load existing state
    const existing = await this.load();

    if (existing) {
      // Validate state matches current config
      if (existing.network !== network) {
        log.warn("State network mismatch, creating new state", {
          existing: existing.network,
          current: network,
        });
      } else if (existing.creatorPubkey !== creatorPubkey) {
        log.warn("State creator mismatch, creating new state", {
          existing: existing.creatorPubkey,
          current: creatorPubkey,
        });
      } else {
        log.info("Loaded existing state", {
          tokens: existing.tokens.length,
          cycleCount: existing.cycleCount,
          lastSignature: existing.lastProcessedSignature?.slice(0, 12),
        });
        this.state = existing;
        this.startAutoSave();
        return existing;
      }
    }

    // Create new state
    this.state = this.createNewState(network, creatorPubkey);
    await this.save();
    this.startAutoSave();

    log.info("Created new state");
    return this.state;
  }

  /**
   * Create new empty state
   */
  private createNewState(
    network: "devnet" | "mainnet",
    creatorPubkey: string
  ): DaemonState {
    return {
      version: STATE_VERSION,
      network,
      creatorPubkey,
      tokens: [],
      cycleCount: 0,
      stats: {
        pollCount: 0,
        errorCount: 0,
        heliusParsedCount: 0,
        startedAt: Date.now(),
        lastSavedAt: Date.now(),
      },
    };
  }

  /**
   * Load state from file
   */
  async load(): Promise<DaemonState | null> {
    try {
      if (!fs.existsSync(this.stateFile)) {
        return null;
      }

      const content = fs.readFileSync(this.stateFile, "utf-8");
      const state = JSON.parse(content) as DaemonState;

      // Handle version migrations
      if (state.version !== STATE_VERSION) {
        return this.migrateState(state);
      }

      return state;
    } catch (error) {
      log.error("Failed to load state", { error: (error as Error).message });
      return null;
    }
  }

  /**
   * Save state to file (atomic write)
   */
  async save(): Promise<void> {
    if (!this.state) {
      return;
    }

    this.state.stats.lastSavedAt = Date.now();

    try {
      const content = JSON.stringify(this.state, null, 2);
      // Use PID for unique temp file (prevents race if multiple processes)
      const tempFile = `${this.stateFile}.tmp.${process.pid}`;

      // Write to temp file first
      fs.writeFileSync(tempFile, content);

      // Atomic rename
      fs.renameSync(tempFile, this.stateFile);

      this.isDirty = false;

      log.debug("State saved", {
        tokens: this.state.tokens.length,
        file: this.stateFile,
      });
    } catch (error) {
      log.error("Failed to save state", { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Create backup of current state
   */
  async backup(): Promise<string> {
    if (!this.state) {
      throw new Error("No state to backup");
    }

    // Ensure backup directory exists
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFile = path.join(
      this.backupDir,
      `state-${timestamp}.json`
    );

    fs.writeFileSync(backupFile, JSON.stringify(this.state, null, 2));

    // Clean old backups
    await this.cleanOldBackups();

    log.info("State backed up", { file: backupFile });
    return backupFile;
  }

  /**
   * Clean old backups beyond maxBackups
   */
  private async cleanOldBackups(): Promise<void> {
    try {
      const files = fs.readdirSync(this.backupDir)
        .filter(f => f.startsWith("state-") && f.endsWith(".json"))
        .sort()
        .reverse();

      // Remove files beyond maxBackups
      for (let i = this.maxBackups; i < files.length; i++) {
        const file = path.join(this.backupDir, files[i]);
        fs.unlinkSync(file);
        log.debug("Removed old backup", { file });
      }
    } catch (error) {
      log.warn("Failed to clean old backups", { error: (error as Error).message });
    }
  }

  /**
   * Migrate state from older version
   */
  private migrateState(oldState: any): DaemonState {
    log.info("Migrating state", {
      fromVersion: oldState.version,
      toVersion: STATE_VERSION,
    });

    // Version 1 -> 2: Add stats object
    if (oldState.version === 1) {
      oldState.stats = {
        pollCount: 0,
        errorCount: 0,
        heliusParsedCount: 0,
        startedAt: Date.now(),
        lastSavedAt: Date.now(),
      };
      oldState.version = 2;
    }

    return oldState as DaemonState;
  }

  /**
   * Start auto-save timer
   */
  private startAutoSave(): void {
    if (this.autoSaveInterval <= 0) {
      return;
    }

    this.autoSaveTimer = setInterval(async () => {
      if (this.isDirty) {
        await this.save();
      }
    }, this.autoSaveInterval);

    log.debug("Auto-save started", { interval: this.autoSaveInterval });
  }

  /**
   * Stop auto-save timer
   */
  stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = undefined;
    }
  }

  /**
   * Mark state as dirty (needs saving)
   */
  markDirty(): void {
    this.isDirty = true;
  }

  /**
   * Get current state
   */
  getState(): DaemonState | null {
    return this.state;
  }

  /**
   * Update token state
   */
  updateToken(token: TokenState): void {
    if (!this.state) return;

    const index = this.state.tokens.findIndex(t => t.mint === token.mint);
    if (index >= 0) {
      this.state.tokens[index] = token;
    } else {
      this.state.tokens.push(token);
    }
    this.markDirty();
  }

  /**
   * Update last processed signature
   */
  updateLastSignature(signature: string): void {
    if (!this.state) return;
    this.state.lastProcessedSignature = signature;
    this.markDirty();
  }

  /**
   * Update cycle info
   */
  updateCycleInfo(slot: number): void {
    if (!this.state) return;
    this.state.lastCycleSlot = slot;
    this.state.lastCycleTimestamp = Date.now();
    this.state.cycleCount++;
    this.markDirty();
  }

  /**
   * Update PoH chain info
   */
  updatePoHInfo(hash: string, sequence: number): void {
    if (!this.state) return;
    this.state.pohLatestHash = hash;
    this.state.pohSequence = sequence;
    this.markDirty();
  }

  /**
   * Update stats
   */
  updateStats(stats: Partial<DaemonState["stats"]>): void {
    if (!this.state) return;
    Object.assign(this.state.stats, stats);
    this.markDirty();
  }

  /**
   * Increment poll count
   */
  incrementPollCount(): void {
    if (!this.state) return;
    this.state.stats.pollCount++;
    this.markDirty();
  }

  /**
   * Increment error count
   */
  incrementErrorCount(): void {
    if (!this.state) return;
    this.state.stats.errorCount++;
    this.markDirty();
  }

  /**
   * Graceful shutdown - save state and stop timers
   */
  async shutdown(): Promise<void> {
    log.info("StateManager shutting down...");
    this.stopAutoSave();

    if (this.state) {
      await this.backup();
      await this.save();
    }

    log.info("StateManager shutdown complete");
  }
}

// Singleton instance
let stateManagerInstance: StateManager | null = null;

export function initStateManager(config?: StateManagerConfig): StateManager {
  stateManagerInstance = new StateManager(config);
  return stateManagerInstance;
}

export function getStateManager(): StateManager | null {
  return stateManagerInstance;
}
