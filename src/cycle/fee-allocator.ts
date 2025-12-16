/**
 * Fee Allocation Logic
 *
 * Handles proportional fee distribution with:
 * - Minimum allocation thresholds
 * - Redistribution of deferred fees
 * - Dynamic allocation with reserves
 * - Shared vault support
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { TokenConfig } from './types';
import { TokenAllocation } from './token-selector';
import { log, colors, logSection } from './utils/logging';
import { formatSOL } from './utils/formatting';
import { getBcCreatorVault, getAmmCreatorVaultAta } from '../pump/amm-utils';

// Fee split ratio: Secondary tokens send 44.8% to root, keeping 55.2% (fee_split_bps = 5520)
export const SECONDARY_KEEP_RATIO = 0.552;

// Safety margins
const RENT_EXEMPT_MINIMUM = 890_880;
const SAFETY_BUFFER = 50_000;
const ATA_RENT_RESERVE = 2_100_000;
const MINIMUM_BUY_AMOUNT = 100_000;
const DAT_AUTHORITY_SEED = Buffer.from('auth_v3');

// Minimum allocation thresholds
const MIN_AFTER_SPLIT = RENT_EXEMPT_MINIMUM + SAFETY_BUFFER + ATA_RENT_RESERVE + MINIMUM_BUY_AMOUNT;
// = 890,880 + 50,000 + 2,100,000 + 100,000 = 3,140,880 lamports

export const MIN_ALLOCATION_SECONDARY = Math.ceil(MIN_AFTER_SPLIT / SECONDARY_KEEP_RATIO);
// = 3,140,880 / 0.552 = 5,690,000 lamports (~0.00569 SOL)

export const MIN_ALLOCATION_ROOT = RENT_EXEMPT_MINIMUM + SAFETY_BUFFER + MINIMUM_BUY_AMOUNT;
// = 890,880 + 50,000 + 100,000 = 1,040,880 lamports

// TX fee reserve: 0.1 SOL per token (19x safety margin at ~5.26k per TX)
const TX_FEE_RESERVE_PER_TOKEN = 100_000_000; // 0.1 SOL
const TOTAL_COST_PER_SECONDARY = MIN_ALLOCATION_SECONDARY + TX_FEE_RESERVE_PER_TOKEN;

export interface ScalableAllocationResult {
  viable: TokenAllocation[];
  skipped: TokenAllocation[];
  ratio: number;
}

export interface DynamicAllocationResult {
  allocation: number;
  viable: boolean;
  reason: string;
}

/**
 * Fee Allocator
 *
 * Handles proportional fee distribution and dynamic allocation
 */
export class FeeAllocator {
  /**
   * Normalize allocations based on actual collected fees
   *
   * Steps:
   * 1. Calculate preliminary proportional allocations
   * 2. Filter tokens meeting minimum threshold
   * 3. Redistribute deferred fees to viable tokens
   *
   * @param allocations - Token allocations with pending fees
   * @param actualCollected - Actual SOL collected from vaults
   * @returns Viable and skipped allocations with distribution ratio
   */
  normalizeAllocations(
    allocations: TokenAllocation[],
    actualCollected: number
  ): ScalableAllocationResult {
    logSection('STEP 3: CALCULATE PROPORTIONAL DISTRIBUTION (SCALABLE)');

    const secondaries = allocations.filter((a) => !a.isRoot);
    const totalPending = secondaries.reduce((sum, a) => sum + a.pendingFees, 0);

    if (totalPending === 0) {
      log('⚠️', 'No pending fees to distribute', colors.yellow);
      return { viable: [], skipped: [], ratio: 0 };
    }

    const ratio = actualCollected / totalPending;

    log('📊', `Total pending: ${formatSOL(totalPending)} SOL`, colors.cyan);
    log('💰', `Actual collected: ${formatSOL(actualCollected)} SOL`, colors.cyan);
    log(
      '📐',
      `Distribution ratio: ${ratio.toFixed(6)}`,
      ratio >= 0.95 ? colors.green : colors.yellow
    );
    log(
      '🔒',
      `Min allocation per secondary: ${formatSOL(MIN_ALLOCATION_SECONDARY)} SOL`,
      colors.cyan
    );

    if (ratio < 0.95) {
      log(
        '⚠️',
        'Collected amount is significantly less than pending fees',
        colors.yellow
      );
      log(
        'ℹ️',
        'This can happen if fees were spent or if pending_fees tracking is out of sync',
        colors.cyan
      );
    }

    // Phase 1: Calculate preliminary allocation for each secondary token
    const preliminary = secondaries.map((alloc) => ({
      ...alloc,
      allocation: Math.floor(alloc.pendingFees * ratio),
    }));

    // Phase 2: Filter tokens that meet minimum allocation requirements
    const viable = preliminary.filter((a) => a.allocation >= MIN_ALLOCATION_SECONDARY);
    const skipped = preliminary.filter((a) => a.allocation < MIN_ALLOCATION_SECONDARY);

    // Phase 3: Redistribute skipped allocations to viable tokens proportionally
    if (viable.length > 0 && skipped.length > 0) {
      const skippedTotal = skipped.reduce((sum, a) => sum + a.allocation, 0);
      const viableTotal = viable.reduce((sum, a) => sum + a.allocation, 0);

      if (viableTotal > 0) {
        // Redistribute proportionally based on each viable token's share
        const redistributionRatio = (viableTotal + skippedTotal) / viableTotal;
        viable.forEach((a) => {
          a.allocation = Math.floor(a.allocation * redistributionRatio);
        });
        log(
          '🔄',
          `Redistributed ${formatSOL(skippedTotal)} SOL from ${skipped.length} deferred tokens`,
          colors.cyan
        );
      }
    }

    // Display allocation table with status
    console.log('\n' + colors.bright + 'Token Allocations:' + colors.reset);
    console.log('─'.repeat(90));
    console.log(
      `${'Token'.padEnd(12)} ${'Pending Fees'.padEnd(18)} ${'Allocated'.padEnd(18)} ${'Min Required'.padEnd(18)} ${'Status'.padEnd(12)}`
    );
    console.log('─'.repeat(90));

    for (const alloc of preliminary) {
      const isViable = alloc.allocation >= MIN_ALLOCATION_SECONDARY;
      const status = isViable ? '✅ VIABLE' : '⏭️ DEFERRED';
      const statusColor = isViable ? colors.green : colors.yellow;
      console.log(
        `${alloc.token.symbol.padEnd(12)} ${formatSOL(alloc.pendingFees).padEnd(18)} ` +
          `${formatSOL(alloc.allocation).padEnd(18)} ${formatSOL(MIN_ALLOCATION_SECONDARY).padEnd(18)} ` +
          `${statusColor}${status}${colors.reset}`
      );
    }
    console.log('─'.repeat(90));

    // Log deferred tokens for transparency
    if (skipped.length > 0) {
      console.log('');
      log(
        'ℹ️',
        `${skipped.length} token(s) deferred - will accumulate and process in next cycle:`,
        colors.yellow
      );
      for (const s of skipped) {
        log(
          '⏭️',
          `${s.token.symbol}: ${formatSOL(s.allocation)} SOL < ${formatSOL(MIN_ALLOCATION_SECONDARY)} SOL minimum`,
          colors.yellow
        );
      }
    }

    // Summary
    console.log('');
    log(
      '📊',
      `Viable tokens: ${viable.length}/${secondaries.length}`,
      viable.length > 0 ? colors.green : colors.yellow
    );
    if (viable.length > 0) {
      const totalViableAllocation = viable.reduce((sum, a) => sum + a.allocation, 0);
      log(
        '💰',
        `Total viable allocation: ${formatSOL(totalViableAllocation)} SOL`,
        colors.green
      );
    }

    return { viable, skipped, ratio };
  }

  /**
   * Calculate dynamic allocation based on actual remaining balance
   *
   * CRITICAL: Reserves minimum allocations for remaining tokens before calculating current allocation
   * This ensures all tokens can be processed if there's enough total balance
   *
   * @param availableBalance - Current datAuthority balance
   * @param tokenPendingFees - This token's pending fees
   * @param totalRemainingPending - Sum of all remaining tokens' pending fees
   * @param numRemainingTokens - Number of tokens left to process (including current)
   * @returns Dynamic allocation result with viability status
   */
  calculateDynamicAllocation(
    availableBalance: number,
    tokenPendingFees: number,
    totalRemainingPending: number,
    numRemainingTokens: number
  ): DynamicAllocationResult {
    // Reserve rent-exempt minimum for datAuthority account
    const RESERVE_FOR_ACCOUNT = RENT_EXEMPT_MINIMUM + SAFETY_BUFFER;

    // CRITICAL FIX: Reserve TOTAL COST (allocation + TX fees) for OTHER remaining tokens
    // This ensures each subsequent token can be fully processed
    const otherTokensCount = numRemainingTokens - 1;
    const reserveForOtherTokens = otherTokensCount * TOTAL_COST_PER_SECONDARY;

    // Total reserved = account reserve + other tokens' minimums
    const totalReserved = RESERVE_FOR_ACCOUNT + reserveForOtherTokens;

    const distributable = availableBalance - totalReserved;

    if (distributable <= 0) {
      return {
        allocation: 0,
        viable: false,
        reason: `No balance after reserving ${formatSOL(totalReserved)} (${otherTokensCount} other tokens)`,
      };
    }

    // Check if we have enough for minimum allocation
    if (distributable < MIN_ALLOCATION_SECONDARY) {
      return {
        allocation: distributable,
        viable: false,
        reason: `Available ${formatSOL(distributable)} < minimum ${formatSOL(MIN_ALLOCATION_SECONDARY)}`,
      };
    }

    // Calculate proportional allocation from distributable (what's left after reservations)
    // This token gets its fair share based on pending_fees ratio
    const pendingRatio =
      totalRemainingPending > 0
        ? tokenPendingFees / totalRemainingPending
        : 1 / numRemainingTokens;

    // Max allocation is either proportional share or all distributable (if last token)
    let allocation: number;
    if (numRemainingTokens === 1) {
      // Last token gets all remaining distributable
      allocation = distributable;
    } else {
      // Calculate proportional share, but cap at distributable to leave room for others
      allocation = Math.floor(distributable * pendingRatio);

      // Ensure at least minimum allocation
      allocation = Math.max(allocation, MIN_ALLOCATION_SECONDARY);

      // Cap at distributable (shouldn't happen but safety check)
      allocation = Math.min(allocation, distributable);
    }

    return { allocation, viable: true, reason: 'OK' };
  }

  /**
   * Get the actual datAuthority balance
   */
  async getDatAuthorityBalance(
    connection: Connection,
    programId: PublicKey
  ): Promise<number> {
    const [datAuthority] = PublicKey.findProgramAddressSync(
      [DAT_AUTHORITY_SEED],
      programId
    );
    const balance = await connection.getBalance(datAuthority);
    return balance;
  }

  /**
   * Get the vault balance for a token (N+1 pattern: fees are still in vault)
   */
  async getTokenVaultBalance(
    connection: Connection,
    token: TokenConfig
  ): Promise<number> {
    if (token.poolType === 'pumpswap_amm') {
      // AMM: Check WSOL ATA balance
      const vaultAta = getAmmCreatorVaultAta(token.creator);
      try {
        const account = await connection.getTokenAccountBalance(vaultAta);
        return Number(account.value.amount);
      } catch {
        return 0; // ATA doesn't exist yet
      }
    } else {
      // Bonding Curve: Check native SOL balance
      const vault = getBcCreatorVault(token.creator);
      return await connection.getBalance(vault);
    }
  }
}
