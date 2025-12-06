#!/usr/bin/env node
/**
 * ASDF Validator SDK - CLI
 *
 * Simple CLI to run a validator daemon for your creator address.
 *
 * Usage:
 *   npx @asdf/validator-sdk --creator <ADDRESS>
 *   npx @asdf/validator-sdk -c <ADDRESS> --verbose
 */

import { ValidatorDaemon, TokenConfig, deriveBondingCurveVault, derivePumpSwapVault } from './daemon';
import { PublicKey, Connection } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Argument Parsing
// ============================================================================

interface CLIArgs {
  creatorAddress: string | null;
  rpcUrl: string;
  tokensFile: string | null;
  verbose: boolean;
  showHelp: boolean;
  pollInterval: number;
}

function parseArgs(args: string[]): CLIArgs {
  const result: CLIArgs = {
    creatorAddress: null,
    rpcUrl: process.env.RPC_URL || 'https://api.mainnet-beta.solana.com',
    tokensFile: null,
    verbose: false,
    showHelp: false,
    pollInterval: 5000,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      result.showHelp = true;
    } else if (arg === '--verbose' || arg === '-v') {
      result.verbose = true;
    } else if (arg === '--creator' || arg === '-c') {
      result.creatorAddress = args[++i];
    } else if (arg === '--rpc' || arg === '-r') {
      result.rpcUrl = args[++i];
    } else if (arg === '--tokens' || arg === '-t') {
      result.tokensFile = args[++i];
    } else if (arg === '--interval' || arg === '-i') {
      result.pollInterval = parseInt(args[++i], 10) * 1000;
    } else if (arg.startsWith('--creator=')) {
      result.creatorAddress = arg.split('=')[1];
    } else if (arg.startsWith('--rpc=')) {
      result.rpcUrl = arg.split('=')[1];
    }
  }

  return result;
}

function showHelp(): void {
  console.log(`
🔥 ASDF Validator SDK

Track creator fees for your Pump.fun tokens.

USAGE:
  npx @asdf/validator-sdk --creator <ADDRESS> [options]

REQUIRED:
  --creator, -c <ADDRESS>   Your creator wallet address

OPTIONS:
  --rpc, -r <URL>           RPC URL (default: mainnet public)
  --tokens, -t <FILE>       JSON file with token configs
  --interval, -i <SECONDS>  Poll interval (default: 5)
  --verbose, -v             Enable verbose logging
  --help, -h                Show this help

ENVIRONMENT:
  RPC_URL                   Default RPC URL

EXAMPLES:
  # Basic usage - monitor your creator vault
  npx @asdf/validator-sdk -c 5ABC...xyz

  # With custom RPC and verbose logging
  npx @asdf/validator-sdk -c 5ABC...xyz -r https://my-rpc.com -v

  # With token config file
  npx @asdf/validator-sdk -c 5ABC...xyz -t tokens.json

TOKEN CONFIG FILE (tokens.json):
  [
    {
      "mint": "TokenMint...",
      "symbol": "MYTOKEN",
      "bondingCurve": "BC...",
      "poolType": "bonding_curve"
    }
  ]

HOW IT WORKS:
  1. Monitors your creator vault(s) for balance changes
  2. Detects fee accumulation from trading activity
  3. Tracks total fees per token
  4. Reports stats every 60 seconds

Press Ctrl+C to stop and see final stats.
`);
}

// ============================================================================
// Token Loading
// ============================================================================

function loadTokens(filePath: string): TokenConfig[] {
  try {
    const fullPath = path.resolve(filePath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const data = JSON.parse(content);

    if (Array.isArray(data)) {
      return data.map((t: any) => ({
        mint: t.mint,
        symbol: t.symbol || t.name || 'UNKNOWN',
        bondingCurve: t.bondingCurve || t.pool,
        poolType: t.poolType || 'bonding_curve',
      }));
    }

    // Single token object
    return [{
      mint: data.mint,
      symbol: data.symbol || data.name || 'UNKNOWN',
      bondingCurve: data.bondingCurve || data.pool,
      poolType: data.poolType || 'bonding_curve',
    }];
  } catch (error) {
    console.error(`Error loading tokens from ${filePath}:`, error);
    return [];
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.showHelp || !args.creatorAddress) {
    showHelp();
    process.exit(args.showHelp ? 0 : 1);
  }

  // Validate creator address
  let creator: PublicKey;
  try {
    creator = new PublicKey(args.creatorAddress);
  } catch {
    console.error('❌ Invalid creator address');
    process.exit(1);
  }

  // Derive vault addresses for display
  const bcVault = deriveBondingCurveVault(creator);
  const ammVault = derivePumpSwapVault(creator);

  console.log('\n🔥 ASDF VALIDATOR DAEMON');
  console.log('═'.repeat(55));
  console.log(`Creator:    ${creator.toBase58()}`);
  console.log(`BC Vault:   ${bcVault.toBase58()}`);
  console.log(`AMM Vault:  ${ammVault.toBase58()}`);
  console.log(`RPC:        ${args.rpcUrl.slice(0, 50)}...`);
  console.log(`Poll:       ${args.pollInterval / 1000}s`);
  console.log('═'.repeat(55));

  // Load tokens if file provided
  let tokens: TokenConfig[] = [];
  if (args.tokensFile) {
    tokens = loadTokens(args.tokensFile);
    console.log(`\n📦 Loaded ${tokens.length} token(s):`);
    for (const t of tokens) {
      console.log(`   • ${t.symbol} (${t.poolType})`);
    }
  }

  // Create daemon
  const daemon = new ValidatorDaemon({
    rpcUrl: args.rpcUrl,
    creatorAddress: args.creatorAddress,
    tokens: tokens.length > 0 ? tokens : undefined,
    pollInterval: args.pollInterval,
    verbose: args.verbose,

    onFeeDetected: (record) => {
      const sol = Number(record.amount) / 1e9;
      const time = new Date().toISOString().slice(11, 19);
      console.log(`[${time}] 💰 ${record.symbol}: +${sol.toFixed(6)} SOL`);
    },

    onStats: (stats) => {
      const total = stats.reduce((sum, s) => sum + Number(s.totalFees), 0);
      console.log('\n📊 STATS');
      console.log('─'.repeat(40));
      console.log(`Total: ${(total / 1e9).toFixed(6)} SOL`);
      for (const s of stats) {
        if (s.totalFees > 0n) {
          const pct = total > 0 ? (Number(s.totalFees) / total * 100).toFixed(1) : '0';
          console.log(`  ${s.symbol}: ${(Number(s.totalFees) / 1e9).toFixed(6)} SOL (${pct}%)`);
        }
      }
      console.log('─'.repeat(40) + '\n');
    },
  });

  // Handle shutdown
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log('\n\n🛑 Shutting down...');
    daemon.stop();

    const total = daemon.getTotalFees();
    const stats = daemon.getStats();

    console.log('\n📊 FINAL STATS');
    console.log('═'.repeat(40));
    console.log(`Total fees tracked: ${(Number(total) / 1e9).toFixed(6)} SOL`);

    for (const s of stats) {
      if (s.totalFees > 0n) {
        console.log(`  ${s.symbol}: ${(Number(s.totalFees) / 1e9).toFixed(6)} SOL`);
      }
    }

    console.log('═'.repeat(40));
    console.log('\n✅ Goodbye!\n');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start daemon
  console.log('\n▶ Starting daemon...\n');
  await daemon.start();
  console.log('✅ Daemon running. Press Ctrl+C to stop.\n');
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
