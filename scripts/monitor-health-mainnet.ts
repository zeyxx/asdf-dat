/**
 * Mainnet Health Monitor
 *
 * Continuously monitors the health of the ASDF-DAT ecosystem on mainnet.
 * Designed to run 24/7 alongside the daemon and orchestrator.
 *
 * Features:
 * - Daemon health checks (API endpoint)
 * - RPC connectivity verification
 * - On-chain TokenStats pending fees monitoring
 * - Configurable alert thresholds
 * - Exit codes for automation/alerting
 *
 * Usage:
 *   npx ts-node scripts/monitor-health-mainnet.ts --network mainnet
 *   npx ts-node scripts/monitor-health-mainnet.ts --network mainnet --interval 120
 *   npx ts-node scripts/monitor-health-mainnet.ts --network mainnet --once  # Single check
 */

import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import { NETWORK_CONFIGS, NetworkType } from '../lib/network-config';

// ============================================================================
// Configuration
// ============================================================================

const DAEMON_PORT = 3030;
const DAEMON_URL = `http://localhost:${DAEMON_PORT}`;

interface HealthConfig {
  network: NetworkType;
  checkIntervalMs: number;
  daemonHealthTimeoutMs: number;
  rpcTimeoutMs: number;
  maxConsecutiveFailures: number;
  runOnce: boolean;
  verbose: boolean;
}

interface TokenConfig {
  mint: string;
  symbol: string;
  name: string;
  isRoot: boolean;
  poolType: string;
}

interface HealthCheckResult {
  timestamp: string;
  overall: 'healthy' | 'degraded' | 'critical';
  checks: {
    daemon: CheckResult;
    rpc: CheckResult;
    tokens: TokenCheckResult[];
  };
  metrics: {
    totalPendingFees: number;
    totalPendingFeesSOL: number;
    tokensAboveThreshold: number;
    rpcLatencyMs: number;
  };
}

interface CheckResult {
  status: 'pass' | 'fail' | 'warn';
  message: string;
  details?: Record<string, unknown>;
}

interface TokenCheckResult extends CheckResult {
  mint: string;
  symbol: string;
  pendingFees: number;
  pendingFeesSOL: number;
}

// ============================================================================
// Program Constants
// ============================================================================

const PROGRAM_ID = new PublicKey('ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui');
const TOKEN_STATS_SEED = Buffer.from('token_stats_v1');

// Thresholds
const MIN_FEES_FOR_CYCLE = 5_500_000; // 0.0055 SOL - minimum to participate in cycle

// ============================================================================
// PDA Derivation
// ============================================================================

function deriveTokenStatsPDA(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [TOKEN_STATS_SEED, mint.toBuffer()],
    PROGRAM_ID
  )[0];
}

// ============================================================================
// Health Checks
// ============================================================================

async function checkDaemonHealth(config: HealthConfig): Promise<CheckResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.daemonHealthTimeoutMs);

    const response = await fetch(`${DAEMON_URL}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return {
        status: 'fail',
        message: `Daemon returned ${response.status}`,
        details: { statusCode: response.status },
      };
    }

    const data = await response.json();

    // Check daemon's internal health
    if (data.status === 'healthy') {
      return {
        status: 'pass',
        message: 'Daemon is healthy',
        details: data,
      };
    } else {
      return {
        status: 'warn',
        message: `Daemon status: ${data.status}`,
        details: data,
      };
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (errorMessage.includes('ECONNREFUSED')) {
      return {
        status: 'fail',
        message: 'Daemon not running (connection refused)',
        details: { error: errorMessage },
      };
    }

    if (errorMessage.includes('aborted') || errorMessage.includes('timeout')) {
      return {
        status: 'fail',
        message: 'Daemon health check timed out',
        details: { timeoutMs: config.daemonHealthTimeoutMs },
      };
    }

    return {
      status: 'fail',
      message: `Daemon health check failed: ${errorMessage}`,
      details: { error: errorMessage },
    };
  }
}

async function checkRpcHealth(
  connection: Connection,
  config: HealthConfig
): Promise<CheckResult & { latencyMs: number }> {
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.rpcTimeoutMs);

    // Simple health check - get slot
    const slot = await connection.getSlot();
    clearTimeout(timeout);

    const latencyMs = Date.now() - startTime;

    return {
      status: 'pass',
      message: `RPC healthy (slot: ${slot}, latency: ${latencyMs}ms)`,
      latencyMs,
      details: { slot, latencyMs },
    };
  } catch (error: unknown) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return {
      status: 'fail',
      message: `RPC check failed: ${errorMessage}`,
      latencyMs,
      details: { error: errorMessage },
    };
  }
}

async function checkTokenStats(
  connection: Connection,
  tokens: TokenConfig[]
): Promise<TokenCheckResult[]> {
  const results: TokenCheckResult[] = [];

  for (const token of tokens) {
    const mint = new PublicKey(token.mint);
    const tokenStatsPDA = deriveTokenStatsPDA(mint);

    try {
      const accountInfo = await connection.getAccountInfo(tokenStatsPDA);

      if (!accountInfo) {
        results.push({
          mint: token.mint,
          symbol: token.symbol,
          status: 'warn',
          message: 'TokenStats not initialized',
          pendingFees: 0,
          pendingFeesSOL: 0,
        });
        continue;
      }

      // Parse TokenStats account data
      // Layout (simplified): discriminator(8) + mint(32) + total_burned(8) + total_sol_collected(8) +
      //                     total_sol_used(8) + total_sol_sent_to_root(8) + total_sol_received(8) +
      //                     total_buybacks(8) + last_cycle_timestamp(8) + last_cycle_sol(8) +
      //                     last_cycle_burned(8) + is_root_token(1) + bump(1) + pending_fees_lamports(8)
      const data = accountInfo.data;

      // Offset for pending_fees_lamports: 8 + 32 + 8*8 + 1 + 1 = 106
      const pendingFeesOffset = 106;
      const pendingFees = data.readBigUInt64LE(pendingFeesOffset);
      const pendingFeesNumber = Number(pendingFees);
      const pendingFeesSOL = pendingFeesNumber / LAMPORTS_PER_SOL;

      const status: 'pass' | 'warn' =
        pendingFeesNumber >= MIN_FEES_FOR_CYCLE ? 'pass' : 'warn';
      const message =
        status === 'pass'
          ? `Ready for cycle (${pendingFeesSOL.toFixed(6)} SOL)`
          : `Below threshold (${pendingFeesSOL.toFixed(6)} SOL < ${(MIN_FEES_FOR_CYCLE / LAMPORTS_PER_SOL).toFixed(4)} SOL)`;

      results.push({
        mint: token.mint,
        symbol: token.symbol,
        status,
        message,
        pendingFees: pendingFeesNumber,
        pendingFeesSOL,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      results.push({
        mint: token.mint,
        symbol: token.symbol,
        status: 'fail',
        message: `Failed to read TokenStats: ${errorMessage}`,
        pendingFees: 0,
        pendingFeesSOL: 0,
      });
    }
  }

  return results;
}

// ============================================================================
// Main Health Check
// ============================================================================

async function runHealthCheck(config: HealthConfig): Promise<HealthCheckResult> {
  const networkConfig = NETWORK_CONFIGS[config.network];
  const connection = new Connection(networkConfig.rpcUrl, 'confirmed');

  // Load token configs
  const tokens = loadTokenConfigs(config.network);

  // Run checks
  const [daemonResult, rpcResult, tokenResults] = await Promise.all([
    checkDaemonHealth(config),
    checkRpcHealth(connection, config),
    checkTokenStats(connection, tokens),
  ]);

  // Calculate metrics
  const totalPendingFees = tokenResults.reduce((sum, t) => sum + t.pendingFees, 0);
  const tokensAboveThreshold = tokenResults.filter(
    (t) => t.pendingFees >= MIN_FEES_FOR_CYCLE
  ).length;

  // Determine overall status
  let overall: 'healthy' | 'degraded' | 'critical' = 'healthy';

  if (daemonResult.status === 'fail' || rpcResult.status === 'fail') {
    overall = 'critical';
  } else if (
    daemonResult.status === 'warn' ||
    rpcResult.status === 'warn' ||
    tokenResults.some((t) => t.status === 'fail')
  ) {
    overall = 'degraded';
  }

  return {
    timestamp: new Date().toISOString(),
    overall,
    checks: {
      daemon: daemonResult,
      rpc: rpcResult,
      tokens: tokenResults,
    },
    metrics: {
      totalPendingFees,
      totalPendingFeesSOL: totalPendingFees / LAMPORTS_PER_SOL,
      tokensAboveThreshold,
      rpcLatencyMs: rpcResult.latencyMs,
    },
  };
}

// ============================================================================
// Token Loading
// ============================================================================

function loadTokenConfigs(network: NetworkType): TokenConfig[] {
  const tokens: TokenConfig[] = [];
  const tokensDir = path.join(process.cwd(), `${network}-tokens`);

  if (!fs.existsSync(tokensDir)) {
    // Fallback to individual files
    const rootFile = path.join(process.cwd(), `${network}-token-root.json`);
    if (fs.existsSync(rootFile)) {
      const config = JSON.parse(fs.readFileSync(rootFile, 'utf-8'));
      tokens.push({
        mint: config.mint,
        symbol: config.symbol,
        name: config.name,
        isRoot: true,
        poolType: config.poolType,
      });
    }
    return tokens;
  }

  // Load from directory
  const files = fs.readdirSync(tokensDir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    try {
      const filePath = path.join(tokensDir, file);
      const config = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      tokens.push({
        mint: config.mint,
        symbol: config.symbol,
        name: config.name,
        isRoot: config.isRoot || false,
        poolType: config.poolType,
      });
    } catch {
      // Skip invalid files
    }
  }

  return tokens;
}

// ============================================================================
// Output Formatting
// ============================================================================

function printHealthResult(result: HealthCheckResult, verbose: boolean): void {
  const statusIcon =
    result.overall === 'healthy'
      ? '🟢'
      : result.overall === 'degraded'
        ? '🟡'
        : '🔴';

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  ASDF-DAT Health Check - ${result.timestamp}`);
  console.log('═══════════════════════════════════════════════════════\n');

  console.log(`Status: ${statusIcon} ${result.overall.toUpperCase()}`);
  console.log('');

  // Daemon check
  const daemonIcon = result.checks.daemon.status === 'pass' ? '✅' : '❌';
  console.log(`${daemonIcon} Daemon: ${result.checks.daemon.message}`);

  // RPC check
  const rpcIcon = result.checks.rpc.status === 'pass' ? '✅' : '❌';
  console.log(`${rpcIcon} RPC: ${result.checks.rpc.message}`);

  // Token summary
  console.log('');
  console.log('Token Status:');
  for (const token of result.checks.tokens) {
    const icon = token.status === 'pass' ? '✅' : token.status === 'warn' ? '⚠️' : '❌';
    console.log(
      `  ${icon} ${token.symbol}: ${token.pendingFeesSOL.toFixed(6)} SOL - ${token.message}`
    );
  }

  // Metrics summary
  console.log('');
  console.log('Metrics:');
  console.log(
    `  Total Pending Fees: ${result.metrics.totalPendingFeesSOL.toFixed(6)} SOL`
  );
  console.log(
    `  Tokens Ready for Cycle: ${result.metrics.tokensAboveThreshold}/${result.checks.tokens.length}`
  );
  console.log(`  RPC Latency: ${result.metrics.rpcLatencyMs}ms`);

  if (verbose && result.checks.daemon.details) {
    console.log('');
    console.log('Daemon Details:');
    console.log(JSON.stringify(result.checks.daemon.details, null, 2));
  }

  console.log('');
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs(): HealthConfig {
  const args = process.argv.slice(2);

  const config: HealthConfig = {
    network: 'devnet',
    checkIntervalMs: 60_000, // 60 seconds
    daemonHealthTimeoutMs: 5_000,
    rpcTimeoutMs: 10_000,
    maxConsecutiveFailures: 3,
    runOnce: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--network' || arg === '-n') {
      const network = args[++i];
      if (network === 'mainnet' || network === 'devnet') {
        config.network = network;
      }
    } else if (arg === '--mainnet' || arg === '-m') {
      config.network = 'mainnet';
    } else if (arg === '--interval' || arg === '-i') {
      config.checkIntervalMs = parseInt(args[++i], 10) * 1000;
    } else if (arg === '--once' || arg === '-1') {
      config.runOnce = true;
    } else if (arg === '--verbose' || arg === '-v') {
      config.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: npx ts-node scripts/monitor-health-mainnet.ts [options]

Options:
  --network, -n <network>   Network: mainnet or devnet (default: devnet)
  --mainnet, -m             Shorthand for --network mainnet
  --interval, -i <seconds>  Check interval in seconds (default: 60)
  --once, -1                Run single check and exit
  --verbose, -v             Show detailed output
  --help, -h                Show this help

Exit Codes:
  0  All checks passed (healthy)
  1  Critical failure (daemon or RPC down)
  2  Degraded (warnings present)
`);
      process.exit(0);
    }
  }

  return config;
}

async function main(): Promise<void> {
  const config = parseArgs();

  console.log(`\n🔍 ASDF-DAT Health Monitor (${config.network})`);
  console.log(`   Interval: ${config.checkIntervalMs / 1000}s`);
  console.log(`   Mode: ${config.runOnce ? 'Single check' : 'Continuous'}`);

  let consecutiveFailures = 0;

  const runCheck = async (): Promise<number> => {
    try {
      const result = await runHealthCheck(config);
      printHealthResult(result, config.verbose);

      if (result.overall === 'critical') {
        consecutiveFailures++;
        console.log(
          `⚠️  Consecutive failures: ${consecutiveFailures}/${config.maxConsecutiveFailures}`
        );

        if (consecutiveFailures >= config.maxConsecutiveFailures) {
          console.log('\n🔴 CRITICAL: Too many consecutive failures!');
          return 1;
        }
      } else {
        consecutiveFailures = 0;
      }

      return result.overall === 'healthy' ? 0 : 2;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`\n❌ Health check error: ${errorMessage}`);
      consecutiveFailures++;
      return 1;
    }
  };

  if (config.runOnce) {
    const exitCode = await runCheck();
    process.exit(exitCode);
  }

  // Continuous monitoring
  console.log('\n📡 Starting continuous monitoring...');
  console.log('   Press Ctrl+C to stop\n');

  // Initial check
  await runCheck();

  // Schedule periodic checks
  setInterval(async () => {
    await runCheck();
  }, config.checkIntervalMs);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
