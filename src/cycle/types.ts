/**
 * Cycle Module Types
 *
 * Type definitions used across cycle execution modules
 */

import { PublicKey } from '@solana/web3.js';

export type PoolType = 'bonding_curve' | 'pumpswap_amm';

export interface TokenConfig {
  file: string;
  symbol: string;
  mint: PublicKey;
  bondingCurve: PublicKey; // For bonding_curve: the bonding curve address. For AMM: the pool address.
  creator: PublicKey;
  isRoot: boolean;
  isToken2022: boolean;
  mayhemMode: boolean; // Determines fee recipient (Mayhem vs SPL)
  poolType: PoolType; // Determines bonding curve vs PumpSwap AMM
  pendingFeesFromState?: number; // Pending fees from daemon state file (fallback when TokenStats doesn't exist)
  hasTokenStats?: boolean; // Whether TokenStats account exists on-chain
}
