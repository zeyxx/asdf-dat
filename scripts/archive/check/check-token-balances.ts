/**
 * Check current token balances for all 3 tokens
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { getAccount, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const walletPk = new PublicKey('EG7MiZWRcfWNZR4Z54G6azsGKwu9QzZePNzHE4TVdXR5');

  // Check all 3 token balances
  const tokens = [
    { name: 'DATS2 (Secondary SPL)', mint: '4bnfKBjKFJd5xiweNKMN1bBzETtegHdHe26Ej24DGUMK', program: TOKEN_PROGRAM_ID },
    { name: 'DATM (Mayhem Token2022)', mint: '3X4LdmUBx5jTweHFtCN1xewrKv5gFue4CiesdgEAT3CJ', program: TOKEN_2022_PROGRAM_ID },
    { name: 'DATSPL (Root SPL)', mint: 'rxeo277TLJfPYX6zaSfbtyHWY7BkTREL9AidoNi38jr', program: TOKEN_PROGRAM_ID }
  ];

  console.log('\n📊 CURRENT TOKEN BALANCES');
  console.log('═══════════════════════════════════════════════════════\n');

  for (const token of tokens) {
    const mint = new PublicKey(token.mint);
    const ata = await getAssociatedTokenAddress(mint, walletPk, false, token.program);

    try {
      const account = await getAccount(connection, ata, 'confirmed', token.program);
      const balance = Number(account.amount) / 1e6;
      console.log(`${token.name}:`);
      console.log(`  Balance: ${balance.toLocaleString()} tokens`);
      console.log(`  ATA: ${ata.toString()}\n`);
    } catch (error: any) {
      console.log(`${token.name}:`);
      console.log(`  Balance: 0 tokens (no account or error)`);
      console.log(`  Error: ${error.message}\n`);
    }
  }
}

main().catch(console.error);
