/**
 * Test: Can datAuthority (creator) buy the token?
 *
 * This test checks if Pump.fun allows the creator to buy their own token.
 * Error 0x7d6 (2006) might be "CreatorCannotBuy" or similar restriction.
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import fs from 'fs';

const IDL = JSON.parse(fs.readFileSync('./target/idl/asdf_dat.json', 'utf8'));
const PROGRAM_ID = new PublicKey('ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui');
const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const FEE_PROGRAM = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');
const PUMP_GLOBAL_CONFIG = new PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf');
const PUMP_EVENT_AUTHORITY = new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1');

async function main() {
  const connection = new Connection('https://devnet.helius-rpc.com/?api-key=ac94987a-2acd-4778-8759-1bb4708e905b', 'confirmed');
  const walletKeyPair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('./devnet-wallet.json', 'utf8'))));
  const wallet = new anchor.Wallet(walletKeyPair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new anchor.Program(IDL, provider);

  const mint = new PublicKey('FuBryC4gM3SvNLPXPsckH4zaMs6pktxUWLhCiG7aBavb');
  const bondingCurve = new PublicKey('6eT4XX8XFfet3bbkvvSf8959bqRFfbvLf4Kg51M5HYeX');
  const creator = new PublicKey('84ddDW8Vvuc9NMTQQFMtd2SAhR3xvGEJgJ9Xqe2VMi68');

  const [datState] = PublicKey.findProgramAddressSync([Buffer.from('dat_v3')], PROGRAM_ID);
  const [datAuthority] = PublicKey.findProgramAddressSync([Buffer.from('auth_v3')], PROGRAM_ID);
  const [feeConfig] = PublicKey.findProgramAddressSync([Buffer.from('fee_config'), PUMP_PROGRAM.toBuffer()], FEE_PROGRAM);
  const [creatorVault] = PublicKey.findProgramAddressSync([Buffer.from('creator-vault'), creator.toBuffer()], PUMP_PROGRAM);

  // Volume accumulators (required by Pump.fun)
  const GLOBAL_VOLUME_ACCUMULATOR = new PublicKey('Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y');
  const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from('user_volume_accumulator'), datAuthority.toBuffer()],
    PUMP_PROGRAM
  );

  // Protocol fee recipient for Token-2022
  const protocolFeeRecipient = new PublicKey('68yFSZxzLWJXkxxRGydZ63C6mHx1NLEDWmwN9Lb5yySg');

  // DAT's token account for DROOT
  const datAsdfAccount = getAssociatedTokenAddressSync(mint, datAuthority, true, TOKEN_2022_PROGRAM_ID);

  // Pool's token account for DROOT
  const poolAsdfAccount = getAssociatedTokenAddressSync(mint, bondingCurve, true, TOKEN_2022_PROGRAM_ID);

  console.log('=== Testing: Can creator (datAuthority) buy the token? ===\n');
  console.log('DAT Authority (creator):', datAuthority.toBase58());
  console.log('Creator from config:', creator.toBase58());
  console.log('Match:', datAuthority.toBase58() === creator.toBase58() ? '✅ YES' : '❌ NO');
  console.log('\nDAT Authority balance:', (await connection.getBalance(datAuthority)) / 1e9, 'SOL');
  console.log('Creator Vault balance:', (await connection.getBalance(creatorVault)) / 1e9, 'SOL');

  // Build execute_buy instruction ONLY (no collect before)
  // This isolates whether the error is from:
  // 1. Creator trying to buy (our hypothesis)
  // 2. Or interaction between collect + buy

  console.log('\n=== Attempting buy as creator (NO collect before) ===');

  try {
    const buyIx = await program.methods
      .executeBuy(null)
      .accounts({
        datState,
        datAuthority,
        datAsdfAccount,
        pool: bondingCurve,
        asdfMint: mint,
        poolAsdfAccount,
        pumpGlobalConfig: PUMP_GLOBAL_CONFIG,
        protocolFeeRecipient,
        creatorVault,
        pumpEventAuthority: PUMP_EVENT_AUTHORITY,
        pumpSwapProgram: PUMP_PROGRAM,
        feeConfig,
        feeProgram: FEE_PROGRAM,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        globalVolumeAccumulator: GLOBAL_VOLUME_ACCUMULATOR,
        userVolumeAccumulator,
      })
      .instruction();

    const result = await provider.connection.simulateTransaction(
      await provider.connection.getLatestBlockhash().then(({ blockhash }) => {
        const tx = new anchor.web3.Transaction();
        tx.recentBlockhash = blockhash;
        tx.feePayer = wallet.publicKey;
        tx.add(buyIx);
        return tx;
      })
    );

    if (result.value.err) {
      console.log('\n❌ Simulation failed:', JSON.stringify(result.value.err));
      console.log('\nLogs:');
      result.value.logs?.forEach(l => console.log('  ', l));

      // Check if it's the same error as the full cycle
      const errorStr = JSON.stringify(result.value.err);
      if (errorStr.includes('2006') || errorStr.includes('0x7d6')) {
        console.log('\n🔍 SAME ERROR as full cycle (0x7d6)!');
        console.log('   This confirms: Pump.fun prevents creator from buying their own token.');
      }
    } else {
      console.log('\n✅ Simulation succeeded!');
      console.log('   Creator CAN buy (unexpected - would work in production)');
    }
  } catch (e: any) {
    console.log('\n❌ Error:', e.message);
  }
}

main().catch(console.error);
