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

  // Volume accumulators (required by Pump.fun)
  const GLOBAL_VOLUME_ACCUMULATOR = new PublicKey('Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y');
  const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from('user_volume_accumulator'), datAuthority.toBuffer()],
    PUMP_PROGRAM
  );

  // Protocol fee recipient for Token-2022 (CRITICAL: different from SPL Token recipient!)
  // SPL Token uses: 6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs
  // Token2022 uses: 68yFSZxzLWJXkxxRGydZ63C6mHx1NLEDWmwN9Lb5yySg
  const protocolFeeRecipient = new PublicKey('68yFSZxzLWJXkxxRGydZ63C6mHx1NLEDWmwN9Lb5yySg');
  
  // DAT's token account for DROOT
  const datAsdfAccount = getAssociatedTokenAddressSync(mint, datAuthority, true, TOKEN_2022_PROGRAM_ID);
  
  // Pool's token account for DROOT  
  const poolAsdfAccount = getAssociatedTokenAddressSync(mint, bondingCurve, true, TOKEN_2022_PROGRAM_ID);

  console.log('=== Testing collect_fees + execute_buy together ===\n');
  console.log('DAT Authority:', datAuthority.toBase58());
  console.log('DAT ASDF Account:', datAsdfAccount.toBase58());
  console.log('Pool ASDF Account:', poolAsdfAccount.toBase58());
  console.log('Fee Config:', feeConfig.toBase58());
  console.log('Protocol Fee Recipient:', protocolFeeRecipient.toBase58());
  
  // Check vault balance
  const vaultBalance = await connection.getBalance(creatorVault);
  console.log('\nVault balance:', vaultBalance / 1e9, 'SOL');
  
  // Build collect_fees instruction
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

  // Build execute_buy instruction (null = use full balance)
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

  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
    .add(collectIx)
    .add(buyIx);
    
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = wallet.publicKey;
  
  console.log('\n=== Simulating collect_fees + execute_buy ===');
  try {
    const result = await connection.simulateTransaction(tx);
    if (result.value.err) {
      console.log('\n❌ Simulation failed:', JSON.stringify(result.value.err));
      console.log('\nLogs:');
      result.value.logs?.forEach(l => console.log('  ', l));
    } else {
      console.log('\n✅ Simulation succeeded!');
      console.log('Logs:', result.value.logs?.slice(-10).join('\n'));
    }
  } catch (e: any) {
    console.log('Error:', e.message);
  }
}

main().catch(console.error);
