/**
 * Test: Execute collect and buy in SEPARATE transactions
 *
 * This tests if the 0x7d6 error comes from having collect + buy
 * in the SAME transaction, or if it's a persistent state issue.
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
  const [tokenStats] = PublicKey.findProgramAddressSync([Buffer.from('token_stats_v1'), mint.toBuffer()], PROGRAM_ID);
  const [creatorVault] = PublicKey.findProgramAddressSync([Buffer.from('creator-vault'), creator.toBuffer()], PUMP_PROGRAM);
  const [pumpEventAuthority] = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], PUMP_PROGRAM);
  const [rootTreasury] = PublicKey.findProgramAddressSync([Buffer.from('root_treasury'), mint.toBuffer()], PROGRAM_ID);
  const [feeConfig] = PublicKey.findProgramAddressSync([Buffer.from('fee_config'), PUMP_PROGRAM.toBuffer()], FEE_PROGRAM);

  const GLOBAL_VOLUME_ACCUMULATOR = new PublicKey('Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y');
  const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from('user_volume_accumulator'), datAuthority.toBuffer()],
    PUMP_PROGRAM
  );

  const protocolFeeRecipient = new PublicKey('68yFSZxzLWJXkxxRGydZ63C6mHx1NLEDWmwN9Lb5yySg');
  const datAsdfAccount = getAssociatedTokenAddressSync(mint, datAuthority, true, TOKEN_2022_PROGRAM_ID);
  const poolAsdfAccount = getAssociatedTokenAddressSync(mint, bondingCurve, true, TOKEN_2022_PROGRAM_ID);

  console.log('=== Testing collect + buy in SEPARATE transactions ===\n');

  // Check initial balances
  const vaultBefore = await connection.getBalance(creatorVault);
  const authBefore = await connection.getBalance(datAuthority);
  console.log('BEFORE:');
  console.log('  Creator Vault:', vaultBefore / 1e9, 'SOL');
  console.log('  DAT Authority:', authBefore / 1e9, 'SOL');

  // TRANSACTION 1: Collect fees
  console.log('\n=== TX 1: Collect fees ===');
  try {
    const sig = await program.methods
      .collectFees(true, true) // is_root_token=true, for_ecosystem=true
      .accounts({
        datState,
        tokenStats,
        tokenMint: mint,
        datAuthority,
        creatorVault,
        pumpEventAuthority,
        pumpSwapProgram: PUMP_PROGRAM,
        rootTreasury,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log('✅ Collect succeeded!');
    console.log('   TX:', sig);

    // Wait for confirmation
    await connection.confirmTransaction(sig, 'confirmed');

    // Check balances after collect
    const vaultAfter = await connection.getBalance(creatorVault);
    const authAfter = await connection.getBalance(datAuthority);
    console.log('\nAFTER COLLECT:');
    console.log('  Creator Vault:', vaultAfter / 1e9, 'SOL');
    console.log('  DAT Authority:', authAfter / 1e9, 'SOL');
    console.log('  Collected:', (authAfter - authBefore) / 1e9, 'SOL');

    // Wait a bit
    console.log('\nWaiting 3 seconds before buy...');
    await new Promise(r => setTimeout(r, 3000));

  } catch (e: any) {
    console.log('❌ Collect failed:', e.message);
    return;
  }

  // TRANSACTION 2: Buy
  console.log('\n=== TX 2: Buy tokens ===');
  try {
    const sig = await program.methods
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
      .rpc();

    console.log('✅ Buy succeeded!');
    console.log('   TX:', sig);

    await connection.confirmTransaction(sig, 'confirmed');

    const authFinal = await connection.getBalance(datAuthority);
    const tokenBalance = await connection.getTokenAccountBalance(datAsdfAccount);
    console.log('\nAFTER BUY:');
    console.log('  DAT Authority:', authFinal / 1e9, 'SOL');
    console.log('  Token balance:', tokenBalance.value.uiAmount, 'DROOT');

  } catch (e: any) {
    console.log('❌ Buy failed:', e.message);
    if (e.logs) {
      console.log('\nLogs:');
      e.logs.forEach((l: string) => console.log('  ', l));
    }
  }
}

main().catch(console.error);
