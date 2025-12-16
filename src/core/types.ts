/**
 * TypeScript type definitions for ASDF Burn Engine program accounts
 *
 * These types match the Rust structs in programs/asdf-dat/src/lib.rs
 * For runtime types (daemon, state persistence), see src/types/index.ts
 *
 * Architecture note:
 * - This file: ON-CHAIN account types (DATState, TokenStats, etc.)
 * - src/types/index.ts: RUNTIME types (TrackedToken, VerifiedToken, etc.)
 */

import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

// Re-export PoolType from main types for consistency
export type { PoolType, TokenProgramType } from '../types';

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
  // Security audit additions (v2)
  pendingAdmin: PublicKey | null;
  pendingFeeSplit: number | null;
  pendingFeeSplitTimestamp: BN;
  adminOperationCooldown: BN;
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
 * UserStats account - External app user contribution tracking
 * Rust struct: programs/asdf-dat/src/state/user_stats.rs
 */
export interface UserStats {
  bump: number;
  user: PublicKey;
  pendingContribution: BN;
  totalContributed: BN;
  totalRebate: BN;
  lastUpdateTimestamp: BN;
  lastUpdateSlot: BN;
}

/**
 * RebatePool account - Self-sustaining rebate fund
 * Rust struct: programs/asdf-dat/src/state/rebate_pool.rs
 */
export interface RebatePool {
  bump: number;
  totalDeposited: BN;
  totalDistributed: BN;
  rebatesCount: BN;
  lastRebateTimestamp: BN;
  lastRebateSlot: BN;
  uniqueRecipients: BN;
}

/**
 * User eligible for rebate lottery
 */
export interface EligibleUser {
  pubkey: PublicKey;
  statsPda: PublicKey;
  pendingContribution: BN;
  lastUpdateSlot: BN;
}

// Note: TokenProgramType and PoolType are re-exported from '../types' at the top of this file

/**
 * Token configuration from JSON files (devnet-tokens/*.json)
 *
 * IMPORTANT: This stores bondingCurve for legacy compatibility.
 * New architecture: bondingCurve should be DERIVED from mint, not stored.
 * See VerifiedToken in src/types/index.ts for the new pattern.
 *
 * Key distinction:
 * - tokenProgram: Which token program (SPL vs Token2022)
 * - mayhemMode: Whether Mayhem Mode is enabled (affects fee recipients and trading)
 *
 * A token can be Token2022 WITHOUT mayhemMode (standard create_v2 token)
 */
export interface TokenConfig {
  mint: string;
  bondingCurve: string;   // Legacy: should be derived, not stored
  creator: string;
  creatorVault?: string;  // Optional, can be derived
  name: string;
  symbol: string;
  uri?: string;

  // Token characteristics
  tokenProgram: 'SPL' | 'Token2022';
  poolType: 'bonding_curve' | 'pumpswap_amm';
  mayhemMode: boolean;  // REQUIRED - determines SDK behavior

  // Metadata
  isRoot?: boolean;
  isCTO?: boolean;  // true if token has undergone Community TakeOver (pump.fun)
  network?: 'devnet' | 'mainnet';
  timestamp?: string;
  transaction?: string;
}

/**
 * Validate a TokenConfig has all required fields
 */
export function validateTokenConfig(config: unknown): config is TokenConfig {
  if (!config || typeof config !== 'object') return false;
  const c = config as Record<string, unknown>;

  return (
    typeof c.mint === 'string' &&
    typeof c.bondingCurve === 'string' &&
    typeof c.creator === 'string' &&
    typeof c.name === 'string' &&
    typeof c.symbol === 'string' &&
    (c.tokenProgram === 'SPL' || c.tokenProgram === 'Token2022') &&
    typeof c.mayhemMode === 'boolean'
  );
}

/**
 * Get the correct token program ID for a token config
 */
export function getTokenProgramId(config: TokenConfig): string {
  return config.tokenProgram === 'Token2022'
    ? 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
    : 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
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

// Note: DaemonState has been moved to src/types/index.ts
// For fee monitoring state, use PersistedState or PersistedStateV2

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
  userStats: { fetch: (pda: PublicKey) => Promise<UserStats> };
  rebatePool: { fetch: (pda: PublicKey) => Promise<RebatePool> };
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
