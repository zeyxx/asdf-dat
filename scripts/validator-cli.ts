#!/usr/bin/env npx ts-node
/**
 * ASDF Validator CLI
 *
 * Simple CLI tool for external apps to initialize and manage validators
 * for per-token fee attribution tracking.
 *
 * Commands:
 *   init <mint> <bonding-curve>  - Initialize validator for a token
 *   status <mint>                - Check validator status
 *   list                         - List all validators from config
 *   add-token <mint> <bc> <symbol> - Add token to tracking config
 *
 * Usage:
 *   npx ts-node scripts/validator-cli.ts init <mint> <bonding-curve> [--network devnet]
 *   npx ts-node scripts/validator-cli.ts status <mint> [--network devnet]
 *   npx ts-node scripts/validator-cli.ts list [--network devnet]
 *
 * Environment:
 *   DEVNET_RPC_URL  - Devnet RPC URL (default: https://api.devnet.solana.com)
 *   WALLET_PATH     - Path to wallet JSON (default: ./devnet-wallet.json)
 */

import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet, Idl } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';
import {
  isValidatorInitialized,
  getTokenContribution,
  deriveValidatorStatePDA,
  ASDF_PROGRAM_ID,
  formatContribution,
} from '../lib/asdev-integration';
import { PUMP_PROGRAM, PUMPSWAP_PROGRAM } from '../lib/amm-utils';

// ============================================================================
// Configuration
// ============================================================================

interface CliConfig {
  network: 'devnet' | 'mainnet';
  rpcUrl: string;
  walletPath: string;
  tokensDir: string;
}

function getCliConfig(args: string[]): CliConfig {
  const isMainnet = args.includes('--mainnet') || args.includes('--network=mainnet');
  const network = isMainnet ? 'mainnet' : 'devnet';

  return {
    network,
    rpcUrl: isMainnet
      ? process.env.MAINNET_RPC_URL || 'https://api.mainnet-beta.solana.com'
      : process.env.DEVNET_RPC_URL || 'https://api.devnet.solana.com',
    walletPath: process.env.WALLET_PATH || (isMainnet ? './mainnet-wallet.json' : './devnet-wallet.json'),
    tokensDir: isMainnet ? './mainnet-tokens' : './devnet-tokens',
  };
}

// ============================================================================
// Commands
// ============================================================================

async function cmdInit(mint: string, bondingCurve: string, config: CliConfig): Promise<void> {
  console.log('\n🔧 INITIALIZE VALIDATOR');
  console.log('='.repeat(60));

  const connection = new Connection(config.rpcUrl, 'confirmed');
  console.log(`Network: ${config.network}`);
  console.log(`RPC: ${config.rpcUrl}`);

  // Load wallet
  if (!fs.existsSync(config.walletPath)) {
    console.error(`\n❌ Wallet not found: ${config.walletPath}`);
    console.log('   Create a wallet or set WALLET_PATH environment variable');
    process.exit(1);
  }

  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(config.walletPath, 'utf-8')))
  );
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);

  // Check balance
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Balance: ${(balance / 1e9).toFixed(4)} SOL`);

  if (balance < 0.01 * 1e9) {
    console.error('\n❌ Insufficient balance. Need at least 0.01 SOL');
    process.exit(1);
  }

  // Parse addresses
  let mintPubkey: PublicKey;
  let bcPubkey: PublicKey;

  try {
    mintPubkey = new PublicKey(mint);
    bcPubkey = new PublicKey(bondingCurve);
  } catch {
    console.error('\n❌ Invalid address format');
    process.exit(1);
  }

  console.log(`\nMint: ${mintPubkey.toBase58()}`);
  console.log(`Bonding Curve: ${bcPubkey.toBase58()}`);

  // Check if already initialized
  const [validatorPDA] = deriveValidatorStatePDA(mintPubkey);
  console.log(`Validator PDA: ${validatorPDA.toBase58()}`);

  const isInit = await isValidatorInitialized(connection, mintPubkey);
  if (isInit) {
    console.log('\n✅ Validator already initialized!');
    const contribution = await getTokenContribution(connection, mintPubkey);
    if (contribution) {
      console.log('\nCurrent status:');
      console.log(formatContribution(contribution).split('\n').map(l => `   ${l}`).join('\n'));
    }
    return;
  }

  // Verify bonding curve owner
  const bcAccount = await connection.getAccountInfo(bcPubkey);
  if (!bcAccount) {
    console.error('\n❌ Bonding curve account not found');
    process.exit(1);
  }

  const isPumpFun = bcAccount.owner.equals(PUMP_PROGRAM);
  const isPumpSwap = bcAccount.owner.equals(PUMPSWAP_PROGRAM);

  if (!isPumpFun && !isPumpSwap) {
    console.error('\n❌ Bonding curve not owned by PumpFun or PumpSwap');
    console.error(`   Owner: ${bcAccount.owner.toBase58()}`);
    console.error(`   Expected: ${PUMP_PROGRAM.toBase58()} or ${PUMPSWAP_PROGRAM.toBase58()}`);
    process.exit(1);
  }

  console.log(`Pool Type: ${isPumpFun ? 'PumpFun Bonding Curve' : 'PumpSwap AMM'}`);

  // Load IDL and create program
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

  // Initialize validator
  console.log('\n📤 Sending transaction...');

  try {
    const tx = await program.methods
      .initializeValidator()
      .accounts({
        validatorState: validatorPDA,
        bondingCurve: bcPubkey,
        mint: mintPubkey,
        payer: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet])
      .rpc();

    console.log(`\n✅ Validator initialized!`);
    console.log(`   TX: ${tx}`);
    console.log(`   Explorer: https://solscan.io/tx/${tx}?cluster=${config.network}`);

  } catch (error: any) {
    console.error('\n❌ Failed to initialize:', error.message || error);
    process.exit(1);
  }
}

async function cmdStatus(mint: string, config: CliConfig): Promise<void> {
  console.log('\n📊 VALIDATOR STATUS');
  console.log('='.repeat(60));

  const connection = new Connection(config.rpcUrl, 'confirmed');
  console.log(`Network: ${config.network}`);

  let mintPubkey: PublicKey;
  try {
    mintPubkey = new PublicKey(mint);
  } catch {
    console.error('❌ Invalid mint address');
    process.exit(1);
  }

  const [validatorPDA] = deriveValidatorStatePDA(mintPubkey);
  console.log(`\nMint: ${mintPubkey.toBase58()}`);
  console.log(`Validator PDA: ${validatorPDA.toBase58()}`);

  const isInit = await isValidatorInitialized(connection, mintPubkey);

  if (!isInit) {
    console.log('\n❌ Validator NOT initialized');
    console.log('\n   To initialize:');
    console.log(`   npx ts-node scripts/validator-cli.ts init ${mint} <bonding-curve>`);
    return;
  }

  console.log('\n✅ Validator initialized');

  const contribution = await getTokenContribution(connection, mintPubkey);
  if (contribution) {
    console.log('\n' + formatContribution(contribution));
  }
}

async function cmdList(config: CliConfig): Promise<void> {
  console.log('\n📋 CONFIGURED TOKENS');
  console.log('='.repeat(60));

  const connection = new Connection(config.rpcUrl, 'confirmed');
  console.log(`Network: ${config.network}`);
  console.log(`Tokens dir: ${config.tokensDir}\n`);

  if (!fs.existsSync(config.tokensDir)) {
    console.log('❌ Tokens directory not found');
    console.log(`   Create ${config.tokensDir}/ and add token JSON files`);
    return;
  }

  const files = fs.readdirSync(config.tokensDir).filter(f => f.endsWith('.json'));

  if (files.length === 0) {
    console.log('No token configurations found');
    return;
  }

  let totalFees = 0;
  let initializedCount = 0;

  for (const file of files) {
    const filePath = path.join(config.tokensDir, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const mint = new PublicKey(data.mint);
      const isInit = await isValidatorInitialized(connection, mint);

      if (isInit) {
        initializedCount++;
        const contribution = await getTokenContribution(connection, mint);
        const fees = contribution?.totalFeesSOL || 0;
        totalFees += fees;

        console.log(`✅ ${data.symbol || data.name || 'UNKNOWN'}`);
        console.log(`   Mint: ${data.mint}`);
        console.log(`   Fees: ${fees.toFixed(6)} SOL`);
      } else {
        console.log(`❌ ${data.symbol || data.name || 'UNKNOWN'}`);
        console.log(`   Mint: ${data.mint}`);
        console.log(`   Status: Not initialized`);
      }
      console.log('');
    } catch (error) {
      console.log(`⚠️  ${file}: Failed to load`);
    }
  }

  console.log('-'.repeat(60));
  console.log(`Total: ${initializedCount}/${files.length} initialized`);
  console.log(`Total fees: ${totalFees.toFixed(6)} SOL`);
}

async function cmdAddToken(mint: string, bondingCurve: string, symbol: string, config: CliConfig): Promise<void> {
  console.log('\n➕ ADD TOKEN TO CONFIG');
  console.log('='.repeat(60));

  // Validate addresses
  let mintPubkey: PublicKey;
  let bcPubkey: PublicKey;

  try {
    mintPubkey = new PublicKey(mint);
    bcPubkey = new PublicKey(bondingCurve);
  } catch {
    console.error('❌ Invalid address format');
    process.exit(1);
  }

  // Determine pool type
  const connection = new Connection(config.rpcUrl, 'confirmed');
  const bcAccount = await connection.getAccountInfo(bcPubkey);

  if (!bcAccount) {
    console.error('❌ Bonding curve account not found');
    process.exit(1);
  }

  const poolType = bcAccount.owner.equals(PUMP_PROGRAM) ? 'bonding_curve' : 'pumpswap_amm';

  // Create tokens directory if needed
  if (!fs.existsSync(config.tokensDir)) {
    fs.mkdirSync(config.tokensDir, { recursive: true });
  }

  // Generate filename
  const existingFiles = fs.readdirSync(config.tokensDir).filter(f => f.endsWith('.json'));
  const nextNum = (existingFiles.length + 1).toString().padStart(2, '0');
  const filename = `${nextNum}-${symbol.toLowerCase()}.json`;
  const filePath = path.join(config.tokensDir, filename);

  // Get creator from bonding curve (simplified - would need proper parsing)
  // For now, use a placeholder that users can update
  const tokenConfig = {
    name: symbol,
    symbol: symbol.toUpperCase(),
    mint: mintPubkey.toBase58(),
    bondingCurve: bcPubkey.toBase58(),
    poolType,
    creator: 'UPDATE_WITH_CREATOR_PUBKEY',
    isRoot: false,
  };

  fs.writeFileSync(filePath, JSON.stringify(tokenConfig, null, 2));

  console.log(`\n✅ Token config created: ${filePath}`);
  console.log('\nConfig:');
  console.log(JSON.stringify(tokenConfig, null, 2));
  console.log('\n⚠️  Update the "creator" field with the actual creator pubkey');
}

// ============================================================================
// Main
// ============================================================================

function printUsage(): void {
  console.log(`
ASDF Validator CLI - Per-Token Fee Attribution

USAGE:
  npx ts-node scripts/validator-cli.ts <command> [args] [options]

COMMANDS:
  init <mint> <bonding-curve>     Initialize validator for a token
  status <mint>                   Check validator status and fees
  list                            List all configured tokens
  add-token <mint> <bc> <symbol>  Add token to tracking config

OPTIONS:
  --network devnet|mainnet        Network to use (default: devnet)
  --help                          Show this help message

EXAMPLES:
  # Initialize validator for a new token
  npx ts-node scripts/validator-cli.ts init \\
    3UD2AL3x7Ytkv4H3yk7vGS1xk2Y2u3eJFc4GaSnbbwBZ \\
    7WgMrKPLT9XqJZKKimTvsDfLPXmS6tKyYyFpmk2bYRsA

  # Check token status
  npx ts-node scripts/validator-cli.ts status 3UD2AL3x7Ytkv4H3yk7vGS1xk2Y2u3eJFc4GaSnbbwBZ

  # List all configured tokens
  npx ts-node scripts/validator-cli.ts list

  # Add token to config
  npx ts-node scripts/validator-cli.ts add-token \\
    3UD2AL3x7Ytkv4H3yk7vGS1xk2Y2u3eJFc4GaSnbbwBZ \\
    7WgMrKPLT9XqJZKKimTvsDfLPXmS6tKyYyFpmk2bYRsA \\
    MYTOKEN

ENVIRONMENT:
  DEVNET_RPC_URL    Devnet RPC URL
  MAINNET_RPC_URL   Mainnet RPC URL
  WALLET_PATH       Path to wallet JSON file

For more information: https://github.com/asdf-dat/validator-sdk
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const command = args[0];
  const config = getCliConfig(args);

  switch (command) {
    case 'init':
      if (args.length < 3) {
        console.error('❌ Usage: validator-cli.ts init <mint> <bonding-curve>');
        process.exit(1);
      }
      await cmdInit(args[1], args[2], config);
      break;

    case 'status':
      if (args.length < 2) {
        console.error('❌ Usage: validator-cli.ts status <mint>');
        process.exit(1);
      }
      await cmdStatus(args[1], config);
      break;

    case 'list':
      await cmdList(config);
      break;

    case 'add-token':
      if (args.length < 4) {
        console.error('❌ Usage: validator-cli.ts add-token <mint> <bonding-curve> <symbol>');
        process.exit(1);
      }
      await cmdAddToken(args[1], args[2], args[3], config);
      break;

    default:
      console.error(`❌ Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((error) => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
