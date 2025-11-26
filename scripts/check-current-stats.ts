import { Connection, PublicKey } from '@solana/web3.js';
import { getNetworkConfig, printNetworkBanner } from '../lib/network-config';

const PROGRAM_ID = new PublicKey('ASDfNfUHwVGfrg3SV7SQYWhaVxnrCUZyWmMpWJAPu4MZ');
const TOKEN_STATS_SEED = Buffer.from('token_stats_v1');

async function main() {
  // Parse network argument
  const args = process.argv.slice(2);
  const networkConfig = getNetworkConfig(args);

  printNetworkBanner(networkConfig);

  const connection = new Connection(networkConfig.rpcUrl, 'confirmed');

  const tokens = [
    { symbol: 'DATSPL', mint: 'rxeo277TLJfPYX6zaSfbtyHWY7BkTREL9AidoNi38jr' },
    { symbol: 'DATS2', mint: '4bnfKBjKFJd5xiweNKMN1bBzETtegHdHe26Ej24DGUMK' },
    { symbol: 'DATM', mint: '3X4LdmUBx5jTweHFtCN1xewrKv5gFue4CiesdgEAT3CJ' }
  ];

  console.log('📊 Current TokenStats Status:\n');

  for (const token of tokens) {
    const mint = new PublicKey(token.mint);
    const [tokenStats] = PublicKey.findProgramAddressSync(
      [TOKEN_STATS_SEED, mint.toBuffer()],
      PROGRAM_ID
    );

    try {
      const accountInfo = await connection.getAccountInfo(tokenStats);
      if (!accountInfo) {
        console.log(`❌ ${token.symbol}: Account not found`);
        continue;
      }

      const data = accountInfo.data;
      const pending_fees = data.readBigUInt64LE(114);
      const last_update = data.readBigInt64LE(122);
      const cycles = data.readBigUInt64LE(130);

      console.log(`✅ ${token.symbol}:`);
      console.log(`   Pending Fees: ${pending_fees} lamports (${Number(pending_fees) / 1e9} SOL)`);
      console.log(`   Last Update: ${new Date(Number(last_update) * 1000).toISOString()}`);
      console.log(`   Cycles Participated: ${cycles}`);
      console.log('');
    } catch (err: any) {
      console.log(`❌ ${token.symbol}: Error - ${err.message}`);
    }
  }
}

main().catch(console.error);
