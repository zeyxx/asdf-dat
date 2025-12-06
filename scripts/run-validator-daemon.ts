#!/usr/bin/env npx ts-node
/**
 * ASDF Validator Daemon - Standalone Runner
 *
 * Easy-to-use daemon for tracking per-token fee attribution.
 * Monitors creator vault balances and registers fees on-chain.
 *
 * Usage:
 *   npx ts-node scripts/run-validator-daemon.ts [options]
 *
 * Options:
 *   --network devnet|mainnet   Network to use (default: devnet)
 *   --verbose                  Enable verbose logging
 *   --interval <seconds>       Flush interval in seconds (default: 30)
 *   --tokens <dir>             Custom tokens directory
 *
 * Environment:
 *   DEVNET_RPC_URL    - Devnet RPC URL
 *   MAINNET_RPC_URL   - Mainnet RPC URL
 *   WALLET_PATH       - Path to admin wallet JSON
 *
 * The daemon will:
 * 1. Load all token configs from the tokens directory
 * 2. Monitor creator vault balances every 5 seconds
 * 3. Detect fee increases from trading activity
 * 4. Register validated fees on-chain every flush interval
 * 5. Track cumulative contributions per token
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet, Idl } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';
import { ValidatorDaemon, TokenConfig } from '../lib/validator-daemon';
import { PoolType } from '../lib/amm-utils';
import { getContributionLeaderboard, ASDF_PROGRAM_ID } from '../lib/asdev-integration';

// ============================================================================
// Configuration
// ============================================================================

interface DaemonConfig {
  network: 'devnet' | 'mainnet';
  rpcUrl: string;
  walletPath: string;
  tokensDir: string;
  flushInterval: number;
  verbose: boolean;
}

function parseDaemonConfig(args: string[]): DaemonConfig {
  const isMainnet = args.includes('--mainnet') || args.includes('--network=mainnet') ||
                    args.some(a => a === '--network' && args[args.indexOf(a) + 1] === 'mainnet');

  const network = isMainnet ? 'mainnet' : 'devnet';

  // Parse interval
  let flushInterval = 30000; // 30 seconds default
  const intervalIdx = args.findIndex(a => a === '--interval');
  if (intervalIdx !== -1 && args[intervalIdx + 1]) {
    flushInterval = parseInt(args[intervalIdx + 1], 10) * 1000;
  }

  // Parse tokens directory
  let tokensDir = isMainnet ? './mainnet-tokens' : './devnet-tokens';
  const tokensDirIdx = args.findIndex(a => a === '--tokens');
  if (tokensDirIdx !== -1 && args[tokensDirIdx + 1]) {
    tokensDir = args[tokensDirIdx + 1];
  }

  return {
    network,
    rpcUrl: isMainnet
      ? process.env.MAINNET_RPC_URL || 'https://api.mainnet-beta.solana.com'
      : process.env.DEVNET_RPC_URL || 'https://api.devnet.solana.com',
    walletPath: process.env.WALLET_PATH || (isMainnet ? './mainnet-wallet.json' : './devnet-wallet.json'),
    tokensDir,
    flushInterval,
    verbose: args.includes('--verbose') || args.includes('-v'),
  };
}

// ============================================================================
// Token Loading
// ============================================================================

interface TokenFileConfig {
  mint: string;
  bondingCurve?: string;
  pool?: string;
  poolType?: PoolType;
  creator: string;
  symbol?: string;
  name?: string;
}

function loadTokenConfigs(tokensDir: string): TokenConfig[] {
  if (!fs.existsSync(tokensDir)) {
    console.error(`❌ Tokens directory not found: ${tokensDir}`);
    console.log('   Create the directory and add token JSON files');
    process.exit(1);
  }

  const files = fs.readdirSync(tokensDir).filter(f => f.endsWith('.json'));

  if (files.length === 0) {
    console.error(`❌ No token configurations found in ${tokensDir}`);
    process.exit(1);
  }

  const tokens: TokenConfig[] = [];

  for (const file of files) {
    const filePath = path.join(tokensDir, file);
    try {
      const data: TokenFileConfig = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      // Validate required fields
      if (!data.mint || !data.creator) {
        console.warn(`⚠️  Skipping ${file}: missing mint or creator`);
        continue;
      }

      const poolType: PoolType = data.poolType || 'bonding_curve';

      tokens.push({
        mint: new PublicKey(data.mint),
        creator: new PublicKey(data.creator),
        symbol: data.symbol || data.name || 'UNKNOWN',
        poolType,
        bondingCurve: data.bondingCurve ? new PublicKey(data.bondingCurve) : undefined,
        pool: data.pool ? new PublicKey(data.pool) : undefined,
      });

      console.log(`✅ Loaded ${data.symbol || data.name} (${poolType})`);
    } catch (error) {
      console.warn(`⚠️  Failed to load ${file}:`, error);
    }
  }

  return tokens;
}

// ============================================================================
// Status Display
// ============================================================================

async function printStatus(
  connection: Connection,
  tokens: TokenConfig[],
  daemon: ValidatorDaemon
): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('📊 VALIDATOR STATUS');
  console.log('='.repeat(60));

  // Get pending fees from daemon
  const pendingFees = daemon.getAllPendingFees();
  let totalPending = 0n;

  console.log('\nPending fees (not yet flushed):');
  for (const [mint, data] of pendingFees) {
    if (data.amount > 0n) {
      console.log(`   ${data.symbol}: ${(Number(data.amount) / 1e9).toFixed(6)} SOL`);
      totalPending += data.amount;
    }
  }

  if (totalPending === 0n) {
    console.log('   (none)');
  } else {
    console.log(`   Total pending: ${(Number(totalPending) / 1e9).toFixed(6)} SOL`);
  }

  // Get on-chain contributions
  const mints = tokens.map(t => t.mint);
  try {
    const leaderboard = await getContributionLeaderboard(connection, mints);

    if (leaderboard.length > 0) {
      console.log('\nOn-chain contributions (validated):');
      for (const c of leaderboard) {
        const symbol = tokens.find(t => t.mint.toBase58() === c.mint)?.symbol || 'UNKNOWN';
        console.log(`   ${symbol}: ${c.totalFeesSOL.toFixed(6)} SOL (${c.percentage.toFixed(1)}%)`);
      }

      const totalOnChain = leaderboard.reduce((sum, c) => sum + c.totalFees, 0);
      console.log(`   Total on-chain: ${(totalOnChain / 1e9).toFixed(6)} SOL`);
    }
  } catch (error) {
    // Ignore errors during status display
  }

  console.log('='.repeat(60) + '\n');
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
ASDF Validator Daemon - Per-Token Fee Attribution

USAGE:
  npx ts-node scripts/run-validator-daemon.ts [options]

OPTIONS:
  --network devnet|mainnet   Network to use (default: devnet)
  --verbose, -v              Enable verbose logging
  --interval <seconds>       Flush interval in seconds (default: 30)
  --tokens <dir>             Custom tokens directory
  --help, -h                 Show this help message

EXAMPLES:
  # Run on devnet with default settings
  npx ts-node scripts/run-validator-daemon.ts

  # Run on mainnet with verbose logging
  npx ts-node scripts/run-validator-daemon.ts --network mainnet --verbose

  # Custom flush interval (60 seconds)
  npx ts-node scripts/run-validator-daemon.ts --interval 60

ENVIRONMENT:
  DEVNET_RPC_URL    Devnet RPC URL
  MAINNET_RPC_URL   Mainnet RPC URL
  WALLET_PATH       Path to admin wallet JSON

The daemon monitors creator vault balances and registers fee
contributions on-chain for per-token attribution tracking.
`);
    process.exit(0);
  }

  const config = parseDaemonConfig(args);

  console.log('\n' + '='.repeat(60));
  console.log('🔥 ASDF VALIDATOR DAEMON');
  console.log('='.repeat(60));
  console.log(`Network: ${config.network.toUpperCase()}`);
  console.log(`RPC: ${config.rpcUrl}`);
  console.log(`Tokens: ${config.tokensDir}`);
  console.log(`Flush interval: ${config.flushInterval / 1000}s`);
  console.log(`Verbose: ${config.verbose}`);
  console.log('='.repeat(60) + '\n');

  // Load wallet
  if (!fs.existsSync(config.walletPath)) {
    console.error(`❌ Wallet not found: ${config.walletPath}`);
    console.log('   Create a wallet or set WALLET_PATH environment variable');
    process.exit(1);
  }

  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(config.walletPath, 'utf-8')))
  );
  console.log(`👤 Admin wallet: ${wallet.publicKey.toBase58()}`);

  // Setup connection
  const connection = new Connection(config.rpcUrl, 'confirmed');

  // Check balance
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`💰 Balance: ${(balance / 1e9).toFixed(4)} SOL`);

  if (balance < 0.01 * 1e9) {
    console.warn('⚠️  Low balance! Daemon needs SOL for transaction fees');
  }

  // Load IDL
  const idlPath = path.join(process.cwd(), 'target/idl/asdf_dat.json');
  if (!fs.existsSync(idlPath)) {
    console.error('\n❌ IDL not found at target/idl/asdf_dat.json');
    console.error('   Run: anchor build');
    process.exit(1);
  }

  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8')) as Idl;
  const provider = new AnchorProvider(
    connection,
    new Wallet(wallet),
    { commitment: 'confirmed' }
  );
  const program = new Program(idl, provider);

  // Load tokens
  console.log('\n📦 Loading token configurations...\n');
  const tokens = loadTokenConfigs(config.tokensDir);

  if (tokens.length === 0) {
    console.error('\n❌ No valid tokens found');
    process.exit(1);
  }

  console.log(`\n✅ Loaded ${tokens.length} token(s)\n`);

  // Create daemon
  const daemon = new ValidatorDaemon({
    connection,
    program,
    tokens,
    flushInterval: config.flushInterval,
    verbose: config.verbose,
  });

  // Handle shutdown
  let shutdownRequested = false;

  const shutdown = async () => {
    if (shutdownRequested) return;
    shutdownRequested = true;

    console.log('\n\n🛑 Shutdown requested...');
    console.log('   Flushing pending fees before exit...');

    try {
      await daemon.forceFlush();
    } catch (error) {
      console.error('   Failed to flush:', error);
    }

    await daemon.stop();
    console.log('✅ Daemon stopped cleanly\n');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start daemon
  await daemon.start();

  // Periodic status display (every 60 seconds)
  const statusInterval = setInterval(async () => {
    if (!shutdownRequested && daemon.isRunning()) {
      await printStatus(connection, tokens, daemon);
    }
  }, 60000);

  // Initial status
  setTimeout(() => {
    if (daemon.isRunning()) {
      printStatus(connection, tokens, daemon);
    }
  }, 5000);

  // Keep running
  console.log('\n✅ Daemon running. Press Ctrl+C to stop.\n');
}

main().catch((error) => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
