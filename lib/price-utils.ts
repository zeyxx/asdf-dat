/**
 * Price Utilities for MEV Protection
 *
 * Calculates expected token amounts from pool reserves and validates slippage.
 * Supports both PumpFun bonding curve and AMM pool types.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { withRetryAndTimeout } from './rpc-utils';

// ============================================================================
// Constants
// ============================================================================

// PumpFun bonding curve constants
const PUMP_BONDING_CURVE_VIRTUAL_SOL_RESERVE = 30_000_000_000n; // 30 SOL virtual
const PUMP_BONDING_CURVE_VIRTUAL_TOKEN_RESERVE = 1_073_000_000_000_000n; // 1.073B tokens virtual
const PUMP_FEE_BPS = 100n; // 1% pump fee

// Default slippage tolerance
export const DEFAULT_SLIPPAGE_BPS = 500; // 5%
export const MAX_SLIPPAGE_BPS = 1500; // 15% absolute max

// ============================================================================
// Types
// ============================================================================

export interface PoolReserves {
  solReserve: bigint;      // In lamports
  tokenReserve: bigint;    // In base units
  virtualSolReserve?: bigint;
  virtualTokenReserve?: bigint;
}

export interface PoolPrice {
  price: number;           // SOL per token
  priceImpact: number;     // Estimated % impact for 1 SOL buy
  reserves: PoolReserves;
  poolType: 'bonding_curve' | 'amm';
}

export interface SwapQuote {
  inputAmount: bigint;     // SOL in lamports
  expectedOutput: bigint;  // Tokens expected
  minOutput: bigint;       // Minimum with slippage
  priceImpact: number;     // Percentage
  effectivePrice: number;  // SOL per token for this swap
  slippageBps: number;     // Applied slippage
}

export interface SlippageValidation {
  isValid: boolean;
  actualSlippageBps: number;
  expectedOutput: bigint;
  actualOutput: bigint;
  reason?: string;
}

// ============================================================================
// Pool Data Parsing
// ============================================================================

/**
 * Parse bonding curve account data
 * Layout: virtual_token_reserve (u64), virtual_sol_reserve (u64), real_token_reserve (u64), real_sol_reserve (u64), ...
 */
export function parseBondingCurveData(data: Buffer): PoolReserves {
  if (data.length < 32) {
    throw new Error(`Invalid bonding curve data length: ${data.length}`);
  }

  // Read 8-byte little-endian values
  const virtualTokenReserve = data.readBigUInt64LE(0);
  const virtualSolReserve = data.readBigUInt64LE(8);
  const realTokenReserve = data.readBigUInt64LE(16);
  const realSolReserve = data.readBigUInt64LE(24);

  return {
    solReserve: realSolReserve,
    tokenReserve: realTokenReserve,
    virtualSolReserve,
    virtualTokenReserve,
  };
}

/**
 * Parse AMM pool account data
 * PumpSwap AMM layout varies - this handles the common format
 */
export function parseAmmPoolData(data: Buffer): PoolReserves {
  if (data.length < 72) {
    throw new Error(`Invalid AMM pool data length: ${data.length}`);
  }

  // AMM pools typically store reserves at specific offsets
  // This may need adjustment based on actual PumpSwap layout
  const tokenReserve = data.readBigUInt64LE(32);
  const solReserve = data.readBigUInt64LE(40);

  return {
    solReserve,
    tokenReserve,
  };
}

// ============================================================================
// Price Calculation
// ============================================================================

/**
 * Fetch and calculate pool price
 */
export async function getPoolPrice(
  connection: Connection,
  poolAddress: PublicKey,
  poolType: 'bonding_curve' | 'amm'
): Promise<PoolPrice> {
  const accountInfo = await withRetryAndTimeout(
    () => connection.getAccountInfo(poolAddress),
    { maxRetries: 3 },
    10000
  );

  if (!accountInfo || !accountInfo.data) {
    throw new Error(`Pool account not found: ${poolAddress.toBase58()}`);
  }

  const reserves = poolType === 'bonding_curve'
    ? parseBondingCurveData(accountInfo.data)
    : parseAmmPoolData(accountInfo.data);

  // Calculate spot price
  const effectiveSolReserve = reserves.virtualSolReserve
    ? reserves.solReserve + reserves.virtualSolReserve
    : reserves.solReserve;

  const effectiveTokenReserve = reserves.virtualTokenReserve
    ? reserves.tokenReserve + reserves.virtualTokenReserve
    : reserves.tokenReserve;

  // Price = SOL reserve / Token reserve (in base units)
  const price = Number(effectiveSolReserve) / Number(effectiveTokenReserve);

  // Estimate price impact for 1 SOL buy
  const testAmount = 1_000_000_000n; // 1 SOL
  const quote = calculateSwapQuote(reserves, testAmount, poolType, 0);
  const priceImpact = ((quote.effectivePrice - price) / price) * 100;

  return {
    price,
    priceImpact,
    reserves,
    poolType,
  };
}

/**
 * Calculate expected output for a swap using constant product formula
 * x * y = k
 * (x + dx) * (y - dy) = k
 * dy = y - k / (x + dx) = y * dx / (x + dx)
 */
export function calculateSwapQuote(
  reserves: PoolReserves,
  solInputLamports: bigint,
  poolType: 'bonding_curve' | 'amm',
  slippageBps: number = DEFAULT_SLIPPAGE_BPS
): SwapQuote {
  // Use effective reserves (including virtual for bonding curves)
  let solReserve = reserves.solReserve;
  let tokenReserve = reserves.tokenReserve;

  if (poolType === 'bonding_curve') {
    solReserve += reserves.virtualSolReserve ?? PUMP_BONDING_CURVE_VIRTUAL_SOL_RESERVE;
    tokenReserve += reserves.virtualTokenReserve ?? PUMP_BONDING_CURVE_VIRTUAL_TOKEN_RESERVE;
  }

  // Apply pump fee (1%) - fee taken from input
  const feeAmount = (solInputLamports * PUMP_FEE_BPS) / 10000n;
  const netInput = solInputLamports - feeAmount;

  // Constant product: dy = y * dx / (x + dx)
  const expectedOutput = (tokenReserve * netInput) / (solReserve + netInput);

  // Apply slippage tolerance
  const slippageMultiplier = 10000n - BigInt(slippageBps);
  const minOutput = (expectedOutput * slippageMultiplier) / 10000n;

  // Calculate effective price (SOL per token)
  const effectivePrice = Number(solInputLamports) / Number(expectedOutput);

  // Calculate price impact
  const spotPrice = Number(solReserve) / Number(tokenReserve);
  const priceImpact = ((effectivePrice - spotPrice) / spotPrice) * 100;

  return {
    inputAmount: solInputLamports,
    expectedOutput,
    minOutput,
    priceImpact,
    effectivePrice,
    slippageBps,
  };
}

/**
 * Calculate minimum tokens to receive for a given SOL amount
 */
export function calculateMinTokensOut(
  reserves: PoolReserves,
  solInputLamports: bigint,
  poolType: 'bonding_curve' | 'amm',
  slippageBps: number = DEFAULT_SLIPPAGE_BPS
): BN {
  const quote = calculateSwapQuote(reserves, solInputLamports, poolType, slippageBps);
  return new BN(quote.minOutput.toString());
}

// ============================================================================
// Slippage Validation
// ============================================================================

/**
 * Validate that actual output meets slippage requirements
 */
export function validateSlippage(
  expectedOutput: bigint,
  actualOutput: bigint,
  maxSlippageBps: number = DEFAULT_SLIPPAGE_BPS
): SlippageValidation {
  if (actualOutput >= expectedOutput) {
    return {
      isValid: true,
      actualSlippageBps: 0,
      expectedOutput,
      actualOutput,
    };
  }

  const diff = expectedOutput - actualOutput;
  const actualSlippageBps = Number((diff * 10000n) / expectedOutput);

  const isValid = actualSlippageBps <= maxSlippageBps;

  return {
    isValid,
    actualSlippageBps,
    expectedOutput,
    actualOutput,
    reason: isValid
      ? undefined
      : `Slippage ${actualSlippageBps / 100}% exceeds max ${maxSlippageBps / 100}%`,
  };
}

/**
 * Pre-execution slippage check
 * Fetches current pool state and validates expected output
 */
export async function checkSlippageBeforeSwap(
  connection: Connection,
  poolAddress: PublicKey,
  poolType: 'bonding_curve' | 'amm',
  solInputLamports: bigint,
  maxSlippageBps: number = DEFAULT_SLIPPAGE_BPS
): Promise<{
  canProceed: boolean;
  quote: SwapQuote;
  reason?: string;
}> {
  try {
    const poolPrice = await getPoolPrice(connection, poolAddress, poolType);

    // Check if price impact alone exceeds slippage
    if (poolPrice.priceImpact > maxSlippageBps / 100) {
      return {
        canProceed: false,
        quote: calculateSwapQuote(poolPrice.reserves, solInputLamports, poolType, maxSlippageBps),
        reason: `Price impact ${poolPrice.priceImpact.toFixed(2)}% exceeds max slippage ${maxSlippageBps / 100}%`,
      };
    }

    const quote = calculateSwapQuote(poolPrice.reserves, solInputLamports, poolType, maxSlippageBps);

    // Check absolute slippage threshold
    if (maxSlippageBps > MAX_SLIPPAGE_BPS) {
      return {
        canProceed: false,
        quote,
        reason: `Requested slippage ${maxSlippageBps / 100}% exceeds maximum allowed ${MAX_SLIPPAGE_BPS / 100}%`,
      };
    }

    return {
      canProceed: true,
      quote,
    };
  } catch (error) {
    return {
      canProceed: false,
      quote: {
        inputAmount: solInputLamports,
        expectedOutput: 0n,
        minOutput: 0n,
        priceImpact: 0,
        effectivePrice: 0,
        slippageBps: maxSlippageBps,
      },
      reason: `Failed to fetch pool state: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Format token amount for display (assumes 6 decimals)
 */
export function formatTokenAmount(amount: bigint, decimals: number = 6): string {
  const divisor = BigInt(10 ** decimals);
  const wholePart = amount / divisor;
  const fractionalPart = amount % divisor;
  return `${wholePart}.${fractionalPart.toString().padStart(decimals, '0')}`;
}

/**
 * Format SOL amount for display
 */
export function formatSolAmount(lamports: bigint): string {
  return formatTokenAmount(lamports, 9);
}

/**
 * Calculate the SOL needed to buy a specific amount of tokens
 * Inverse of calculateSwapQuote
 */
export function calculateSolNeededForTokens(
  reserves: PoolReserves,
  desiredTokens: bigint,
  poolType: 'bonding_curve' | 'amm'
): bigint {
  let solReserve = reserves.solReserve;
  let tokenReserve = reserves.tokenReserve;

  if (poolType === 'bonding_curve') {
    solReserve += reserves.virtualSolReserve ?? PUMP_BONDING_CURVE_VIRTUAL_SOL_RESERVE;
    tokenReserve += reserves.virtualTokenReserve ?? PUMP_BONDING_CURVE_VIRTUAL_TOKEN_RESERVE;
  }

  // From: dy = y * dx / (x + dx)
  // Solve for dx: dx = x * dy / (y - dy)
  if (desiredTokens >= tokenReserve) {
    throw new Error('Desired tokens exceed pool reserves');
  }

  const netSolNeeded = (solReserve * desiredTokens) / (tokenReserve - desiredTokens);

  // Add fee back (1%)
  const grossSolNeeded = (netSolNeeded * 10000n) / (10000n - PUMP_FEE_BPS);

  return grossSolNeeded;
}

/**
 * Estimate price after a swap (for cascading slippage calculation)
 */
export function estimatePriceAfterSwap(
  reserves: PoolReserves,
  solInputLamports: bigint,
  poolType: 'bonding_curve' | 'amm'
): number {
  const quote = calculateSwapQuote(reserves, solInputLamports, poolType, 0);

  // New reserves after swap
  let newSolReserve = reserves.solReserve + solInputLamports;
  let newTokenReserve = reserves.tokenReserve - quote.expectedOutput;

  if (poolType === 'bonding_curve') {
    newSolReserve += reserves.virtualSolReserve ?? PUMP_BONDING_CURVE_VIRTUAL_SOL_RESERVE;
    newTokenReserve += reserves.virtualTokenReserve ?? PUMP_BONDING_CURVE_VIRTUAL_TOKEN_RESERVE;
  }

  return Number(newSolReserve) / Number(newTokenReserve);
}
