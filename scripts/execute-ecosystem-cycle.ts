/**
 * Flush Orchestrator
 *
 * Optimistic Burn Protocol - executes the complete flush cycle:
 * Collect fees → Buy tokens → Burn → Verify
 *
 * Flow:
 * 1. Query pending_fees from all TokenStats
 * 2. Collect fees from shared creator vault
 * 3. Calculate proportional distribution (55.2% secondary / 44.8% root)
 * 4. Execute buyback for each token with allocated amount
 * 5. Burn acquired tokens
 * 6. Update on-chain state (reset pending_fees, increment cycles)
 *
 * Usage:
 *   npx ts-node scripts/execute-ecosystem-cycle.ts [options]
 *
 * Options:
 *   --network devnet|mainnet   Select network (default: devnet)
 *   --dry-run                  Preview without executing
 *
 * Requirements:
 *   - TokenStats initialized for all tokens
 *   - Root token configured (set_root_token)
 *   - Fee daemon running (to populate pending_fees)
 *
 * Verify on-chain: all burns recorded, supply reduced, cycle count incremented.
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction, ComputeBudgetProgram, TransactionInstruction, Commitment } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet, BN, Idl } from '@coral-xyz/anchor';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAccount } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import { getNetworkConfig, parseNetworkArg, printNetworkBanner, NetworkConfig, getCommitment, isMainnet } from '../lib/network-config';
import {
  getBcCreatorVault,
  getAmmCreatorVaultAta,
  deriveAmmCreatorVaultAuthority,
} from '../lib/amm-utils';
import { DATState, TokenStats, getTypedAccounts } from '../lib/types';
import { withRetryAndTimeout, confirmTransactionWithRetry, sleep as rpcSleep } from '../lib/rpc-utils';
import { ExecutionLock, LockError } from '../lib/execution-lock';
import { getAlerting, initAlerting, CycleSummary } from '../lib/alerting';
import { validateAlertingEnv } from '../lib/env-validator';
import {
  deriveRebatePoolPda,
  deriveUserStatsPda,
  getEligibleUsers,
  selectUserForRebate,
  calculateRebateAmount,
} from '../lib/user-pool';
import { getAssociatedTokenAddress } from '@solana/spl-token';

// ============================================================================
// Constants & Configuration
// ============================================================================

const PROGRAM_ID = new PublicKey('ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui');
const DAT_STATE_SEED = Buffer.from('dat_v3');
const DAT_AUTHORITY_SEED = Buffer.from('auth_v3');
const TOKEN_STATS_SEED = Buffer.from('token_stats_v1');
const ROOT_TREASURY_SEED = Buffer.from('root_treasury');
const USER_STATS_SEED = Buffer.from('user_stats_v1');
const REBATE_POOL_SEED = Buffer.from('rebate_pool');

// PumpFun Bonding Curve Program
const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMP_GLOBAL_CONFIG = new PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf');
const PUMP_EVENT_AUTHORITY = new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1');
const FEE_PROGRAM = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// PumpSwap AMM Program (for migrated tokens)
const PUMP_SWAP_PROGRAM = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const PUMPSWAP_GLOBAL_CONFIG = new PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf');
const PUMPSWAP_EVENT_AUTHORITY = new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1');
const PUMPSWAP_PROTOCOL_FEE_RECIPIENT = new PublicKey('6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs');
const PUMPSWAP_GLOBAL_VOLUME_ACCUMULATOR = new PublicKey('Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y');
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

// Dev sustainability wallet - receives 1% of secondary burns
// 1% today = 99% burns forever
const DEV_WALLET = new PublicKey('dcW5uy7wKdKFxkhyBfPv3MyvrCkDcv1rWucoat13KH4');
const DEV_FEE_BPS = 100; // 1%

// ============================================================================
// Scalability Constants (aligned with lib.rs execute_buy)
// ============================================================================
// These values must match the on-chain constants for proper allocation validation
const RENT_EXEMPT_MINIMUM = 890_880;      // ~0.00089 SOL
const SAFETY_BUFFER = 50_000;             // ~0.00005 SOL
const ATA_RENT_RESERVE = 2_100_000;       // ~0.0021 SOL (for secondary ATA creation)
const MINIMUM_BUY_AMOUNT = 100_000;       // ~0.0001 SOL

// Fee split ratio: Secondary tokens send 44.8% to root, keeping 55.2% (fee_split_bps = 5520)
const SECONDARY_KEEP_RATIO = 0.552;

// Minimum allocation required per token type
const MIN_ALLOCATION_ROOT = RENT_EXEMPT_MINIMUM + SAFETY_BUFFER + MINIMUM_BUY_AMOUNT;
// = 890,880 + 50,000 + 100,000 = 1,040,880 lamports (~0.00104 SOL)

// CRITICAL FIX: MIN_ALLOCATION_SECONDARY must account for the 44.8% split to root treasury
// The allocated amount must be large enough that AFTER the split, there's enough for rent+buffer+ata+min_buy
const MIN_AFTER_SPLIT = RENT_EXEMPT_MINIMUM + SAFETY_BUFFER + ATA_RENT_RESERVE + MINIMUM_BUY_AMOUNT;
// = 890,880 + 50,000 + 2,100,000 + 100,000 = 3,140,880 lamports

const MIN_ALLOCATION_SECONDARY = Math.ceil(MIN_AFTER_SPLIT / SECONDARY_KEEP_RATIO);
// = 3,140,880 / 0.552 = 5,690,000 lamports (~0.00569 SOL)

// TX Fee reserve: Each secondary cycle requires buy + finalize + burn = 3 TX
// On devnet with compute budget: ~0.006-0.007 SOL total
const TX_FEE_RESERVE_PER_TOKEN = 7_000_000; // ~0.007 SOL for TX fees

// MIN_CYCLE_INTERVAL: Must match lib.rs MIN_CYCLE_INTERVAL (60 seconds)
// The program enforces this cooldown between cycles
const MIN_CYCLE_INTERVAL_SECONDS = 60;

// Total actual cost per secondary token (allocation + TX fees)
const TOTAL_COST_PER_SECONDARY = MIN_ALLOCATION_SECONDARY + TX_FEE_RESERVE_PER_TOKEN;
// = 5,690,000 + 7,000,000 = 12,690,000 lamports (~0.0127 SOL)

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

// ============================================================================
// Types & Interfaces
// ============================================================================

// Pool type determines which CPI instruction to use
type PoolType = 'bonding_curve' | 'pumpswap_amm';

interface TokenConfig {
  file: string;
  symbol: string;
  mint: PublicKey;
  bondingCurve: PublicKey;  // For bonding_curve: the bonding curve address. For AMM: the pool address.
  creator: PublicKey;
  isRoot: boolean;
  isToken2022: boolean;
  poolType: PoolType;       // Determines bonding curve vs PumpSwap AMM
}

interface TokenAllocation {
  token: TokenConfig;
  pendingFees: number;
  allocation: number;
  isRoot: boolean;
}

interface CycleResult {
  token: string;
  success: boolean;
  pendingFees?: number;
  allocation?: number;
  buyTx?: string;
  finalizeTx?: string;
  burnTx?: string;
  tokensBurned?: number;
  error?: string;
}

// Dry-run report structure
interface DryRunReport {
  timestamp: string;
  network: 'devnet' | 'mainnet';
  status: 'READY' | 'INSUFFICIENT_FEES' | 'COOLDOWN_ACTIVE' | 'NO_TOKENS';

  ecosystem: {
    totalPendingFees: number;      // lamports
    totalPendingFeesSOL: string;   // formatted
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

// ============================================================================
// Dry-Run Functions
// ============================================================================

/**
 * Generate a dry-run report based on current allocations
 */
function generateDryRunReport(
  allocations: TokenAllocation[],
  networkName: string,
  rootToken: TokenConfig | undefined
): DryRunReport {
  const secondaries = allocations.filter(a => !a.isRoot);
  const rootAlloc = allocations.find(a => a.isRoot);
  const totalPending = secondaries.reduce((sum, a) => sum + a.pendingFees, 0);

  // Calculate preliminary allocations (simulate normalizeAllocations logic)
  const ratio = totalPending > 0 ? 1.0 : 0; // Assume 100% collection for preview
  const preliminary = secondaries.map(alloc => ({
    ...alloc,
    allocation: Math.floor(alloc.pendingFees * ratio),
  }));

  const viable = preliminary.filter(a => a.allocation >= MIN_ALLOCATION_SECONDARY);
  const deferred = preliminary.filter(a => a.allocation < MIN_ALLOCATION_SECONDARY && a.pendingFees > 0);

  // Build warnings
  const warnings: string[] = [];
  const recommendations: string[] = [];

  for (const d of deferred) {
    warnings.push(`${d.token.symbol} will be deferred (${formatSOL(d.allocation)} < ${formatSOL(MIN_ALLOCATION_SECONDARY)} minimum)`);
  }

  if (totalPending === 0) {
    warnings.push('No pending fees detected - run daemon or wait for fee accumulation');
    recommendations.push('Start the fee monitor daemon: npx ts-node scripts/monitor-ecosystem-fees.ts');
  }

  if (viable.length === 0 && secondaries.length > 0) {
    recommendations.push('Generate more volume to accumulate fees above threshold');
    recommendations.push(`Target: ${formatSOL(MIN_ALLOCATION_SECONDARY)} SOL per token minimum`);
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
      deferReason: !isViable && alloc.pendingFees > 0
        ? `Below minimum (${formatSOL(alloc.allocation)} < ${formatSOL(MIN_ALLOCATION_SECONDARY)})`
        : undefined,
    });
  }

  // Add root token
  if (rootAlloc) {
    // Root gets 44.8% of all secondary fees
    const rootReceived = Math.floor(viable.reduce((sum, v) => sum + v.allocation, 0) * 0.448);
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
      totalPendingFeesSOL: formatSOL(totalPending + (rootAlloc?.pendingFees || 0)),
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
function printDryRunSummary(report: DryRunReport): void {
  const statusEmoji = {
    READY: '✅',
    INSUFFICIENT_FEES: '⚠️',
    COOLDOWN_ACTIVE: '⏳',
    NO_TOKENS: '❌',
  };

  const networkBanner = report.network === 'mainnet' ? colors.red + 'MAINNET' : colors.green + 'DEVNET';

  console.log('\n' + colors.bright + colors.cyan);
  console.log('══════════════════════════════════════════════════════════════════════════════');
  console.log('  DRY RUN - Ecosystem Cycle Preview (' + networkBanner + colors.cyan + colors.bright + ')');
  console.log('══════════════════════════════════════════════════════════════════════════════');
  console.log(colors.reset + '\n');

  console.log(`  Status: ${statusEmoji[report.status]} ${report.status}\n`);

  // Ecosystem overview
  console.log(colors.bright + '  ECOSYSTEM OVERVIEW' + colors.reset);
  console.log('  ' + '─'.repeat(70));
  console.log(`  Total Pending Fees    │ ${report.ecosystem.totalPendingFeesSOL}`);
  console.log(`  Tokens Eligible       │ ${report.ecosystem.tokensEligible} / ${report.ecosystem.tokensTotal}`);
  console.log(`  Tokens Deferred       │ ${report.ecosystem.tokensDeferred}`);
  console.log('');

  // Token allocations table
  console.log(colors.bright + '  TOKEN ALLOCATIONS' + colors.reset);
  console.log('  ' + '─'.repeat(70));
  console.log(`  ${'Symbol'.padEnd(10)} │ ${'Pending'.padEnd(14)} │ ${'Allocation'.padEnd(14)} │ ${'Status'.padEnd(12)}`);
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
  console.log(`  TX Fees per Token     │ ${report.costs.estimatedTxFeesPerTokenSOL}`);
  console.log(`  Total Estimated Cost  │ ${report.costs.totalEstimatedCostSOL}`);
  console.log('');

  // Thresholds
  console.log(colors.bright + '  THRESHOLDS' + colors.reset);
  console.log('  ' + '─'.repeat(70));
  console.log(`  Min Secondary         │ ${report.thresholds.minAllocationSecondarySOL} (allocation after split)`);
  console.log(`  Min Root              │ ${report.thresholds.minAllocationRootSOL}`);
  console.log('');

  // Warnings
  if (report.warnings.length > 0) {
    console.log(colors.yellow + colors.bright + '  ⚠️  WARNINGS' + colors.reset);
    console.log('  ' + '─'.repeat(70));
    for (const warning of report.warnings) {
      console.log(colors.yellow + `  - ${warning}` + colors.reset);
    }
    console.log('');
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    console.log(colors.cyan + colors.bright + '  💡 RECOMMENDATIONS' + colors.reset);
    console.log('  ' + '─'.repeat(70));
    for (const rec of report.recommendations) {
      console.log(colors.cyan + `  - ${rec}` + colors.reset);
    }
    console.log('');
  }

  console.log(colors.bright + colors.cyan);
  console.log('══════════════════════════════════════════════════════════════════════════════');
  console.log(colors.reset);
}

// ============================================================================
// Helper Functions
// ============================================================================

function log(icon: string, message: string, color = colors.reset) {
  console.log(`${color}${icon} ${message}${colors.reset}`);
}

function logSection(title: string) {
  console.log(`\n${colors.bright}${colors.cyan}${'='.repeat(80)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(80)}${colors.reset}\n`);
}

function formatSOL(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(6);
}

// Use sleep from rpc-utils (imported as rpcSleep)
const sleep = rpcSleep;

/**
 * Validate wallet file format and return keypair
 * Throws descriptive error if file is invalid
 */
function loadAndValidateWallet(walletPath: string): Keypair {
  if (!fs.existsSync(walletPath)) {
    throw new Error(`Wallet file not found: ${walletPath}`);
  }

  let walletData: unknown;
  try {
    const fileContent = fs.readFileSync(walletPath, 'utf-8');
    walletData = JSON.parse(fileContent);
  } catch (error) {
    throw new Error(`Invalid wallet JSON: ${(error as Error).message}`);
  }

  // Validate it's an array of numbers
  if (!Array.isArray(walletData)) {
    throw new Error(`Invalid wallet format: Expected array of numbers, got ${typeof walletData}`);
  }

  // Validate array length (64 bytes for secret key)
  if (walletData.length !== 64) {
    throw new Error(`Invalid wallet format: Expected 64 bytes, got ${walletData.length}`);
  }

  // Validate all elements are numbers in valid range (0-255)
  for (let i = 0; i < walletData.length; i++) {
    const val = walletData[i];
    if (typeof val !== 'number' || !Number.isInteger(val) || val < 0 || val > 255) {
      throw new Error(`Invalid wallet format: Element at index ${i} is not a valid byte (0-255)`);
    }
  }

  try {
    return Keypair.fromSecretKey(new Uint8Array(walletData));
  } catch (error) {
    throw new Error(`Invalid keypair: ${(error as Error).message}`);
  }
}

/**
 * Check MIN_CYCLE_INTERVAL and wait if necessary
 * The program enforces a cooldown between cycles - this function checks it upfront
 * and waits if needed, rather than letting the TX fail with CycleTooSoon
 */
async function waitForCycleCooldown(program: Program<Idl>): Promise<void> {
  const [datState] = PublicKey.findProgramAddressSync([DAT_STATE_SEED], program.programId);
  const state = await getTypedAccounts(program).datState.fetch(datState);

  const lastCycleTimestamp = state.lastCycleTimestamp.toNumber();
  const minCycleInterval = state.minCycleInterval.toNumber();

  // CRITICAL FIX: Use Solana clock instead of local time
  // The program uses Clock::get()?.unix_timestamp, so we must match it
  const connection = program.provider.connection;
  const slot = await connection.getSlot();
  const blockTime = await connection.getBlockTime(slot);
  const currentTime = blockTime || Math.floor(Date.now() / 1000);

  const timeSinceLastCycle = currentTime - lastCycleTimestamp;
  // Add 2s buffer to account for clock drift between check and TX execution
  const waitTime = minCycleInterval - timeSinceLastCycle + 2;

  if (waitTime > 0) {
    log('⏳', `Cycle cooldown active. Last cycle: ${new Date(lastCycleTimestamp * 1000).toISOString()}`, colors.yellow);
    log('⏳', `Waiting ${waitTime}s for MIN_CYCLE_INTERVAL (${minCycleInterval}s)...`, colors.yellow);

    // Wait with progress updates every 10 seconds
    let remaining = waitTime;
    while (remaining > 0) {
      const waitChunk = Math.min(remaining, 10);
      await sleep(waitChunk * 1000);
      remaining -= waitChunk;
      if (remaining > 0) {
        log('⏳', `${remaining}s remaining...`, colors.yellow);
      }
    }
    log('✅', 'Cooldown complete. Proceeding with cycle execution.', colors.green);
  } else {
    log('✅', `Cycle cooldown OK (${timeSinceLastCycle}s since last cycle, min: ${minCycleInterval}s)`, colors.green);
  }
}

/**
 * Flush result interface from daemon API
 */
interface FlushResult {
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

/**
 * Trigger daemon flush to ensure all pending fees are written on-chain
 * This solves the race condition between daemon detection and cycle execution
 * @returns FlushResult with detailed status, or null if daemon not available
 */
async function triggerDaemonFlush(): Promise<FlushResult | null> {
  const DAEMON_API_PORT = parseInt(process.env.DAEMON_API_PORT || '3030');
  const DAEMON_API_URL = `http://localhost:${DAEMON_API_PORT}/flush`;
  const DAEMON_API_KEY = process.env.DAEMON_API_KEY || '';
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 2000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      log('🔄', `Triggering daemon flush (attempt ${attempt}/${MAX_RETRIES})...`, colors.cyan);

      // Build headers with optional API key authentication
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
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
        result = await response.json() as FlushResult;
      } catch (parseError) {
        throw new Error(`Invalid JSON response from daemon: ${(parseError as Error).message}`);
      }

      // Check if all tokens were flushed successfully
      if (result.success) {
        log('✅', `Daemon flush completed: ${result.tokensUpdated} tokens updated, ${(result.totalFlushed / 1e9).toFixed(6)} SOL flushed`, colors.green);
      } else if (result.tokensFailed > 0) {
        log('⚠️', `Partial flush: ${result.tokensUpdated} succeeded, ${result.tokensFailed} failed. Remaining: ${(result.remainingPending / 1e9).toFixed(6)} SOL`, colors.yellow);
        // Log failed tokens
        result.details?.filter(d => !d.success).forEach(d => {
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
        log('⚠️', 'Daemon not running - proceeding with on-chain pending_fees', colors.yellow);
        return null;
      }

      if (attempt < MAX_RETRIES) {
        log('⚠️', `Flush attempt ${attempt} failed: ${errorMsg}. Retrying in ${RETRY_DELAY_MS}ms...`, colors.yellow);
        await sleep(RETRY_DELAY_MS);
      } else {
        log('⚠️', `All ${MAX_RETRIES} flush attempts failed: ${errorMsg}`, colors.yellow);
        return null;
      }
    }
  }

  return null;
}

// ============================================================================
// Scalability Validation
// ============================================================================

interface EcosystemValidation {
  canProceed: boolean;
  secondaryCount: number;
  minRequired: number;
  available: number;
  message: string;
}

/**
 * Pre-flight validation to check if collected fees are sufficient for all tokens
 * This is an early warning system before attempting distribution
 */
function validateMinimumEcosystemFees(
  tokens: TokenConfig[],
  totalPending: number
): EcosystemValidation {
  const secondaryCount = tokens.filter(t => !t.isRoot).length;
  const minRequired = secondaryCount * MIN_ALLOCATION_SECONDARY;

  if (totalPending < minRequired) {
    return {
      canProceed: false,
      secondaryCount,
      minRequired,
      available: totalPending,
      message: `Pending fees (${formatSOL(totalPending)} SOL) < minimum required (${formatSOL(minRequired)} SOL) for ${secondaryCount} secondary tokens`
    };
  }

  return {
    canProceed: true,
    secondaryCount,
    minRequired,
    available: totalPending,
    message: `OK: ${formatSOL(totalPending)} SOL >= ${formatSOL(minRequired)} SOL minimum for ${secondaryCount} tokens`
  };
}

/**
 * Calculate minimum SOL needed for ecosystem with N secondary tokens
 */
function calculateMinimumEcosystemFees(secondaryCount: number): number {
  return secondaryCount * MIN_ALLOCATION_SECONDARY;
}

// ============================================================================
// Daemon Synchronization (Scalability Fix)
// ============================================================================

/**
 * Wait for validator daemon to sync all secondary tokens' pending_fees
 * This ensures all tokens have their fees registered before the cycle executes
 *
 * @param program - Anchor program instance
 * @param tokens - Array of token configs to check
 * @param maxWaitMs - Maximum time to wait (default 60s)
 * @returns true if all tokens have pending_fees > 0, false if timeout
 */
async function waitForDaemonSync(
  program: Program,
  tokens: TokenConfig[],
  maxWaitMs: number = 60000
): Promise<{ synced: boolean; tokensWithFees: string[]; tokensWithoutFees: string[] }> {
  logSection('PRE-FLIGHT: DAEMON SYNCHRONIZATION CHECK');

  const secondaryTokens = tokens.filter(t => !t.isRoot);
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

        const tokenStats = await getTypedAccounts(program).tokenStats.fetch(tokenStatsPDA);
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
      log('✅', `All ${secondaryTokens.length} secondary tokens have pending fees`, colors.green);
      for (const symbol of tokensWithFees) {
        log('  ✓', `${symbol}: pending_fees > 0`, colors.green);
      }
      return { synced: true, tokensWithFees, tokensWithoutFees };
    }

    if (iteration === 1) {
      log('⏳', `Waiting for daemon to sync ${tokensWithoutFees.length} token(s)...`, colors.yellow);
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
      const tokenStats = await getTypedAccounts(program).tokenStats.fetch(tokenStatsPDA);
      if (tokenStats.pendingFeesLamports.toNumber() > 0) {
        finalTokensWithFees.push(token.symbol);
      } else {
        finalTokensWithoutFees.push(token.symbol);
      }
    } catch {
      finalTokensWithoutFees.push(token.symbol);
    }
  }

  log('⚠️', `Timeout after ${maxWaitMs / 1000}s - proceeding with ${finalTokensWithFees.length}/${secondaryTokens.length} tokens`, colors.yellow);
  if (finalTokensWithoutFees.length > 0) {
    log('ℹ️', `Tokens without pending fees will be DEFERRED: ${finalTokensWithoutFees.join(', ')}`, colors.cyan);
  }

  return { synced: false, tokensWithFees: finalTokensWithFees, tokensWithoutFees: finalTokensWithoutFees };
}

// ============================================================================
// Token Configuration Loader
// ============================================================================

async function loadEcosystemTokens(connection: Connection, networkConfig: NetworkConfig): Promise<TokenConfig[]> {
  // Get token files from network config
  const tokenFiles = networkConfig.tokens;

  const tokens: TokenConfig[] = [];

  for (const file of tokenFiles) {
    const filePath = path.join(__dirname, '..', file);

    if (!fs.existsSync(filePath)) {
      log('⚠️', `Token file not found: ${file}`, colors.yellow);
      continue;
    }

    try {
      const tokenData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      // Read poolType from JSON, default to 'bonding_curve' if not specified
      const poolType: PoolType = tokenData.poolType === 'pumpswap_amm' ? 'pumpswap_amm' : 'bonding_curve';
      // Determine if root from JSON data
      const isRoot = tokenData.isRoot === true;
      // Determine token program from JSON or filename
      const isToken2022 = tokenData.tokenProgram === 'Token2022' || tokenData.mayhemMode === true;

      tokens.push({
        file,
        symbol: tokenData.symbol || tokenData.name || 'UNKNOWN',
        mint: new PublicKey(tokenData.mint),
        bondingCurve: new PublicKey(tokenData.bondingCurve || tokenData.pool),
        creator: new PublicKey(tokenData.creator),
        isRoot,
        isToken2022,
        poolType,
      });
      const poolIcon = poolType === 'pumpswap_amm' ? '🔄' : '📈';
      log('✓', `Loaded ${tokenData.symbol || tokenData.name} from ${file} (${poolIcon} ${poolType})`, colors.green);
    } catch (error) {
      log('❌', `Failed to load ${file}: ${(error as Error).message || String(error)}`, colors.red);
    }
  }

  if (tokens.length === 0) {
    throw new Error('No tokens loaded. Ensure token config files exist.');
  }

  // Verify we have exactly one root token
  const rootTokens = tokens.filter(t => t.isRoot);
  if (rootTokens.length === 0) {
    throw new Error('No root token found in configuration. Ensure at least one token has "isRoot": true');
  }
  if (rootTokens.length > 1) {
    throw new Error('Multiple root tokens found. Only one root token is allowed.');
  }

  log('📊', `Loaded ${tokens.length} tokens: ${rootTokens.length} root, ${tokens.length - 1} secondary`, colors.cyan);
  return tokens;
}

// ============================================================================
// Step 1: Query Pending Fees
// ============================================================================

async function queryPendingFees(
  program: Program,
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
      log('ℹ️', `${token.symbol} (ROOT): Skipped (will collect from root treasury)`, colors.cyan);
      continue;
    }

    try {
      // Derive TokenStats PDA
      const [tokenStatsPDA] = PublicKey.findProgramAddressSync(
        [TOKEN_STATS_SEED, token.mint.toBuffer()],
        program.programId
      );

      // Fetch TokenStats account
      const tokenStats = await getTypedAccounts(program).tokenStats.fetch(tokenStatsPDA);

      const pendingFees = tokenStats.pendingFeesLamports.toNumber();

      allocations.push({
        token,
        pendingFees,
        allocation: 0, // Will be calculated in next step
        isRoot: false,
      });

      log('💰', `${token.symbol}: ${formatSOL(pendingFees)} SOL pending (${pendingFees} lamports)`,
        pendingFees > 0 ? colors.green : colors.yellow);

    } catch (error) {
      log('❌', `${token.symbol}: Failed to query pending fees - ${(error as Error).message || String(error)}`, colors.red);
      throw error;
    }
  }

  // Calculate total pending fees
  const totalPending = allocations
    .filter(a => !a.isRoot)
    .reduce((sum, a) => sum + a.pendingFees, 0);

  log('📊', `Total pending fees: ${formatSOL(totalPending)} SOL (${totalPending} lamports)`, colors.bright);

  if (totalPending === 0) {
    log('⚠️', 'No pending fees found. Ensure fee monitoring is running and has accumulated fees.', colors.yellow);
  }

  return allocations;
}

// ============================================================================
// Step 2: Collect All SECONDARY Vault Fees
// ============================================================================

async function collectAllSecondaryVaultFees(
  program: Program,
  secondaryTokens: TokenConfig[],
  rootMint: PublicKey,
  adminKeypair: Keypair
): Promise<number> {
  logSection('STEP 2: COLLECT FEES FROM SECONDARY VAULTS');

  const [datState] = PublicKey.findProgramAddressSync([DAT_STATE_SEED], program.programId);
  const [datAuthority] = PublicKey.findProgramAddressSync([DAT_AUTHORITY_SEED], program.programId);

  // Derive root treasury PDA (needed for collect_fees)
  const [rootTreasury] = PublicKey.findProgramAddressSync(
    [ROOT_TREASURY_SEED, rootMint.toBuffer()],
    program.programId
  );

  // Derive pump event authority
  const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('__event_authority')],
    PUMP_PROGRAM
  );

  let totalCollected = 0;

  for (const token of secondaryTokens) {
    const creator = token.creator;
    const isAmm = token.poolType === 'pumpswap_amm';

    const [tokenStats] = PublicKey.findProgramAddressSync(
      [TOKEN_STATS_SEED, token.mint.toBuffer()],
      program.programId
    );

    // Derive vault based on pool type
    let creatorVault: PublicKey;
    let creatorVaultAuthority: PublicKey | null = null;

    if (isAmm) {
      const [vaultAuth] = deriveAmmCreatorVaultAuthority(creator);
      creatorVaultAuthority = vaultAuth;
      creatorVault = getAmmCreatorVaultAta(creator);
    } else {
      creatorVault = getBcCreatorVault(creator);
    }

    // Check vault balance
    let vaultBalance = 0;
    if (isAmm) {
      try {
        const vaultAccount = await getAccount(program.provider.connection, creatorVault);
        vaultBalance = Number(vaultAccount.amount);
      } catch {
        // Token account doesn't exist yet
      }
    } else {
      vaultBalance = await program.provider.connection.getBalance(creatorVault);
    }

    log('💰', `${token.symbol}: ${formatSOL(vaultBalance)} ${isAmm ? 'WSOL' : 'SOL'} in vault`, colors.cyan);

    if (vaultBalance === 0) {
      log('  ⏭️', `Skipping ${token.symbol} - vault empty`, colors.yellow);
      continue;
    }

    try {
      if (isAmm) {
        // AMM: collect_fees_amm + unwrap_wsol
        const [datWsolAccount] = PublicKey.findProgramAddressSync(
          [datAuthority.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), WSOL_MINT.toBuffer()],
          ASSOCIATED_TOKEN_PROGRAM
        );

        // Collect WSOL from AMM vault
        const tx1 = await program.methods
          .collectFeesAmm()
          .accounts({
            datState,
            tokenStats,
            tokenMint: token.mint,
            datAuthority,
            wsolMint: WSOL_MINT,
            datWsolAccount,
            creatorVaultAuthority: creatorVaultAuthority!,
            creatorVaultAta: creatorVault,
            pumpSwapProgram: PUMP_SWAP_PROGRAM,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([adminKeypair])
          .rpc();

        // Unwrap WSOL to native SOL
        const tx2 = await program.methods
          .unwrapWsol()
          .accounts({
            datState,
            datAuthority,
            datWsolAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([adminKeypair])
          .rpc();

        log('  ✅', `${token.symbol}: Collected ${formatSOL(vaultBalance)} SOL (from WSOL)`, colors.green);
        totalCollected += vaultBalance;

      } else {
        // Bonding Curve: collect_fees with for_ecosystem=true
        const tx = await program.methods
          .collectFees(false, true) // is_root_token=false, for_ecosystem=true
          .accounts({
            datState,
            tokenStats,
            tokenMint: token.mint,
            datAuthority,
            creatorVault,
            pumpEventAuthority,
            pumpSwapProgram: PUMP_PROGRAM,
            rootTreasury,
            systemProgram: SystemProgram.programId,
          })
          .signers([adminKeypair])
          .rpc();

        // Check vault balance after collection
        const vaultBalanceAfter = await program.provider.connection.getBalance(creatorVault);
        const collected = vaultBalance - vaultBalanceAfter;

        log('  ✅', `${token.symbol}: Collected ${formatSOL(collected)} SOL`, colors.green);
        totalCollected += collected;
      }

    } catch (error) {
      log('  ❌', `${token.symbol}: Failed - ${(error as Error).message?.slice(0, 100) || String(error)}`, colors.red);
    }
  }

  log('💸', `Total collected from secondaries: ${formatSOL(totalCollected)} SOL`, colors.bright);
  return totalCollected;
}

// ============================================================================
// Step 3: Normalize Allocations (Scalable Version)
// ============================================================================

interface ScalableAllocationResult {
  viable: TokenAllocation[];
  skipped: TokenAllocation[];
  ratio: number;
}

function normalizeAllocations(
  allocations: TokenAllocation[],
  actualCollected: number
): ScalableAllocationResult {
  logSection('STEP 3: CALCULATE PROPORTIONAL DISTRIBUTION (SCALABLE)');

  const secondaries = allocations.filter(a => !a.isRoot);
  const totalPending = secondaries.reduce((sum, a) => sum + a.pendingFees, 0);

  if (totalPending === 0) {
    log('⚠️', 'No pending fees to distribute', colors.yellow);
    return { viable: [], skipped: [], ratio: 0 };
  }

  const ratio = actualCollected / totalPending;

  log('📊', `Total pending: ${formatSOL(totalPending)} SOL`, colors.cyan);
  log('💰', `Actual collected: ${formatSOL(actualCollected)} SOL`, colors.cyan);
  log('📐', `Distribution ratio: ${ratio.toFixed(6)}`, ratio >= 0.95 ? colors.green : colors.yellow);
  log('🔒', `Min allocation per secondary: ${formatSOL(MIN_ALLOCATION_SECONDARY)} SOL`, colors.cyan);

  if (ratio < 0.95) {
    log('⚠️', 'Collected amount is significantly less than pending fees', colors.yellow);
    log('ℹ️', 'This can happen if fees were spent or if pending_fees tracking is out of sync', colors.cyan);
  }

  // Phase 1: Calculate preliminary allocation for each secondary token
  const preliminary = secondaries.map(alloc => ({
    ...alloc,
    allocation: Math.floor(alloc.pendingFees * ratio),
  }));

  // Phase 2: Filter tokens that meet minimum allocation requirements
  const viable = preliminary.filter(a => a.allocation >= MIN_ALLOCATION_SECONDARY);
  const skipped = preliminary.filter(a => a.allocation < MIN_ALLOCATION_SECONDARY);

  // Phase 3: Redistribute skipped allocations to viable tokens proportionally
  if (viable.length > 0 && skipped.length > 0) {
    const skippedTotal = skipped.reduce((sum, a) => sum + a.allocation, 0);
    const viableTotal = viable.reduce((sum, a) => sum + a.allocation, 0);

    if (viableTotal > 0) {
      // Redistribute proportionally based on each viable token's share
      const redistributionRatio = (viableTotal + skippedTotal) / viableTotal;
      viable.forEach(a => {
        a.allocation = Math.floor(a.allocation * redistributionRatio);
      });
      log('🔄', `Redistributed ${formatSOL(skippedTotal)} SOL from ${skipped.length} deferred tokens`, colors.cyan);
    }
  }

  // Display allocation table with status
  console.log('\n' + colors.bright + 'Token Allocations:' + colors.reset);
  console.log('─'.repeat(90));
  console.log(`${'Token'.padEnd(12)} ${'Pending Fees'.padEnd(18)} ${'Allocated'.padEnd(18)} ${'Min Required'.padEnd(18)} ${'Status'.padEnd(12)}`);
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
    log('ℹ️', `${skipped.length} token(s) deferred - will accumulate and process in next cycle:`, colors.yellow);
    for (const s of skipped) {
      log('⏭️', `${s.token.symbol}: ${formatSOL(s.allocation)} SOL < ${formatSOL(MIN_ALLOCATION_SECONDARY)} SOL minimum`, colors.yellow);
    }
  }

  // Summary
  console.log('');
  log('📊', `Viable tokens: ${viable.length}/${secondaries.length}`, viable.length > 0 ? colors.green : colors.yellow);
  if (viable.length > 0) {
    const totalViableAllocation = viable.reduce((sum, a) => sum + a.allocation, 0);
    log('💰', `Total viable allocation: ${formatSOL(totalViableAllocation)} SOL`, colors.green);
  }

  return { viable, skipped, ratio };
}

// ============================================================================
// Step 4: Execute Secondary Cycles with DYNAMIC Allocation
// ============================================================================

/**
 * Get the actual datAuthority balance
 */
async function getDatAuthorityBalance(connection: Connection, programId: PublicKey): Promise<number> {
  const [datAuthority] = PublicKey.findProgramAddressSync([DAT_AUTHORITY_SEED], programId);
  const balance = await connection.getBalance(datAuthority);
  return balance;
}

/**
 * Get the vault balance for a token (N+1 pattern: fees are still in vault)
 */
async function getTokenVaultBalance(connection: Connection, token: TokenConfig): Promise<number> {
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

/**
 * Calculate dynamic allocation based on actual remaining balance
 * CRITICAL: Reserves minimum allocations for remaining tokens before calculating current allocation
 * This ensures all tokens can be processed if there's enough total balance
 */
function calculateDynamicAllocation(
  availableBalance: number,
  tokenPendingFees: number,
  totalRemainingPending: number,
  numRemainingTokens: number
): { allocation: number; viable: boolean; reason: string } {
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
      reason: `No balance after reserving ${formatSOL(totalReserved)} (${otherTokensCount} other tokens)`
    };
  }

  // Check if we have enough for minimum allocation
  if (distributable < MIN_ALLOCATION_SECONDARY) {
    return {
      allocation: distributable,
      viable: false,
      reason: `Available ${formatSOL(distributable)} < minimum ${formatSOL(MIN_ALLOCATION_SECONDARY)}`
    };
  }

  // Calculate proportional allocation from distributable (what's left after reservations)
  // This token gets its fair share based on pending_fees ratio
  const pendingRatio = totalRemainingPending > 0 ? tokenPendingFees / totalRemainingPending : 1 / numRemainingTokens;

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
 * Execute secondary tokens with SHARED VAULT support
 *
 * ARCHITECTURE: All tokens share the SAME creator vault (single creator = single vault)
 *
 * Flow:
 * 1. Check shared vault balance ONCE
 * 2. Calculate proportional allocations based on pending_fees ratio
 * 3. First token: collect (drains vault to datAuthority) + buy (with its SHARE only)
 * 4. Other tokens: collect (vault empty, no-op) + buy (from remaining datAuthority balance)
 * 5. All collected fees are used for buyback & burn (100%)
 */
async function executeSecondaryTokensDynamic(
  program: Program,
  connection: Connection,
  secondaryAllocations: TokenAllocation[],
  adminKeypair: Keypair
): Promise<{ results: { [key: string]: CycleResult }; viable: TokenAllocation[]; deferred: TokenAllocation[] }> {
  logSection('STEP 2: EXECUTE SECONDARY TOKEN CYCLES (SHARED VAULT N+1)');

  const results: { [key: string]: CycleResult } = {};
  const viable: TokenAllocation[] = [];
  const deferred: TokenAllocation[] = [];

  if (secondaryAllocations.length === 0) {
    return { results, viable, deferred };
  }

  // STEP 1: Check SHARED vault balance (all tokens use same creator = same vault)
  // Use first token to get the shared vault address
  const sharedVaultBalance = await getTokenVaultBalance(connection, secondaryAllocations[0].token);

  log('📊', `SHARED VAULT STATUS:`, colors.bright);
  log('  💰', `Total fees in shared vault: ${formatSOL(sharedVaultBalance)} SOL`, colors.cyan);
  log('  👥', `Secondary tokens to process: ${secondaryAllocations.length}`, colors.cyan);

  const MIN_FEES_FOR_SPLIT = 5_500_000; // 0.0055 SOL (program minimum)

  // STEP 2: Check if we have enough total fees for at least one token
  if (sharedVaultBalance < MIN_FEES_FOR_SPLIT) {
    log('⚠️', `Shared vault ${formatSOL(sharedVaultBalance)} < minimum ${formatSOL(MIN_FEES_FOR_SPLIT)} SOL`, colors.yellow);
    log('ℹ️', `All secondary tokens will be DEFERRED until more fees accumulate`, colors.cyan);

    for (const allocation of secondaryAllocations) {
      deferred.push(allocation);
      results[allocation.token.symbol] = {
        token: allocation.token.symbol,
        success: true, // Deferred is not a failure
        pendingFees: allocation.pendingFees,
        allocation: 0,
        error: `DEFERRED: Shared vault insufficient (${formatSOL(sharedVaultBalance)} SOL)`,
      };
    }
    return { results, viable, deferred };
  }

  // STEP 3: Calculate proportional allocations based on pending_fees
  // pending_fees comes from daemon tracking per-token trading activity
  const totalPending = secondaryAllocations.reduce((sum, a) => sum + a.pendingFees, 0);

  log('📐', `Calculating proportional distribution:`, colors.cyan);
  log('  📊', `Total tracked pending fees: ${formatSOL(totalPending)} SOL`, colors.cyan);

  // If no pending_fees tracked (daemon not running), distribute equally
  const useEqualDistribution = totalPending === 0;
  if (useEqualDistribution) {
    log('  ⚠️', `No pending_fees tracked - using equal distribution`, colors.yellow);
  }

  // Calculate each token's allocation from the shared vault
  const allocationsWithShare: Array<TokenAllocation & { calculatedShare: number; isViable: boolean }> = [];

  for (const allocation of secondaryAllocations) {
    let share: number;

    if (useEqualDistribution) {
      // Equal distribution when daemon hasn't tracked fees
      share = Math.floor(sharedVaultBalance / secondaryAllocations.length);
    } else {
      // Proportional distribution based on pending_fees ratio
      const ratio = allocation.pendingFees / totalPending;
      share = Math.floor(sharedVaultBalance * ratio);
    }

    const isViable = share >= MIN_FEES_FOR_SPLIT;

    allocationsWithShare.push({
      ...allocation,
      calculatedShare: share,
      isViable,
    });

    const statusIcon = isViable ? '✅' : '⏭️';
    const statusColor = isViable ? colors.green : colors.yellow;
    log(`  ${statusIcon}`, `${allocation.token.symbol}: ${formatSOL(share)} SOL (${useEqualDistribution ? 'equal' : ((allocation.pendingFees / totalPending * 100).toFixed(1) + '%')})`, statusColor);
  }

  // Sort by share descending - process largest allocations first
  const sorted = allocationsWithShare.sort((a, b) => b.calculatedShare - a.calculatedShare);

  console.log('');
  log('🔄', `Processing ${sorted.filter(a => a.isViable).length} viable tokens, deferring ${sorted.filter(a => !a.isViable).length}`, colors.bright);
  console.log('');

  // STEP 4: Execute each token's cycle
  // First token will collect from vault (drains it)
  // Subsequent tokens will collect from empty vault (no-op) but use remaining datAuthority balance
  let isFirstToken = true;

  for (const allocation of sorted) {
    if (!allocation.isViable) {
      // Token's share is below minimum - defer to next cycle
      log('⏭️', `${allocation.token.symbol} DEFERRED: share ${formatSOL(allocation.calculatedShare)} < ${formatSOL(MIN_FEES_FOR_SPLIT)} minimum`, colors.yellow);
      deferred.push(allocation);
      results[allocation.token.symbol] = {
        token: allocation.token.symbol,
        success: true, // Deferred is not a failure
        pendingFees: allocation.pendingFees,
        allocation: allocation.calculatedShare,
        error: `DEFERRED: Share below minimum`,
      };
      console.log('');
      continue;
    }

    // Update allocation with calculated share
    allocation.allocation = allocation.calculatedShare;

    // Wait for cooldown before processing (if not first token)
    // The program enforces MIN_CYCLE_INTERVAL globally between collect_fees calls
    if (!isFirstToken) {
      log('⏳', `Waiting for cooldown before ${allocation.token.symbol}...`, colors.yellow);
      await waitForCycleCooldown(program);
    }

    log('🔄', `Processing ${allocation.token.symbol}:`, colors.cyan);
    log('  💰', `Allocated share: ${formatSOL(allocation.calculatedShare)} SOL`, colors.cyan);
    if (isFirstToken) {
      log('  📦', `Will collect ${formatSOL(sharedVaultBalance)} SOL from shared vault`, colors.cyan);
    } else {
      log('  📦', `Vault already drained - using datAuthority balance`, colors.cyan);
    }

    // Execute the cycle (N+1: collect + buy + finalize + burn in single TX)
    const result = await executeSecondaryWithAllocation(program, allocation, adminKeypair);
    results[allocation.token.symbol] = result;

    if (result.success) {
      viable.push(allocation);
      isFirstToken = false; // Only first successful token drains the vault
    }

    console.log('');
  }

  return { results, viable, deferred };
}

async function executeSecondaryWithAllocation(
  program: Program,
  allocation: TokenAllocation,
  adminKeypair: Keypair
): Promise<CycleResult> {
  const result: CycleResult = {
    token: allocation.token.symbol,
    success: false,
    pendingFees: allocation.pendingFees,
    allocation: allocation.allocation,
  };

  // Validate allocation before proceeding
  if (!allocation.allocation || allocation.allocation <= 0) {
    log('⚠️', `${allocation.token.symbol}: Invalid allocation (${allocation.allocation || 0}) - skipping`, colors.yellow);
    return result;
  }

  try {
    log('🔄', `Processing ${allocation.token.symbol} (BATCH TX)...`, colors.cyan);

    // Derive all required PDAs
    const [datState] = PublicKey.findProgramAddressSync([DAT_STATE_SEED], program.programId);
    const [datAuthority] = PublicKey.findProgramAddressSync([DAT_AUTHORITY_SEED], program.programId);
    const [tokenStats] = PublicKey.findProgramAddressSync(
      [TOKEN_STATS_SEED, allocation.token.mint.toBuffer()],
      program.programId
    );

    // Get state to determine root token and other params
    const state = await getTypedAccounts(program).datState.fetch(datState);
    const rootMint = state.rootTokenMint;

    if (!rootMint) {
      throw new Error('Root token not configured in DAT state');
    }

    // Derive other required accounts
    // Use the token's creator (DAT Authority), NOT the admin wallet
    const creator = allocation.token.creator;
    const [creatorVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('creator-vault'), creator.toBuffer()],
      PUMP_PROGRAM
    );

    const tokenProgram = allocation.token.isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

    // Derive ATA for DAT authority
    const [datAsdfAccount] = PublicKey.findProgramAddressSync(
      [
        datAuthority.toBuffer(),
        tokenProgram.toBuffer(),
        allocation.token.mint.toBuffer(),
      ],
      new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL') // Associated Token Program
    );

    // Derive pool accounts
    const [poolAsdfAccount] = PublicKey.findProgramAddressSync(
      [
        allocation.token.bondingCurve.toBuffer(),
        tokenProgram.toBuffer(),
        allocation.token.mint.toBuffer(),
      ],
      new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
    );

    // Protocol fee recipient (different for Mayhem vs SPL)
    const MAYHEM_FEE_RECIPIENT = new PublicKey('GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS');
    const SPL_FEE_RECIPIENT = new PublicKey('6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs');

    const protocolFeeRecipient = allocation.token.isToken2022 ? MAYHEM_FEE_RECIPIENT : SPL_FEE_RECIPIENT;

    // Derive root treasury PDA (required for secondary tokens)
    const [rootTreasury] = PublicKey.findProgramAddressSync(
      [ROOT_TREASURY_SEED, rootMint.toBuffer()],
      program.programId
    );

    // Build instructions array for batch transaction
    const instructions: TransactionInstruction[] = [];

    // Add compute budget for complex batch transaction (collect + buy + finalize + burn)
    instructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 })
    );

    // Derive pump event authority for collect_fees
    const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('__event_authority')],
      PUMP_PROGRAM
    );

    // Route based on pool type
    if (allocation.token.poolType === 'pumpswap_amm') {
      // ═══════════════════════════════════════════════════════════════════════
      // PumpSwap AMM: Collect + Unwrap + Wrap + Buy (optimized N+1 pattern)
      // ═══════════════════════════════════════════════════════════════════════
      log('  📦', `Building AMM batch (collect + unwrap + wrap + buy)...`, colors.cyan);

      // Derive AMM-specific PDAs
      const pool = allocation.token.bondingCurve; // For AMM, this is the pool address

      // DAT's WSOL account
      const [datWsolAccount] = PublicKey.findProgramAddressSync(
        [datAuthority.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), WSOL_MINT.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM
      );

      // AMM creator vault accounts (for collect_fees_amm)
      const [creatorVaultAuthority] = deriveAmmCreatorVaultAuthority(creator);
      const creatorVaultAta = getAmmCreatorVaultAta(creator);

      // Pool's token accounts (base = token, quote = WSOL)
      const [poolBaseTokenAccount] = PublicKey.findProgramAddressSync(
        [pool.toBuffer(), tokenProgram.toBuffer(), allocation.token.mint.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM
      );

      const [poolQuoteTokenAccount] = PublicKey.findProgramAddressSync(
        [pool.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), WSOL_MINT.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM
      );

      // Protocol fee recipient ATA (for WSOL)
      const [protocolFeeRecipientAta] = PublicKey.findProgramAddressSync(
        [PUMPSWAP_PROTOCOL_FEE_RECIPIENT.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), WSOL_MINT.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM
      );

      // Coin creator vault accounts (for buy)
      // Use deriveAmmCreatorVaultAuthority which uses correct seeds: ["creator_vault", creator]
      const [coinCreatorVaultAuthority] = deriveAmmCreatorVaultAuthority(creator);
      const coinCreatorVaultAta = getAmmCreatorVaultAta(creator);

      // Volume accumulator PDAs (PumpSwap uses same program)
      const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
        [Buffer.from('global_volume_accumulator')],
        PUMP_SWAP_PROGRAM
      );

      const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
        [Buffer.from('user_volume_accumulator'), datAuthority.toBuffer()],
        PUMP_SWAP_PROGRAM
      );

      const [feeConfig] = PublicKey.findProgramAddressSync(
        [Buffer.from('fee_config'), PUMP_SWAP_PROGRAM.toBuffer()],
        FEE_PROGRAM
      );

      // Step 1: Collect fees from AMM creator vault (WSOL → datWsolAccount)
      log('  📦', `Building collect_fees_amm instruction...`, colors.cyan);
      const collectAmmIx = await program.methods
        .collectFeesAmm()
        .accounts({
          datState,
          tokenStats,
          tokenMint: allocation.token.mint,
          datAuthority,
          datWsolAccount,
          creatorVaultAuthority,
          creatorVaultAta,
          wsolMint: WSOL_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
          pumpSwapProgram: PUMP_SWAP_PROGRAM,
        })
        .instruction();

      instructions.push(collectAmmIx);

      // Step 2: Unwrap WSOL → SOL (moves from datWsolAccount to datAuthority)
      log('  📦', `Building unwrap_wsol instruction...`, colors.cyan);
      const unwrapIx = await program.methods
        .unwrapWsol()
        .accounts({
          datState,
          datAuthority,
          datWsolAccount,
          wsolMint: WSOL_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();

      instructions.push(unwrapIx);

      // Step 3: Wrap SOL → WSOL for AMM buy
      log('  📦', `Building wrap_wsol instruction (${formatSOL(allocation.allocation)} SOL)...`, colors.cyan);
      const wrapIx = await program.methods
        .wrapWsol(new BN(allocation.allocation))
        .accounts({
          datState,
          datAuthority,
          datWsolAccount,
          wsolMint: WSOL_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      instructions.push(wrapIx);

      // Step 4: Calculate desired tokens based on allocation (simplified - in prod use price oracle)
      const desiredTokens = new BN(1_000_000); // 1M tokens minimum, will get actual amount from CPI
      const maxSolCost = new BN(allocation.allocation);

      const buyIx = await program.methods
        .executeBuyAmm(desiredTokens, maxSolCost)
        .accounts({
          datState,
          datAuthority,
          datTokenAccount: datAsdfAccount,
          pool,
          globalConfig: PUMPSWAP_GLOBAL_CONFIG,
          baseMint: allocation.token.mint,
          quoteMint: WSOL_MINT,
          datWsolAccount,
          poolBaseTokenAccount,
          poolQuoteTokenAccount,
          protocolFeeRecipient: PUMPSWAP_PROTOCOL_FEE_RECIPIENT,
          protocolFeeRecipientAta,
          baseTokenProgram: tokenProgram,
          quoteTokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM,
          eventAuthority: PUMPSWAP_EVENT_AUTHORITY,
          pumpSwapProgram: PUMP_SWAP_PROGRAM,
          coinCreatorVaultAta,
          coinCreatorVaultAuthority,
          globalVolumeAccumulator,
          userVolumeAccumulator,
          feeConfig,
          feeProgram: FEE_PROGRAM,
        })
        .instruction();

      instructions.push(buyIx);

    } else {
      // ═══════════════════════════════════════════════════════════════════════
      // Bonding Curve: Collect + Buy (optimized N+1 pattern)
      // ═══════════════════════════════════════════════════════════════════════

      // Step 1: Collect fees from creator vault → datAuthority
      log('  📦', `Building collect_fees instruction...`, colors.cyan);
      const collectIx = await program.methods
        .collectFees(false, true) // is_root_token=false, for_ecosystem=true
        .accounts({
          datState,
          tokenStats,
          tokenMint: allocation.token.mint,
          datAuthority,
          creatorVault,
          pumpEventAuthority,
          pumpSwapProgram: PUMP_PROGRAM,
          rootTreasury,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      instructions.push(collectIx);

      // Step 2: Buy tokens with PROPORTIONAL allocation from shared vault
      // CRITICAL: Pass calculated allocation, NOT null (to leave balance for other tokens)
      log('  📦', `Building bonding curve buy instruction (${formatSOL(allocation.allocation)} SOL)...`, colors.cyan);

      // PumpFun volume accumulator accounts
      const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
        [Buffer.from('global_volume_accumulator')],
        PUMP_PROGRAM
      );

      const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
        [Buffer.from('user_volume_accumulator'), datAuthority.toBuffer()],
        PUMP_PROGRAM
      );

      const [feeConfig] = PublicKey.findProgramAddressSync(
        [Buffer.from('fee_config'), PUMP_PROGRAM.toBuffer()],
        FEE_PROGRAM
      );

      // Pass calculated allocation (proportional share from shared vault)
      // This leaves remaining balance in datAuthority for other secondary tokens
      const buyIx = await program.methods
        .executeBuySecondary(new BN(allocation.allocation))
        .accounts({
          datState,
          datAuthority,
          datAsdfAccount,
          pool: allocation.token.bondingCurve,
          asdfMint: allocation.token.mint,
          poolAsdfAccount,
          pumpGlobalConfig: PUMP_GLOBAL_CONFIG,
          protocolFeeRecipient,
          creatorVault,
          pumpEventAuthority: PUMP_EVENT_AUTHORITY,
          pumpSwapProgram: PUMP_PROGRAM,
          globalVolumeAccumulator,
          userVolumeAccumulator,
          feeConfig,
          feeProgram: FEE_PROGRAM,
          rootTreasury,
          tokenProgram,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      instructions.push(buyIx);
    }

    // Finalize instruction
    log('  📦', 'Building finalize instruction...', colors.cyan);
    const finalizeIx = await program.methods
      .finalizeAllocatedCycle(true) // Token participated - reset pending_fees
      .accounts({
        datState,
        tokenStats,
        admin: adminKeypair.publicKey,
      })
      .instruction();

    instructions.push(finalizeIx);

    // Burn instruction
    log('  📦', 'Building burn instruction...', colors.cyan);
    const burnIx = await program.methods
      .burnAndUpdate()
      .accounts({
        datState,
        tokenStats,
        datAuthority,
        asdfMint: allocation.token.mint,
        datAsdfAccount,
        tokenProgram,
      })
      .instruction();

    instructions.push(burnIx);

    // Dev sustainability fee - 1% of secondary share (after split)
    // This is the 99/1 split: 99% burned, 1% keeps infrastructure running
    log('  📦', 'Building dev fee instruction...', colors.cyan);
    const secondaryShareLamports = Math.floor(allocation.allocation * SECONDARY_KEEP_RATIO);
    const devFeeIx = await program.methods
      .transferDevFee(new BN(secondaryShareLamports))
      .accounts({
        datState,
        datAuthority,
        devWallet: DEV_WALLET,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    instructions.push(devFeeIx);

    // Create and send batch transaction
    log('  🚀', `Sending BATCH TX (${instructions.length} instructions: compute + collect + buy + finalize + burn + devFee)...`, colors.cyan);

    const tx = new Transaction();
    instructions.forEach(ix => tx.add(ix));

    // Get latest blockhash with retry (30s timeout for mainnet)
    const { blockhash, lastValidBlockHeight } = await withRetryAndTimeout(
      () => program.provider.connection.getLatestBlockhash('confirmed'),
      { maxRetries: 3 },
      30000
    );
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = adminKeypair.publicKey;

    // Sign for simulation
    tx.sign(adminKeypair);

    // CRITICAL: Simulate transaction BEFORE sending to detect instruction failures
    // This prevents finalize from running if buy fails (which would lose pending_fees)
    log('  🔍', 'Simulating transaction...', colors.cyan);
    const simulation = await withRetryAndTimeout(
      () => program.provider.connection.simulateTransaction(tx),
      { maxRetries: 2, baseDelayMs: 500 },
      30000
    );

    if (simulation.value.err) {
      // Parse simulation error to identify which instruction failed
      const errStr = JSON.stringify(simulation.value.err);
      const logs = simulation.value.logs || [];

      // Check if it's a buy instruction failure
      const isBuyFailure = logs.some(log =>
        log.includes('execute_buy') ||
        log.includes('slippage') ||
        log.includes('insufficient')
      );

      if (isBuyFailure) {
        throw new Error(`Simulation failed at BUY instruction (finalize skipped to preserve pending_fees): ${errStr}`);
      }

      throw new Error(`Simulation failed: ${errStr}. Logs: ${logs.slice(-5).join(' | ')}`);
    }
    log('  ✅', 'Simulation passed, sending transaction...', colors.green);

    // Send with retry (45s timeout for mainnet) - skipPreflight since already simulated
    const signature = await withRetryAndTimeout(
      () => program.provider.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
        preflightCommitment: 'confirmed',
      }),
      { maxRetries: 3, baseDelayMs: 1000 },
      45000
    );

    // Wait for confirmation with retry
    await confirmTransactionWithRetry(
      program.provider.connection,
      signature,
      blockhash,
      lastValidBlockHeight,
      { maxRetries: 3 }
    );

    result.buyTx = signature;
    result.finalizeTx = signature; // Same TX
    result.burnTx = signature; // Same TX

    // Fetch final stats to get burned amount
    const finalStats = await getTypedAccounts(program).tokenStats.fetch(tokenStats);
    result.tokensBurned = finalStats.totalBurned.toNumber();

    log('  ✅', `BATCH TX confirmed: ${signature.slice(0, 20)}...`, colors.green);
    log('  ✅', `${allocation.token.symbol} cycle complete (1 TX instead of 3)!`, colors.bright);

    result.success = true;
    return result;

  } catch (error) {
    const errorMsg = (error as Error).message || String(error);
    result.error = errorMsg;
    log('  ❌', `Failed: ${errorMsg}`, colors.red);
    return result;
  }
}

// ============================================================================
// Step 4b: Finalize Deferred Tokens (preserve pending_fees)
// ============================================================================

/**
 * Finalize deferred tokens with actually_participated=false
 * This preserves their pending_fees for the next cycle
 */
async function finalizeDeferredTokens(
  program: Program,
  skippedAllocations: TokenAllocation[],
  adminKeypair: Keypair
): Promise<void> {
  if (skippedAllocations.length === 0) return;

  logSection('FINALIZE DEFERRED TOKENS (PRESERVE PENDING_FEES)');

  for (const allocation of skippedAllocations) {
    try {
      const [datState] = PublicKey.findProgramAddressSync([DAT_STATE_SEED], program.programId);
      const [tokenStats] = PublicKey.findProgramAddressSync(
        [TOKEN_STATS_SEED, allocation.token.mint.toBuffer()],
        program.programId
      );

      log('⏭️', `Finalizing ${allocation.token.symbol} (deferred - preserving pending_fees)...`, colors.yellow);

      const finalizeTx = await program.methods
        .finalizeAllocatedCycle(false) // Token did NOT participate - preserve pending_fees
        .accounts({
          datState,
          tokenStats,
          admin: adminKeypair.publicKey,
        })
        .signers([adminKeypair])
        .rpc();

      log('  ✅', `${allocation.token.symbol}: pending_fees preserved, TX: ${finalizeTx.slice(0, 16)}...`, colors.green);

    } catch (error) {
      const errorMsg = (error as Error).message || String(error);
      log('  ⚠️', `${allocation.token.symbol}: Failed to finalize deferred - ${errorMsg}`, colors.yellow);
    }
  }
}

// ============================================================================
// Step 5: Execute Root Cycle
// ============================================================================

async function executeRootCycle(
  program: Program,
  rootToken: TokenConfig,
  adminKeypair: Keypair
): Promise<CycleResult> {
  logSection('STEP 3: EXECUTE ROOT TOKEN CYCLE');

  const result: CycleResult = {
    token: rootToken.symbol,
    success: false,
  };

  try {
    const isAmm = rootToken.poolType === 'pumpswap_amm';
    log('🔄', `Processing ${rootToken.symbol} (ROOT - ${isAmm ? 'AMM' : 'BC'} BATCH TX)...`, colors.cyan);

    // Derive PDAs
    const [datState] = PublicKey.findProgramAddressSync([DAT_STATE_SEED], program.programId);
    const [datAuthority] = PublicKey.findProgramAddressSync([DAT_AUTHORITY_SEED], program.programId);
    const [tokenStats] = PublicKey.findProgramAddressSync(
      [TOKEN_STATS_SEED, rootToken.mint.toBuffer()],
      program.programId
    );

    const creator = rootToken.creator;
    const creatorVault = getBcCreatorVault(creator);

    const [rootTreasury] = PublicKey.findProgramAddressSync(
      [ROOT_TREASURY_SEED, rootToken.mint.toBuffer()],
      program.programId
    );

    // Dynamic token program selection for root (supports Token-2022/Mayhem as root)
    const tokenProgram = rootToken.isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const poolAddress = rootToken.bondingCurve; // For AMM, this is the pool address

    const [datAsdfAccount] = PublicKey.findProgramAddressSync(
      [
        datAuthority.toBuffer(),
        tokenProgram.toBuffer(),
        rootToken.mint.toBuffer(),
      ],
      new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
    );

    const [poolAsdfAccount] = PublicKey.findProgramAddressSync(
      [
        poolAddress.toBuffer(),
        tokenProgram.toBuffer(),
        rootToken.mint.toBuffer(),
      ],
      new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
    );

    // Protocol fee recipient (different for Mayhem vs SPL)
    const MAYHEM_FEE_RECIPIENT = new PublicKey('GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS');
    const SPL_FEE_RECIPIENT = new PublicKey('6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs');
    const protocolFeeRecipient = rootToken.isToken2022 ? MAYHEM_FEE_RECIPIENT : SPL_FEE_RECIPIENT;

    // Select swap program based on pool type
    const swapProgram = isAmm ? PUMP_SWAP_PROGRAM : PUMP_PROGRAM;

    const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [Buffer.from('global_volume_accumulator')],
      swapProgram
    );

    const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [Buffer.from('user_volume_accumulator'), datAuthority.toBuffer()],
      swapProgram
    );

    const [feeConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from('fee_config'), swapProgram.toBuffer()],
      FEE_PROGRAM
    );

    const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('__event_authority')],
      PUMP_PROGRAM
    );

    // Build instructions array for batch transaction
    const instructions: TransactionInstruction[] = [];

    // Add compute budget for complex batch transaction
    instructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })
    );

    if (isAmm) {
      // AMM: Fees collected in Step 2 (unwrapped to SOL) + treasury SOL
      // Need to wrap SOL → WSOL, then execute buy + burn
      log('  📦', 'AMM: Building wrap_wsol + buy instructions...', colors.cyan);

      // Derive AMM-specific accounts
      const [datWsolAccount] = PublicKey.findProgramAddressSync(
        [datAuthority.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), WSOL_MINT.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM
      );

      const [poolQuoteTokenAccount] = PublicKey.findProgramAddressSync(
        [poolAddress.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), WSOL_MINT.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM
      );

      const [protocolFeeRecipientAta] = PublicKey.findProgramAddressSync(
        [PUMPSWAP_PROTOCOL_FEE_RECIPIENT.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), WSOL_MINT.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM
      );

      // Coin creator vault accounts (for root AMM buy)
      // Use deriveAmmCreatorVaultAuthority which uses correct seeds: ["creator_vault", creator]
      const [coinCreatorVaultAuthority] = deriveAmmCreatorVaultAuthority(rootToken.creator);
      const coinCreatorVaultAta = getAmmCreatorVaultAta(rootToken.creator);

      // PumpSwap global config
      const [pumpSwapGlobalConfig] = PublicKey.findProgramAddressSync(
        [Buffer.from('global')],
        PUMP_SWAP_PROGRAM
      );

      // Get available SOL balance for wrap
      const datAuthorityBalance = await program.provider.connection.getBalance(datAuthority);
      const availableForWrap = Math.max(0, datAuthorityBalance - RENT_EXEMPT_MINIMUM - SAFETY_BUFFER);

      if (availableForWrap > 0) {
        // Step 1: Wrap SOL → WSOL for AMM buy
        const wrapIx = await program.methods
          .wrapWsol(new BN(availableForWrap))
          .accounts({
            datState,
            datAuthority,
            datWsolAccount,
            wsolMint: WSOL_MINT,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .instruction();

        instructions.push(wrapIx);
        log('  📦', `Wrap instruction added: ${formatSOL(availableForWrap)} SOL → WSOL`, colors.cyan);
      }

      // Step 2: Execute buy via AMM
      const desiredTokens = new BN(1_000_000);
      const maxSolCost = new BN(10_000_000_000); // 10 SOL max (will use actual balance)

      const buyIx = await program.methods
        .executeBuyAmm(desiredTokens, maxSolCost)
        .accounts({
          datState,
          datAuthority,
          datTokenAccount: datAsdfAccount,
          pool: poolAddress,
          globalConfig: pumpSwapGlobalConfig,
          baseMint: rootToken.mint,
          quoteMint: WSOL_MINT,
          datWsolAccount,
          poolBaseTokenAccount: poolAsdfAccount,
          poolQuoteTokenAccount,
          protocolFeeRecipient: PUMPSWAP_PROTOCOL_FEE_RECIPIENT,
          protocolFeeRecipientAta,
          baseTokenProgram: tokenProgram,
          quoteTokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM,
          eventAuthority: PUMPSWAP_EVENT_AUTHORITY,
          pumpSwapProgram: PUMP_SWAP_PROGRAM,
          coinCreatorVaultAta,
          coinCreatorVaultAuthority,
          globalVolumeAccumulator,
          userVolumeAccumulator,
          feeConfig,
          feeProgram: FEE_PROGRAM,
        })
        .instruction();

      instructions.push(buyIx);

    } else {
      // Bonding Curve: Collect fees + execute buy
      log('  📦', 'Building collect fees instruction...', colors.cyan);
      const collectIx = await program.methods
        .collectFees(true, true) // is_root_token=true, for_ecosystem=true (skip vault threshold check)
        .accounts({
          datState,
          tokenStats,
          tokenMint: rootToken.mint,
          datAuthority,
          creatorVault,
          pumpEventAuthority,
          pumpSwapProgram: PUMP_PROGRAM,
          rootTreasury,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      instructions.push(collectIx);

      // Execute buy instruction
      log('  📦', 'Building buy instruction (100% buyback)...', colors.cyan);
      const buyIx = await program.methods
        .executeBuy(null) // No allocated_lamports = use full balance
        .accounts({
          datState,
          datAuthority,
          datAsdfAccount,
          pool: poolAddress,
          asdfMint: rootToken.mint,
          poolAsdfAccount,
          pumpGlobalConfig: PUMP_GLOBAL_CONFIG,
          protocolFeeRecipient,
          creatorVault,
          pumpEventAuthority: PUMP_EVENT_AUTHORITY,
          pumpSwapProgram: PUMP_PROGRAM,
          globalVolumeAccumulator,
          userVolumeAccumulator,
          feeConfig,
          feeProgram: FEE_PROGRAM,
          tokenProgram,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      instructions.push(buyIx);
    }

    // Finalize instruction for root token (reset pending_fees)
    // This was missing - root token pending_fees accumulated indefinitely
    log('  📦', 'Building finalize instruction...', colors.cyan);
    const finalizeIx = await program.methods
      .finalizeAllocatedCycle(true) // Token participated - reset pending_fees
      .accounts({
        datState,
        tokenStats,
        admin: adminKeypair.publicKey,
      })
      .instruction();
    instructions.push(finalizeIx);

    // Burn instruction (same for both BC and AMM)
    log('  📦', 'Building burn instruction...', colors.cyan);
    const burnIx = await program.methods
      .burnAndUpdate()
      .accounts({
        datState,
        tokenStats,
        datAuthority,
        asdfMint: rootToken.mint,
        datAsdfAccount,
        tokenProgram,
      })
      .instruction();

    instructions.push(burnIx);

    // Process user rebate (if eligible user exists)
    // This is the LAST instruction in the ROOT cycle batch
    let selectedUserForRebate = null;
    try {
      log('  🎲', 'Checking for eligible rebate users...', colors.cyan);

      // Get eligible users
      const eligibleUsers = await getEligibleUsers(program, program.programId);

      if (eligibleUsers.length > 0) {
        // Get current slot for random selection
        const currentSlot = await program.provider.connection.getSlot();
        selectedUserForRebate = selectUserForRebate(eligibleUsers, currentSlot);

        if (selectedUserForRebate) {
          log('  🎯', `Selected user for rebate: ${selectedUserForRebate.pubkey.toBase58().slice(0, 8)}...`, colors.cyan);
          log('  💰', `Pending: ${selectedUserForRebate.pendingContribution.toNumber() / 1e9} $ASDF`, colors.cyan);

          // Derive rebate pool accounts
          const [rebatePool] = deriveRebatePoolPda(program.programId);
          // IMPORTANT: Rebate pool uses ASDF mint from DAT state, NOT root token mint
          // On devnet: root=TROOT, but asdfMint=FROOT in DAT state
          const datStateAccount = await getTypedAccounts(program).datState.fetch(datState);
          const asdfMint = datStateAccount.asdfMint;

          // Get rebate pool ATA
          const rebatePoolAta = await getAssociatedTokenAddress(
            asdfMint,
            rebatePool,
            true // Allow owner off curve (PDA)
          );

          // Get user ATA
          const userAta = await getAssociatedTokenAddress(
            asdfMint,
            selectedUserForRebate.pubkey,
            false
          );

          // Calculate rebate amount (0.552% of pending)
          const rebateAmount = calculateRebateAmount(selectedUserForRebate.pendingContribution);
          log('  🎁', `Rebate amount: ${rebateAmount.toNumber() / 1e9} $ASDF`, colors.cyan);

          // Build process_user_rebate instruction
          const rebateIx = await program.methods
            .processUserRebate()
            .accounts({
              datState,
              rebatePool,
              rebatePoolAta,
              userStats: selectedUserForRebate.statsPda,
              user: selectedUserForRebate.pubkey,
              userAta,
              admin: adminKeypair.publicKey,
              tokenProgram,
            })
            .instruction();

          instructions.push(rebateIx);
          log('  📦', 'Added process_user_rebate instruction to batch', colors.cyan);
        }
      } else {
        log('  ℹ️', 'No eligible users for rebate this cycle', colors.cyan);
      }
    } catch (error) {
      // Rebate processing is optional - don't fail the whole cycle
      log('  ⚠️', `Rebate check failed (non-fatal): ${(error as Error).message}`, colors.yellow);
    }

    // Create and send batch transaction
    const batchDesc = selectedUserForRebate
      ? 'compute + collect + buy + finalize + burn + rebate'
      : 'compute + collect + buy + finalize + burn';
    log('  🚀', `Sending BATCH TX (${instructions.length} instructions: ${batchDesc})...`, colors.cyan);

    const tx = new Transaction();
    instructions.forEach(ix => tx.add(ix));

    // Get latest blockhash with retry (30s timeout for mainnet)
    const { blockhash, lastValidBlockHeight } = await withRetryAndTimeout(
      () => program.provider.connection.getLatestBlockhash('confirmed'),
      { maxRetries: 3 },
      30000
    );
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = adminKeypair.publicKey;

    // Sign for simulation
    tx.sign(adminKeypair);

    // CRITICAL: Simulate transaction BEFORE sending to detect instruction failures
    // This prevents finalize from running if buy fails (which would lose pending_fees)
    log('  🔍', 'Simulating transaction...', colors.cyan);
    const simulation = await withRetryAndTimeout(
      () => program.provider.connection.simulateTransaction(tx),
      { maxRetries: 2, baseDelayMs: 500 },
      30000
    );

    if (simulation.value.err) {
      // Parse simulation error to identify which instruction failed
      const errStr = JSON.stringify(simulation.value.err);
      const logs = simulation.value.logs || [];

      // Check if it's a buy instruction failure
      const isBuyFailure = logs.some(log =>
        log.includes('execute_buy') ||
        log.includes('slippage') ||
        log.includes('insufficient')
      );

      if (isBuyFailure) {
        throw new Error(`Simulation failed at BUY instruction (finalize skipped to preserve pending_fees): ${errStr}`);
      }

      throw new Error(`Simulation failed: ${errStr}. Logs: ${logs.slice(-5).join(' | ')}`);
    }
    log('  ✅', 'Simulation passed, sending transaction...', colors.green);

    // Send with retry (45s timeout for mainnet) - skipPreflight since already simulated
    const signature = await withRetryAndTimeout(
      () => program.provider.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
        preflightCommitment: 'confirmed',
      }),
      { maxRetries: 3, baseDelayMs: 1000 },
      45000
    );

    // Wait for confirmation with retry
    await confirmTransactionWithRetry(
      program.provider.connection,
      signature,
      blockhash,
      lastValidBlockHeight,
      { maxRetries: 3 }
    );

    result.buyTx = signature;
    result.burnTx = signature; // Same TX

    const finalStats = await getTypedAccounts(program).tokenStats.fetch(tokenStats);
    result.tokensBurned = finalStats.totalBurned.toNumber();

    log('  ✅', `BATCH TX confirmed: ${signature.slice(0, 20)}...`, colors.green);
    log('  ✅', `${rootToken.symbol} cycle complete (1 TX instead of 3)!`, colors.bright);

    result.success = true;
    return result;

  } catch (error) {
    const errorMsg = (error as Error).message || String(error);
    result.error = errorMsg;
    log('  ❌', `Failed: ${errorMsg}`, colors.red);
    return result;
  }
}

// ============================================================================
// Step 6: Display Summary
// ============================================================================

function displayCycleSummary(
  normalized: { viable: TokenAllocation[]; skipped: TokenAllocation[]; ratio: number },
  results: { [key: string]: CycleResult },
  totalCollected: number
) {
  logSection('ECOSYSTEM CYCLE SUMMARY');

  // Overall stats
  console.log(colors.bright + '💰 Financial Summary:' + colors.reset);
  console.log(`   Total Collected: ${formatSOL(totalCollected)} SOL`);
  console.log(`   Distribution Ratio: ${normalized.ratio.toFixed(6)}`);
  console.log(`   Min Allocation (Secondary): ${formatSOL(MIN_ALLOCATION_SECONDARY)} SOL`);
  console.log('');

  // Scalability stats
  const totalSecondaries = normalized.viable.length + normalized.skipped.length;
  console.log(colors.bright + '📈 Scalability Report:' + colors.reset);
  console.log(`   Total Secondary Tokens: ${totalSecondaries}`);
  console.log(`   ${colors.green}Viable (processed): ${normalized.viable.length}${colors.reset}`);
  console.log(`   ${colors.yellow}Deferred (accumulating): ${normalized.skipped.length}${colors.reset}`);
  console.log('');

  // Cycle results table
  console.log(colors.bright + '🔄 Cycle Results:' + colors.reset);
  console.log('─'.repeat(110));
  console.log(
    `${'Token'.padEnd(12)} ${'Status'.padEnd(14)} ${'Allocated'.padEnd(15)} ` +
    `${'Buy Tx'.padEnd(18)} ${'Finalize Tx'.padEnd(18)} ${'Burn Tx'.padEnd(18)}`
  );
  console.log('─'.repeat(110));

  let successCount = 0;
  let failureCount = 0;
  let deferredCount = 0;

  for (const [symbol, result] of Object.entries(results)) {
    const isDeferred = result.error?.startsWith('DEFERRED:');
    let statusIcon: string;
    let statusText: string;
    let statusColor: string;

    if (isDeferred) {
      statusIcon = '⏭️';
      statusText = 'Deferred';
      statusColor = colors.yellow;
      deferredCount++;
    } else if (result.success) {
      statusIcon = '✅';
      statusText = 'Success';
      statusColor = colors.green;
      successCount++;
    } else {
      statusIcon = '❌';
      statusText = 'Failed';
      statusColor = colors.red;
      failureCount++;
    }

    const allocation = result.allocation ? formatSOL(result.allocation) : 'N/A';
    const buyTx = result.buyTx ? result.buyTx.slice(0, 16) + '...' : '-';
    const finalizeTx = result.finalizeTx ? result.finalizeTx.slice(0, 16) + '...' : '-';
    const burnTx = result.burnTx ? result.burnTx.slice(0, 16) + '...' : '-';

    console.log(
      statusColor +
      `${symbol.padEnd(12)} ${(statusIcon + ' ' + statusText).padEnd(14)} ` +
      `${allocation.padEnd(15)} ${buyTx.padEnd(18)} ${finalizeTx.padEnd(18)} ${burnTx.padEnd(18)}` +
      colors.reset
    );

    // Show error details for failures (not deferrals)
    if (!result.success && result.error && !isDeferred) {
      console.log(`     ${colors.red}Error: ${result.error}${colors.reset}`);
    }
  }

  console.log('─'.repeat(110));
  console.log('');

  // Summary stats
  console.log(colors.bright + '📊 Execution Summary:' + colors.reset);
  console.log(`   Total Tokens: ${Object.keys(results).length}`);
  console.log(`   ${colors.green}Successful: ${successCount}${colors.reset}`);
  console.log(`   ${colors.yellow}Deferred: ${deferredCount}${colors.reset}`);
  console.log(`   ${colors.red}Failed: ${failureCount}${colors.reset}`);
  console.log('');

  if (failureCount > 0) {
    console.log(colors.red + '❌ Some cycles failed. Review errors above.' + colors.reset);
  } else if (deferredCount > 0) {
    console.log(colors.yellow + '⏭️  Some tokens deferred due to insufficient allocation.' + colors.reset);
    console.log(colors.cyan + '   They will accumulate and process in next cycle.' + colors.reset);
  } else {
    console.log(colors.green + '✅ All cycles executed successfully!' + colors.reset);
  }
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  // Parse network argument
  const args = process.argv.slice(2);
  const networkConfig = getNetworkConfig(args);

  // Parse dry-run flag
  const dryRun = args.includes('--dry-run');

  // Determine commitment level based on network (finalized for mainnet, confirmed for devnet)
  const commitment: Commitment = getCommitment(networkConfig);
  const onMainnet = isMainnet(networkConfig);

  console.log(colors.bright + colors.magenta);
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    ECOSYSTEM CYCLE ORCHESTRATOR                             ║');
  console.log('║              Hierarchical Token Buyback & Burn System                       ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log(colors.reset + '\n');

  // Print network banner
  printNetworkBanner(networkConfig);

  // Acquire execution lock (prevents concurrent cycles)
  const executionLock = new ExecutionLock();
  if (!executionLock.acquire('ecosystem-cycle')) {
    const status = executionLock.getStatus();
    log('❌', `Cannot start: Another cycle is already running (PID: ${status.lockInfo?.pid})`, colors.red);
    log('ℹ️', `Started: ${new Date(status.lockInfo?.timestamp || 0).toISOString()}`, colors.cyan);
    process.exit(1);
  }
  log('🔒', 'Execution lock acquired', colors.green);

  // Setup connection and provider using network config
  const rpcUrl = process.env.RPC_URL || networkConfig.rpcUrl;
  const connection = new Connection(rpcUrl, commitment);

  const walletPath = process.env.WALLET_PATH || networkConfig.wallet;
  let adminKeypair: Keypair;
  try {
    adminKeypair = loadAndValidateWallet(walletPath);
  } catch (error) {
    executionLock.release();
    throw error;
  }

  const provider = new AnchorProvider(
    connection,
    new Wallet(adminKeypair),
    { commitment }
  );

  // Load IDL
  const idlPath = path.join(__dirname, '../target/idl/asdf_dat.json');
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8')) as Idl;
  const program = new Program(idl, provider);

  log('🔗', `Connected to: ${rpcUrl}`, colors.cyan);
  log('👤', `Admin: ${adminKeypair.publicKey.toBase58()}`, colors.cyan);
  log('📜', `Program: ${networkConfig.programId}`, colors.cyan);
  log('⚙️', `Commitment: ${commitment} (${onMainnet ? 'MAINNET' : 'DEVNET'})`, colors.cyan);
  console.log('');

  // Initialize alerting (reuse existing singleton if daemon already initialized it)
  const alertingEnv = validateAlertingEnv();
  const alerting = initAlerting({
    webhookUrl: alertingEnv.WEBHOOK_URL || '',
    webhookType: alertingEnv.WEBHOOK_TYPE,
    enabled: alertingEnv.ALERT_ENABLED,
    rateLimitWindowMs: alertingEnv.ALERT_RATE_LIMIT_WINDOW,
    rateLimitMaxAlerts: alertingEnv.ALERT_RATE_LIMIT_MAX,
    minAlertIntervalMs: alertingEnv.ALERT_COOLDOWN_MS,
  }, {
    errorRatePercent: alertingEnv.ALERT_ERROR_RATE_THRESHOLD,
    pollLagMultiplier: alertingEnv.ALERT_POLL_LAG_MULTIPLIER,
    pendingFeesStuckMinutes: alertingEnv.ALERT_PENDING_STUCK_MINUTES,
    failedCyclesConsecutive: alertingEnv.ALERT_FAILED_CYCLES_MAX,
  });

  try {
    // Load all ecosystem tokens from network config
    const tokens = await loadEcosystemTokens(connection, networkConfig);
    const rootToken = tokens.find(t => t.isRoot);
    const secondaryTokens = tokens.filter(t => !t.isRoot);

    if (!rootToken) {
      throw new Error('Root token not found');
    }

    // Execute the complete ecosystem cycle
    const startTime = Date.now();

    // Pre-flight: Trigger daemon flush to ensure fees are synced on-chain
    // This solves the race condition where daemon detects fees but hasn't flushed yet
    const flushResult = await triggerDaemonFlush();

    // Verify flush succeeded for all tokens (critical for fee consistency)
    if (flushResult && flushResult.tokensFailed > 0) {
      log('⚠️', `Flush partially failed: ${flushResult.tokensFailed} tokens did not flush`, colors.yellow);
      log('⚠️', `Tokens affected may have incorrect pending_fees - proceeding with caution`, colors.yellow);
      // Note: We don't abort here because:
      // 1. Some tokens may still work
      // 2. On-chain state might be stale but still valid
      // 3. Failed tokens will be skipped naturally if pending_fees = 0
    }

    // Pre-flight: Check MIN_CYCLE_INTERVAL and wait if necessary
    // This prevents CycleTooSoon errors by waiting upfront
    logSection('PRE-FLIGHT: CYCLE COOLDOWN CHECK');
    await waitForCycleCooldown(program);

    // Pre-flight: Wait for daemon synchronization (optional, 30s timeout)
    // This helps ensure all tokens have their pending_fees populated
    const syncResult = await waitForDaemonSync(program, tokens, 30000);
    if (!syncResult.synced && syncResult.tokensWithoutFees.length > 0) {
      log('ℹ️', `Proceeding with ${syncResult.tokensWithFees.length} synced tokens`, colors.cyan);
    }

    // Step 1: Query pending fees (for display/allocation calculation)
    const allocations = await queryPendingFees(program, tokens);

    // DRY-RUN MODE: Generate report and exit without executing
    if (dryRun) {
      const report = generateDryRunReport(allocations, networkConfig.name, rootToken);

      // Print console summary
      printDryRunSummary(report);

      // Write JSON report
      const reportDir = 'reports';
      if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, { recursive: true });
      }
      const reportFile = `${reportDir}/dry-run-${Date.now()}.json`;
      fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
      console.log(colors.green + `  📄 Report saved: ${reportFile}` + colors.reset);
      console.log('');

      // Release lock and exit
      executionLock.release();
      log('🔓', 'Execution lock released (dry-run complete)', colors.green);
      process.exit(0);
    }

    // Get secondary allocations for processing
    const secondaryAllocations = allocations.filter(a => !a.isRoot);

    if (secondaryAllocations.length === 0) {
      log('⚠️', 'No secondary tokens with pending fees. Skipping secondary cycles.', colors.yellow);
    }

    // Calculate total pending for ratio display (actual collection happens per-token in batch TX)
    const totalPending = secondaryAllocations.reduce((sum, a) => sum + a.pendingFees, 0);
    const ratio = 1.0; // Will be recalculated based on actual collected amounts

    // Step 2: Execute secondary cycles (each batch TX: collect + buy + finalize + burn)
    // This is the optimized N+1 pattern - collection is now INSIDE each secondary's batch TX
    const { results, viable: actualViable, deferred: actualDeferred } = await executeSecondaryTokensDynamic(
      program,
      connection,
      secondaryAllocations,
      adminKeypair
    );

    // Step 2b: Finalize deferred tokens (preserve their pending_fees for next cycle)
    await finalizeDeferredTokens(program, actualDeferred, adminKeypair);

    // Step 2c: Wait for cooldown before root cycle (if any secondary was processed)
    // The program enforces MIN_CYCLE_INTERVAL globally, so we need to wait after secondary cycles
    if (actualViable.length > 0) {
      logSection('PRE-ROOT: CYCLE COOLDOWN CHECK');
      await waitForCycleCooldown(program);
    }

    // Step 3: Execute root cycle (batch TX: collect + buy + burn)
    const rootResult = await executeRootCycle(program, rootToken, adminKeypair);
    results[rootToken.symbol] = rootResult;

    // Step 4: Display summary
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    // Calculate total collected from viable results
    const totalCollected = actualViable.reduce((sum, a) => sum + (a.allocation || 0), 0);

    displayCycleSummary({ viable: actualViable, skipped: actualDeferred, ratio }, results, totalCollected);

    console.log(colors.bright + `⏱️  Total execution time: ${duration}s` + colors.reset);
    console.log('');

    // Release lock before exit
    const released = executionLock.release();
    if (released) {
      log('🔓', 'Execution lock released', colors.green);
    } else {
      log('⚠️', 'Warning: Could not release execution lock - may need manual cleanup', colors.yellow);
    }

    // Exit with appropriate code
    const hasFailures = Object.values(results).some(r => !r.success);

    // Calculate total burned for alert
    const totalBurned = Object.values(results)
      .filter(r => r.success && r.tokensBurned)
      .reduce((sum, r) => sum + (r.tokensBurned || 0), 0);

    // Send success/partial success alert
    const cycleSummary: CycleSummary = {
      success: !hasFailures,
      tokensProcessed: actualViable.length + 1, // +1 for root
      tokensDeferred: actualDeferred.length,
      totalBurned,
      totalFeesSOL: totalCollected / LAMPORTS_PER_SOL,
      durationMs: endTime - startTime,
      network: networkConfig.name,
    };

    await alerting.sendCycleSuccess(cycleSummary).catch((err) => {
      log('⚠️', `Failed to send cycle success alert: ${err.message}`, colors.yellow);
    });

    process.exit(hasFailures ? 1 : 0);

  } catch (error) {
    // Always release lock on error
    const released = executionLock.release();
    if (released) {
      log('🔓', 'Execution lock released (error)', colors.yellow);
    } else {
      log('⚠️', 'Warning: Could not release execution lock - may need manual cleanup', colors.yellow);
    }

    // Send failure alert
    const errorMessage = (error as Error).message || String(error);
    await alerting.sendCycleFailure(errorMessage, {
      network: networkConfig.name,
      stack: (error as Error).stack?.slice(0, 500),  // Truncate stack for alert
    }).catch((alertErr) => {
      console.error(`Failed to send cycle failure alert: ${alertErr.message}`);
    });

    console.error(colors.red + '\n❌ Fatal error:' + colors.reset);
    console.error(colors.red + errorMessage + colors.reset);
    console.error((error as Error).stack);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { main as executeEcosystemCycle };
