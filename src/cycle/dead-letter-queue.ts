/**
 * Dead Letter Queue (DLQ) Management
 *
 * Handles failed token cycles with automatic retry for transient errors.
 * Features:
 * - Exponential backoff retry
 * - Auto-expiry after 24 hours
 * - Max 5 retries per token
 * - Persistent storage in .dead-letter-tokens.json
 */

import * as fs from 'fs';
import { PublicKey } from '@solana/web3.js';
import { isRetryableError } from '../network/rpc-utils';
import { log, colors } from './utils/logging';

const DEAD_LETTER_FILE = '.dead-letter-tokens.json';
const MAX_DLQ_RETRIES = 5;
const DLQ_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface DeadLetterEntry {
  timestamp: string;
  token: string;
  mint: string;
  error: string;
  isTransient: boolean;
  pendingFees: number;
  allocation: number;
  retryCount: number;
  nextRetryAt?: string; // ISO timestamp for auto-retry
  status?: 'pending' | 'resolved' | 'expired';
}

export interface DLQProcessResult {
  retryable: string[]; // Mints ready for retry
  expired: string[]; // Tokens that exceeded retries/time
}

/**
 * Dead Letter Queue Manager
 */
export class DeadLetterQueue {
  constructor(private readonly filePath: string = DEAD_LETTER_FILE) {}

  /**
   * Process DLQ: identify retryable and expired entries
   * Called at the start of each cycle
   */
  process(): DLQProcessResult {
    const retryable: string[] = [];
    const expired: string[] = [];

    if (!fs.existsSync(this.filePath)) {
      return { retryable, expired };
    }

    let entries: DeadLetterEntry[];
    try {
      entries = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
    } catch {
      return { retryable, expired };
    }

    const now = Date.now();
    let modified = false;

    for (const entry of entries) {
      // Skip already resolved/expired
      if (entry.status === 'resolved' || entry.status === 'expired') {
        continue;
      }

      const entryAge = now - new Date(entry.timestamp).getTime();

      // Check if entry has expired (24h)
      if (entryAge > DLQ_EXPIRY_MS) {
        entry.status = 'expired';
        expired.push(entry.token);
        modified = true;
        continue;
      }

      // Check if max retries exceeded
      if (entry.retryCount >= MAX_DLQ_RETRIES) {
        entry.status = 'expired';
        expired.push(entry.token);
        modified = true;
        continue;
      }

      // Check if transient and ready for retry
      if (entry.isTransient && entry.nextRetryAt) {
        const retryTime = new Date(entry.nextRetryAt).getTime();
        if (now >= retryTime) {
          retryable.push(entry.mint);
        }
      }
    }

    // Save if modified
    if (modified) {
      this.saveEntries(entries);
    }

    return { retryable, expired };
  }

  /**
   * Mark entry as resolved after successful retry
   */
  markResolved(mint: string): void {
    if (!fs.existsSync(this.filePath)) return;

    try {
      const entries: DeadLetterEntry[] = JSON.parse(
        fs.readFileSync(this.filePath, 'utf-8')
      );
      const entry = entries.find((e) => e.mint === mint && e.status !== 'resolved');
      if (entry) {
        entry.status = 'resolved';
        this.saveEntries(entries);
        log('✅', `DLQ: Marked ${entry.token} as resolved`, colors.green);
      }
    } catch {
      // Ignore errors
    }
  }

  /**
   * Append failed token to DLQ
   */
  append(
    token: { symbol: string; mint: PublicKey },
    error: Error,
    pendingFees: number,
    allocation: number,
    retryCount: number
  ): void {
    const isTransient = isRetryableError(error);
    const entry: DeadLetterEntry = {
      timestamp: new Date().toISOString(),
      token: token.symbol,
      mint: token.mint.toBase58(),
      error: error.message,
      isTransient,
      pendingFees,
      allocation,
      retryCount,
      nextRetryAt: isTransient
        ? this.getNextRetryTime(retryCount).toISOString()
        : undefined,
      status: 'pending',
    };

    let entries: DeadLetterEntry[] = [];
    try {
      if (fs.existsSync(this.filePath)) {
        entries = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      }
    } catch {
      // File doesn't exist or is invalid - start fresh
    }

    entries.push(entry);

    // Keep only last 100 entries
    if (entries.length > 100) {
      entries = entries.slice(-100);
    }

    this.saveEntries(entries);
    log(
      '📝',
      `Added ${token.symbol} to dead-letter queue: ${this.filePath}`,
      colors.yellow
    );
  }

  /**
   * Calculate next retry time with exponential backoff
   * 5min, 10min, 20min, 40min, 80min
   */
  private getNextRetryTime(retryCount: number): Date {
    const baseDelayMs = 5 * 60 * 1000; // 5 minutes
    const delay = baseDelayMs * Math.pow(2, retryCount - 1);
    return new Date(Date.now() + delay);
  }

  /**
   * Save entries to file
   */
  private saveEntries(entries: DeadLetterEntry[]): void {
    fs.writeFileSync(this.filePath, JSON.stringify(entries, null, 2));
  }
}

/**
 * Check if error is CycleTooSoon (time threshold not met)
 * This is NOT a failure - just means token isn't ready yet
 */
export function isCycleTooSoonError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('cycletoosoon') ||
    message.includes('cycle too soon') ||
    message.includes('min_cycle_interval')
  );
}
