/**
 * Check accumulated fees in creator vault and root treasury
 */

import { Connection, PublicKey } from '@solana/web3.js';

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
  const PROGRAM_ID = new PublicKey('ASDfNfUHwVGfrg3SV7SQYWhaVxnrCUZyWmMpWJAPu4MZ');
  const creator = new PublicKey('4nS8cak3SUafTXsmaZVi1SEVoL67tNotsnmHG1RH7Jjd');
  const rootMint = new PublicKey('rxeo277TLJfPYX6zaSfbtyHWY7BkTREL9AidoNi38jr');

  const [vault] = PublicKey.findProgramAddressSync([Buffer.from('creator-vault'), creator.toBuffer()], PUMP_PROGRAM);
  const [treasury] = PublicKey.findProgramAddressSync([Buffer.from('root_treasury'), rootMint.toBuffer()], PROGRAM_ID);

  const [vaultBalance, treasuryBalance] = await Promise.all([
    connection.getBalance(vault),
    connection.getBalance(treasury)
  ]);

  console.log('\n📊 FEES ACCUMULATED');
  console.log('═══════════════════════════════════════════════════════\n');
  console.log('Creator Vault:   ' + (vaultBalance / 1e9).toFixed(6) + ' SOL');
  console.log('Root Treasury:   ' + (treasuryBalance / 1e9).toFixed(6) + ' SOL');
  console.log('─────────────────────────────────────────────────────────');
  console.log('Total Available: ' + ((vaultBalance + treasuryBalance) / 1e9).toFixed(6) + ' SOL\n');

  const total = (vaultBalance + treasuryBalance) / 1e9;
  const rentExempt = 0.000891;
  const safetyBuffer = 0.000050;
  const available = total - rentExempt - safetyBuffer;

  console.log('Breakdown:');
  console.log('  Rent exempt minimum: ' + rentExempt.toFixed(6) + ' SOL');
  console.log('  Safety buffer:       ' + safetyBuffer.toFixed(6) + ' SOL');
  console.log('  Available for ops:   ' + available.toFixed(6) + ' SOL\n');

  if (available >= 0.01) {
    console.log('✅ EXCELLENT! Sufficient fees for all secondary token cycles!');
    console.log('   Ready to execute complete ecosystem test.\n');
  } else if (available >= 0.005) {
    console.log('✅ GOOD! Should be sufficient for at least one cycle per token.');
    console.log('   May want more volume for multiple cycles.\n');
  } else if (available > 0) {
    console.log('⚠️  LOW: May struggle with cycles requiring rent + operations.');
    console.log('   Recommendation: Generate more volume (target: 0.01+ SOL)\n');
  } else {
    console.log('❌ INSUFFICIENT: Not enough for operations after rent.');
    console.log('   MUST generate more fees before cycles.\n');
  }
}

main().catch(console.error);
