/**
 * Token Selection for Cycle Execution
 *
 * Implements probabilistic O(1) token selection using slot-based determinism.
 * Each eligible token has equal probability of selection: 1/N
 */

import { TokenConfig } from '../types';

export interface TokenAllocation {
  token: TokenConfig;
  pendingFees: number;
  allocation: number;
  isRoot: boolean;
}

// Minimum fees required to execute a cycle (7 SOL = ~0.007 SOL)
const TX_FEE_RESERVE_PER_TOKEN = 7_000_000;

/**
 * Token Selector for Cycle Execution
 */
export class TokenSelector {
  /**
   * Filter tokens that meet minimum threshold
   */
  getEligibleTokens(allocations: TokenAllocation[]): TokenAllocation[] {
    return allocations.filter(
      (a) => !a.isRoot && a.pendingFees >= TX_FEE_RESERVE_PER_TOKEN
    );
  }

  /**
   * Select ONE token for this cycle using slot-based deterministic selection
   * Same pattern as user rebate selection: slot % eligible_count
   *
   * UNIFORM SELECTION: No sorting bias
   * Each eligible token has equal probability: 1/N
   * Slot-based deterministic selection ensures reproducibility
   *
   * @param eligibleTokens - Tokens with pending_fees >= threshold
   * @param currentSlot - Current Solana slot for deterministic selection
   * @returns Selected token or null if none eligible
   */
  selectForCycle(
    eligibleTokens: TokenAllocation[],
    currentSlot: number
  ): TokenAllocation | null {
    if (eligibleTokens.length === 0) {
      return null;
    }

    const selectedIndex = currentSlot % eligibleTokens.length;
    return eligibleTokens[selectedIndex];
  }

  /**
   * Get all secondary tokens (non-root)
   */
  getSecondaries(allocations: TokenAllocation[]): TokenAllocation[] {
    return allocations.filter((a) => !a.isRoot);
  }

  /**
   * Get root token
   */
  getRoot(allocations: TokenAllocation[]): TokenAllocation | undefined {
    return allocations.find((a) => a.isRoot);
  }
}
