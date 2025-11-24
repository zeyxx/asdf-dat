/**
 * Migrate All TokenStats Accounts
 *
 * Initializes new fields for existing TokenStats accounts after smart contract upgrade:
 * - pending_fees_lamports: u64 (initialized to 0)
 * - last_fee_update_timestamp: i64 (initialized to current timestamp)
 * - cycles_participated: u64 (initialized to 0)
 *
 * This script should be run once after deploying the upgraded smart contract to devnet/mainnet.
 *
 * Usage:
 *   npx ts-node scripts/migrate-all-token-stats.ts
 *
 * Requirements:
 *   - Admin wallet with authority to migrate (devnet-wallet.json)
 *   - Existing TokenStats accounts for all tokens
 *   - Upgraded smart contract deployed
 */

import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Constants
// ============================================================================

const PROGRAM_ID = new PublicKey('ASDfNfUHwVGfrg3SV7SQYWhaVxnrCUZyWmMpWJAPu4MZ');
const DAT_STATE_SEED = Buffer.from('dat_v3');
const TOKEN_STATS_SEED = Buffer.from('token_stats_v1');

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

// ============================================================================
// Token Configuration
// ============================================================================

interface TokenConfig {
  file: string;
  name: string;
  symbol: string;
  mint: PublicKey;
  isRoot: boolean;
}

function loadTokenConfigs(): TokenConfig[] {
  const tokenFiles = [
    { file: 'devnet-token-spl.json', name: 'Root SPL Token', symbol: 'DATSPL', isRoot: true },
    { file: 'devnet-token-secondary.json', name: 'Secondary SPL Token', symbol: 'DATS2', isRoot: false },
    { file: 'devnet-token-mayhem.json', name: 'Secondary Token2022', symbol: 'DATM', isRoot: false },
  ];

  const tokens: TokenConfig[] = [];

  for (const config of tokenFiles) {
    const filePath = path.join(__dirname, '..', config.file);

    if (!fs.existsSync(filePath)) {
      log('⚠️ ', `Token file not found: ${config.file} - Skipping`, colors.yellow);
      continue;
    }

    try {
      const tokenData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      tokens.push({
        file: config.file,
        name: config.name,
        symbol: config.symbol,
        mint: new PublicKey(tokenData.mint),
        isRoot: config.isRoot,
      });
    } catch (error) {
      log('❌', `Failed to load ${config.file}: ${(error as Error).message || String(error)}`, colors.red);
    }
  }

  return tokens;
}

// ============================================================================
// Migration Function
// ============================================================================

async function migrateTokenStats(
  program: Program,
  token: TokenConfig,
  adminKeypair: Keypair
): Promise<boolean> {
  try {
    log('🔄', `Migrating ${token.symbol} (${token.name})...`, colors.cyan);

    // Derive PDAs
    const [datState] = PublicKey.findProgramAddressSync([DAT_STATE_SEED], program.programId);
    const [tokenStats] = PublicKey.findProgramAddressSync(
      [TOKEN_STATS_SEED, token.mint.toBuffer()],
      program.programId
    );

    // Check if TokenStats account exists
    try {
      const accountInfo = await program.provider.connection.getAccountInfo(tokenStats);
      if (!accountInfo) {
        log('  ⚠️ ', `TokenStats account doesn't exist yet - Skipping`, colors.yellow);
        return false;
      }
    } catch (error) {
      log('  ⚠️ ', `Cannot fetch TokenStats account - Skipping`, colors.yellow);
      return false;
    }

    // Fetch current stats to check if already migrated
    const currentStats: any = await (program.account as any).tokenStats.fetch(tokenStats);

    // Check if already migrated (pending_fees_lamports should be 0 initially)
    // Note: We can't easily check if already migrated, so we'll just try to migrate
    // The instruction should be idempotent

    log('  📊', 'Current TokenStats:', colors.cyan);
    log('     ', `Total Burned: ${currentStats.totalBurned.toString()}`, colors.reset);
    log('     ', `Total SOL Collected: ${currentStats.totalSolCollected.toString()}`, colors.reset);
    log('     ', `Total Buybacks: ${currentStats.totalBuybacks.toString()}`, colors.reset);

    // Call migrate_token_stats instruction
    log('  🔧', 'Calling migrate_token_stats()...', colors.cyan);

    const tx = await program.methods
      .migrateTokenStats()
      .accounts({
        datState,
        tokenStats,
        mint: token.mint,
        admin: adminKeypair.publicKey,
      })
      .signers([adminKeypair])
      .rpc();

    log('  ✅', `Migration successful!`, colors.green);
    log('  🔗', `TX: https://explorer.solana.com/tx/${tx}?cluster=devnet`, colors.cyan);

    // Fetch updated stats to verify migration
    const updatedStats: any = await (program.account as any).tokenStats.fetch(tokenStats);

    log('  📊', 'Migrated TokenStats:', colors.green);
    log('     ', `pending_fees_lamports: ${updatedStats.pendingFeesLamports.toString()}`, colors.green);
    log('     ', `last_fee_update_timestamp: ${updatedStats.lastFeeUpdateTimestamp.toString()}`, colors.green);
    log('     ', `cycles_participated: ${updatedStats.cyclesParticipated.toString()}`, colors.green);

    return true;

  } catch (error) {
    // Check if error is "already migrated" or other known errors
    const errorMsg = (error as Error).message || String(error);

    if (errorMsg.includes('already initialized') || errorMsg.includes('AlreadyInUse')) {
      log('  ℹ️ ', 'Already migrated - Skipping', colors.cyan);
      return true;
    }

    log('  ❌', `Migration failed: ${errorMsg}`, colors.red);

    if ((error as any).logs) {
      console.log('     📋 Transaction logs:');
      (error as any).logs.slice(-5).forEach((l: string) => console.log(`        ${l}`));
    }

    return false;
  }
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  console.log(colors.bright + colors.magenta);
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                   MIGRATE ALL TOKENSTATS ACCOUNTS                           ║');
  console.log('║          Initialize new fields after smart contract upgrade                 ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log(colors.reset + '\n');

  // Setup connection and provider
  const rpcUrl = process.env.RPC_URL || 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');

  const walletPath = process.env.WALLET_PATH || 'devnet-wallet.json';
  if (!fs.existsSync(walletPath)) {
    throw new Error(`Wallet file not found: ${walletPath}`);
  }

  const adminKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  );

  const provider = new AnchorProvider(
    connection,
    new Wallet(adminKeypair),
    { commitment: 'confirmed' }
  );

  // Load IDL
  const idlPath = path.join(__dirname, '../target/idl/asdf_dat.json');
  if (!fs.existsSync(idlPath)) {
    throw new Error(`IDL file not found: ${idlPath}. Run 'anchor build' first.`);
  }

  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
  const program = new Program(idl as any, provider);

  log('🔗', `Connected to: ${rpcUrl}`, colors.cyan);
  log('👤', `Admin: ${adminKeypair.publicKey.toBase58()}`, colors.cyan);
  log('📜', `Program: ${PROGRAM_ID.toBase58()}`, colors.cyan);

  // Verify program is deployed
  try {
    const programAccount = await connection.getAccountInfo(PROGRAM_ID);
    if (!programAccount) {
      throw new Error('Program account not found. Ensure the program is deployed.');
    }
    log('✅', 'Program account verified', colors.green);
  } catch (error) {
    log('❌', `Program verification failed: ${(error as Error).message || String(error)}`, colors.red);
    process.exit(1);
  }

  console.log('');

  // Load token configs
  logSection('LOADING TOKEN CONFIGURATIONS');
  const tokens = loadTokenConfigs();

  if (tokens.length === 0) {
    log('❌', 'No token configuration files found', colors.red);
    log('ℹ️ ', 'Expected files: devnet-token-spl.json, devnet-token-secondary.json, devnet-token-mayhem.json', colors.cyan);
    process.exit(1);
  }

  log('📊', `Found ${tokens.length} token(s) to migrate:`, colors.cyan);
  tokens.forEach(token => {
    log('  •', `${token.symbol} (${token.name})${token.isRoot ? ' [ROOT]' : ''}`, colors.reset);
  });

  // Confirm before proceeding
  log('\n⚠️ ', 'This will migrate TokenStats for all tokens listed above.', colors.yellow);
  log('ℹ️ ', 'Press Ctrl+C to cancel, or wait 3 seconds to proceed...', colors.cyan);

  await new Promise(resolve => setTimeout(resolve, 3000));

  // Migrate each token
  logSection('MIGRATING TOKENSTATS ACCOUNTS');

  const results: { token: TokenConfig; success: boolean }[] = [];

  for (const token of tokens) {
    const success = await migrateTokenStats(program, token, adminKeypair);
    results.push({ token, success });
    console.log(''); // Spacing between tokens
  }

  // Display summary
  logSection('MIGRATION SUMMARY');

  const successCount = results.filter(r => r.success).length;
  const failureCount = results.filter(r => !r.success).length;

  console.log(colors.bright + 'Results:' + colors.reset);
  console.log('─'.repeat(80));

  for (const result of results) {
    const statusIcon = result.success ? '✅' : '❌';
    const statusColor = result.success ? colors.green : colors.red;
    const status = result.success ? 'Success' : 'Failed';

    console.log(
      `${statusColor}${statusIcon} ${result.token.symbol.padEnd(12)} ${status}${colors.reset}`
    );
  }

  console.log('─'.repeat(80));
  console.log('');

  log('📊', `Total Tokens: ${results.length}`, colors.bright);
  log('✅', `Successful: ${successCount}`, colors.green);
  log('❌', `Failed: ${failureCount}`, failureCount > 0 ? colors.red : colors.reset);

  console.log('');

  if (failureCount > 0) {
    log('⚠️ ', 'Some migrations failed. Review the errors above.', colors.yellow);
    log('💡', 'You can re-run this script to retry failed migrations.', colors.cyan);
    process.exit(1);
  } else {
    log('🎉', 'All TokenStats accounts migrated successfully!', colors.green);
    log('✅', 'Your ecosystem is ready for the new fee tracking system.', colors.bright);
    console.log('');
    log('📋', 'Next steps:', colors.cyan);
    log('  1.', 'Start fee monitoring: npx ts-node scripts/monitor-ecosystem-fees.ts', colors.reset);
    log('  2.', 'Run ecosystem cycle: npx ts-node scripts/execute-ecosystem-cycle.ts', colors.reset);
    console.log('');
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error(colors.red + '\n❌ Fatal error:' + colors.reset);
    console.error(colors.red + ((error as Error).message || String(error)) + colors.reset);
    if ((error as Error).stack) {
      console.error((error as Error).stack);
    }
    process.exit(1);
  });
}

export { main as migrateAllTokenStats };
