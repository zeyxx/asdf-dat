/**
 * AMM Utilities for PumpSwap Integration
 *
 * This module provides utilities for deriving PumpSwap AMM vault addresses
 * and working with both Bonding Curve and AMM tokens in the ASDF Burn Engine ecosystem.
 */

import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

// Program IDs
export const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
export const PUMPSWAP_PROGRAM = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');

// Token Mints
export const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// Pool Types
export type PoolType = 'bonding_curve' | 'pumpswap_amm';

/**
 * Derive the PumpSwap AMM creator vault authority PDA
 * Seeds: ["creator_vault", creator_pubkey]
 */
export function deriveAmmCreatorVaultAuthority(creator: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('creator_vault'), creator.toBuffer()],
    PUMPSWAP_PROGRAM
  );
}

/**
 * Get the WSOL ATA for the AMM creator vault authority
 * This is where AMM creator fees accumulate as WSOL
 */
export function getAmmCreatorVaultAta(creator: PublicKey): PublicKey {
  const [vaultAuthority] = deriveAmmCreatorVaultAuthority(creator);
  return getAssociatedTokenAddressSync(WSOL_MINT, vaultAuthority, true);
}

/**
 * Derive the PumpFun Bonding Curve creator vault PDA
 * Seeds: ["creator-vault", creator_pubkey]
 * Note: Uses hyphen, not underscore (different from AMM)
 */
export function getBcCreatorVault(creator: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('creator-vault'), creator.toBuffer()],
    PUMP_PROGRAM
  )[0];
}

/**
 * Get the appropriate vault address based on pool type
 * - For bonding_curve: returns native SOL vault PDA
 * - For pumpswap_amm: returns WSOL token account (ATA)
 */
export function getCreatorVaultAddress(creator: PublicKey, poolType: PoolType): PublicKey {
  if (poolType === 'bonding_curve') {
    return getBcCreatorVault(creator);
  } else {
    return getAmmCreatorVaultAta(creator);
  }
}

/**
 * Check if pool type is AMM
 */
export function isAmmToken(poolType: PoolType): boolean {
  return poolType === 'pumpswap_amm';
}

/**
 * Check if pool type is Bonding Curve
 */
export function isBondingCurveToken(poolType: PoolType): boolean {
  return poolType === 'bonding_curve';
}
