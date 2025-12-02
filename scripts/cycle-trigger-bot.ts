/**
 * Cycle Trigger Bot
 *
 * Simple, threshold-based autonomous cycle trigger.
 * Philosophy: Check threshold, execute if ready, repeat.
 *
 * The Formula:
 * - THRESHOLD = 0.19 SOL (gas efficiency minimum)
 * - MAX_PER_CYCLE = 10 SOL (safety cap)
 * - CHECK_INTERVAL = 60 seconds
 * - No optimization, no market timing
 *
 * Usage:
 *   npx ts-node scripts/cycle-trigger-bot.ts --network devnet
 *   npx ts-node scripts/cycle-trigger-bot.ts --network mainnet --threshold 0.5
 *   npx ts-node scripts/cycle-trigger-bot.ts --network devnet --dry-run
 *   npx ts-node scripts/cycle-trigger-bot.ts --network devnet --once
 */

import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { NETWORK_CONFIGS, NetworkType, parseNetworkArg } from '../lib/network-config';

// ============================================================================
// Constants - Simple, no optimization
// ============================================================================

const DEFAULT_THRESHOLD = 190_000_000;         // 0.19 SOL
const DEFAULT_CHECK_INTERVAL = 60_000;         // 60 seconds
// No cap in bot - slippage protection (5%) is the natural market-driven cap
const DAEMON_URL = 'http://localhost:3030';

// Pump.fun program IDs
const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMPSWAP_PROGRAM = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');

// ============================================================================
// Types
// ============================================================================

interface BotConfig {
  network: NetworkType;
  threshold: number;
  checkInterval: number;
  dryRun: boolean;
  runOnce: boolean;
  verbose: boolean;
}

interface TokenConfig {
  mint: string;
  creator: string;
  poolType: 'bonding_curve' | 'amm';
}

interface DaemonHealth {
  healthy: boolean;
  status?: string;
  lastPollAgoMs?: number;
  error?: string;
}

// ============================================================================
// Vault Balance Functions
// ============================================================================

/**
 * Derive creator vault PDA for bonding curve (BC) tokens
 * Seeds: ["creator-vault", creator] with HYPHEN
 */
function deriveCreatorVaultBC(creator: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('creator-vault'), creator.toBuffer()],
    PUMP_PROGRAM
  )[0];
}

/**
 * Derive creator vault PDA for AMM tokens
 * Seeds: ["creator_vault", creator] with UNDERSCORE
 */
function deriveCreatorVaultAMM(creator: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('creator_vault'), creator.toBuffer()],
    PUMPSWAP_PROGRAM
  )[0];
}

/**
 * Get total vault balance across all unique creators
 * Note: All tokens from same creator share one vault
 */
async function getCreatorVaultBalance(
  connection: Connection,
  tokens: TokenConfig[]
): Promise<number> {
  // Extract unique creators by pool type
  const bcCreators = new Set<string>();
  const ammCreators = new Set<string>();

  for (const token of tokens) {
    if (token.poolType === 'bonding_curve') {
      bcCreators.add(token.creator);
    } else if (token.poolType === 'amm') {
      ammCreators.add(token.creator);
    }
  }

  let totalBalance = 0;

  // Check BC vaults (native SOL)
  for (const creator of Array.from(bcCreators)) {
    const vault = deriveCreatorVaultBC(new PublicKey(creator));
    const balance = await connection.getBalance(vault);
    totalBalance += balance;
  }

  // Check AMM vaults (WSOL - need to check token account)
  // For AMM, the vault holds WSOL, so we check the WSOL token balance
  // For simplicity, we'll just check SOL balance as well (approximation)
  // The orchestrator handles WSOL unwrapping
  for (const creator of Array.from(ammCreators)) {
    const vault = deriveCreatorVaultAMM(new PublicKey(creator));
    const balance = await connection.getBalance(vault);
    totalBalance += balance;
  }

  return totalBalance;
}

// ============================================================================
// Daemon Health Functions
// ============================================================================

/**
 * Check daemon health
 */
async function checkDaemonHealth(): Promise<DaemonHealth> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${DAEMON_URL}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    // Parse body regardless of status code (daemon returns 503 for degraded, but body is valid)
    let data;
    try {
      data = await response.json();
    } catch {
      return {
        healthy: false,
        error: `Daemon returned ${response.status} (no body)`,
      };
    }

    // Check if daemon is running (status healthy or degraded is OK - degraded just means no recent trades)
    // We accept degraded because daemon may be idle with no new transactions to poll
    const isRunning = data.status === 'healthy' || data.status === 'degraded';
    const daemonRunning = data.checks?.daemon_running || false;
    const healthy = isRunning && daemonRunning;
    const lastPollAgoMs = data.details?.recent_poll ? 0 : undefined;

    return {
      healthy,
      status: data.status,
      lastPollAgoMs,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.includes('ECONNREFUSED')) {
      return {
        healthy: false,
        error: 'Daemon not running (connection refused)',
      };
    }

    return {
      healthy: false,
      error: message,
    };
  }
}

/**
 * Trigger daemon flush before cycle
 */
async function triggerDaemonFlush(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`${DAEMON_URL}/flush`, {
      method: 'POST',
      signal: controller.signal,
    });
    clearTimeout(timeout);

    return response.ok;
  } catch {
    return false;
  }
}

// ============================================================================
// Cycle Execution
// ============================================================================

/**
 * Execute ecosystem cycle via subprocess
 */
async function executeCycle(network: NetworkType, dryRun: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const args = [
      'ts-node',
      'scripts/execute-ecosystem-cycle.ts',
      '--network',
      network,
    ];

    if (dryRun) {
      args.push('--dry-run');
    }

    log(`Spawning: npx ${args.join(' ')}`);

    const child = spawn('npx', args, {
      cwd: process.cwd(),
      stdio: 'inherit',
    });

    child.on('exit', (code) => {
      if (code === 0) {
        log('Cycle completed successfully');
        resolve(true);
      } else {
        log(`Cycle exited with code ${code}`);
        resolve(false);
      }
    });

    child.on('error', (err) => {
      log(`Cycle spawn error: ${err.message}`);
      resolve(false);
    });
  });
}

// ============================================================================
// Token Loading
// ============================================================================

function loadTokens(network: NetworkType): TokenConfig[] {
  const tokensDir = path.join(process.cwd(), `${network}-tokens`);
  const tokens: TokenConfig[] = [];

  if (!fs.existsSync(tokensDir)) {
    log(`Token directory not found: ${tokensDir}`);
    return tokens;
  }

  const files = fs.readdirSync(tokensDir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    try {
      const filePath = path.join(tokensDir, file);
      const config = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      tokens.push({
        mint: config.mint,
        creator: config.creator,
        poolType: config.poolType || 'bonding_curve',
      });
    } catch {
      // Skip invalid files
    }
  }

  return tokens;
}

// ============================================================================
// Logging
// ============================================================================

function log(message: string): void {
  const timestamp = new Date().toISOString().slice(11, 19);
  console.log(`[${timestamp}] ${message}`);
}

// ============================================================================
// Main Loop
// ============================================================================

async function checkAndExecute(
  connection: Connection,
  tokens: TokenConfig[],
  config: BotConfig
): Promise<void> {
  // 1. Check daemon health first
  const health = await checkDaemonHealth();
  if (!health.healthy) {
    if (config.verbose) {
      log(`Daemon not healthy: ${health.error || 'unknown'}`);
    }
    return;
  }

  if (config.verbose) {
    log(`Daemon healthy (last poll ${health.lastPollAgoMs}ms ago)`);
  }

  // 2. Get vault balance
  const vaultBalance = await getCreatorVaultBalance(connection, tokens);
  const vaultBalanceSOL = vaultBalance / LAMPORTS_PER_SOL;

  if (config.verbose) {
    log(`Vault balance: ${vaultBalanceSOL.toFixed(6)} SOL`);
  }

  // 3. Simple threshold check
  if (vaultBalance >= config.threshold) {
    log(`Threshold met: ${vaultBalanceSOL.toFixed(4)} SOL >= ${(config.threshold / LAMPORTS_PER_SOL).toFixed(2)} SOL`);

    // 4. Force daemon flush before cycle
    log('Flushing daemon...');
    await triggerDaemonFlush();

    // Small delay to let flush complete
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // 5. Execute cycle
    log(config.dryRun ? 'Executing cycle (DRY RUN)...' : 'Executing cycle...');
    await executeCycle(config.network, config.dryRun);
  } else if (config.verbose) {
    log(`Below threshold: ${vaultBalanceSOL.toFixed(4)} SOL < ${(config.threshold / LAMPORTS_PER_SOL).toFixed(2)} SOL`);
  }
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs(): BotConfig {
  const args = process.argv.slice(2);

  const config: BotConfig = {
    network: parseNetworkArg(args),
    threshold: DEFAULT_THRESHOLD,
    checkInterval: DEFAULT_CHECK_INTERVAL,
    dryRun: false,
    runOnce: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--threshold' || arg === '-t') {
      const value = parseFloat(args[++i]);
      if (!isNaN(value)) {
        config.threshold = Math.floor(value * LAMPORTS_PER_SOL);
      }
    } else if (arg === '--interval' || arg === '-i') {
      const value = parseInt(args[++i], 10);
      if (!isNaN(value)) {
        config.checkInterval = value * 1000;
      }
    } else if (arg === '--dry-run') {
      config.dryRun = true;
    } else if (arg === '--once' || arg === '-1') {
      config.runOnce = true;
    } else if (arg === '--verbose' || arg === '-v') {
      config.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return config;
}

function printHelp(): void {
  console.log(`
Cycle Trigger Bot - Simple threshold-based cycle trigger

Usage: npx ts-node scripts/cycle-trigger-bot.ts [options]

Options:
  --network <devnet|mainnet>  Network to use (default: devnet)
  --threshold, -t <SOL>       Threshold in SOL (default: 0.19)
  --interval, -i <seconds>    Check interval in seconds (default: 60)
  --dry-run                   Log what would execute, don't actually trigger
  --once, -1                  Single check, then exit
  --verbose, -v               Show detailed logs
  --help, -h                  Show this help

Examples:
  npx ts-node scripts/cycle-trigger-bot.ts --network devnet
  npx ts-node scripts/cycle-trigger-bot.ts --network mainnet -t 0.5
  npx ts-node scripts/cycle-trigger-bot.ts --network devnet --dry-run --once

Philosophy:
  Check threshold. Execute if ready. Repeat.
  No optimization. No market timing. The market handles the rest.
`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const config = parseArgs();
  const networkConfig = NETWORK_CONFIGS[config.network];

  // Banner
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║           ASDF-DAT CYCLE TRIGGER BOT                 ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  log(`Network: ${config.network}`);
  log(`Threshold: ${(config.threshold / LAMPORTS_PER_SOL).toFixed(2)} SOL`);
  log(`Interval: ${config.checkInterval / 1000}s`);
  log(`Mode: ${config.runOnce ? 'Single check' : 'Continuous'}`);
  if (config.dryRun) {
    log('DRY RUN MODE - Will not execute actual cycles');
  }
  console.log('');

  // Load tokens
  const tokens = loadTokens(config.network);
  if (tokens.length === 0) {
    console.error('No tokens found in configuration');
    process.exit(1);
  }
  log(`Loaded ${tokens.length} tokens`);

  // Create connection
  const connection = new Connection(networkConfig.rpcUrl, 'confirmed');

  // Single check mode
  if (config.runOnce) {
    await checkAndExecute(connection, tokens, { ...config, verbose: true });
    process.exit(0);
  }

  // Continuous mode
  log('Starting continuous monitoring...');
  log('Press Ctrl+C to stop\n');

  // Initial check
  await checkAndExecute(connection, tokens, config);

  // Main loop - Simple
  setInterval(async () => {
    await checkAndExecute(connection, tokens, config);
  }, config.checkInterval);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
