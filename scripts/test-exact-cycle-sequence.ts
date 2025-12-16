/**
 * Test: Exact cycle sequence reproduction
 * Reproduces EXACTLY what execute-ecosystem-cycle.ts does for root token
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair, SystemProgram, ComputeBudgetProgram, Transaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import fs from 'fs';

const IDL = JSON.parse(fs.readFileSync('./target/idl/asdf_dat.json', 'utf8'));
const PROGRAM_ID = new PublicKey('ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui');
const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const FEE_PROGRAM = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');
const PUMP_GLOBAL_CONFIG = new PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf');
const PUMP_EVENT_AUTHORITY = new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1');
const GLOBAL_VOLUME_ACCUMULATOR = new PublicKey('Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y');

async function main() {
  const connection = new Connection('https://devnet.helius-rpc.com/?api-key=ac94987a-2acd-4778-8759-1bb4708e905b', 'confirmed');
  const walletKeyPair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('./devnet-wallet.json', 'utf8'))));
  const wallet = new anchor.Wallet(walletKeyPair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new anchor.Program(IDL, provider);

  // Load root token config
  const rootTokenConfig = JSON.parse(fs.readFileSync('./devnet-tokens/root.json', 'utf8'));
  const mint = new PublicKey(rootTokenConfig.mint);
  const bondingCurve = new PublicKey(rootTokenConfig.bondingCurve);
  const creator = new PublicKey(rootTokenConfig.creator);
  const isToken2022 = rootTokenConfig.tokenProgram === 'Token2022';

  console.log('=== Exact Cycle Sequence Test ===\n');
  console.log('Token:', rootTokenConfig.symbol);
  console.log('Mint:', mint.toBase58());
  console.log('Creator:', creator.toBase58());
  console.log('IsToken2022:', isToken2022);

  // Derive PDAs EXACTLY as cycle does
  const [datState] = PublicKey.findProgramAddressSync([Buffer.from('dat_v3')], PROGRAM_ID);
  const [datAuthority] = PublicKey.findProgramAddressSync([Buffer.from('auth_v3')], PROGRAM_ID);
  const [tokenStats] = PublicKey.findProgramAddressSync([Buffer.from('token_stats_v1'), mint.toBuffer()], PROGRAM_ID);
  const [rootTreasury] = PublicKey.findProgramAddressSync([Buffer.from('root_treasury'), mint.toBuffer()], PROGRAM_ID);
  const [creatorVault] = PublicKey.findProgramAddressSync([Buffer.from('creator-vault'), creator.toBuffer()], PUMP_PROGRAM);
  const [pumpEventAuthority] = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], PUMP_PROGRAM);
  const [feeConfig] = PublicKey.findProgramAddressSync([Buffer.from('fee_config'), PUMP_PROGRAM.toBuffer()], FEE_PROGRAM);
  const [userVolumeAccumulator] = PublicKey.findProgramAddressSync([Buffer.from('user_volume_accumulator'), datAuthority.toBuffer()], PUMP_PROGRAM);

  // Protocol fee recipient - EXACTLY as cycle does after fix
  const MAYHEM_FEE_RECIPIENT = new PublicKey('GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS');
  const TOKEN2022_FEE_RECIPIENT = new PublicKey('68yFSZxzLWJXkxxRGydZ63C6mHx1NLEDWmwN9Lb5yySg');
  const SPL_FEE_RECIPIENT = new PublicKey('6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs');

  const protocolFeeRecipient = rootTokenConfig.mayhemMode
    ? MAYHEM_FEE_RECIPIENT
    : isToken2022
      ? TOKEN2022_FEE_RECIPIENT
      : SPL_FEE_RECIPIENT;

  const tokenProgram = isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_2022_PROGRAM_ID; // Always Token2022 for DROOT

  const datAsdfAccount = getAssociatedTokenAddressSync(mint, datAuthority, true, tokenProgram);
  const poolAsdfAccount = getAssociatedTokenAddressSync(mint, bondingCurve, true, tokenProgram);

  console.log('\nUsing protocolFeeRecipient:', protocolFeeRecipient.toBase58());
  console.log('Expected for Token2022:', TOKEN2022_FEE_RECIPIENT.toBase58());
  console.log('Match:', protocolFeeRecipient.equals(TOKEN2022_FEE_RECIPIENT) ? '✅' : '❌');

  // Build transaction EXACTLY as cycle does
  const instructions: anchor.web3.TransactionInstruction[] = [];

  // 1. Compute budget
  instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));

  // 2. Collect fees
  const collectIx = await program.methods
    .collectFees(true, true)
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
    .instruction();
  instructions.push(collectIx);

  // 3. Buy
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
      pumpEventAuthority: PUMP_EVENT_AUTHORITY,  // Hardcoded, not derived!
      pumpSwapProgram: PUMP_PROGRAM,
      globalVolumeAccumulator: GLOBAL_VOLUME_ACCUMULATOR,
      userVolumeAccumulator,
      feeConfig,
      feeProgram: FEE_PROGRAM,
      tokenProgram,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  instructions.push(buyIx);

  const tx = new Transaction();
  tx.add(...instructions);
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = wallet.publicKey;

  console.log('\n=== Simulating transaction ===');
  try {
    const result = await connection.simulateTransaction(tx);
    if (result.value.err) {
      console.log('\n❌ Simulation failed:', JSON.stringify(result.value.err));
      console.log('\nLogs:');
      result.value.logs?.forEach(l => console.log('  ', l));
    } else {
      console.log('\n✅ Simulation succeeded!');
      console.log('Last 10 logs:');
      result.value.logs?.slice(-10).forEach(l => console.log('  ', l));
    }
  } catch (e: any) {
    console.log('\n❌ Error:', e.message);
  }
}

main().catch(console.error);
