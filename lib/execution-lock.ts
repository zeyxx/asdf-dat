/**
 * Execution Locking System
 *
 * Prevents concurrent cycle executions using file-based locks.
 * Designed for single-machine deployment with crash recovery.
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Configuration
// ============================================================================

const LOCK_FILE_NAME = '.cycle-lock.json';
const DEFAULT_LOCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes - auto-expire stale locks

export interface LockInfo {
  pid: number;
  timestamp: number;
  tokenMint?: string;
  operation: string;
  hostname: string;
}

export interface LockStatus {
  locked: boolean;
  lockInfo?: LockInfo;
  ageMs?: number;
  isStale?: boolean;
}

// ============================================================================
// Lock Manager
// ============================================================================

export class ExecutionLock {
  private lockFilePath: string;
  private lockTimeoutMs: number;

  constructor(
    lockDir: string = process.cwd(),
    lockTimeoutMs: number = DEFAULT_LOCK_TIMEOUT_MS
  ) {
    this.lockFilePath = path.join(lockDir, LOCK_FILE_NAME);
    this.lockTimeoutMs = lockTimeoutMs;
  }

  /**
   * Attempt to acquire the execution lock
   * @param operation - Description of the operation (e.g., "ecosystem-cycle")
   * @param tokenMint - Optional token mint for per-token locking
   * @returns true if lock acquired, false if already locked
   */
  acquire(operation: string, tokenMint?: string): boolean {
    const status = this.getStatus();

    // If locked and not stale, cannot acquire
    if (status.locked && !status.isStale) {
      return false;
    }

    // If stale, log warning and proceed to overwrite
    if (status.locked && status.isStale) {
      console.warn(
        `[LOCK] Found stale lock from PID ${status.lockInfo?.pid} ` +
        `(age: ${Math.round((status.ageMs ?? 0) / 1000)}s). Overwriting.`
      );
    }

    // Create new lock
    const lockInfo: LockInfo = {
      pid: process.pid,
      timestamp: Date.now(),
      tokenMint,
      operation,
      hostname: this.getHostname(),
    };

    try {
      // Write atomically using rename pattern
      const tempPath = `${this.lockFilePath}.tmp.${process.pid}`;
      fs.writeFileSync(tempPath, JSON.stringify(lockInfo, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.lockFilePath);
      return true;
    } catch (error) {
      console.error(`[LOCK] Failed to acquire lock: ${error}`);
      return false;
    }
  }

  /**
   * Release the execution lock
   * @param force - Force release even if owned by different PID
   */
  release(force: boolean = false): boolean {
    const status = this.getStatus();

    if (!status.locked) {
      return true; // Already unlocked
    }

    // Check ownership unless forcing
    if (!force && status.lockInfo?.pid !== process.pid) {
      console.warn(
        `[LOCK] Cannot release lock owned by PID ${status.lockInfo?.pid} ` +
        `(current PID: ${process.pid})`
      );
      return false;
    }

    try {
      fs.unlinkSync(this.lockFilePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return true; // File already gone
      }
      console.error(`[LOCK] Failed to release lock: ${error}`);
      return false;
    }
  }

  /**
   * Get current lock status
   */
  getStatus(): LockStatus {
    try {
      if (!fs.existsSync(this.lockFilePath)) {
        return { locked: false };
      }

      const content = fs.readFileSync(this.lockFilePath, 'utf-8');
      const lockInfo: LockInfo = JSON.parse(content);
      const ageMs = Date.now() - lockInfo.timestamp;
      const isStale = ageMs > this.lockTimeoutMs;

      return {
        locked: true,
        lockInfo,
        ageMs,
        isStale,
      };
    } catch (error) {
      // If file is corrupted or unreadable, treat as unlocked
      console.warn(`[LOCK] Error reading lock file: ${error}`);
      return { locked: false };
    }
  }

  /**
   * Check if currently locked (convenience method)
   */
  isLocked(): boolean {
    const status = this.getStatus();
    return status.locked && !status.isStale;
  }

  /**
   * Wait for lock to become available
   * @param timeoutMs - Maximum time to wait
   * @param pollIntervalMs - How often to check
   */
  async waitForUnlock(
    timeoutMs: number = 60000,
    pollIntervalMs: number = 1000
  ): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (!this.isLocked()) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    return false;
  }

  /**
   * Execute a function with automatic lock management
   */
  async withLock<T>(
    operation: string,
    fn: () => Promise<T>,
    tokenMint?: string
  ): Promise<T> {
    if (!this.acquire(operation, tokenMint)) {
      const status = this.getStatus();
      throw new LockError(
        `Cannot acquire lock for "${operation}". ` +
        `Locked by PID ${status.lockInfo?.pid} since ${new Date(status.lockInfo?.timestamp ?? 0).toISOString()}`
      );
    }

    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Get hostname for lock info
   */
  private getHostname(): string {
    try {
      return require('os').hostname();
    } catch {
      return 'unknown';
    }
  }

  /**
   * Clean up stale lock (utility method)
   */
  cleanStale(): boolean {
    const status = this.getStatus();
    if (status.locked && status.isStale) {
      return this.release(true);
    }
    return false;
  }
}

// ============================================================================
// Error Types
// ============================================================================

export class LockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LockError';
  }
}

// ============================================================================
// Per-Token Lock Manager
// ============================================================================

/**
 * Manages individual locks per token mint
 * Useful for parallel token processing with individual locks
 */
export class TokenLockManager {
  private lockDir: string;
  private lockTimeoutMs: number;
  private locks: Map<string, ExecutionLock> = new Map();

  constructor(
    lockDir: string = process.cwd(),
    lockTimeoutMs: number = DEFAULT_LOCK_TIMEOUT_MS
  ) {
    this.lockDir = lockDir;
    this.lockTimeoutMs = lockTimeoutMs;
  }

  /**
   * Get or create lock for a specific token
   */
  private getLock(tokenMint: string): ExecutionLock {
    if (!this.locks.has(tokenMint)) {
      // Create a unique lock file per token
      const lockFileName = `.lock-${tokenMint.slice(0, 8)}.json`;
      const lockPath = path.join(this.lockDir, lockFileName);
      // We need to create a lock with custom path
      const lock = new ExecutionLock(path.dirname(lockPath), this.lockTimeoutMs);
      // Override the lock file path
      (lock as any).lockFilePath = lockPath;
      this.locks.set(tokenMint, lock);
    }
    return this.locks.get(tokenMint)!;
  }

  /**
   * Acquire lock for a specific token
   */
  acquireForToken(tokenMint: string, operation: string): boolean {
    return this.getLock(tokenMint).acquire(operation, tokenMint);
  }

  /**
   * Release lock for a specific token
   */
  releaseForToken(tokenMint: string): boolean {
    return this.getLock(tokenMint).release();
  }

  /**
   * Check if a token is locked
   */
  isTokenLocked(tokenMint: string): boolean {
    return this.getLock(tokenMint).isLocked();
  }

  /**
   * Get status for a specific token
   */
  getTokenStatus(tokenMint: string): LockStatus {
    return this.getLock(tokenMint).getStatus();
  }

  /**
   * Release all locks (cleanup)
   */
  releaseAll(): void {
    Array.from(this.locks.values()).forEach((lock) => {
      lock.release(true);
    });
    this.locks.clear();
  }

  /**
   * Clean all stale locks
   */
  cleanAllStale(): number {
    let cleaned = 0;
    Array.from(this.locks.values()).forEach((lock) => {
      if (lock.cleanStale()) {
        cleaned++;
      }
    });
    return cleaned;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let globalLock: ExecutionLock | null = null;

/**
 * Get the global execution lock instance
 */
export function getGlobalLock(): ExecutionLock {
  if (!globalLock) {
    globalLock = new ExecutionLock();
  }
  return globalLock;
}

/**
 * Convenience function to acquire global lock
 */
export function acquireGlobalLock(operation: string): boolean {
  return getGlobalLock().acquire(operation);
}

/**
 * Convenience function to release global lock
 */
export function releaseGlobalLock(): boolean {
  return getGlobalLock().release();
}

/**
 * Convenience function to check global lock status
 */
export function isGloballyLocked(): boolean {
  return getGlobalLock().isLocked();
}
