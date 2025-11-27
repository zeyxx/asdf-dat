/**
 * TypeScript type definitions for ASDF-DAT program accounts
 * These types match the Rust structs in programs/asdf-dat/src/lib.rs
 */

import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

/**
 * DATState account - Global configuration for the DAT protocol
 * Rust struct: programs/asdf-dat/src/lib.rs:2449-2484
 */
export interface DATState {
  admin: PublicKey;
  asdfMint: PublicKey;
  wsolMint: PublicKey;
  poolAddress: PublicKey;
  pumpSwapProgram: PublicKey;
  totalBurned: BN;
  totalSolCollected: BN;
  totalBuybacks: number;
  failedCycles: number;
  consecutiveFailures: number;
  isActive: boolean;
  emergencyPause: boolean;
  lastCycleTimestamp: BN;
  initializedAt: BN;
  lastAmExecution: BN;
  lastPmExecution: BN;
  lastCycleSol: BN;
  lastCycleBurned: BN;
  minFeesThreshold: BN;
  maxFeesPerCycle: BN;
  slippageBps: number;
  minCycleInterval: BN;
  datAuthorityBump: number;
  currentFeeRecipientIndex: number;
  lastKnownPrice: BN;
  pendingBurnAmount: BN;
  rootTokenMint: PublicKey | null;
  feeSplitBps: number;
  lastSolSentToRoot: BN;
}

/**
 * TokenStats account - Per-token statistics tracking
 * Rust struct: programs/asdf-dat/src/lib.rs:2488-2505
 */
export interface TokenStats {
  mint: PublicKey;
  totalBurned: BN;
  totalSolCollected: BN;
  totalSolUsed: BN;
  totalSolSentToRoot: BN;
  totalSolReceivedFromOthers: BN;
  totalBuybacks: BN;
  lastCycleTimestamp: BN;
  lastCycleSol: BN;
  lastCycleBurned: BN;
  isRootToken: boolean;
  bump: number;
  pendingFeesLamports: BN;
  lastFeeUpdateTimestamp: BN;
  cyclesParticipated: BN;
}

/**
 * ValidatorState account - Trustless per-token fee attribution
 * Rust struct: programs/asdf-dat/src/lib.rs:2513-2527
 */
export interface ValidatorState {
  mint: PublicKey;
  bondingCurve: PublicKey;
  lastValidatedSlot: BN;
  totalValidatedLamports: BN;
  totalValidatedCount: BN;
  feeRateBps: number;
  bump: number;
}

/**
 * Token configuration from JSON files (devnet-token-*.json)
 */
export interface TokenConfig {
  mint: string;
  bondingCurve: string;
  creator: string;
  creatorVault: string;
  tokenProgram: string;
  poolType: 'bonding_curve' | 'amm';
  name: string;
  symbol: string;
  isRoot?: boolean;
}

/**
 * Result of an ecosystem cycle for a single token
 */
export interface CycleResult {
  token: string;
  symbol: string;
  status: 'success' | 'failed' | 'deferred';
  allocatedLamports: BN | null;
  buyTx: string | null;
  finalizeTx: string | null;
  burnTx: string | null;
  error?: string;
}

/**
 * Ecosystem cycle summary
 */
export interface EcosystemCycleSummary {
  totalTokens: number;
  successful: number;
  failed: number;
  deferred: number;
  totalCollected: BN;
  results: CycleResult[];
  executionTimeMs: number;
}

/**
 * Fee monitoring state persisted to disk
 */
export interface DaemonState {
  lastSignatures: Record<string, string>;
  lastUpdated: string;
  version: number;
}

/**
 * Helper type for Anchor program account fetch
 * Use this to type the result of program.account.*.fetch()
 */
export type AnchorAccount<T> = T;

/**
 * Type-safe accessor for Anchor program accounts
 * Eliminates the need for `(program.account as any)` patterns
 *
 * Usage:
 *   const accounts = getTypedAccounts(program);
 *   const state = await accounts.datState.fetch(pda);
 *   const stats = await accounts.tokenStats.fetch(pda);
 */
export interface TypedAccountFetcher {
  datState: { fetch: (pda: PublicKey) => Promise<DATState> };
  tokenStats: { fetch: (pda: PublicKey) => Promise<TokenStats> };
  validatorState: { fetch: (pda: PublicKey) => Promise<ValidatorState> };
}

/**
 * Get typed account fetchers from an Anchor program
 * @param program - Anchor Program instance
 * @returns Typed account fetcher object
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getTypedAccounts(program: { account: any }): TypedAccountFetcher {
  return program.account as TypedAccountFetcher;
}

/**
 * Type guard to check if a value is a valid PublicKey
 */
export function isPublicKey(value: unknown): value is PublicKey {
  return value instanceof PublicKey;
}

/**
 * Type guard to check if a value is a valid BN
 */
export function isBN(value: unknown): value is BN {
  return BN.isBN(value);
}

/**
 * Convert lamports (BN) to SOL (number)
 */
export function lamportsToSol(lamports: BN): number {
  return lamports.toNumber() / 1_000_000_000;
}

/**
 * Convert SOL (number) to lamports (BN)
 */
export function solToLamports(sol: number): BN {
  return new BN(Math.floor(sol * 1_000_000_000));
}
