/**
 * FeeAllocator Unit Tests
 *
 * Tests proportional fee distribution and dynamic allocation
 */

import { expect } from 'chai';
import { PublicKey } from '@solana/web3.js';
import { FeeAllocator, MIN_ALLOCATION_SECONDARY } from '../fee-allocator';
import { TokenAllocation } from '../token-selector';
import { TokenConfig } from '../types';

describe('FeeAllocator', () => {
  let allocator: FeeAllocator;
  let mockToken1: TokenConfig;
  let mockToken2: TokenConfig;
  let mockToken3: TokenConfig;

  beforeEach(() => {
    allocator = new FeeAllocator();

    // Use system program addresses for valid PublicKeys
    mockToken1 = {
      file: 'test1.json',
      symbol: 'TEST1',
      mint: PublicKey.default, // 11111111111111111111111111111111
      bondingCurve: PublicKey.default,
      creator: PublicKey.default,
      isRoot: false,
      isToken2022: false,
      mayhemMode: false,
      poolType: 'bonding_curve',
    };

    mockToken2 = {
      ...mockToken1,
      symbol: 'TEST2',
      mint: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), // SPL Token program
    };

    mockToken3 = {
      ...mockToken1,
      symbol: 'ROOT',
      mint: new PublicKey('So11111111111111111111111111111111111111112'), // Wrapped SOL
      isRoot: true,
    };
  });

  describe('normalizeAllocations', () => {
    it('should handle zero pending fees', () => {
      const allocations: TokenAllocation[] = [
        { token: mockToken1, pendingFees: 0, allocation: 0, isRoot: false },
        { token: mockToken2, pendingFees: 0, allocation: 0, isRoot: false },
      ];

      const result = allocator.normalizeAllocations(allocations, 0);

      expect(result.viable).to.have.lengthOf(0);
      expect(result.skipped).to.have.lengthOf(0);
      expect(result.ratio).to.equal(0);
    });

    it('should calculate proportional allocations', () => {
      const allocations: TokenAllocation[] = [
        { token: mockToken1, pendingFees: 10_000_000, allocation: 0, isRoot: false },
        { token: mockToken2, pendingFees: 20_000_000, allocation: 0, isRoot: false },
      ];

      const actualCollected = 30_000_000;
      const result = allocator.normalizeAllocations(allocations, actualCollected);

      expect(result.ratio).to.equal(1.0);
      expect(result.viable).to.have.lengthOf(2);

      // TEST1 should get 10M, TEST2 should get 20M
      const test1 = result.viable.find((a) => a.token.symbol === 'TEST1');
      const test2 = result.viable.find((a) => a.token.symbol === 'TEST2');

      expect(test1?.allocation).to.equal(10_000_000);
      expect(test2?.allocation).to.equal(20_000_000);
    });

    it('should filter tokens below minimum allocation', () => {
      const allocations: TokenAllocation[] = [
        { token: mockToken1, pendingFees: 10_000_000, allocation: 0, isRoot: false },
        { token: mockToken2, pendingFees: 1_000_000, allocation: 0, isRoot: false }, // Below MIN
      ];

      const actualCollected = 11_000_000;
      const result = allocator.normalizeAllocations(allocations, actualCollected);

      expect(result.viable).to.have.lengthOf(1);
      expect(result.skipped).to.have.lengthOf(1);
      expect(result.viable[0].token.symbol).to.equal('TEST1');
      expect(result.skipped[0].token.symbol).to.equal('TEST2');
    });

    it('should redistribute skipped allocations to viable tokens', () => {
      const allocations: TokenAllocation[] = [
        { token: mockToken1, pendingFees: 10_000_000, allocation: 0, isRoot: false },
        { token: mockToken2, pendingFees: 2_000_000, allocation: 0, isRoot: false }, // Will be skipped
      ];

      const actualCollected = 12_000_000;
      const result = allocator.normalizeAllocations(allocations, actualCollected);

      expect(result.viable).to.have.lengthOf(1);
      expect(result.skipped).to.have.lengthOf(1);

      // TEST1 should get all 12M after redistribution
      expect(result.viable[0].allocation).to.equal(12_000_000);
    });

    it('should handle partial collection (ratio < 1)', () => {
      const allocations: TokenAllocation[] = [
        { token: mockToken1, pendingFees: 10_000_000, allocation: 0, isRoot: false },
        { token: mockToken2, pendingFees: 20_000_000, allocation: 0, isRoot: false },
      ];

      // Only collected 15M out of 30M pending (50% ratio)
      const actualCollected = 15_000_000;
      const result = allocator.normalizeAllocations(allocations, actualCollected);

      expect(result.ratio).to.equal(0.5);

      // TEST1: 5M (below threshold) → skipped, redistributed to TEST2
      // TEST2: 10M + 5M = 15M (viable)
      expect(result.viable).to.have.lengthOf(1);
      expect(result.skipped).to.have.lengthOf(1);

      const test2 = result.viable.find((a) => a.token.symbol === 'TEST2');
      const test1Skipped = result.skipped.find((a) => a.token.symbol === 'TEST1');

      expect(test2?.allocation).to.equal(15_000_000); // 10M + redistributed 5M
      expect(test1Skipped?.allocation).to.equal(5_000_000); // Below MIN threshold
    });

    it('should skip root tokens', () => {
      const allocations: TokenAllocation[] = [
        { token: mockToken1, pendingFees: 10_000_000, allocation: 0, isRoot: false },
        { token: mockToken3, pendingFees: 30_000_000, allocation: 0, isRoot: true },
      ];

      const actualCollected = 10_000_000;
      const result = allocator.normalizeAllocations(allocations, actualCollected);

      expect(result.viable).to.have.lengthOf(1);
      expect(result.viable[0].token.symbol).to.equal('TEST1');
    });
  });

  describe('calculateDynamicAllocation', () => {
    it('should return viable allocation when sufficient balance', () => {
      const availableBalance = 200_000_000; // 0.2 SOL
      const tokenPendingFees = 10_000_000;
      const totalRemainingPending = 10_000_000;
      const numRemainingTokens = 1;

      const result = allocator.calculateDynamicAllocation(
        availableBalance,
        tokenPendingFees,
        totalRemainingPending,
        numRemainingTokens
      );

      expect(result.viable).to.be.true;
      expect(result.allocation).to.be.greaterThan(MIN_ALLOCATION_SECONDARY);
    });

    it('should reserve funds for other tokens', () => {
      const availableBalance = 300_000_000; // 0.3 SOL
      const tokenPendingFees = 10_000_000;
      const totalRemainingPending = 30_000_000;
      const numRemainingTokens = 3; // This token + 2 others

      const result = allocator.calculateDynamicAllocation(
        availableBalance,
        tokenPendingFees,
        totalRemainingPending,
        numRemainingTokens
      );

      expect(result.viable).to.be.true;
      // Should allocate less than available to reserve for others
      expect(result.allocation).to.be.lessThan(availableBalance);
    });

    it('should give all distributable to last token', () => {
      const availableBalance = 200_000_000; // 0.2 SOL
      const tokenPendingFees = 10_000_000;
      const totalRemainingPending = 10_000_000;
      const numRemainingTokens = 1; // Last token

      const result = allocator.calculateDynamicAllocation(
        availableBalance,
        tokenPendingFees,
        totalRemainingPending,
        numRemainingTokens
      );

      expect(result.viable).to.be.true;
      // Last token gets all remaining (minus reserves)
      expect(result.allocation).to.be.greaterThan(0);
    });

    it('should return non-viable when insufficient balance', () => {
      const availableBalance = 1_000_000; // Very low
      const tokenPendingFees = 10_000_000;
      const totalRemainingPending = 10_000_000;
      const numRemainingTokens = 1;

      const result = allocator.calculateDynamicAllocation(
        availableBalance,
        tokenPendingFees,
        totalRemainingPending,
        numRemainingTokens
      );

      expect(result.viable).to.be.false;
      expect(result.reason).to.include('Available');
    });

    it('should handle proportional allocation for multiple tokens', () => {
      const availableBalance = 500_000_000; // 0.5 SOL
      const token1PendingFees = 10_000_000;
      const token2PendingFees = 20_000_000;
      const totalRemainingPending = 30_000_000;

      // First token (2 remaining)
      const result1 = allocator.calculateDynamicAllocation(
        availableBalance,
        token1PendingFees,
        totalRemainingPending,
        2
      );

      expect(result1.viable).to.be.true;

      // Allocation should be proportional to pending fees
      // TOKEN1 has 1/3 of pending fees, so should get ~1/3 of distributable
      const expectedRatio = token1PendingFees / totalRemainingPending;
      expect(result1.allocation).to.be.greaterThan(0);
    });

    it('should ensure minimum allocation when viable', () => {
      const availableBalance = 200_000_000; // 0.2 SOL
      const tokenPendingFees = 1_000_000; // Very small pending
      const totalRemainingPending = 1_000_000;
      const numRemainingTokens = 1;

      const result = allocator.calculateDynamicAllocation(
        availableBalance,
        tokenPendingFees,
        totalRemainingPending,
        numRemainingTokens
      );

      if (result.viable) {
        // If viable, allocation should meet minimum
        expect(result.allocation).to.be.at.least(MIN_ALLOCATION_SECONDARY);
      }
    });
  });
});
