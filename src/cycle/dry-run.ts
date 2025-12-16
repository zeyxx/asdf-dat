/**
 * Dry-Run Reporting for Cycle Execution
 *
 * Generates preview of cycle execution without executing transactions.
 * Shows warnings, recommendations, and expected outcomes.
 */

import { TokenConfig } from './types';
import { formatSOL } from './utils/formatting';
import { colors } from './utils/logging';
import { TokenAllocation } from './token-selector';

// Minimum allocation thresholds (from main script)
const MIN_ALLOCATION_SECONDARY = 5_690_000; // ~0.00569 SOL
const MIN_ALLOCATION_ROOT = 1_040_880; // Rent + ATA reserve
const TX_FEE_RESERVE_PER_TOKEN = 100_000_000; // 0.1 SOL

export interface DryRunReport {
  timestamp: string;
  network: 'devnet' | 'mainnet';
  status: 'READY' | 'INSUFFICIENT_FEES' | 'COOLDOWN_ACTIVE' | 'NO_TOKENS';

  ecosystem: {
    totalPendingFees: number; // lamports
    totalPendingFeesSOL: string; // formatted
    tokensTotal: number;
    tokensEligible: number;
    tokensDeferred: number;
  };

  tokens: Array<{
    symbol: string;
    mint: string;
    isRoot: boolean;
    pendingFees: number;
    pendingFeesSOL: string;
    allocation: number;
    allocationSOL: string;
    willProcess: boolean;
    deferReason?: string;
  }>;

  thresholds: {
    minAllocationSecondary: number;
    minAllocationSecondarySOL: string;
    minAllocationRoot: number;
    minAllocationRootSOL: string;
  };

  costs: {
    estimatedTxFeesPerToken: number;
    estimatedTxFeesPerTokenSOL: string;
    totalEstimatedCost: number;
    totalEstimatedCostSOL: string;
  };

  warnings: string[];
  recommendations: string[];
}

/**
 * Dry-Run Reporter
 *
 * Generates and displays cycle execution previews
 */
export class DryRunReporter {
  /**
   * Generate a dry-run report based on current allocations
   */
  generate(
    allocations: TokenAllocation[],
    networkName: string,
    rootToken: TokenConfig | undefined
  ): DryRunReport {
    const secondaries = allocations.filter((a) => !a.isRoot);
    const rootAlloc = allocations.find((a) => a.isRoot);
    const totalPending = secondaries.reduce((sum, a) => sum + a.pendingFees, 0);

    // Calculate preliminary allocations (simulate normalizeAllocations logic)
    const ratio = totalPending > 0 ? 1.0 : 0; // Assume 100% collection for preview
    const preliminary = secondaries.map((alloc) => ({
      ...alloc,
      allocation: Math.floor(alloc.pendingFees * ratio),
    }));

    const viable = preliminary.filter(
      (a) => a.allocation >= MIN_ALLOCATION_SECONDARY
    );
    const deferred = preliminary.filter(
      (a) => a.allocation < MIN_ALLOCATION_SECONDARY && a.pendingFees > 0
    );

    // Build warnings
    const warnings: string[] = [];
    const recommendations: string[] = [];

    for (const d of deferred) {
      warnings.push(
        `${d.token.symbol} will be deferred (${formatSOL(d.allocation)} < ${formatSOL(MIN_ALLOCATION_SECONDARY)} minimum)`
      );
    }

    if (totalPending === 0) {
      warnings.push(
        'No pending fees detected - run daemon or wait for fee accumulation'
      );
      recommendations.push(
        'Start the fee monitor daemon: npx ts-node scripts/monitor-ecosystem-fees.ts'
      );
    }

    if (viable.length === 0 && secondaries.length > 0) {
      recommendations.push(
        'Generate more volume to accumulate fees above threshold'
      );
      recommendations.push(
        `Target: ${formatSOL(MIN_ALLOCATION_SECONDARY)} SOL per token minimum`
      );
    }

    // Determine status
    let status: DryRunReport['status'] = 'READY';
    if (secondaries.length === 0 && !rootToken) {
      status = 'NO_TOKENS';
    } else if (totalPending === 0) {
      status = 'INSUFFICIENT_FEES';
    } else if (viable.length === 0) {
      status = 'INSUFFICIENT_FEES';
    }

    // Estimate costs
    const tokensToProcess = viable.length + (rootAlloc ? 1 : 0);
    const estimatedTxCost = tokensToProcess * TX_FEE_RESERVE_PER_TOKEN;

    // Build token details
    const tokens: DryRunReport['tokens'] = [];

    for (const alloc of preliminary) {
      const isViable = alloc.allocation >= MIN_ALLOCATION_SECONDARY;
      tokens.push({
        symbol: alloc.token.symbol,
        mint: alloc.token.mint.toBase58(),
        isRoot: false,
        pendingFees: alloc.pendingFees,
        pendingFeesSOL: formatSOL(alloc.pendingFees),
        allocation: alloc.allocation,
        allocationSOL: formatSOL(alloc.allocation),
        willProcess: isViable,
        deferReason:
          !isViable && alloc.pendingFees > 0
            ? `Below minimum (${formatSOL(alloc.allocation)} < ${formatSOL(MIN_ALLOCATION_SECONDARY)})`
            : undefined,
      });
    }

    // Add root token
    if (rootAlloc) {
      // Root gets 44.8% of all secondary fees
      const rootReceived = Math.floor(
        viable.reduce((sum, v) => sum + v.allocation, 0) * 0.448
      );
      tokens.push({
        symbol: rootAlloc.token.symbol,
        mint: rootAlloc.token.mint.toBase58(),
        isRoot: true,
        pendingFees: rootAlloc.pendingFees,
        pendingFeesSOL: formatSOL(rootAlloc.pendingFees),
        allocation: rootReceived + rootAlloc.pendingFees,
        allocationSOL: formatSOL(rootReceived + rootAlloc.pendingFees),
        willProcess: true,
        deferReason: undefined,
      });
    }

    return {
      timestamp: new Date().toISOString(),
      network: networkName as 'devnet' | 'mainnet',
      status,
      ecosystem: {
        totalPendingFees: totalPending + (rootAlloc?.pendingFees || 0),
        totalPendingFeesSOL: formatSOL(
          totalPending + (rootAlloc?.pendingFees || 0)
        ),
        tokensTotal: allocations.length,
        tokensEligible: viable.length + (rootAlloc ? 1 : 0),
        tokensDeferred: deferred.length,
      },
      tokens,
      thresholds: {
        minAllocationSecondary: MIN_ALLOCATION_SECONDARY,
        minAllocationSecondarySOL: formatSOL(MIN_ALLOCATION_SECONDARY),
        minAllocationRoot: MIN_ALLOCATION_ROOT,
        minAllocationRootSOL: formatSOL(MIN_ALLOCATION_ROOT),
      },
      costs: {
        estimatedTxFeesPerToken: TX_FEE_RESERVE_PER_TOKEN,
        estimatedTxFeesPerTokenSOL: formatSOL(TX_FEE_RESERVE_PER_TOKEN),
        totalEstimatedCost: estimatedTxCost,
        totalEstimatedCostSOL: formatSOL(estimatedTxCost),
      },
      warnings,
      recommendations,
    };
  }

  /**
   * Print dry-run summary to console
   */
  print(report: DryRunReport): void {
    const statusEmoji = {
      READY: '✅',
      INSUFFICIENT_FEES: '⚠️',
      COOLDOWN_ACTIVE: '⏳',
      NO_TOKENS: '❌',
    };

    const networkBanner =
      report.network === 'mainnet'
        ? colors.red + 'MAINNET'
        : colors.green + 'DEVNET';

    console.log('\n' + colors.bright + colors.cyan);
    console.log(
      '══════════════════════════════════════════════════════════════════════════════'
    );
    console.log(
      '  DRY RUN - Ecosystem Cycle Preview (' +
        networkBanner +
        colors.cyan +
        colors.bright +
        ')'
    );
    console.log(
      '══════════════════════════════════════════════════════════════════════════════'
    );
    console.log(colors.reset + '\n');

    console.log(`  Status: ${statusEmoji[report.status]} ${report.status}\n`);

    // Ecosystem overview
    console.log(colors.bright + '  ECOSYSTEM OVERVIEW' + colors.reset);
    console.log('  ' + '─'.repeat(70));
    console.log(
      `  Total Pending Fees    │ ${report.ecosystem.totalPendingFeesSOL}`
    );
    console.log(
      `  Tokens Eligible       │ ${report.ecosystem.tokensEligible} / ${report.ecosystem.tokensTotal}`
    );
    console.log(`  Tokens Deferred       │ ${report.ecosystem.tokensDeferred}`);
    console.log('');

    // Token allocations table
    console.log(colors.bright + '  TOKEN ALLOCATIONS' + colors.reset);
    console.log('  ' + '─'.repeat(70));
    console.log(
      `  ${'Symbol'.padEnd(10)} │ ${'Pending'.padEnd(14)} │ ${'Allocation'.padEnd(14)} │ ${'Status'.padEnd(12)}`
    );
    console.log('  ' + '─'.repeat(70));

    for (const token of report.tokens) {
      const statusText = token.isRoot
        ? colors.magenta + 'ROOT' + colors.reset
        : token.willProcess
          ? colors.green + '✅ READY' + colors.reset
          : colors.yellow + '⏭️ DEFER' + colors.reset;

      console.log(
        `  ${token.symbol.padEnd(10)} │ ${token.pendingFeesSOL.padEnd(14)} │ ${token.allocationSOL.padEnd(14)} │ ${statusText}`
      );
    }
    console.log('  ' + '─'.repeat(70));
    console.log('');

    // Costs
    console.log(colors.bright + '  ESTIMATED COSTS' + colors.reset);
    console.log('  ' + '─'.repeat(70));
    console.log(
      `  TX Fees per Token     │ ${report.costs.estimatedTxFeesPerTokenSOL}`
    );
    console.log(
      `  Total Estimated Cost  │ ${report.costs.totalEstimatedCostSOL}`
    );
    console.log('');

    // Thresholds
    console.log(colors.bright + '  THRESHOLDS' + colors.reset);
    console.log('  ' + '─'.repeat(70));
    console.log(
      `  Min Secondary         │ ${report.thresholds.minAllocationSecondarySOL} (allocation after split)`
    );
    console.log(`  Min Root              │ ${report.thresholds.minAllocationRootSOL}`);
    console.log('');

    // Warnings
    if (report.warnings.length > 0) {
      console.log(
        colors.yellow + colors.bright + '  ⚠️  WARNINGS' + colors.reset
      );
      console.log('  ' + '─'.repeat(70));
      for (const warning of report.warnings) {
        console.log(colors.yellow + `  - ${warning}` + colors.reset);
      }
      console.log('');
    }

    // Recommendations
    if (report.recommendations.length > 0) {
      console.log(
        colors.cyan + colors.bright + '  💡 RECOMMENDATIONS' + colors.reset
      );
      console.log('  ' + '─'.repeat(70));
      for (const rec of report.recommendations) {
        console.log(colors.cyan + `  - ${rec}` + colors.reset);
      }
      console.log('');
    }

    console.log(colors.bright + colors.cyan);
    console.log(
      '══════════════════════════════════════════════════════════════════════════════'
    );
    console.log(colors.reset);
  }
}
