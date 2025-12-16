/**
 * Pre-Flight Validation for Cycle Execution
 *
 * Validates ecosystem state before cycle execution:
 * - Daemon synchronization (fee flush)
 * - Minimum fee thresholds
 * - TokenStats availability
 *
 * Prevents failed cycles and wasted transaction fees.
 */

import { PublicKey } from '@solana/web3.js';
import { Program } from '@coral-xyz/anchor';
import { TokenConfig } from './types';
import { log, colors, logSection } from './utils/logging';
import { formatSOL } from './utils/formatting';
import { getTypedAccounts } from '../core/types';
import { sleep as rpcSleep } from '../network/rpc-utils';

const sleep = rpcSleep;
const TOKEN_STATS_SEED = Buffer.from('token_stats_v1');
const MIN_ALLOCATION_SECONDARY = 5_690_000; // ~0.00569 SOL

export interface FlushResult {
  success: boolean;
  tokensUpdated: number;
  tokensFailed: number;
  totalFlushed: number;
  remainingPending: number;
  timestamp?: number;
  details?: Array<{
    symbol: string;
    mint: string;
    amount: number;
    success: boolean;
    error?: string;
  }>;
}

export interface EcosystemValidation {
  canProceed: boolean;
  secondaryCount: number;
  minRequired: number;
  available: number;
  message: string;
}

export interface DaemonSyncResult {
  synced: boolean;
  tokensWithFees: string[];
  tokensWithoutFees: string[];
}

/**
 * Cycle Validator
 *
 * Pre-flight checks before cycle execution
 */
export class CycleValidator {
  /**
   * Trigger daemon flush to ensure all pending fees are written on-chain
   * This solves the race condition between daemon detection and cycle execution
   *
   * @returns FlushResult with detailed status, or null if daemon not available
   */
  async triggerDaemonFlush(): Promise<FlushResult | null> {
    const DAEMON_API_PORT = parseInt(process.env.DAEMON_API_PORT || '3030');
    const DAEMON_API_URL = `http://localhost:${DAEMON_API_PORT}/flush`;
    const DAEMON_API_KEY = process.env.DAEMON_API_KEY || '';
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 2000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        log(
          '🔄',
          `Triggering daemon flush (attempt ${attempt}/${MAX_RETRIES})...`,
          colors.cyan
        );

        // Build headers with optional API key authentication
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (DAEMON_API_KEY) {
          headers['X-Daemon-Key'] = DAEMON_API_KEY;
        }

        const response = await fetch(DAEMON_API_URL, {
          method: 'POST',
          headers,
        });

        // Safe JSON parsing with error handling
        let result: FlushResult;
        try {
          result = (await response.json()) as FlushResult;
        } catch (parseError) {
          throw new Error(
            `Invalid JSON response from daemon: ${(parseError as Error).message}`
          );
        }

        // Check if all tokens were flushed successfully
        if (result.success) {
          log(
            '✅',
            `Daemon flush completed: ${result.tokensUpdated} tokens updated, ${(result.totalFlushed / 1e9).toFixed(6)} SOL flushed`,
            colors.green
          );
        } else if (result.tokensFailed > 0) {
          log(
            '⚠️',
            `Partial flush: ${result.tokensUpdated} succeeded, ${result.tokensFailed} failed. Remaining: ${(result.remainingPending / 1e9).toFixed(6)} SOL`,
            colors.yellow
          );
          // Log failed tokens
          result.details
            ?.filter((d) => !d.success)
            .forEach((d) => {
              log('  ❌', `${d.symbol}: ${d.error}`, colors.red);
            });
        }

        // Wait for blockchain confirmation (increased to 15s for reliable sync)
        // This is CRITICAL to prevent race condition where on-chain state
        // hasn't been updated yet when cycle reads pending_fees
        log('⏳', 'Waiting 15s for blockchain confirmation...', colors.cyan);
        await sleep(15000);
        return result;
      } catch (error) {
        const errorMsg = (error as Error).message || String(error);

        if (errorMsg.includes('ECONNREFUSED') || errorMsg.includes('fetch failed')) {
          log(
            '⚠️',
            'Daemon not running - proceeding with on-chain pending_fees',
            colors.yellow
          );
          return null;
        }

        if (attempt < MAX_RETRIES) {
          log(
            '⚠️',
            `Flush attempt ${attempt} failed: ${errorMsg}. Retrying in ${RETRY_DELAY_MS}ms...`,
            colors.yellow
          );
          await sleep(RETRY_DELAY_MS);
        } else {
          log(
            '⚠️',
            `All ${MAX_RETRIES} flush attempts failed: ${errorMsg}`,
            colors.yellow
          );
          return null;
        }
      }
    }

    return null;
  }

  /**
   * Pre-flight validation to check if collected fees are sufficient for all tokens
   * This is an early warning system before attempting distribution
   */
  validateMinimumEcosystemFees(
    tokens: TokenConfig[],
    totalPending: number
  ): EcosystemValidation {
    const secondaryCount = tokens.filter((t) => !t.isRoot).length;
    const minRequired = secondaryCount * MIN_ALLOCATION_SECONDARY;

    if (totalPending < minRequired) {
      return {
        canProceed: false,
        secondaryCount,
        minRequired,
        available: totalPending,
        message: `Pending fees (${formatSOL(totalPending)} SOL) < minimum required (${formatSOL(minRequired)} SOL) for ${secondaryCount} secondary tokens`,
      };
    }

    return {
      canProceed: true,
      secondaryCount,
      minRequired,
      available: totalPending,
      message: `OK: ${formatSOL(totalPending)} SOL >= ${formatSOL(minRequired)} SOL minimum for ${secondaryCount} tokens`,
    };
  }

  /**
   * Calculate minimum SOL needed for ecosystem with N secondary tokens
   */
  calculateMinimumEcosystemFees(secondaryCount: number): number {
    return secondaryCount * MIN_ALLOCATION_SECONDARY;
  }

  /**
   * Wait for validator daemon to sync all secondary tokens' pending_fees
   * This ensures all tokens have their fees registered before the cycle executes
   *
   * @param program - Anchor program instance
   * @param tokens - Array of token configs to check
   * @param maxWaitMs - Maximum time to wait (default 60s)
   * @returns Sync result with token status
   */
  async waitForDaemonSync(
    program: Program,
    tokens: TokenConfig[],
    maxWaitMs: number = 60000
  ): Promise<DaemonSyncResult> {
    logSection('PRE-FLIGHT: DAEMON SYNCHRONIZATION CHECK');

    const secondaryTokens = tokens.filter((t) => !t.isRoot);
    const startTime = Date.now();
    let iteration = 0;

    while (Date.now() - startTime < maxWaitMs) {
      iteration++;
      const tokensWithFees: string[] = [];
      const tokensWithoutFees: string[] = [];

      for (const token of secondaryTokens) {
        try {
          const [tokenStatsPDA] = PublicKey.findProgramAddressSync(
            [TOKEN_STATS_SEED, token.mint.toBuffer()],
            program.programId
          );

          const tokenStats = await getTypedAccounts(program).tokenStats.fetch(
            tokenStatsPDA
          );
          const pendingFees = tokenStats.pendingFeesLamports.toNumber();

          if (pendingFees > 0) {
            tokensWithFees.push(token.symbol);
          } else {
            tokensWithoutFees.push(token.symbol);
          }
        } catch (error) {
          tokensWithoutFees.push(token.symbol);
        }
      }

      if (tokensWithoutFees.length === 0) {
        log(
          '✅',
          `All ${secondaryTokens.length} secondary tokens have pending fees`,
          colors.green
        );
        for (const symbol of tokensWithFees) {
          log('  ✓', `${symbol}: pending_fees > 0`, colors.green);
        }
        return { synced: true, tokensWithFees, tokensWithoutFees };
      }

      if (iteration === 1) {
        log(
          '⏳',
          `Waiting for daemon to sync ${tokensWithoutFees.length} token(s)...`,
          colors.yellow
        );
        for (const symbol of tokensWithoutFees) {
          log('  ⏳', `${symbol}: pending_fees = 0 (waiting)`, colors.yellow);
        }
        for (const symbol of tokensWithFees) {
          log('  ✓', `${symbol}: pending_fees > 0`, colors.green);
        }
      }

      await sleep(5000); // Wait 5s before retry
    }

    // Timeout - proceed with available tokens
    const finalTokensWithFees: string[] = [];
    const finalTokensWithoutFees: string[] = [];

    for (const token of secondaryTokens) {
      try {
        const [tokenStatsPDA] = PublicKey.findProgramAddressSync(
          [TOKEN_STATS_SEED, token.mint.toBuffer()],
          program.programId
        );
        const tokenStats = await getTypedAccounts(program).tokenStats.fetch(
          tokenStatsPDA
        );
        if (tokenStats.pendingFeesLamports.toNumber() > 0) {
          finalTokensWithFees.push(token.symbol);
        } else {
          finalTokensWithoutFees.push(token.symbol);
        }
      } catch {
        finalTokensWithoutFees.push(token.symbol);
      }
    }

    log(
      '⚠️',
      `Timeout after ${maxWaitMs / 1000}s - proceeding with ${finalTokensWithFees.length}/${secondaryTokens.length} tokens`,
      colors.yellow
    );
    if (finalTokensWithoutFees.length > 0) {
      log(
        'ℹ️',
        `Tokens without pending fees will be DEFERRED: ${finalTokensWithoutFees.join(', ')}`,
        colors.cyan
      );
    }

    return {
      synced: false,
      tokensWithFees: finalTokensWithFees,
      tokensWithoutFees: finalTokensWithoutFees,
    };
  }
}
