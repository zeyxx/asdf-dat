/**
 * ASDF Burn Engine PDA Utilities
 *
 * Single source of truth for all PDA derivations.
 * Import from here instead of deriving locally.
 *
 * PDA Overview:
 * - ASDF Program PDAs: DAT State, Authority, Token Stats, Root Treasury
 * - Pump.fun PDAs: Creator Vault (BC), Creator Vault (AMM)
 * - External: Validator State, User Stats, Rebate Pool
 */

import { PublicKey } from '@solana/web3.js';
import {
  PROGRAM_ID,
  PUMP_PROGRAM,
  PUMPSWAP_PROGRAM,
  METADATA_PROGRAM,
  DAT_STATE_SEED,
  DAT_AUTHORITY_SEED,
  TOKEN_STATS_SEED,
  ROOT_TREASURY_SEED,
  VALIDATOR_STATE_SEED,
  USER_STATS_SEED,
  REBATE_POOL_SEED,
  WSOL_MINT,
} from './constants';

// ============================================================================
// ASDF Burn Engine Program PDAs
// ============================================================================

/**
 * Derive DAT State PDA
 * Seeds: ["dat_v3"]
 */
export function deriveDATState(programId: PublicKey = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([DAT_STATE_SEED], programId);
}

/**
 * Derive DAT Authority PDA
 * Seeds: ["auth_v3"]
 */
export function deriveDATAuthority(programId: PublicKey = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([DAT_AUTHORITY_SEED], programId);
}

/**
 * Derive Token Stats PDA for a specific token
 * Seeds: ["token_stats_v1", mint]
 */
export function deriveTokenStats(
  mint: PublicKey,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([TOKEN_STATS_SEED, mint.toBuffer()], programId);
}

/**
 * Derive Root Treasury PDA
 * Seeds: ["root_treasury", root_mint]
 */
export function deriveRootTreasury(
  rootMint: PublicKey,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ROOT_TREASURY_SEED, rootMint.toBuffer()],
    programId
  );
}

/**
 * Derive Validator State PDA
 * Seeds: ["validator_v1", mint, bonding_curve]
 */
export function deriveValidatorState(
  mint: PublicKey,
  bondingCurve: PublicKey,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VALIDATOR_STATE_SEED, mint.toBuffer(), bondingCurve.toBuffer()],
    programId
  );
}

/**
 * Derive User Stats PDA
 * Seeds: ["user_stats_v1", user]
 */
export function deriveUserStats(
  user: PublicKey,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([USER_STATS_SEED, user.toBuffer()], programId);
}

/**
 * Derive Rebate Pool PDA
 * Seeds: ["rebate_pool"]
 */
export function deriveRebatePool(programId: PublicKey = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([REBATE_POOL_SEED], programId);
}

// ============================================================================
// Pump.fun Creator Vault PDAs
// ============================================================================

/**
 * Derive Creator Vault PDA for Bonding Curve tokens
 * Seeds: ["creator-vault", creator] (note: hyphen)
 */
export function deriveCreatorVaultBC(creator: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('creator-vault'), creator.toBuffer()],
    PUMP_PROGRAM
  );
}

/**
 * Derive Creator Vault PDA for AMM tokens
 * Seeds: ["creator_vault", creator] (note: underscore)
 */
export function deriveCreatorVaultAMM(creator: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('creator_vault'), creator.toBuffer()],
    PUMPSWAP_PROGRAM
  );
}

/**
 * Derive Creator Vault Authority PDA for AMM
 * Seeds: ["creator_vault_authority", creator]
 */
export function deriveCreatorVaultAuthority(creator: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('creator_vault_authority'), creator.toBuffer()],
    PUMPSWAP_PROGRAM
  );
}

/**
 * Get creator vault address based on pool type
 */
export function getCreatorVaultAddress(
  creator: PublicKey,
  poolType: 'bonding_curve' | 'amm' | 'pumpswap_amm'
): PublicKey {
  if (poolType === 'bonding_curve') {
    return deriveCreatorVaultBC(creator)[0];
  } else {
    return deriveCreatorVaultAMM(creator)[0];
  }
}

// ============================================================================
// Pump.fun Pool PDAs
// ============================================================================

/**
 * Derive Bonding Curve PDA
 * Seeds: ["bonding-curve", mint]
 */
export function deriveBondingCurve(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), mint.toBuffer()],
    PUMP_PROGRAM
  );
}

/**
 * Derive AMM Pool PDA
 * Seeds: ["pool", mint, wsol_mint]
 */
export function deriveAMMPool(
  mint: PublicKey,
  wsolMint: PublicKey = WSOL_MINT
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), mint.toBuffer(), wsolMint.toBuffer()],
    PUMPSWAP_PROGRAM
  );
}

/**
 * Get pool address based on pool type
 */
export function getPoolAddress(
  mint: PublicKey,
  poolType: 'bonding_curve' | 'amm' | 'pumpswap_amm'
): PublicKey {
  if (poolType === 'bonding_curve') {
    return deriveBondingCurve(mint)[0];
  } else {
    return deriveAMMPool(mint)[0];
  }
}

// ============================================================================
// Pump.fun Internal PDAs
// ============================================================================

/**
 * Derive Pump.fun Global Config PDA
 * Seeds: ["global"]
 */
export function derivePumpGlobalConfig(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('global')], PUMP_PROGRAM);
}

/**
 * Derive Pump.fun Event Authority PDA
 * Seeds: ["__event_authority"]
 */
export function derivePumpEventAuthority(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], PUMP_PROGRAM);
}

/**
 * Derive Pump.fun Fee Config PDA
 * Seeds: ["fee-config"]
 */
export function derivePumpFeeConfig(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('fee-config')], PUMP_PROGRAM);
}

// ============================================================================
// Metaplex Metadata PDA
// ============================================================================

/**
 * Derive Token Metadata PDA (Metaplex)
 * Seeds: ["metadata", metadata_program, mint]
 */
export function deriveMetadata(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), METADATA_PROGRAM.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM
  );
}

// ============================================================================
// Convenience Exports
// ============================================================================

/**
 * Get all ASDF Burn Engine PDAs for a given root mint
 */
export function getAllDATpdas(rootMint?: PublicKey): {
  datState: PublicKey;
  datAuthority: PublicKey;
  rootTreasury: PublicKey | null;
  rebatePool: PublicKey;
} {
  const [datState] = deriveDATState();
  const [datAuthority] = deriveDATAuthority();
  const [rebatePool] = deriveRebatePool();
  const rootTreasury = rootMint ? deriveRootTreasury(rootMint)[0] : null;

  return {
    datState,
    datAuthority,
    rootTreasury,
    rebatePool,
  };
}
