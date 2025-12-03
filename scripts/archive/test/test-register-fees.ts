/**
 * Test script to register validated fees for secondary tokens
 * This simulates what the daemon should do when it successfully flushes
 */

import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet, BN } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';

const PROGRAM_ID = new PublicKey('ASDfNfUHwVGfrg3SV7SQYWhaVxnrCUZyWmMpWJAPu4MZ');
const VALIDATOR_STATE_SEED = Buffer.from('validator_v1');
const TOKEN_STATS_SEED = Buffer.from('token_stats_v1');

function loadIdl() {
  const idlPath = path.join(__dirname, '../target/idl/asdf_dat.json');
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
  if (!idl.metadata) {
    idl.metadata = { address: PROGRAM_ID.toString() };
  }
  return idl;
}

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const walletKeyPair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync('./devnet-wallet.json', 'utf-8')))
  );
  const wallet = new Wallet(walletKeyPair);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const idl = loadIdl();
  const program = new Program(idl as any, provider);

  const tokens = [
    JSON.parse(fs.readFileSync('devnet-token-secondary.json', 'utf-8')),
    JSON.parse(fs.readFileSync('devnet-token-mayhem.json', 'utf-8'))
  ];

  const currentSlot = await connection.getSlot();
  console.log('Current slot:', currentSlot);

  for (const token of tokens) {
    const mint = new PublicKey(token.mint);
    const [validatorState] = PublicKey.findProgramAddressSync(
      [VALIDATOR_STATE_SEED, mint.toBuffer()],
      PROGRAM_ID
    );
    const [tokenStats] = PublicKey.findProgramAddressSync(
      [TOKEN_STATS_SEED, mint.toBuffer()],
      PROGRAM_ID
    );

    // Read validator state
    const vsAccount = await connection.getAccountInfo(validatorState);
    if (!vsAccount) {
      console.log(`\n${token.symbol}: No ValidatorState account`);
      continue;
    }

    // Read last_validated_slot (offset 72: discriminator(8) + mint(32) + bonding_curve(32))
    const lastValidatedSlot = Number(vsAccount.data.readBigUInt64LE(72));
    console.log(`\n${token.symbol}: last_validated_slot = ${lastValidatedSlot}`);
    console.log(`  Slot delta: ${currentSlot - lastValidatedSlot}`);

    // Register fees with a slot within range
    // For 2 secondaries with ~0.0055 SOL vault, we need ~0.00275 SOL each
    // But allocation = pending * ratio, and we need allocation >= MIN (0.00314)
    // So pending = MIN / ratio = 0.00314 / ~0.85 = 0.0037 SOL
    // Let's use 3,700,000 lamports each
    const feeAmount = 3_700_000; // 0.0037 SOL
    const newEndSlot = lastValidatedSlot + 500; // Stay well within 1000 range

    console.log(`  Attempting register with endSlot = ${newEndSlot}, feeAmount = ${feeAmount}`);

    try {
      const tx = await (program.methods as any)
        .registerValidatedFees(
          new BN(feeAmount),
          new BN(newEndSlot),
          1 // tx_count
        )
        .accounts({
          validatorState,
          tokenStats,
        })
        .rpc();
      console.log(`  ✅ Registered: ${tx.slice(0, 20)}...`);

      // Verify TokenStats was updated
      const stats: any = await (program.account as any).tokenStats.fetch(tokenStats);
      console.log(`  📊 New pending_fees_lamports: ${stats.pendingFeesLamports.toString()}`);

    } catch (error: any) {
      console.log(`  ❌ Error: ${error.message?.slice(0, 200) || error}`);
    }
  }
}

main().catch(console.error);
