/**
 * Formatting Utilities for Cycle Display
 *
 * Human-readable formatting for amounts, dates, and other cycle data.
 */

import { LAMPORTS_PER_SOL } from '@solana/web3.js';

/**
 * Format lamports as SOL with 6 decimal places
 */
export function formatSOL(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(6);
}

/**
 * Format large numbers with commas
 */
export function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

/**
 * Format percentage with 2 decimal places
 */
export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

/**
 * Format duration in milliseconds to human-readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Truncate pubkey for display
 */
export function truncatePubkey(pubkey: string, chars = 8): string {
  return `${pubkey.slice(0, chars)}...${pubkey.slice(-chars)}`;
}
