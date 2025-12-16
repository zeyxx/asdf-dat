/**
 * DeadLetterQueue Unit Tests
 *
 * Tests DLQ management with exponential backoff retry
 */

import { expect } from 'chai';
import { PublicKey } from '@solana/web3.js';
import { DeadLetterQueue, isCycleTooSoonError } from '../dead-letter-queue';
import * as fs from 'fs';

describe('DeadLetterQueue', () => {
  let dlq: DeadLetterQueue;
  const testFilePath = '.dead-letter-tokens.test.json';

  beforeEach(() => {
    dlq = new DeadLetterQueue(testFilePath);
    // Clean up test file
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  });

  afterEach(() => {
    // Clean up test file
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  });

  describe('append', () => {
    it('should add entry to DLQ', () => {
      const mockToken = {
        symbol: 'TEST',
        mint: PublicKey.default,
      };
      const error = new Error('Test error');

      dlq.append(mockToken, error, 1000000, 500000, 1);

      // Verify file exists
      expect(fs.existsSync(testFilePath)).to.be.true;

      // Read and verify content
      const content = JSON.parse(fs.readFileSync(testFilePath, 'utf-8'));
      expect(content).to.have.lengthOf(1);
      expect(content[0].token).to.equal('TEST');
      expect(content[0].error).to.equal('Test error');
      expect(content[0].retryCount).to.equal(1);
      expect(content[0].status).to.equal('pending');
    });

    it('should set nextRetryAt for transient errors', () => {
      const mockToken = {
        symbol: 'TEST',
        mint: PublicKey.default,
      };
      const error = new Error('fetch failed'); // Retryable error

      dlq.append(mockToken, error, 1000000, 500000, 1);

      const content = JSON.parse(fs.readFileSync(testFilePath, 'utf-8'));
      expect(content[0].isTransient).to.be.true;
      expect(content[0].nextRetryAt).to.not.be.undefined;
    });

    it('should not set nextRetryAt for permanent errors', () => {
      const mockToken = {
        symbol: 'TEST',
        mint: PublicKey.default,
      };
      const error = new Error('Invalid mint');

      dlq.append(mockToken, error, 1000000, 500000, 1);

      const content = JSON.parse(fs.readFileSync(testFilePath, 'utf-8'));
      expect(content[0].isTransient).to.be.false;
      expect(content[0].nextRetryAt).to.be.undefined;
    });

    it('should limit entries to 100', () => {
      const mockToken = {
        symbol: 'TEST',
        mint: PublicKey.default,
      };

      // Add 150 entries
      for (let i = 0; i < 150; i++) {
        dlq.append(mockToken, new Error(`Error ${i}`), 1000000, 500000, 1);
      }

      const content = JSON.parse(fs.readFileSync(testFilePath, 'utf-8'));
      expect(content).to.have.lengthOf(100);
      // Should keep the last 100 entries
      expect(content[99].error).to.equal('Error 149');
    });
  });

  describe('process', () => {
    it('should return empty arrays for non-existent file', () => {
      const result = dlq.process();

      expect(result.retryable).to.have.lengthOf(0);
      expect(result.expired).to.have.lengthOf(0);
    });

    it('should identify expired entries based on age', () => {
      // Create entry older than 24 hours
      const oldTimestamp = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      const entries = [
        {
          timestamp: oldTimestamp,
          token: 'TEST',
          mint: '11111111111111111111111111111111',
          error: 'Test error',
          isTransient: true,
          pendingFees: 1000000,
          allocation: 500000,
          retryCount: 1,
          nextRetryAt: new Date().toISOString(),
          status: 'pending',
        },
      ];

      fs.writeFileSync(testFilePath, JSON.stringify(entries));

      const result = dlq.process();

      expect(result.expired).to.have.lengthOf(1);
      expect(result.expired[0]).to.equal('TEST');

      // Verify status was updated
      const content = JSON.parse(fs.readFileSync(testFilePath, 'utf-8'));
      expect(content[0].status).to.equal('expired');
    });

    it('should identify expired entries based on max retries', () => {
      const entries = [
        {
          timestamp: new Date().toISOString(),
          token: 'TEST',
          mint: '11111111111111111111111111111111',
          error: 'Test error',
          isTransient: true,
          pendingFees: 1000000,
          allocation: 500000,
          retryCount: 5, // Max retries
          nextRetryAt: new Date().toISOString(),
          status: 'pending',
        },
      ];

      fs.writeFileSync(testFilePath, JSON.stringify(entries));

      const result = dlq.process();

      expect(result.expired).to.have.lengthOf(1);
      expect(result.expired[0]).to.equal('TEST');
    });

    it('should identify retryable entries', () => {
      // Create entry with past retry time
      const pastRetryTime = new Date(Date.now() - 1000).toISOString();
      const entries = [
        {
          timestamp: new Date().toISOString(),
          token: 'TEST',
          mint: '11111111111111111111111111111111',
          error: 'Test error',
          isTransient: true,
          pendingFees: 1000000,
          allocation: 500000,
          retryCount: 1,
          nextRetryAt: pastRetryTime,
          status: 'pending',
        },
      ];

      fs.writeFileSync(testFilePath, JSON.stringify(entries));

      const result = dlq.process();

      expect(result.retryable).to.have.lengthOf(1);
      expect(result.retryable[0]).to.equal('11111111111111111111111111111111');
    });

    it('should skip resolved/expired entries', () => {
      const entries = [
        {
          timestamp: new Date().toISOString(),
          token: 'TEST1',
          mint: '11111111111111111111111111111111',
          error: 'Test error',
          isTransient: true,
          pendingFees: 1000000,
          allocation: 500000,
          retryCount: 1,
          nextRetryAt: new Date().toISOString(),
          status: 'resolved',
        },
        {
          timestamp: new Date().toISOString(),
          token: 'TEST2',
          mint: '22222222222222222222222222222222',
          error: 'Test error',
          isTransient: true,
          pendingFees: 1000000,
          allocation: 500000,
          retryCount: 1,
          nextRetryAt: new Date().toISOString(),
          status: 'expired',
        },
      ];

      fs.writeFileSync(testFilePath, JSON.stringify(entries));

      const result = dlq.process();

      expect(result.retryable).to.have.lengthOf(0);
      expect(result.expired).to.have.lengthOf(0);
    });
  });

  describe('markResolved', () => {
    it('should mark entry as resolved', () => {
      const entries = [
        {
          timestamp: new Date().toISOString(),
          token: 'TEST',
          mint: '11111111111111111111111111111111',
          error: 'Test error',
          isTransient: true,
          pendingFees: 1000000,
          allocation: 500000,
          retryCount: 1,
          nextRetryAt: new Date().toISOString(),
          status: 'pending',
        },
      ];

      fs.writeFileSync(testFilePath, JSON.stringify(entries));

      dlq.markResolved('11111111111111111111111111111111');

      const content = JSON.parse(fs.readFileSync(testFilePath, 'utf-8'));
      expect(content[0].status).to.equal('resolved');
    });

    it('should handle non-existent file gracefully', () => {
      // Should not throw
      expect(() => dlq.markResolved('nonexistent')).to.not.throw();
    });

    it('should not re-mark already resolved entries', () => {
      const entries = [
        {
          timestamp: new Date().toISOString(),
          token: 'TEST',
          mint: '11111111111111111111111111111111',
          error: 'Test error',
          isTransient: true,
          pendingFees: 1000000,
          allocation: 500000,
          retryCount: 1,
          nextRetryAt: new Date().toISOString(),
          status: 'resolved',
        },
      ];

      fs.writeFileSync(testFilePath, JSON.stringify(entries));

      // Should not throw or modify
      dlq.markResolved('11111111111111111111111111111111');

      const content = JSON.parse(fs.readFileSync(testFilePath, 'utf-8'));
      expect(content[0].status).to.equal('resolved');
    });
  });

  describe('isCycleTooSoonError', () => {
    it('should identify CycleTooSoon error variants', () => {
      expect(isCycleTooSoonError(new Error('CycleTooSoon'))).to.be.true;
      expect(isCycleTooSoonError(new Error('cycle too soon'))).to.be.true;
      expect(isCycleTooSoonError(new Error('min_cycle_interval not met'))).to.be.true;
    });

    it('should reject non-CycleTooSoon errors', () => {
      expect(isCycleTooSoonError(new Error('Network error'))).to.be.false;
      expect(isCycleTooSoonError(new Error('Invalid mint'))).to.be.false;
    });
  });
});
