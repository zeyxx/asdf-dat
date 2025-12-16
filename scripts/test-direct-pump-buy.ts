import { PublicKey, Connection, Keypair, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import fs from 'fs';

const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const FEE_PROGRAM = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');
const PUMP_GLOBAL_CONFIG = new PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf');
const PUMP_EVENT_AUTHORITY = new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1');
const GLOBAL_VOLUME_ACCUMULATOR = new PublicKey('Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y');
const PUMPFUN_BUY_DISCRIMINATOR = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);

async function main() {
  const connection = new Connection('https://devnet.helius-rpc.com/?api-key=ac94987a-2acd-4778-8759-1bb4708e905b', 'confirmed');
  const walletKeyPair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('./devnet-wallet.json', 'utf8'))));

  const mint = new PublicKey('FuBryC4gM3SvNLPXPsckH4zaMs6pktxUWLhCiG7aBavb');
  const bondingCurve = new PublicKey('6eT4XX8XFfet3bbkvvSf8959bqRFfbvLf4Kg51M5HYeX');
  const creator = new PublicKey('84ddDW8Vvuc9NMTQQFMtd2SAhR3xvGEJgJ9Xqe2VMi68');

  const [creatorVault] = PublicKey.findProgramAddressSync([Buffer.from('creator-vault'), creator.toBuffer()], PUMP_PROGRAM);
  const [feeConfig] = PublicKey.findProgramAddressSync([Buffer.from('fee_config'), PUMP_PROGRAM.toBuffer()], FEE_PROGRAM);

  // User volume accumulator PDA (seeds: "user_volume_accumulator" + user)
  const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from('user_volume_accumulator'), walletKeyPair.publicKey.toBuffer()],
    PUMP_PROGRAM
  );

  // Use SPL fee recipient (works for Token2022 too based on successful tx!)
  const protocolFeeRecipient = new PublicKey('6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs');

  // User's token account
  const userTokenAccount = getAssociatedTokenAddressSync(mint, walletKeyPair.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const poolTokenAccount = getAssociatedTokenAddressSync(mint, bondingCurve, true, TOKEN_2022_PROGRAM_ID);

  console.log('=== Testing DIRECT Pump.fun Buy (CORRECT 16-account format) ===\n');
  console.log('User:', walletKeyPair.publicKey.toBase58());
  console.log('User Token Account:', userTokenAccount.toBase58());
  console.log('Pool Token Account:', poolTokenAccount.toBase58());
  console.log('Fee Recipient:', protocolFeeRecipient.toBase58());
  console.log('Token Program:', TOKEN_2022_PROGRAM_ID.toBase58());
  console.log('User Volume Acc:', userVolumeAccumulator.toBase58());

  // Build buy instruction - CORRECT 16-account format!
  const desiredTokens = BigInt(1_000_000_000); // 1 token with 9 decimals
  const maxSolCost = BigInt(100_000_000); // 0.1 SOL max

  const data = Buffer.alloc(25);
  PUMPFUN_BUY_DISCRIMINATOR.copy(data, 0);
  data.writeBigUInt64LE(desiredTokens, 8);
  data.writeBigUInt64LE(maxSolCost, 16);
  data.writeUInt8(0, 24); // no priority fee

  // CORRECT 16-account format based on successful tx 3Rqh43z2...
  const buyIx = new TransactionInstruction({
    programId: PUMP_PROGRAM,
    keys: [
      { pubkey: PUMP_GLOBAL_CONFIG, isSigner: false, isWritable: false },        // 0: global_config
      { pubkey: protocolFeeRecipient, isSigner: false, isWritable: true },       // 1: fee_recipient
      { pubkey: mint, isSigner: false, isWritable: true },                        // 2: mint
      { pubkey: bondingCurve, isSigner: false, isWritable: true },               // 3: pool
      { pubkey: poolTokenAccount, isSigner: false, isWritable: true },           // 4: pool_token_account
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },           // 5: user_token_account
      { pubkey: walletKeyPair.publicKey, isSigner: true, isWritable: true },     // 6: user
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },   // 7: system_program
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },     // 8: token_program (BEFORE creator_vault!)
      { pubkey: creatorVault, isSigner: false, isWritable: true },               // 9: creator_vault (AFTER token_program!)
      { pubkey: PUMP_EVENT_AUTHORITY, isSigner: false, isWritable: false },      // 10: event_authority
      { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },              // 11: pump_program
      { pubkey: GLOBAL_VOLUME_ACCUMULATOR, isSigner: false, isWritable: false }, // 12: global_volume_accumulator
      { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },      // 13: user_volume_accumulator
      { pubkey: feeConfig, isSigner: false, isWritable: false },                 // 14: fee_config
      { pubkey: FEE_PROGRAM, isSigner: false, isWritable: false },               // 15: fee_program
    ],
    data,
  });

  const tx = new Transaction().add(buyIx);
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = walletKeyPair.publicKey;

  console.log('\n=== Simulating direct Pump.fun buy (16 accounts) ===');
  try {
    const result = await connection.simulateTransaction(tx);
    if (result.value.err) {
      console.log('\n❌ Simulation failed:', JSON.stringify(result.value.err));
      console.log('\nLogs:');
      result.value.logs?.forEach(l => console.log('  ', l));
    } else {
      console.log('\n✅ Direct buy simulation succeeded!');
      console.log('Last 5 logs:');
      result.value.logs?.slice(-5).forEach(l => console.log('  ', l));
    }
  } catch (e: any) {
    console.log('Error:', e.message);
  }
}

main().catch(console.error);
