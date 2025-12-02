/**
 * Rollback Cycle Script
 *
 * Manual recovery tool for handling partial cycle failures.
 * Use this script when a cycle fails partway through execution.
 *
 * Actions available:
 * 1. Reset pending_fees for a specific token (if buy failed but fees were attributed)
 * 2. View current state of all tokens
 * 3. Force finalize a stuck token
 *
 * Usage:
 *   npx ts-node scripts/rollback-cycle.ts --network mainnet --action status
 *   npx ts-node scripts/rollback-cycle.ts --network mainnet --action reset-fees --token <MINT>
 *
 * CAUTION: This script modifies on-chain state. Use with extreme care on mainnet.
 *
 * Exit Codes:
 *   0 - Success
 *   1 - Error
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, ComputeBudgetProgram } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet, BN } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { NETWORK_CONFIGS, NetworkType, NetworkConfig } from '../lib/network-config';

// ============================================================================
// Constants
// ============================================================================

const PROGRAM_ID = new PublicKey('ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui');
const DAT_STATE_SEED = Buffer.from('dat_v3');
const TOKEN_STATS_SEED = Buffer.from('token_stats_v1');

// ============================================================================
// Types
// ============================================================================

interface TokenConfig {
  mint: string;
  symbol: string;
  name: string;
  isRoot: boolean;
}

interface TokenState {
  mint: string;
  symbol: string;
  pendingFees: number;
  pendingFeesSOL: number;
  totalBurned: number;
  totalCycles: number;
  lastCycleTimestamp: number;
  lastCycleSOL: number;
}

type Action = 'status' | 'reset-fees' | 'help';

interface Args {
  network: NetworkType;
  action: Action;
  token?: string;
  force: boolean;
}

// ============================================================================
// PDA Derivation
// ============================================================================

function deriveDATStatePDA(): PublicKey {
  return PublicKey.findProgramAddressSync([DAT_STATE_SEED], PROGRAM_ID)[0];
}

function deriveTokenStatsPDA(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [TOKEN_STATS_SEED, mint.toBuffer()],
    PROGRAM_ID
  )[0];
}

// ============================================================================
// Token Loading
// ============================================================================

function loadTokenConfigs(network: NetworkType): TokenConfig[] {
  const tokens: TokenConfig[] = [];
  const tokensDir = path.join(process.cwd(), `${network}-tokens`);

  if (fs.existsSync(tokensDir)) {
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
        });
      } catch {
        // Skip invalid files
      }
    }
  }

  // Also check root token file
  const rootFile = path.join(process.cwd(), `${network}-token-root.json`);
  if (fs.existsSync(rootFile)) {
    try {
      const config = JSON.parse(fs.readFileSync(rootFile, 'utf-8'));
      if (!tokens.find((t) => t.mint === config.mint)) {
        tokens.push({
          mint: config.mint,
          symbol: config.symbol,
          name: config.name,
          isRoot: true,
        });
      }
    } catch {
      // Skip
    }
  }

  return tokens;
}

// ============================================================================
// State Reading
// ============================================================================

async function readTokenState(
  connection: Connection,
  token: TokenConfig
): Promise<TokenState | null> {
  const mint = new PublicKey(token.mint);
  const tokenStatsPDA = deriveTokenStatsPDA(mint);

  try {
    const accountInfo = await connection.getAccountInfo(tokenStatsPDA);
    if (!accountInfo) {
      return null;
    }

    const data = accountInfo.data;

    // Parse TokenStats layout (simplified):
    // 8 (discriminator) + 32 (mint) + 8 (total_burned) + 8 (total_sol_collected) +
    // 8 (total_sol_used) + 8 (total_sol_sent_to_root) + 8 (total_sol_received) +
    // 8 (total_buybacks) + 8 (last_cycle_timestamp) + 8 (last_cycle_sol) +
    // 8 (last_cycle_burned) + 1 (is_root_token) + 1 (bump) + 8 (pending_fees_lamports)

    const totalBurned = Number(data.readBigUInt64LE(40));
    const totalBuybacks = Number(data.readBigUInt64LE(72));
    const lastCycleTimestamp = Number(data.readBigInt64LE(80));
    const lastCycleSOL = Number(data.readBigUInt64LE(88));
    const pendingFees = Number(data.readBigUInt64LE(106));

    return {
      mint: token.mint,
      symbol: token.symbol,
      pendingFees,
      pendingFeesSOL: pendingFees / LAMPORTS_PER_SOL,
      totalBurned,
      totalCycles: totalBuybacks,
      lastCycleTimestamp,
      lastCycleSOL: lastCycleSOL / LAMPORTS_PER_SOL,
    };
  } catch (error) {
    console.error(`Error reading state for ${token.symbol}:`, error);
    return null;
  }
}

// ============================================================================
// Actions
// ============================================================================

async function showStatus(connection: Connection, tokens: TokenConfig[]): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  TOKEN STATUS');
  console.log('═══════════════════════════════════════════════════════\n');

  console.log('Token'.padEnd(12) + 'Pending Fees'.padEnd(16) + 'Total Cycles'.padEnd(14) + 'Last Cycle');
  console.log('─'.repeat(60));

  for (const token of tokens) {
    const state = await readTokenState(connection, token);

    if (!state) {
      console.log(`${token.symbol.padEnd(12)}NOT INITIALIZED`);
      continue;
    }

    const lastCycleTime = state.lastCycleTimestamp > 0
      ? new Date(state.lastCycleTimestamp * 1000).toISOString().slice(0, 19)
      : 'Never';

    console.log(
      `${state.symbol.padEnd(12)}${state.pendingFeesSOL.toFixed(6).padEnd(16)}${String(state.totalCycles).padEnd(14)}${lastCycleTime}`
    );
  }

  console.log('─'.repeat(60));
  console.log('');
}

async function resetPendingFees(
  connection: Connection,
  program: Program<any>,
  wallet: Keypair,
  token: TokenConfig,
  force: boolean
): Promise<boolean> {
  const state = await readTokenState(connection, token);

  if (!state) {
    console.log(`❌ TokenStats not found for ${token.symbol}`);
    return false;
  }

  if (state.pendingFees === 0) {
    console.log(`⚠️  ${token.symbol} already has 0 pending fees`);
    return true;
  }

  console.log(`\n📊 Current state for ${token.symbol}:`);
  console.log(`   Pending Fees: ${state.pendingFeesSOL.toFixed(6)} SOL`);
  console.log(`   Total Cycles: ${state.totalCycles}`);

  // Confirmation
  if (!force) {
    const confirmed = await confirm(
      `\n⚠️  This will reset pending_fees to 0 for ${token.symbol}. Continue?`
    );
    if (!confirmed) {
      console.log('Cancelled.');
      return false;
    }
  }

  console.log(`\n🔄 Resetting pending fees for ${token.symbol}...`);

  try {
    const mint = new PublicKey(token.mint);
    const tokenStatsPDA = deriveTokenStatsPDA(mint);
    const datStatePDA = deriveDATStatePDA();

    // Create update_pending_fees instruction with amount = -current (to reset to 0)
    // Actually, update_pending_fees adds to pending, so we need finalize_allocated_cycle
    // which resets pending_fees to 0

    // For safety, we'll use the existing finalize instruction which resets pending
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instruction = await (program.methods as any)
      .finalizeAllocatedCycle()
      .accounts({
        datState: datStatePDA,
        tokenStats: tokenStatsPDA,
        admin: wallet.publicKey,
      })
      .instruction();

    // Build transaction with compute budget
    const transaction = new Transaction();
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 })
    );
    transaction.add(instruction);

    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = wallet.publicKey;
    transaction.sign(wallet);

    const signature = await connection.sendRawTransaction(transaction.serialize());
    await connection.confirmTransaction(signature, 'confirmed');

    console.log(`✅ Pending fees reset successfully!`);
    console.log(`   TX: ${signature}`);

    return true;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ Failed to reset pending fees: ${errorMessage}`);
    return false;
  }
}

// ============================================================================
// Utilities
// ============================================================================

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

function printHelp(): void {
  console.log(`
Usage: npx ts-node scripts/rollback-cycle.ts [options]

Actions:
  --action status            Show current state of all tokens
  --action reset-fees        Reset pending_fees to 0 for a token
  --action help              Show this help

Options:
  --network <network>        Network: mainnet or devnet (default: devnet)
  --token <MINT>             Token mint address (required for reset-fees)
  --force                    Skip confirmation prompts

Examples:
  # View token status
  npx ts-node scripts/rollback-cycle.ts --network devnet --action status

  # Reset pending fees for a token
  npx ts-node scripts/rollback-cycle.ts --network devnet --action reset-fees --token ABC123...

CAUTION: This script modifies on-chain state. Use with care!
`);
}

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs(): Args {
  const args = process.argv.slice(2);

  const result: Args = {
    network: 'devnet',
    action: 'status',
    force: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--network' || arg === '-n') {
      const network = args[++i];
      if (network === 'mainnet' || network === 'devnet') {
        result.network = network;
      }
    } else if (arg === '--mainnet' || arg === '-m') {
      result.network = 'mainnet';
    } else if (arg === '--action' || arg === '-a') {
      const action = args[++i];
      if (action === 'status' || action === 'reset-fees' || action === 'help') {
        result.action = action;
      }
    } else if (arg === '--token' || arg === '-t') {
      result.token = args[++i];
    } else if (arg === '--force' || arg === '-f') {
      result.force = true;
    } else if (arg === '--help' || arg === '-h') {
      result.action = 'help';
    }
  }

  return result;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.action === 'help') {
    printHelp();
    process.exit(0);
  }

  console.log(`\n🔧 Rollback Cycle Tool (${args.network})\n`);

  const networkConfig = NETWORK_CONFIGS[args.network];
  const connection = new Connection(networkConfig.rpcUrl, 'confirmed');
  const tokens = loadTokenConfigs(args.network);

  if (tokens.length === 0) {
    console.error('❌ No tokens found in configuration');
    process.exit(1);
  }

  // Load wallet and program for write operations
  let wallet: Keypair | null = null;
  let program: Program<any> | null = null;

  if (args.action === 'reset-fees') {
    const walletPath = path.join(process.cwd(), networkConfig.wallet);
    if (!fs.existsSync(walletPath)) {
      console.error(`❌ Wallet not found: ${networkConfig.wallet}`);
      process.exit(1);
    }

    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
    wallet = Keypair.fromSecretKey(Uint8Array.from(walletData));

    // Load IDL
    const idlPath = path.join(process.cwd(), 'target/idl/asdf_dat.json');
    if (!fs.existsSync(idlPath)) {
      console.error('❌ IDL not found. Run anchor build first.');
      process.exit(1);
    }
    const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));

    const anchorWallet = new Wallet(wallet);
    const provider = new AnchorProvider(connection, anchorWallet, { commitment: 'confirmed' });
    program = new Program(idl, provider);
  }

  switch (args.action) {
    case 'status':
      await showStatus(connection, tokens);
      break;

    case 'reset-fees':
      if (!args.token) {
        console.error('❌ --token is required for reset-fees action');
        process.exit(1);
      }

      const token = tokens.find(
        (t) => t.mint === args.token || t.symbol.toLowerCase() === args.token?.toLowerCase()
      );

      if (!token) {
        console.error(`❌ Token not found: ${args.token}`);
        console.log('Available tokens:');
        tokens.forEach((t) => console.log(`  - ${t.symbol} (${t.mint.slice(0, 12)}...)`));
        process.exit(1);
      }

      const success = await resetPendingFees(connection, program!, wallet!, token, args.force);
      process.exit(success ? 0 : 1);
      break;
  }

  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
