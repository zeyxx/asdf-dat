import { Connection, PublicKey } from '@solana/web3.js';
import { getNetworkConfig, printNetworkBanner } from '../lib/network-config';

const PROGRAM_ID = new PublicKey('ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui');
const TOKEN_STATS_SEED = Buffer.from('token_stats_v1');

async function main() {
  // Parse network argument
  const args = process.argv.slice(2);
  const networkConfig = getNetworkConfig(args);

  printNetworkBanner(networkConfig);

  const connection = new Connection(networkConfig.rpcUrl, 'confirmed');

  // Load tokens from network config dynamically
  const fs = await import('fs');
  const tokens = networkConfig.tokens
    .filter(f => fs.existsSync(f))
    .map(f => {
      const tokenData = JSON.parse(fs.readFileSync(f, 'utf8'));
      return { symbol: tokenData.symbol || f, ...tokenData };
    });

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
      // TokenStats layout (after 8-byte discriminator):
      // mint: 32 bytes (offset 8)
      // total_burned: u64 (offset 40)
      // total_sol_collected: u64 (offset 48)
      // total_sol_used: u64 (offset 56)
      // total_sol_sent_to_root: u64 (offset 64)
      // total_sol_received_from_others: u64 (offset 72)
      // total_buybacks: u32 (offset 80)
      // is_root_token: bool (offset 84)
      // creator: 32 bytes (offset 85)
      // pending_fees_lamports: u64 (offset 117 - actually 114 due to padding?)
      // last_update_timestamp: i64 (offset 122)
      // cycles_participated: u64 (offset 130)

      const total_burned = data.readBigUInt64LE(40);
      const total_sol_collected = data.readBigUInt64LE(48);
      const total_sol_used = data.readBigUInt64LE(56);
      const total_buybacks = data.readUInt32LE(80);
      const pending_fees = data.readBigUInt64LE(114);
      const last_update = data.readBigInt64LE(122);
      const cycles = data.readBigUInt64LE(130);

      console.log(`✅ ${token.symbol}:`);
      console.log(`   🔥 Total Burned: ${total_burned} tokens (${(Number(total_burned) / 1e6).toFixed(2)}M)`);
      console.log(`   💰 Total SOL Collected: ${total_sol_collected} lamports (${Number(total_sol_collected) / 1e9} SOL)`);
      console.log(`   💸 Total SOL Used: ${total_sol_used} lamports (${Number(total_sol_used) / 1e9} SOL)`);
      console.log(`   🔄 Total Buybacks: ${total_buybacks}`);
      console.log(`   ⏳ Pending Fees: ${pending_fees} lamports (${Number(pending_fees) / 1e9} SOL)`);
      console.log(`   📅 Last Update: ${new Date(Number(last_update) * 1000).toISOString()}`);
      console.log(`   🎯 Cycles Participated: ${cycles}`);
      console.log('');
    } catch (err: any) {
      console.log(`❌ ${token.symbol}: Error - ${err.message}`);
    }
  }
}

main().catch(console.error);
