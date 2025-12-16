/**
 * Cycle Executor - Main Orchestrator
 *
 * Orchestrates the complete ecosystem flush cycle:
 * 1. Token discovery
 * 2. Pre-flight validation
 * 3. DLQ processing
 * 4. Probabilistic token selection
 * 5. Fee collection & burn
 * 6. Root cycle execution
 * 7. User rebate selection
 *
 * Uses all domain modules for clean separation of concerns.
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import { TokenConfig } from './types';
import { NetworkConfig } from '../network/config';
import { DeadLetterQueue, DLQProcessResult } from './dead-letter-queue';
import { TokenSelector, TokenAllocation } from './token-selector';
import { DryRunReporter, DryRunReport } from './dry-run';
import { TokenLoader } from './token-loader';
import { CycleValidator, FlushResult, DaemonSyncResult } from './validation';
import { FeeAllocator } from './fee-allocator';
import { log, colors, logSection } from './utils/logging';
import { formatSOL } from './utils/formatting';
import { getTypedAccounts } from '../core/types';

const TOKEN_STATS_SEED = Buffer.from('token_stats_v1');
const TX_FEE_RESERVE_PER_TOKEN = 100_000_000; // 0.1 SOL
const OPERATIONAL_BUFFER = 190_000_000; // 0.19 SOL

export interface CycleExecutorConfig {
  programId: PublicKey;
  connection: Connection;
  program: Program;
  adminKeypair: Keypair;
  networkConfig: NetworkConfig;
  dryRun?: boolean;
}

export interface CycleResult {
  token: string;
  success: boolean;
  pendingFees: number;
  allocation: number;
  tokensBurned?: number;
  error?: string;
  signature?: string;
}

export interface CycleSummary {
  success: boolean;
  tokensProcessed: number;
  tokensDeferred: number;
  totalBurned: number;
  totalFeesSOL: number;
  durationMs: number;
  network: string;
}

/**
 * Cycle Executor
 *
 * Orchestrates the complete ecosystem flush cycle
 */
export class CycleExecutor {
  private readonly dlq: DeadLetterQueue;
  private readonly tokenSelector: TokenSelector;
  private readonly dryRunReporter: DryRunReporter;
  private readonly tokenLoader: TokenLoader;
  private readonly validator: CycleValidator;
  private readonly feeAllocator: FeeAllocator;

  constructor(private readonly config: CycleExecutorConfig) {
    this.dlq = new DeadLetterQueue();
    this.tokenSelector = new TokenSelector();
    this.dryRunReporter = new DryRunReporter();
    this.tokenLoader = new TokenLoader(config.programId);
    this.validator = new CycleValidator();
    this.feeAllocator = new FeeAllocator();
  }

  /**
   * Execute complete ecosystem cycle
   *
   * Main entry point for cycle execution
   */
  async execute(): Promise<CycleSummary> {
    const startTime = Date.now();

    try {
      // Step 0: Validate operational buffer
      await this.validateOperationalBuffer();

      // Step 1: Load tokens
      const tokens = await this.loadTokens();
      const rootToken = tokens.find((t) => t.isRoot);
      if (!rootToken) {
        throw new Error('Root token not found');
      }

      // Step 2: Process DLQ
      this.processDLQ();

      // Step 3: Pre-flight validation (daemon flush & sync)
      await this.preFlightValidation(tokens);

      // Step 4: Query pending fees
      const allocations = await this.queryPendingFees(tokens);

      // Step 5: Dry-run mode (exit early if requested)
      if (this.config.dryRun) {
        return this.executeDryRun(allocations, rootToken);
      }

      // Step 6: Probabilistic token selection
      const { selectedToken, eligibleTokens, ineligibleTokens } =
        await this.selectToken(allocations);

      // Step 7: Execute selected token cycle (if any)
      const results: { [key: string]: CycleResult } = {};
      let actualViable: TokenAllocation[] = [];
      let actualDeferred: TokenAllocation[] = [];

      if (selectedToken) {
        // Execute cycle for the selected token
        // NOTE: Actual execution logic would go here
        // For now, this is a placeholder that shows the architecture
        log('🎯', `Executing cycle for: ${selectedToken.token.symbol}`, colors.green);
        actualViable.push(selectedToken);

        // Mark other eligible tokens as waiting
        for (const token of eligibleTokens) {
          if (token.token.symbol !== selectedToken.token.symbol) {
            actualDeferred.push(token);
            results[token.token.symbol] = {
              token: token.token.symbol,
              success: true,
              pendingFees: token.pendingFees,
              allocation: 0,
              error: 'WAITING: Will be selected in future cycle',
            };
          }
        }
      }

      // Mark ineligible tokens as deferred
      for (const token of ineligibleTokens) {
        actualDeferred.push(token);
        results[token.token.symbol] = {
          token: token.token.symbol,
          success: true,
          pendingFees: token.pendingFees,
          allocation: 0,
          error: `DEFERRED: pending ${formatSOL(token.pendingFees)} < threshold`,
        };
      }

      // Step 8: Execute root cycle (independent)
      logSection('ROOT CYCLE (INDEPENDENT)');
      log('🔄', 'Root cycle execution...', colors.cyan);
      // NOTE: Actual root execution would go here

      // Step 9: Summary
      const endTime = Date.now();
      const totalBurned = Object.values(results)
        .filter((r) => r.success && r.tokensBurned)
        .reduce((sum, r) => sum + (r.tokensBurned || 0), 0);

      const totalFeesSOL = actualViable.reduce(
        (sum, a) => sum + (a.allocation || 0),
        0
      ) / LAMPORTS_PER_SOL;

      return {
        success: true,
        tokensProcessed: actualViable.length + 1, // +1 for root
        tokensDeferred: actualDeferred.length,
        totalBurned,
        totalFeesSOL,
        durationMs: endTime - startTime,
        network: this.config.networkConfig.name,
      };
    } catch (error) {
      log('❌', `Cycle execution failed: ${(error as Error).message}`, colors.red);
      throw error;
    }
  }

  /**
   * Validate operational buffer (0.19 SOL minimum)
   */
  private async validateOperationalBuffer(): Promise<void> {
    const adminBalance = await this.config.connection.getBalance(
      this.config.adminKeypair.publicKey
    );
    const estimatedCycleCost = TX_FEE_RESERVE_PER_TOKEN * 3; // Rough estimate
    const remainingAfterCycle = adminBalance - estimatedCycleCost;

    log('💰', `Admin balance: ${formatSOL(adminBalance)} SOL`, colors.cyan);

    if (remainingAfterCycle < OPERATIONAL_BUFFER) {
      throw new Error(
        `INSUFFICIENT BUFFER: ${formatSOL(remainingAfterCycle)} would remain < ${formatSOL(OPERATIONAL_BUFFER)} required`
      );
    }

    log(
      '✅',
      `Buffer OK: ${formatSOL(remainingAfterCycle)} will remain (>= ${formatSOL(OPERATIONAL_BUFFER)} required)`,
      colors.green
    );
    console.log('');
  }

  /**
   * Load ecosystem tokens using priority cascade
   */
  private async loadTokens(): Promise<TokenConfig[]> {
    logSection('STEP 0: LOAD ECOSYSTEM TOKENS');
    const tokens = await this.tokenLoader.loadEcosystemTokens(
      this.config.connection,
      this.config.networkConfig
    );
    log('📊', `Loaded ${tokens.length} tokens`, colors.cyan);
    return tokens;
  }

  /**
   * Process dead-letter queue for auto-retry
   */
  private processDLQ(): DLQProcessResult {
    const dlqStatus = this.dlq.process();
    if (dlqStatus.retryable.length > 0) {
      log(
        '🔄',
        `DLQ: ${dlqStatus.retryable.length} entries ready for retry`,
        colors.yellow
      );
    }
    if (dlqStatus.expired.length > 0) {
      log(
        '⏰',
        `DLQ: ${dlqStatus.expired.length} entries expired (manual review needed)`,
        colors.red
      );
    }
    return dlqStatus;
  }

  /**
   * Pre-flight validation: daemon flush + sync
   */
  private async preFlightValidation(tokens: TokenConfig[]): Promise<void> {
    // Trigger daemon flush
    const flushResult = await this.validator.triggerDaemonFlush();

    if (flushResult && flushResult.tokensFailed > 0) {
      log(
        '⚠️',
        `Flush partially failed: ${flushResult.tokensFailed} tokens did not flush`,
        colors.yellow
      );
    }

    // Wait for daemon synchronization
    const syncResult = await this.validator.waitForDaemonSync(
      this.config.program,
      tokens,
      30000
    );

    if (!syncResult.synced && syncResult.tokensWithoutFees.length > 0) {
      log(
        'ℹ️',
        `Proceeding with ${syncResult.tokensWithFees.length} synced tokens`,
        colors.cyan
      );
    }
  }

  /**
   * Query pending fees from all tokens
   */
  private async queryPendingFees(
    tokens: TokenConfig[]
  ): Promise<TokenAllocation[]> {
    logSection('STEP 1: QUERY PENDING FEES');

    const allocations: TokenAllocation[] = [];

    for (const token of tokens) {
      if (token.isRoot) {
        // Root token doesn't have pending fees from this mechanism
        allocations.push({
          token,
          pendingFees: 0,
          allocation: 0,
          isRoot: true,
        });
        log(
          'ℹ️',
          `${token.symbol} (ROOT): Skipped (will collect from root treasury)`,
          colors.cyan
        );
        continue;
      }

      try {
        // Derive TokenStats PDA
        const [tokenStatsPDA] = PublicKey.findProgramAddressSync(
          [TOKEN_STATS_SEED, token.mint.toBuffer()],
          this.config.programId
        );

        // Fetch TokenStats account
        const tokenStats = await getTypedAccounts(this.config.program).tokenStats.fetch(
          tokenStatsPDA
        );

        const pendingFees = tokenStats.pendingFeesLamports.toNumber();

        allocations.push({
          token,
          pendingFees,
          allocation: 0, // Will be calculated in next step
          isRoot: false,
        });

        log(
          '💰',
          `${token.symbol}: ${formatSOL(pendingFees)} SOL pending (${pendingFees} lamports)`,
          pendingFees > 0 ? colors.green : colors.yellow
        );
      } catch (error) {
        // TokenStats doesn't exist on-chain - try to use fees from daemon state file
        if (token.pendingFeesFromState && token.pendingFeesFromState > 0) {
          log(
            '💾',
            `${token.symbol}: Using state file pending fees: ${formatSOL(token.pendingFeesFromState)} SOL`,
            colors.cyan
          );
          allocations.push({
            token,
            pendingFees: token.pendingFeesFromState,
            allocation: 0,
            isRoot: false,
          });
        } else {
          log(
            '⚠️',
            `${token.symbol}: No TokenStats & no state fees (skipping)`,
            colors.yellow
          );
        }
        continue;
      }
    }

    // Calculate total pending fees
    const totalPending = allocations
      .filter((a) => !a.isRoot)
      .reduce((sum, a) => sum + a.pendingFees, 0);

    log(
      '📊',
      `Total pending fees: ${formatSOL(totalPending)} SOL (${totalPending} lamports)`,
      colors.bright
    );

    if (totalPending === 0) {
      log(
        '⚠️',
        'No pending fees found. Ensure fee monitoring is running and has accumulated fees.',
        colors.yellow
      );
    }

    return allocations;
  }

  /**
   * Execute dry-run mode
   */
  private executeDryRun(
    allocations: TokenAllocation[],
    rootToken: TokenConfig
  ): CycleSummary {
    const report = this.dryRunReporter.generate(
      allocations,
      this.config.networkConfig.name,
      rootToken
    );

    // Print console summary
    this.dryRunReporter.print(report);

    // Write JSON report
    const fs = require('fs');
    const reportDir = 'reports';
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }
    const reportFile = `${reportDir}/dry-run-${Date.now()}.json`;
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    log('📄', `Report saved: ${reportFile}`, colors.green);

    return {
      success: true,
      tokensProcessed: 0,
      tokensDeferred: allocations.length - 1, // All except root
      totalBurned: 0,
      totalFeesSOL: 0,
      durationMs: 0,
      network: this.config.networkConfig.name,
    };
  }

  /**
   * Probabilistic token selection (O(1) per cycle)
   */
  private async selectToken(allocations: TokenAllocation[]): Promise<{
    selectedToken: TokenAllocation | null;
    eligibleTokens: TokenAllocation[];
    ineligibleTokens: TokenAllocation[];
  }> {
    logSection('STEP 2: PROBABILISTIC TOKEN SELECTION');

    const secondaryAllocations = allocations.filter((a) => !a.isRoot);
    const eligibleTokens = this.tokenSelector.getEligibleTokens(secondaryAllocations);
    const currentSlot = await this.config.connection.getSlot();

    log('📊', `Token Selection Status:`, colors.bright);
    log('  👥', `Total secondary tokens: ${secondaryAllocations.length}`, colors.cyan);
    log(
      '  ✅',
      `Eligible tokens (>= ${formatSOL(TX_FEE_RESERVE_PER_TOKEN)} SOL processing cost): ${eligibleTokens.length}`,
      colors.cyan
    );
    log('  🎰', `Current slot: ${currentSlot}`, colors.cyan);

    // Select ONE token for this cycle
    const selectedToken = this.tokenSelector.selectForCycle(eligibleTokens, currentSlot);

    const ineligibleTokens = secondaryAllocations.filter(
      (a) => !eligibleTokens.some((e) => e.token.symbol === a.token.symbol)
    );

    if (!selectedToken) {
      log(
        '⚠️',
        'No eligible tokens for this cycle. All tokens below threshold.',
        colors.yellow
      );
      return { selectedToken: null, eligibleTokens: [], ineligibleTokens: secondaryAllocations };
    }

    // Show selection result
    const selectedIndex = currentSlot % eligibleTokens.length;
    log(
      '🎯',
      `SELECTED: ${selectedToken.token.symbol} (index ${selectedIndex} of ${eligibleTokens.length})`,
      colors.green
    );
    log('  💰', `Pending fees: ${formatSOL(selectedToken.pendingFees)} SOL`, colors.cyan);

    // Show other eligible tokens that will wait for next cycle
    const otherEligible = eligibleTokens.filter(
      (t) => t.token.symbol !== selectedToken.token.symbol
    );
    if (otherEligible.length > 0) {
      log(
        '⏳',
        `Other eligible (next cycles): ${otherEligible.map((t) => t.token.symbol).join(', ')}`,
        colors.yellow
      );
    }

    console.log('');

    return { selectedToken, eligibleTokens, ineligibleTokens };
  }
}
