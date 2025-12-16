/**
 * ASDF Burn Engine - Allocation Calculator
 *
 * Calculates proportional token allocations for flush cycles.
 * Uses daemon internal state (not on-chain TokenStats) as source of truth.
 *
 * Key concepts:
 * - Eligibility: pending_fees >= threshold
 * - Selection: slot % eligible_count (O(1) probabilistic)
 * - Allocation: proportional to pending_fees ratio
 */

import { PublicKey, Connection } from "@solana/web3.js";
import { TrackedToken, TokenAllocation, PoolType } from "../types";
import {
  SECONDARY_KEEP_RATIO,
  ROOT_SHARE_RATIO,
  LAMPORTS_PER_SOL,
  MIN_FEES_FOR_SPLIT,
} from "./constants";
import { createLogger } from "../utils/logger";

const log = createLogger("allocator");

// ============================================================================
// Scalability Constants (aligned with on-chain lib.rs)
// ============================================================================

/** Rent-exempt minimum for accounts */
const RENT_EXEMPT_MINIMUM = 890_880n;

/** Safety buffer for account operations */
const SAFETY_BUFFER = 50_000n;

/** ATA rent reserve for secondary token accounts */
const ATA_RENT_RESERVE = 2_100_000n;

/** Minimum buy amount */
const MINIMUM_BUY_AMOUNT = 100_000n;

/**
 * MARKET-REGULATED THRESHOLD: TX_COST × 19 = 0.1 SOL
 * Eligibility = Efficiency: Only process when economically meaningful
 * At 0.1 SOL threshold, only 5% goes to TX fees (ratio 20:1)
 */
export const ELIGIBILITY_THRESHOLD = 100_000_000n; // 0.1 SOL

/**
 * Minimum allocation for root token
 * = RENT_EXEMPT_MINIMUM + SAFETY_BUFFER + MINIMUM_BUY_AMOUNT
 */
export const MIN_ALLOCATION_ROOT =
  RENT_EXEMPT_MINIMUM + SAFETY_BUFFER + MINIMUM_BUY_AMOUNT;

/**
 * Minimum allocation for secondary token (before split)
 * Must be large enough that AFTER 44.8% split to root, there's enough for operations
 */
const MIN_AFTER_SPLIT =
  RENT_EXEMPT_MINIMUM + SAFETY_BUFFER + ATA_RENT_RESERVE + MINIMUM_BUY_AMOUNT;

export const MIN_ALLOCATION_SECONDARY = BigInt(
  Math.ceil(Number(MIN_AFTER_SPLIT) / SECONDARY_KEEP_RATIO)
);

// ============================================================================
// Types
// ============================================================================

export interface AllocationResult {
  /** Tokens that will be processed this cycle */
  viable: TokenAllocationExtended[];

  /** Tokens deferred to next cycle (below threshold) */
  deferred: TokenAllocationExtended[];

  /** Root token allocation (if any) */
  rootAllocation: TokenAllocationExtended | null;

  /** Distribution ratio (actualCollected / totalPending) */
  ratio: number;

  /** Total SOL that will be distributed */
  totalDistributable: bigint;

  /** Root treasury contribution from secondaries (44.8%) */
  rootTreasuryContribution: bigint;
}

export interface TokenAllocationExtended extends TokenAllocation {
  /** Token metadata */
  token: TrackedToken;

  /** Calculated allocation in lamports */
  allocation: bigint;

  /** Why this token was deferred (if applicable) */
  deferReason?: string;
}

export interface SelectionResult {
  /** Selected token for this cycle */
  selected: TokenAllocationExtended | null;

  /** Slot used for selection */
  slot: number;

  /** All eligible tokens (for transparency) */
  eligible: TokenAllocationExtended[];
}

// ============================================================================
// Allocation Calculator
// ============================================================================

export class AllocationCalculator {
  /**
   * Calculate allocations for all tokens based on internal pending fees
   *
   * @param tokens - Tracked tokens from TokenManager (internal state)
   * @param vaultBalance - Actual creator vault balance (for verification)
   * @returns Allocation result with viable and deferred tokens
   */
  calculate(
    tokens: TrackedToken[],
    vaultBalance: bigint
  ): AllocationResult {
    const secondaries = tokens.filter((t) => !t.isRoot);
    const rootToken = tokens.find((t) => t.isRoot);

    // Calculate total pending from internal state
    const totalPending = secondaries.reduce(
      (sum, t) => sum + t.pendingFeesLamports,
      0n
    );

    if (totalPending === 0n) {
      log.debug("No pending fees to distribute");
      return {
        viable: [],
        deferred: [],
        rootAllocation: rootToken
          ? this.createRootAllocation(rootToken, 0n)
          : null,
        ratio: 0,
        totalDistributable: 0n,
        rootTreasuryContribution: 0n,
      };
    }

    // Calculate distribution ratio (vault vs internal expectation)
    const ratio = Number(vaultBalance) / Number(totalPending);

    log.info("Calculating allocations", {
      totalPending: this.formatSOL(totalPending),
      vaultBalance: this.formatSOL(vaultBalance),
      ratio: ratio.toFixed(4),
      secondaryCount: secondaries.length,
    });

    if (ratio < 0.95) {
      log.warn("Vault balance significantly less than expected", {
        expected: this.formatSOL(totalPending),
        actual: this.formatSOL(vaultBalance),
        divergence: `${((1 - ratio) * 100).toFixed(1)}%`,
      });
    }

    // Phase 1: Calculate preliminary allocation for each secondary
    const preliminary = secondaries.map((token) => {
      const allocation = BigInt(
        Math.floor(Number(token.pendingFeesLamports) * ratio)
      );

      return this.createSecondaryAllocation(token, allocation);
    });

    // Phase 2: Filter viable vs deferred
    const viable = preliminary.filter(
      (a) => a.allocation >= MIN_ALLOCATION_SECONDARY
    );
    const deferred = preliminary
      .filter((a) => a.allocation < MIN_ALLOCATION_SECONDARY)
      .map((a) => ({
        ...a,
        deferReason: `Allocation ${this.formatSOL(a.allocation)} < minimum ${this.formatSOL(MIN_ALLOCATION_SECONDARY)}`,
      }));

    // Phase 3: Redistribute deferred allocations to viable tokens
    if (viable.length > 0 && deferred.length > 0) {
      const deferredTotal = deferred.reduce((sum, a) => sum + a.allocation, 0n);
      const viableTotal = viable.reduce((sum, a) => sum + a.allocation, 0n);

      if (viableTotal > 0n) {
        const redistributionRatio =
          Number(viableTotal + deferredTotal) / Number(viableTotal);

        viable.forEach((a) => {
          a.allocation = BigInt(Math.floor(Number(a.allocation) * redistributionRatio));
          // Update derived fields
          a.allocationLamports = a.allocation;
          const secondaryShare = BigInt(
            Math.floor(Number(a.allocation) * SECONDARY_KEEP_RATIO)
          );
          a.burnShareLamports = (secondaryShare * 99n) / 100n;
          a.devShareLamports = secondaryShare / 100n;
        });

        log.info("Redistributed deferred allocations", {
          deferredTotal: this.formatSOL(deferredTotal),
          deferredCount: deferred.length,
        });
      }
    }

    // Calculate root treasury contribution (44.8% from all viable secondaries)
    const totalViableAllocation = viable.reduce(
      (sum, a) => sum + a.allocation,
      0n
    );
    const rootTreasuryContribution = BigInt(
      Math.floor(Number(totalViableAllocation) * ROOT_SHARE_RATIO)
    );

    // Create root allocation if root token exists
    const rootAllocation = rootToken
      ? this.createRootAllocation(
          rootToken,
          rootToken.pendingFeesLamports + rootTreasuryContribution
        )
      : null;

    log.info("Allocation complete", {
      viable: viable.length,
      deferred: deferred.length,
      totalDistributable: this.formatSOL(totalViableAllocation),
      rootTreasury: this.formatSOL(rootTreasuryContribution),
    });

    return {
      viable,
      deferred,
      rootAllocation,
      ratio,
      totalDistributable: totalViableAllocation,
      rootTreasuryContribution,
    };
  }

  /**
   * Select ONE token for this cycle using slot-based deterministic selection
   * Pattern: slot % eligible_count (O(1) probabilistic, fair selection)
   *
   * @param eligible - Tokens with pending_fees >= threshold
   * @param currentSlot - Current Solana slot for deterministic selection
   * @returns Selected token or null if none eligible
   */
  selectForCycle(
    eligible: TokenAllocationExtended[],
    currentSlot: number
  ): SelectionResult {
    if (eligible.length === 0) {
      return { selected: null, slot: currentSlot, eligible: [] };
    }

    // UNIFORM SELECTION: No sorting bias
    // Each eligible token has equal probability: 1/N
    const selectedIndex = currentSlot % eligible.length;
    const selected = eligible[selectedIndex];

    log.info("Token selected for cycle", {
      selected: selected.symbol,
      index: selectedIndex,
      slot: currentSlot,
      totalEligible: eligible.length,
    });

    return { selected, slot: currentSlot, eligible };
  }

  /**
   * Get eligible tokens (above threshold)
   *
   * @param allocations - All token allocations
   * @returns Tokens eligible for processing
   */
  getEligibleTokens(
    allocations: TokenAllocationExtended[]
  ): TokenAllocationExtended[] {
    return allocations.filter(
      (a) => !a.isRoot && a.allocationLamports >= ELIGIBILITY_THRESHOLD
    );
  }

  /**
   * Calculate dynamic allocation for a single token
   * Used during sequential execution when balance changes
   *
   * @param availableBalance - Current available balance in datAuthority
   * @param tokenPendingFees - This token's pending fees
   * @param totalRemainingPending - Sum of pending fees for remaining tokens
   * @param numRemainingTokens - Number of tokens still to process
   */
  calculateDynamicAllocation(
    availableBalance: bigint,
    tokenPendingFees: bigint,
    totalRemainingPending: bigint,
    numRemainingTokens: number
  ): { allocation: bigint; viable: boolean; reason: string } {
    // Reserve rent-exempt minimum for datAuthority account
    const RESERVE_FOR_ACCOUNT = RENT_EXEMPT_MINIMUM + SAFETY_BUFFER;

    // Reserve total cost for OTHER remaining tokens
    const otherTokensCount = numRemainingTokens - 1;
    const reserveForOtherTokens =
      BigInt(otherTokensCount) * ELIGIBILITY_THRESHOLD;

    const totalReserved = RESERVE_FOR_ACCOUNT + reserveForOtherTokens;
    const distributable =
      availableBalance > totalReserved
        ? availableBalance - totalReserved
        : 0n;

    if (distributable <= 0n) {
      return {
        allocation: 0n,
        viable: false,
        reason: `No balance after reserving ${this.formatSOL(totalReserved)} for ${otherTokensCount} other tokens`,
      };
    }

    if (distributable < MIN_ALLOCATION_SECONDARY) {
      return {
        allocation: distributable,
        viable: false,
        reason: `Available ${this.formatSOL(distributable)} < minimum ${this.formatSOL(MIN_ALLOCATION_SECONDARY)}`,
      };
    }

    // Calculate proportional allocation
    const pendingRatio =
      totalRemainingPending > 0n
        ? Number(tokenPendingFees) / Number(totalRemainingPending)
        : 1 / numRemainingTokens;

    let allocation: bigint;
    if (numRemainingTokens === 1) {
      // Last token gets all remaining distributable
      allocation = distributable;
    } else {
      // Proportional share, minimum guaranteed
      allocation = BigInt(Math.floor(Number(distributable) * pendingRatio));
      allocation =
        allocation < MIN_ALLOCATION_SECONDARY
          ? MIN_ALLOCATION_SECONDARY
          : allocation;
      allocation = allocation > distributable ? distributable : allocation;
    }

    return { allocation, viable: true, reason: "OK" };
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private createSecondaryAllocation(
    token: TrackedToken,
    allocation: bigint
  ): TokenAllocationExtended {
    // Secondary keeps 55.2%, sends 44.8% to root treasury
    const secondaryShare = BigInt(
      Math.floor(Number(allocation) * SECONDARY_KEEP_RATIO)
    );

    // Of the 55.2%, 99% burns, 1% dev sustainability
    const burnShare = (secondaryShare * 99n) / 100n;
    const devShare = secondaryShare / 100n;

    return {
      mint: token.mint,
      symbol: token.symbol,
      isRoot: false,
      allocationLamports: allocation,
      burnShareLamports: burnShare,
      devShareLamports: devShare,
      token,
      allocation,
    };
  }

  private createRootAllocation(
    token: TrackedToken,
    totalAllocation: bigint
  ): TokenAllocationExtended {
    // Root gets 100% burn (no dev fee, no split)
    return {
      mint: token.mint,
      symbol: token.symbol,
      isRoot: true,
      allocationLamports: totalAllocation,
      burnShareLamports: totalAllocation, // 100% burn
      devShareLamports: 0n, // No dev fee for root
      token,
      allocation: totalAllocation,
    };
  }

  private formatSOL(lamports: bigint): string {
    return `${(Number(lamports) / Number(LAMPORTS_PER_SOL)).toFixed(6)} SOL`;
  }
}

// Export singleton for convenience
export const allocator = new AllocationCalculator();
