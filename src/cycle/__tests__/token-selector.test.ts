/**
 * TokenSelector Unit Tests
 *
 * Tests probabilistic O(1) token selection logic
 */

import { expect } from 'chai';
import { PublicKey } from '@solana/web3.js';
import { TokenSelector, TokenAllocation } from '../token-selector';
import { TokenConfig } from '../types';

describe('TokenSelector', () => {
  let selector: TokenSelector;
  let mockToken1: TokenConfig;
  let mockToken2: TokenConfig;
  let mockToken3: TokenConfig;

  beforeEach(() => {
    selector = new TokenSelector();

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

  describe('getEligibleTokens', () => {
    it('should filter tokens that meet minimum threshold', () => {
      const allocations: TokenAllocation[] = [
        { token: mockToken1, pendingFees: 7_000_000, allocation: 0, isRoot: false },
        { token: mockToken2, pendingFees: 5_000_000, allocation: 0, isRoot: false },
        { token: mockToken3, pendingFees: 10_000_000, allocation: 0, isRoot: true },
      ];

      const eligible = selector.getEligibleTokens(allocations);

      expect(eligible).to.have.lengthOf(1);
      expect(eligible[0].token.symbol).to.equal('TEST1');
    });

    it('should exclude root tokens', () => {
      const allocations: TokenAllocation[] = [
        { token: mockToken3, pendingFees: 10_000_000, allocation: 0, isRoot: true },
      ];

      const eligible = selector.getEligibleTokens(allocations);

      expect(eligible).to.have.lengthOf(0);
    });

    it('should exclude tokens below threshold', () => {
      const allocations: TokenAllocation[] = [
        { token: mockToken1, pendingFees: 1_000_000, allocation: 0, isRoot: false },
        { token: mockToken2, pendingFees: 500_000, allocation: 0, isRoot: false },
      ];

      const eligible = selector.getEligibleTokens(allocations);

      expect(eligible).to.have.lengthOf(0);
    });

    it('should include all tokens above threshold', () => {
      const allocations: TokenAllocation[] = [
        { token: mockToken1, pendingFees: 10_000_000, allocation: 0, isRoot: false },
        { token: mockToken2, pendingFees: 20_000_000, allocation: 0, isRoot: false },
      ];

      const eligible = selector.getEligibleTokens(allocations);

      expect(eligible).to.have.lengthOf(2);
    });
  });

  describe('selectForCycle', () => {
    it('should return null for empty list', () => {
      const selected = selector.selectForCycle([], 12345);

      expect(selected).to.be.null;
    });

    it('should select deterministically based on slot', () => {
      const eligibleTokens: TokenAllocation[] = [
        { token: mockToken1, pendingFees: 10_000_000, allocation: 0, isRoot: false },
        { token: mockToken2, pendingFees: 20_000_000, allocation: 0, isRoot: false },
      ];

      // Slot 0 % 2 = 0 → index 0
      const selected1 = selector.selectForCycle(eligibleTokens, 0);
      expect(selected1?.token.symbol).to.equal('TEST1');

      // Slot 1 % 2 = 1 → index 1
      const selected2 = selector.selectForCycle(eligibleTokens, 1);
      expect(selected2?.token.symbol).to.equal('TEST2');

      // Slot 100 % 2 = 0 → index 0 (same as slot 0)
      const selected3 = selector.selectForCycle(eligibleTokens, 100);
      expect(selected3?.token.symbol).to.equal('TEST1');
    });

    it('should provide uniform distribution', () => {
      const eligibleTokens: TokenAllocation[] = [
        { token: mockToken1, pendingFees: 10_000_000, allocation: 0, isRoot: false },
        { token: mockToken2, pendingFees: 20_000_000, allocation: 0, isRoot: false },
      ];

      const selections: { [key: string]: number } = {};

      // Simulate 1000 slots
      for (let slot = 0; slot < 1000; slot++) {
        const selected = selector.selectForCycle(eligibleTokens, slot);
        if (selected) {
          selections[selected.token.symbol] = (selections[selected.token.symbol] || 0) + 1;
        }
      }

      // Each token should be selected ~500 times (uniform distribution)
      expect(selections['TEST1']).to.equal(500);
      expect(selections['TEST2']).to.equal(500);
    });

    it('should handle single token', () => {
      const eligibleTokens: TokenAllocation[] = [
        { token: mockToken1, pendingFees: 10_000_000, allocation: 0, isRoot: false },
      ];

      // Any slot should select the only token
      const selected1 = selector.selectForCycle(eligibleTokens, 0);
      const selected2 = selector.selectForCycle(eligibleTokens, 99);
      const selected3 = selector.selectForCycle(eligibleTokens, 12345);

      expect(selected1?.token.symbol).to.equal('TEST1');
      expect(selected2?.token.symbol).to.equal('TEST1');
      expect(selected3?.token.symbol).to.equal('TEST1');
    });
  });

  describe('getSecondaries', () => {
    it('should return only non-root tokens', () => {
      const allocations: TokenAllocation[] = [
        { token: mockToken1, pendingFees: 10_000_000, allocation: 0, isRoot: false },
        { token: mockToken2, pendingFees: 20_000_000, allocation: 0, isRoot: false },
        { token: mockToken3, pendingFees: 30_000_000, allocation: 0, isRoot: true },
      ];

      const secondaries = selector.getSecondaries(allocations);

      expect(secondaries).to.have.lengthOf(2);
      expect(secondaries.every((a) => !a.isRoot)).to.be.true;
    });
  });

  describe('getRoot', () => {
    it('should return root token', () => {
      const allocations: TokenAllocation[] = [
        { token: mockToken1, pendingFees: 10_000_000, allocation: 0, isRoot: false },
        { token: mockToken3, pendingFees: 30_000_000, allocation: 0, isRoot: true },
      ];

      const root = selector.getRoot(allocations);

      expect(root).to.not.be.undefined;
      expect(root?.token.symbol).to.equal('ROOT');
    });

    it('should return undefined if no root', () => {
      const allocations: TokenAllocation[] = [
        { token: mockToken1, pendingFees: 10_000_000, allocation: 0, isRoot: false },
        { token: mockToken2, pendingFees: 20_000_000, allocation: 0, isRoot: false },
      ];

      const root = selector.getRoot(allocations);

      expect(root).to.be.undefined;
    });
  });
});
