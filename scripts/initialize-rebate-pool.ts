#!/usr/bin/env npx ts-node

/**
 * Initialize Rebate Pool
 *
 * Creates the RebatePool PDA and its associated token account.
 * Run once during protocol setup.
 *
 * Usage:
 *   npx ts-node scripts/initialize-rebate-pool.ts --network devnet
 *   npx ts-node scripts/initialize-rebate-pool.ts --network mainnet
 */

import { Connection, Keypair, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { Program, AnchorProvider, setProvider, Wallet } from '@coral-xyz/anchor';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

// Import IDL
import idlJson from '../target/idl/asdf_dat.json';

const IDL = idlJson as any;

// PDA Seeds
const DAT_STATE_SEED = Buffer.from('dat_v3');
const REBATE_POOL_SEED = Buffer.from('rebate_pool');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bright: '\x1b[1m',
};

function log(emoji: string, message: string, color = colors.reset): void {
  console.log(`${color}${emoji} ${message}${colors.reset}`);
}

/**
 * Detect which token program a mint uses (SPL Token or Token2022)
 */
async function getTokenProgramId(
  connection: Connection,
  mint: PublicKey
): Promise<PublicKey> {
  const mintInfo = await connection.getAccountInfo(mint);
  if (!mintInfo) {
    throw new Error(`Mint account not found: ${mint.toBase58()}`);
  }
  // Token2022 = TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
  if (mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    return TOKEN_2022_PROGRAM_ID;
  }
  return TOKEN_PROGRAM_ID;
}

async function main() {
  // Parse arguments
  const args = process.argv.slice(2);
  const networkIdx = args.indexOf('--network');
  const network = networkIdx !== -1 ? args[networkIdx + 1] : 'devnet';

  log('🚀', `Initializing Rebate Pool on ${network}`, colors.cyan);

  // Set up connection
  const rpcUrl = network === 'mainnet'
    ? process.env.MAINNET_RPC || 'https://api.mainnet-beta.solana.com'
    : process.env.DEVNET_RPC || 'https://api.devnet.solana.com';

  const connection = new Connection(rpcUrl, 'confirmed');

  // Load wallet
  const walletPath = network === 'mainnet'
    ? path.resolve(__dirname, '../mainnet-wallet.json')
    : path.resolve(__dirname, '../devnet-wallet.json');

  if (!fs.existsSync(walletPath)) {
    throw new Error(`Wallet file not found: ${walletPath}`);
  }

  const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  const adminKeypair = Keypair.fromSecretKey(Uint8Array.from(walletData));

  log('👛', `Admin wallet: ${adminKeypair.publicKey.toBase58()}`, colors.cyan);

  // Set up Anchor provider
  const wallet = new Wallet(adminKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
    skipPreflight: false,
  });
  setProvider(provider);

  // Load program
  const programId = new PublicKey(IDL.address);
  const program = new Program(IDL, provider);

  log('📋', `Program ID: ${programId.toBase58()}`, colors.cyan);

  // Derive PDAs
  const [datState] = PublicKey.findProgramAddressSync([DAT_STATE_SEED], programId);
  const [rebatePool, rebatePoolBump] = PublicKey.findProgramAddressSync([REBATE_POOL_SEED], programId);

  log('🔑', `DAT State PDA: ${datState.toBase58()}`, colors.cyan);
  log('🔑', `Rebate Pool PDA: ${rebatePool.toBase58()} (bump: ${rebatePoolBump})`, colors.cyan);

  // Check if rebate pool already exists
  const rebatePoolInfo = await connection.getAccountInfo(rebatePool);
  if (rebatePoolInfo) {
    log('⚠️', 'Rebate pool already initialized!', colors.yellow);
    return;
  }

  // Get ASDF mint from DAT state
  const datStateAccount = await (program.account as any).datState.fetch(datState);
  const asdfMint = datStateAccount.asdfMint as PublicKey;

  log('🪙', `ASDF Mint: ${asdfMint.toBase58()}`, colors.cyan);

  // Detect token program from mint owner
  const tokenProgramId = await getTokenProgramId(connection, asdfMint);
  log('🔧', `Token Program: ${tokenProgramId.equals(TOKEN_2022_PROGRAM_ID) ? 'Token2022' : 'SPL Token'}`, colors.cyan);

  // Get rebate pool ATA with correct program
  const rebatePoolAta = await getAssociatedTokenAddress(
    asdfMint,
    rebatePool,
    true, // Allow owner off curve (PDA)
    tokenProgramId // Use detected program
  );

  log('🏦', `Rebate Pool ATA: ${rebatePoolAta.toBase58()}`, colors.cyan);

  // Build transaction
  const tx = new Transaction();

  // 1. Initialize rebate pool PDA
  const initRebatePoolIx = await program.methods
    .initializeRebatePool()
    .accounts({
      rebatePool,
      datState,
      admin: adminKeypair.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  tx.add(initRebatePoolIx);

  // 2. Create rebate pool ATA if it doesn't exist
  const rebatePoolAtaInfo = await connection.getAccountInfo(rebatePoolAta);
  if (!rebatePoolAtaInfo) {
    const createAtaIx = createAssociatedTokenAccountInstruction(
      adminKeypair.publicKey, // payer
      rebatePoolAta, // ata address
      rebatePool, // owner (PDA)
      asdfMint, // mint
      tokenProgramId // Use detected program
    );
    tx.add(createAtaIx);
    log('📦', 'Adding create ATA instruction', colors.cyan);
  }

  // Send transaction
  log('🚀', 'Sending transaction...', colors.cyan);

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = adminKeypair.publicKey;

  tx.sign(adminKeypair);

  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });

  // Wait for confirmation
  await connection.confirmTransaction({
    signature,
    blockhash,
    lastValidBlockHeight,
  });

  log('✅', `Rebate Pool initialized!`, colors.green);
  log('📝', `Transaction: ${signature}`, colors.green);
  log('🔑', `Rebate Pool PDA: ${rebatePool.toBase58()}`, colors.green);
  log('🏦', `Rebate Pool ATA: ${rebatePoolAta.toBase58()}`, colors.green);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
