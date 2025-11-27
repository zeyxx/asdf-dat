/**
 * Create All Required ATAs for Ecosystem
 *
 * Pre-creates all Associated Token Accounts needed for cycles to avoid InsufficientFundsForRent errors
 */

import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token';
import fs from 'fs';

const PROGRAM_ID = new PublicKey('ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui');

async function main() {
  console.log('\n🔧 CREATING ALL REQUIRED ATAs FOR ECOSYSTEM');
  console.log('═══════════════════════════════════════════════════════\n');

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const payer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync('devnet-wallet.json', 'utf-8')))
  );

  console.log(`Payer: ${payer.publicKey.toString()}\n`);

  // Load token configs
  const tokens = [
    { file: 'devnet-token-spl.json', program: TOKEN_PROGRAM_ID },
    { file: 'devnet-token-secondary.json', program: TOKEN_PROGRAM_ID },
    { file: 'devnet-token-mayhem.json', program: TOKEN_2022_PROGRAM_ID },
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

  let totalCreated = 0;

  // Create ATAs for each token
  for (const { file, program } of tokens) {
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
        // Skip if incompatible (e.g., SPL recipient with Token2022 mint)
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
      totalCreated++;

    } catch (error: any) {
      console.log(`  ⚠️  Some ATAs may already exist: ${error.message}\n`);
    }
  }

  console.log('═══════════════════════════════════════════════════════');
  console.log(`✅ ATA Creation Complete - ${totalCreated} tokens processed`);
  console.log('═══════════════════════════════════════════════════════\n');
  console.log('🎯 Now cycles can execute without rent errors!');
  console.log('   Run: bash scripts/manual-ecosystem-test.sh\n');
}

main().catch(console.error);
