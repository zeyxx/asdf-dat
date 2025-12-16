/**
 * User Pool Management for External App Integration
 *
 * Tracks eligible users for rebate lottery and handles random selection.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { Program } from '@coral-xyz/anchor';
import BN from 'bn.js';
import { EligibleUser, UserStats, getTypedAccounts } from './types';

// PDA Seeds (must match Rust constants)
const USER_STATS_SEED = Buffer.from('user_stats_v1');
const REBATE_POOL_SEED = Buffer.from('rebate_pool');

// Rebate eligibility threshold (0.07 SOL equivalent in $ASDF)
// This is the minimum pending_contribution required to be eligible for lottery
const REBATE_THRESHOLD_SOL_EQUIV = 70_000_000; // 0.07 SOL in lamports

/**
 * Derive UserStats PDA for a user
 */
export function deriveUserStatsPda(
  user: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [USER_STATS_SEED, user.toBuffer()],
    programId
  );
}

/**
 * Derive RebatePool PDA
 */
export function deriveRebatePoolPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([REBATE_POOL_SEED], programId);
}

/**
 * Get all UserStats accounts from the program
 * Uses getProgramAccounts to fetch all accounts of type UserStats
 */
export async function getAllUserStats(
  connection: Connection,
  programId: PublicKey
): Promise<Map<string, UserStats>> {
  // UserStats discriminator (first 8 bytes of SHA256("account:UserStats"))
  // This is calculated by Anchor
  const userStatsDiscriminator = Buffer.from([
    116, 218, 158, 143, 174, 189, 165, 48 // Placeholder - will be updated
  ]);

  const accounts = await connection.getProgramAccounts(programId, {
    filters: [
      {
        memcmp: {
          offset: 0,
          bytes: userStatsDiscriminator.toString('base64'),
        },
      },
    ],
  });

  const result = new Map<string, UserStats>();

  for (const account of accounts) {
    try {
      // Skip discriminator (8 bytes) and deserialize
      const data = account.account.data.slice(8);
      const userStats = deserializeUserStats(data);
      result.set(account.pubkey.toBase58(), userStats);
    } catch {
      // Skip malformed accounts
    }
  }

  return result;
}

/**
 * Deserialize UserStats from raw bytes
 */
function deserializeUserStats(data: Buffer): UserStats {
  let offset = 0;

  const bump = data.readUInt8(offset);
  offset += 1;

  const user = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  const pendingContribution = new BN(data.slice(offset, offset + 8), 'le');
  offset += 8;

  const totalContributed = new BN(data.slice(offset, offset + 8), 'le');
  offset += 8;

  const totalRebate = new BN(data.slice(offset, offset + 8), 'le');
  offset += 8;

  const lastUpdateTimestamp = new BN(data.slice(offset, offset + 8), 'le');
  offset += 8;

  const lastUpdateSlot = new BN(data.slice(offset, offset + 8), 'le');

  return {
    bump,
    user,
    pendingContribution,
    totalContributed,
    totalRebate,
    lastUpdateTimestamp,
    lastUpdateSlot,
  };
}

/**
 * Get eligible users for rebate lottery
 * Users are eligible if pending_contribution >= REBATE_THRESHOLD_SOL_EQUIV
 */
export async function getEligibleUsers(
  program: Program,
  programId: PublicKey
): Promise<EligibleUser[]> {
  const accounts = getTypedAccounts(program);
  const eligibleUsers: EligibleUser[] = [];

  try {
    // Get all program accounts that match UserStats structure
    const allAccounts = await program.provider.connection.getProgramAccounts(
      programId,
      {
        dataSlice: { offset: 0, length: 0 }, // Just get pubkeys first
      }
    );

    for (const account of allAccounts) {
      try {
        // Try to fetch as UserStats
        const userStats = await accounts.userStats.fetch(account.pubkey);

        // Check eligibility
        if (userStats.pendingContribution.gte(new BN(REBATE_THRESHOLD_SOL_EQUIV))) {
          eligibleUsers.push({
            pubkey: userStats.user,
            statsPda: account.pubkey,
            pendingContribution: userStats.pendingContribution,
            lastUpdateSlot: userStats.lastUpdateSlot,
          });
        }
      } catch {
        // Not a UserStats account, skip
      }
    }
  } catch (error) {
    console.error('Error fetching eligible users:', error);
  }

  // Sort by lastUpdateSlot for fairness (oldest first)
  eligibleUsers.sort((a, b) => a.lastUpdateSlot.cmp(b.lastUpdateSlot));

  return eligibleUsers;
}

/**
 * Select a user for rebate using slot-based random selection
 * Selection is deterministic based on current slot for verifiability
 *
 * @param eligibleUsers - List of users eligible for rebate
 * @param currentSlot - Current blockchain slot
 * @returns Selected user or null if no eligible users
 */
export function selectUserForRebate(
  eligibleUsers: EligibleUser[],
  currentSlot: number
): EligibleUser | null {
  if (eligibleUsers.length === 0) {
    return null;
  }

  // Use slot as random seed (deterministic and verifiable)
  const selectedIndex = currentSlot % eligibleUsers.length;
  return eligibleUsers[selectedIndex];
}

/**
 * Get user stats for a specific user
 */
export async function getUserStats(
  program: Program,
  user: PublicKey
): Promise<UserStats | null> {
  const [userStatsPda] = deriveUserStatsPda(user, program.programId);

  try {
    const accounts = getTypedAccounts(program);
    return await accounts.userStats.fetch(userStatsPda);
  } catch {
    return null;
  }
}

/**
 * Check if a user is eligible for rebate
 */
export function isEligibleForRebate(userStats: UserStats): boolean {
  return userStats.pendingContribution.gte(new BN(REBATE_THRESHOLD_SOL_EQUIV));
}

/**
 * Calculate rebate amount for a user
 * Rebate = 0.552% of pending_contribution
 */
export function calculateRebateAmount(pendingContribution: BN): BN {
  // 0.552% = 55 / 10000 BPS
  return pendingContribution.mul(new BN(55)).div(new BN(10000));
}

/**
 * User pool state for daemon persistence
 */
export interface UserPoolState {
  eligible: string[]; // User pubkeys as base58
  lastProcessedSlot: number;
  totalRebatesDistributed: number;
}

/**
 * Create initial user pool state
 */
export function createInitialUserPoolState(): UserPoolState {
  return {
    eligible: [],
    lastProcessedSlot: 0,
    totalRebatesDistributed: 0,
  };
}
