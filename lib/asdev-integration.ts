/**
 * ASDev Integration Library
 *
 * Helper functions for integrating ASDev (Pump.fun token launcher) with
 * the ASDF-DAT validator system for per-token fee attribution.
 *
 * Usage:
 *   import { initializeValidatorForToken, getTokenContribution } from './asdev-integration';
 *
 *   // After launching a token on Pump.fun
 *   await initializeValidatorForToken(program, mintPubkey, bondingCurvePubkey, payerPubkey);
 *
 *   // Query contribution later
 *   const contribution = await getTokenContribution(connection, mintPubkey);
 *   console.log(`Token contributed ${contribution.totalFees / 1e9} SOL in creator fees`);
 */

import { Connection, PublicKey, SystemProgram } from '@solana/web3.js';
import { Program } from '@coral-xyz/anchor';

// Program ID for ASDF-DAT
export const ASDF_PROGRAM_ID = new PublicKey('ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui');

// PDA Seeds
const VALIDATOR_STATE_SEED = Buffer.from('validator_v1');
const TOKEN_STATS_SEED = Buffer.from('token_stats_v1');

/**
 * ValidatorState account layout offsets
 * Layout: discriminator(8) + mint(32) + bonding_curve(32) +
 *         last_validated_slot(8) + total_validated_lamports(8) +
 *         total_validated_count(8) + fee_rate_bps(2) + bump(1) + reserved(32)
 */
const VALIDATOR_STATE_OFFSETS = {
  discriminator: 0,        // 8 bytes
  mint: 8,                 // 32 bytes
  bondingCurve: 40,        // 32 bytes
  lastValidatedSlot: 72,   // 8 bytes
  totalValidatedLamports: 80,  // 8 bytes
  totalValidatedCount: 88, // 8 bytes
  feeRateBps: 96,          // 2 bytes
  bump: 98,                // 1 byte
  reserved: 99,            // 32 bytes
};

/**
 * Parsed ValidatorState data
 */
export interface ValidatorStateData {
  mint: PublicKey;
  bondingCurve: PublicKey;
  lastValidatedSlot: number;
  totalValidatedLamports: number;
  totalValidatedCount: number;
  feeRateBps: number;
  bump: number;
}

/**
 * Token contribution info
 */
export interface TokenContribution {
  mint: string;
  totalFees: number;           // Total fees in lamports
  totalFeesSOL: number;        // Total fees in SOL
  validationCount: number;     // Number of validation batches
  lastSlot: number;            // Last validated slot
  feeRateBps: number;          // Fee rate in basis points
}

/**
 * Token contribution with percentage
 */
export interface TokenContributionWithPercentage extends TokenContribution {
  percentage: number;          // Percentage of total fees
}

/**
 * Derive ValidatorState PDA for a token
 */
export function deriveValidatorStatePDA(
  mint: PublicKey,
  programId: PublicKey = ASDF_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VALIDATOR_STATE_SEED, mint.toBuffer()],
    programId
  );
}

/**
 * Derive TokenStats PDA for a token
 */
export function deriveTokenStatsPDA(
  mint: PublicKey,
  programId: PublicKey = ASDF_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [TOKEN_STATS_SEED, mint.toBuffer()],
    programId
  );
}

/**
 * Check if a ValidatorState exists for a token
 */
export async function isValidatorInitialized(
  connection: Connection,
  mint: PublicKey,
  programId: PublicKey = ASDF_PROGRAM_ID
): Promise<boolean> {
  const [validatorState] = deriveValidatorStatePDA(mint, programId);
  const account = await connection.getAccountInfo(validatorState);
  return account !== null;
}

/**
 * Initialize ValidatorState for a new token
 *
 * Call this after successfully launching a token on Pump.fun via create_v2.
 * The validator daemon will then track fees for this token.
 *
 * @param program - Anchor program instance for asdf-dat
 * @param mint - Token mint address
 * @param bondingCurve - Pump.fun bonding curve address for this token
 * @param payer - Transaction payer (signer)
 * @returns Transaction signature
 */
export async function initializeValidatorForToken(
  program: Program,
  mint: PublicKey,
  bondingCurve: PublicKey,
  payer: PublicKey
): Promise<string> {
  const [validatorState] = deriveValidatorStatePDA(mint, program.programId);

  const tx = await program.methods
    .initializeValidator()
    .accounts({
      validatorState,
      bondingCurve,
      mint,
      payer,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return tx;
}

/**
 * Initialize ValidatorState with pre-check
 *
 * Same as initializeValidatorForToken but checks if already initialized first.
 *
 * @returns Transaction signature or null if already initialized
 */
export async function initializeValidatorIfNeeded(
  program: Program,
  connection: Connection,
  mint: PublicKey,
  bondingCurve: PublicKey,
  payer: PublicKey
): Promise<string | null> {
  const isInitialized = await isValidatorInitialized(connection, mint, program.programId);

  if (isInitialized) {
    return null;
  }

  return initializeValidatorForToken(program, mint, bondingCurve, payer);
}

/**
 * Parse raw ValidatorState account data
 */
function parseValidatorStateData(data: Buffer): ValidatorStateData {
  return {
    mint: new PublicKey(data.subarray(VALIDATOR_STATE_OFFSETS.mint, VALIDATOR_STATE_OFFSETS.mint + 32)),
    bondingCurve: new PublicKey(data.subarray(VALIDATOR_STATE_OFFSETS.bondingCurve, VALIDATOR_STATE_OFFSETS.bondingCurve + 32)),
    lastValidatedSlot: Number(data.readBigUInt64LE(VALIDATOR_STATE_OFFSETS.lastValidatedSlot)),
    totalValidatedLamports: Number(data.readBigUInt64LE(VALIDATOR_STATE_OFFSETS.totalValidatedLamports)),
    totalValidatedCount: Number(data.readBigUInt64LE(VALIDATOR_STATE_OFFSETS.totalValidatedCount)),
    feeRateBps: data.readUInt16LE(VALIDATOR_STATE_OFFSETS.feeRateBps),
    bump: data[VALIDATOR_STATE_OFFSETS.bump],
  };
}

/**
 * Get raw ValidatorState data for a token
 */
export async function getValidatorState(
  connection: Connection,
  mint: PublicKey,
  programId: PublicKey = ASDF_PROGRAM_ID
): Promise<ValidatorStateData | null> {
  const [validatorState] = deriveValidatorStatePDA(mint, programId);

  const account = await connection.getAccountInfo(validatorState);
  if (!account) {
    return null;
  }

  return parseValidatorStateData(account.data);
}

/**
 * Get token contribution info
 *
 * Returns the total fees this token has contributed to creator rewards.
 *
 * @param connection - Solana connection
 * @param mint - Token mint address
 * @param programId - ASDF-DAT program ID (optional, defaults to mainnet)
 * @returns Token contribution data or null if not found
 */
export async function getTokenContribution(
  connection: Connection,
  mint: PublicKey,
  programId: PublicKey = ASDF_PROGRAM_ID
): Promise<TokenContribution | null> {
  const state = await getValidatorState(connection, mint, programId);

  if (!state) {
    return null;
  }

  return {
    mint: mint.toBase58(),
    totalFees: state.totalValidatedLamports,
    totalFeesSOL: state.totalValidatedLamports / 1e9,
    validationCount: state.totalValidatedCount,
    lastSlot: state.lastValidatedSlot,
    feeRateBps: state.feeRateBps,
  };
}

/**
 * Get contributions for multiple tokens
 *
 * Fetches contribution data for all provided mints and calculates
 * percentage of total fees for each.
 *
 * @param connection - Solana connection
 * @param mints - Array of token mint addresses
 * @param programId - ASDF-DAT program ID (optional)
 * @returns Map of mint address to contribution data with percentages
 */
export async function getAllTokenContributions(
  connection: Connection,
  mints: PublicKey[],
  programId: PublicKey = ASDF_PROGRAM_ID
): Promise<Map<string, TokenContributionWithPercentage>> {
  const contributions = new Map<string, TokenContributionWithPercentage>();
  let totalAllFees = 0;

  // Fetch all contributions
  for (const mint of mints) {
    try {
      const contribution = await getTokenContribution(connection, mint, programId);
      if (contribution) {
        contributions.set(mint.toBase58(), {
          ...contribution,
          percentage: 0, // Will be calculated after
        });
        totalAllFees += contribution.totalFees;
      }
    } catch (error) {
      // Token not tracked - skip
      console.warn(`Warning: Could not fetch contribution for ${mint.toBase58()}`);
    }
  }

  // Calculate percentages
  for (const [, data] of contributions) {
    data.percentage = totalAllFees > 0 ? (data.totalFees / totalAllFees) * 100 : 0;
  }

  return contributions;
}

/**
 * Get contributions sorted by total fees (descending)
 *
 * Returns a leaderboard of tokens by their contribution to creator rewards.
 *
 * @param connection - Solana connection
 * @param mints - Array of token mint addresses
 * @param programId - ASDF-DAT program ID (optional)
 * @returns Array of contributions sorted by total fees (highest first)
 */
export async function getContributionLeaderboard(
  connection: Connection,
  mints: PublicKey[],
  programId: PublicKey = ASDF_PROGRAM_ID
): Promise<TokenContributionWithPercentage[]> {
  const contributionsMap = await getAllTokenContributions(connection, mints, programId);

  const contributions = Array.from(contributionsMap.values());

  // Sort by total fees descending
  contributions.sort((a, b) => b.totalFees - a.totalFees);

  return contributions;
}

/**
 * Calculate proportional distribution based on contributions
 *
 * Given an amount to distribute, calculates how much each token should receive
 * based on their contribution percentage.
 *
 * @param contributions - Map of contributions (from getAllTokenContributions)
 * @param amountToDistribute - Total amount to distribute (in lamports)
 * @returns Map of mint address to distribution amount
 */
export function calculateProportionalDistribution(
  contributions: Map<string, TokenContributionWithPercentage>,
  amountToDistribute: number
): Map<string, number> {
  const distribution = new Map<string, number>();

  for (const [mint, data] of contributions) {
    const share = Math.floor(amountToDistribute * (data.percentage / 100));
    distribution.set(mint, share);
  }

  return distribution;
}

/**
 * Format contribution for display
 */
export function formatContribution(contribution: TokenContribution): string {
  return [
    `Mint: ${contribution.mint}`,
    `Total Fees: ${contribution.totalFeesSOL.toFixed(6)} SOL`,
    `Validations: ${contribution.validationCount}`,
    `Last Slot: ${contribution.lastSlot}`,
    `Fee Rate: ${contribution.feeRateBps / 100}%`,
  ].join('\n');
}

/**
 * Format leaderboard for display
 */
export function formatLeaderboard(contributions: TokenContributionWithPercentage[]): string {
  if (contributions.length === 0) {
    return 'No contributions found';
  }

  const lines = ['CONTRIBUTION LEADERBOARD', '='.repeat(60)];

  contributions.forEach((c, index) => {
    lines.push(
      `#${index + 1} ${c.mint.slice(0, 8)}... | ` +
      `${c.totalFeesSOL.toFixed(6)} SOL | ` +
      `${c.percentage.toFixed(2)}%`
    );
  });

  return lines.join('\n');
}
