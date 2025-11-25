/**
 * Start Validator Daemon
 *
 * This script starts the validator daemon that monitors PumpFun trades
 * and commits validated fees on-chain using the permissionless
 * register_validated_fees instruction.
 *
 * Usage:
 *   npx ts-node scripts/start-validator.ts [options]
 *
 * Options:
 *   --verbose    Enable verbose logging
 *   --interval   Flush interval in seconds (default: 30)
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet, Idl } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';
import { ValidatorDaemon, TokenConfig, createValidatorDaemon } from '../lib/validator-daemon';

const PROGRAM_ID = new PublicKey('ASDfNfUHwVGfrg3SV7SQYWhaVxnrCUZyWmMpWJAPu4MZ');

// Parse command line arguments
const args = process.argv.slice(2);
const verbose = args.includes('--verbose') || args.includes('-v');
const intervalArg = args.find(a => a.startsWith('--interval='));
const interval = intervalArg ? parseInt(intervalArg.split('=')[1]) * 1000 : 30000;

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('🔍 VALIDATOR DAEMON - Trustless Fee Attribution');
  console.log('='.repeat(70) + '\n');

  // Load connection
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // Load wallet (for signing - even though register_validated_fees is permissionless,
  // we need a wallet for the Provider)
  const walletPath = path.join(process.cwd(), 'devnet-wallet.json');
  if (!fs.existsSync(walletPath)) {
    console.error('❌ Wallet not found at devnet-wallet.json');
    console.error('   Please create a wallet or copy an existing one');
    process.exit(1);
  }

  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  );
  console.log(`👤 Wallet: ${wallet.publicKey.toBase58()}`);

  // Check balance
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`💰 Balance: ${(balance / 1e9).toFixed(4)} SOL`);

  if (balance < 0.01 * 1e9) {
    console.warn('⚠️  Low balance - consider topping up for transaction fees');
  }

  // Load IDL
  const idlPath = path.join(process.cwd(), 'target/idl/asdf_dat.json');
  if (!fs.existsSync(idlPath)) {
    console.error('❌ IDL not found at target/idl/asdf_dat.json');
    console.error('   Please run: anchor build');
    process.exit(1);
  }

  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8')) as Idl;
  const provider = new AnchorProvider(
    connection,
    new Wallet(wallet),
    { commitment: 'confirmed' }
  );
  const program = new Program(idl, provider);

  // Load token configs
  const tokenFiles = [
    'devnet-token-spl.json',
    'devnet-token-secondary.json',
    'devnet-token-mayhem.json',
  ];

  const tokens: TokenConfig[] = [];

  for (const file of tokenFiles) {
    const filePath = path.join(process.cwd(), file);
    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        tokens.push({
          mint: new PublicKey(data.mint),
          bondingCurve: new PublicKey(data.bondingCurve),
          creator: new PublicKey(data.creator),
          symbol: data.symbol || data.name || 'UNKNOWN',
        });
        console.log(`✅ Loaded ${data.symbol}: ${data.mint}`);
      } catch (error) {
        console.error(`❌ Failed to load ${file}:`, error);
      }
    } else {
      console.log(`⚠️  Token file not found: ${file}`);
    }
  }

  if (tokens.length === 0) {
    console.error('❌ No tokens loaded. Please create token config files.');
    process.exit(1);
  }

  console.log(`\n📊 Loaded ${tokens.length} token(s)`);
  console.log(`⏱️  Flush interval: ${interval / 1000}s`);
  console.log(`🔊 Verbose: ${verbose}`);

  // Create daemon
  const daemon = new ValidatorDaemon({
    connection,
    program,
    tokens,
    flushInterval: interval,
    verbose,
  });

  // Handle shutdown gracefully
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log('\n\n📴 Received shutdown signal...');

    // Flush any pending fees before stopping
    console.log('📤 Flushing pending fees before shutdown...');
    await daemon.forceFlush();

    await daemon.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start daemon
  console.log('\n' + '-'.repeat(70));
  await daemon.start();
  console.log('-'.repeat(70));

  // Print status periodically
  setInterval(() => {
    const pending = daemon.getAllPendingFees();
    let hasContent = false;

    for (const [mint, data] of pending) {
      if (data.amount > 0n) {
        if (!hasContent) {
          console.log('\n📊 Pending fees:');
          hasContent = true;
        }
        console.log(`   ${data.symbol}: ${Number(data.amount) / 1e9} SOL (${data.txCount} TXs)`);
      }
    }
  }, 60000); // Every minute

  console.log('\n👀 Monitoring for trades... (Press Ctrl+C to stop)\n');
}

main().catch((error) => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
