/**
 * TypeScript type definitions for the ASDF DAT program
 * Generated from the IDL to provide type safety across the codebase
 */

import { PublicKey } from '@solana/web3.js';
import { BN, Program, IdlAccounts } from '@coral-xyz/anchor';

// ============================================================================
// Account Types
// ============================================================================

/**
 * DATState account - Global protocol state
 * PDA: ["dat_v3"]
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
 * TokenStats account - Per-token statistics
 * PDA: ["token_stats_v1", mint]
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

// ============================================================================
// Instruction Arguments Types
// ============================================================================

export interface CollectFeesArgs {
  isRootToken: boolean;
  forEcosystem: boolean;
}

export interface ExecuteBuyArgs {
  isSecondaryToken: boolean;
  allocatedLamports: BN | null;
}

export interface SetRootTokenArgs {
  rootMint: PublicKey;
}

export interface UpdateFeeSplitArgs {
  newFeeSplitBps: number;
}

export interface UpdateParametersArgs {
  newMinFees: BN | null;
  newMaxFees: BN | null;
  newSlippageBps: number | null;
  newMinInterval: BN | null;
}

export interface RecordFailureArgs {
  errorCode: number;
}

export interface UpdatePendingFeesArgs {
  amountLamports: BN;
}

// ============================================================================
// Program Type Helper
// ============================================================================

/**
 * Type-safe program accounts accessor
 * Usage: const state = await getProgramAccounts(program).datState.fetch(pda);
 */
export interface DATAccounts {
  datState: {
    fetch: (pda: PublicKey) => Promise<DATState>;
    fetchNullable: (pda: PublicKey) => Promise<DATState | null>;
  };
  tokenStats: {
    fetch: (pda: PublicKey) => Promise<TokenStats>;
    fetchNullable: (pda: PublicKey) => Promise<TokenStats | null>;
  };
}

/**
 * Helper to get typed program accounts
 * Avoids the need for `as any` throughout the codebase
 */
export function getDATAccounts(program: Program): DATAccounts {
  return program.account as unknown as DATAccounts;
}

// ============================================================================
// Constants
// ============================================================================

export const DAT_STATE_SEED = Buffer.from('dat_v3');
export const DAT_AUTHORITY_SEED = Buffer.from('auth_v3');
export const TOKEN_STATS_SEED = Buffer.from('token_stats_v1');
export const ROOT_TREASURY_SEED = Buffer.from('root_treasury');

// Program and External Program IDs
export const PROGRAM_ID = new PublicKey('ASDfNfUHwVGfrg3SV7SQYWhaVxnrCUZyWmMpWJAPu4MZ');
export const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
export const PUMP_SWAP_PROGRAM = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
export const FEE_PROGRAM = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');

// PumpFun accounts
export const PUMP_GLOBAL_CONFIG = new PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf');
export const PUMP_EVENT_AUTHORITY = new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1');

// Token mints
export const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// ============================================================================
// PDA Derivation Helpers
// ============================================================================

export function deriveDatState(programId: PublicKey = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([DAT_STATE_SEED], programId);
}

export function deriveDatAuthority(programId: PublicKey = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([DAT_AUTHORITY_SEED], programId);
}

export function deriveTokenStats(mint: PublicKey, programId: PublicKey = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([TOKEN_STATS_SEED, mint.toBuffer()], programId);
}

export function deriveRootTreasury(rootMint: PublicKey, programId: PublicKey = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([ROOT_TREASURY_SEED, rootMint.toBuffer()], programId);
}

export function deriveCreatorVault(creator: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('creator-vault'), creator.toBuffer()],
    PUMP_PROGRAM
  );
}

export function derivePumpEventAuthority(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('__event_authority')],
    PUMP_PROGRAM
  );
}
