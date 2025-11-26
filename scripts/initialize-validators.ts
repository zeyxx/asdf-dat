/**
 * Initialize Validators for All Tokens
 *
 * This script initializes ValidatorState accounts for each token
 * in the ecosystem. Must be run once per token before the validator
 * daemon can register fees.
 *
 * Usage:
 *   npx ts-node scripts/initialize-validators.ts [options]
 *
 * Options:
 *   --network    Network to use: mainnet or devnet (default: devnet)
 */

import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet, Idl } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';
import { getNetworkConfig, printNetworkBanner } from '../lib/network-config';

const PROGRAM_ID = new PublicKey('ASDfNfUHwVGfrg3SV7SQYWhaVxnrCUZyWmMpWJAPu4MZ');
const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const VALIDATOR_STATE_SEED = Buffer.from('validator_v1');

interface TokenInfo {
  mint: string;
  bondingCurve: string;
  symbol: string;
  name: string;
}

async function main() {
  const args = process.argv.slice(2);
  const networkConfig = getNetworkConfig(args);

  printNetworkBanner(networkConfig);
  console.log('🔧 INITIALIZE VALIDATOR STATES');
  console.log('='.repeat(70) + '\n');

  // Load connection
  const connection = new Connection(networkConfig.rpcUrl, 'confirmed');
  console.log(`🌐 RPC: ${networkConfig.rpcUrl}`);

  // Load wallet
  const walletPath = path.join(process.cwd(), networkConfig.wallet);
  if (!fs.existsSync(walletPath)) {
    console.error(`❌ Wallet not found at ${networkConfig.wallet}`);
    process.exit(1);
  }

  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  );
  console.log(`👤 Wallet: ${wallet.publicKey.toBase58()}`);

  // Check balance
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`💰 Balance: ${(balance / 1e9).toFixed(4)} SOL`);

  if (balance < 0.1 * 1e9) {
    console.warn('⚠️  Low balance - need ~0.003 SOL per validator initialization');
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

  // Load token configs from network config
  const tokenFiles = networkConfig.tokens;

  const tokens: TokenInfo[] = [];

  for (const file of tokenFiles) {
    const filePath = path.join(process.cwd(), file);
    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        tokens.push({
          mint: data.mint,
          bondingCurve: data.bondingCurve,
          symbol: data.symbol || data.name || 'UNKNOWN',
          name: data.name,
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
    console.error('❌ No tokens loaded');
    process.exit(1);
  }

  console.log(`\n📊 Found ${tokens.length} token(s) to initialize\n`);
  console.log('-'.repeat(70));

  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;

  for (const token of tokens) {
    console.log(`\n🔄 Processing ${token.symbol}...`);

    const mint = new PublicKey(token.mint);
    const bondingCurve = new PublicKey(token.bondingCurve);

    // Derive ValidatorState PDA
    const [validatorState, bump] = PublicKey.findProgramAddressSync(
      [VALIDATOR_STATE_SEED, mint.toBuffer()],
      PROGRAM_ID
    );

    console.log(`   Mint: ${mint.toBase58()}`);
    console.log(`   Bonding Curve: ${bondingCurve.toBase58()}`);
    console.log(`   Validator PDA: ${validatorState.toBase58()}`);

    // Check if already initialized
    try {
      const existingAccount = await connection.getAccountInfo(validatorState);
      if (existingAccount) {
        console.log(`   ⏭️  Already initialized, skipping`);
        skipCount++;
        continue;
      }
    } catch {
      // Account doesn't exist, proceed with initialization
    }

    // Verify bonding curve is owned by PumpFun
    try {
      const bcAccount = await connection.getAccountInfo(bondingCurve);
      if (!bcAccount) {
        console.log(`   ❌ Bonding curve account not found`);
        failCount++;
        continue;
      }

      if (!bcAccount.owner.equals(PUMP_PROGRAM)) {
        console.log(`   ❌ Bonding curve not owned by PumpFun`);
        console.log(`      Expected: ${PUMP_PROGRAM.toBase58()}`);
        console.log(`      Actual: ${bcAccount.owner.toBase58()}`);
        failCount++;
        continue;
      }

      console.log(`   ✅ Bonding curve verified (owner: PumpFun)`);
    } catch (error) {
      console.log(`   ❌ Failed to verify bonding curve:`, error);
      failCount++;
      continue;
    }

    // Initialize validator
    try {
      const tx = await program.methods
        .initializeValidator()
        .accounts({
          validatorState,
          bondingCurve,
          mint,
          payer: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([wallet])
        .rpc();

      console.log(`   ✅ Initialized! TX: ${tx}`);
      successCount++;

      // Wait a bit between transactions
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error: any) {
      console.log(`   ❌ Failed to initialize: ${error.message || error}`);

      // Check for specific errors
      if (error.message?.includes('already in use')) {
        console.log(`      ↳ Account already exists`);
        skipCount++;
      } else {
        failCount++;
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('📊 SUMMARY');
  console.log('='.repeat(70));
  console.log(`   ✅ Initialized: ${successCount}`);
  console.log(`   ⏭️  Skipped: ${skipCount}`);
  console.log(`   ❌ Failed: ${failCount}`);
  console.log(`   📦 Total: ${tokens.length}`);

  if (successCount + skipCount === tokens.length) {
    console.log('\n✅ All validators ready!');
    console.log('\n📝 Next steps:');
    console.log('   1. Start the validator daemon:');
    console.log('      npx ts-node scripts/start-validator.ts --verbose');
    console.log('\n   2. Generate some volume:');
    console.log('      npx ts-node scripts/generate-volume.ts devnet-token-spl.json 5 0.1');
    console.log('\n   3. Check pending fees:');
    console.log('      The daemon will automatically register fees every 30s');
  } else {
    console.log('\n⚠️  Some validators failed to initialize. Check errors above.');
  }
}

main().catch((error) => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
