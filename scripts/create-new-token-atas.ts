/**
 * Create ATAs for New Devnet Test Tokens
 */

import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token';
import fs from 'fs';
import path from 'path';

const PROGRAM_ID = new PublicKey('ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui');

async function main() {
  console.log('\n🔧 CREATING ATAs FOR NEW TEST TOKENS');
  console.log('═══════════════════════════════════════════════════════\n');

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const payer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync('devnet-wallet.json', 'utf-8')))
  );

  console.log(`Payer: ${payer.publicKey.toString()}\n`);

  // New test tokens
  const tokens = [
    { file: 'devnet-tokens/01-troot.json', program: TOKEN_PROGRAM_ID },
    { file: 'devnet-tokens/02-ts1.json', program: TOKEN_PROGRAM_ID },
    { file: 'devnet-tokens/03-ts2.json', program: TOKEN_PROGRAM_ID },
    { file: 'devnet-tokens/04-ts3.json', program: TOKEN_PROGRAM_ID },
    { file: 'devnet-tokens/05-tmay.json', program: TOKEN_2022_PROGRAM_ID },
  ];

  // Protocol fee recipients (from PumpFun)
  const feeRecipients = [
    new PublicKey('6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs'),  // SPL
    new PublicKey('GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS'),  // Token2022
  ];

  // Get DAT Authority
  const [datAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('auth_v3')],
    PROGRAM_ID
  );

  console.log(`DAT Authority: ${datAuthority.toString()}\n`);

  // Create ATAs for each token
  for (const { file, program } of tokens) {
    if (!fs.existsSync(file)) {
      console.log(`⚠️ Skipping ${file} (not found)`);
      continue;
    }

    const tokenInfo = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const mint = new PublicKey(tokenInfo.mint);

    console.log(`━━━ ${tokenInfo.symbol} ━━━`);
    console.log(`Mint: ${mint.toString()}`);

    const tx = new Transaction();

    // 1. DAT Authority ATA (for holding tokens before burn)
    const datAta = await getAssociatedTokenAddress(mint, datAuthority, true, program);
    console.log(`  → DAT Authority ATA: ${datAta.toString()}`);
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        payer.publicKey,
        datAta,
        datAuthority,
        mint,
        program
      )
    );

    // 2. Protocol Fee Recipient ATAs
    for (const recipient of feeRecipients) {
      try {
        const recipientAta = await getAssociatedTokenAddress(mint, recipient, true, program);
        console.log(`  → Fee Recipient ATA: ${recipientAta.toString()}`);
        tx.add(
          createAssociatedTokenAccountIdempotentInstruction(
            payer.publicKey,
            recipientAta,
            recipient,
            mint,
            program
          )
        );
      } catch (err) {
        // Skip if incompatible
      }
    }

    // Send transaction
    try {
      tx.feePayer = payer.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      const sig = await connection.sendTransaction(tx, [payer], {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
      await connection.confirmTransaction(sig, 'confirmed');

      console.log(`  ✅ ATAs created: ${sig}`);
      console.log(`     https://explorer.solana.com/tx/${sig}?cluster=devnet\n`);
    } catch (err: any) {
      console.log(`  ❌ Error: ${err.message}\n`);
    }
  }

  console.log('═══════════════════════════════════════════════════════');
  console.log('✅ ATA Creation Complete');
  console.log('═══════════════════════════════════════════════════════\n');
}

main().catch(console.error);
