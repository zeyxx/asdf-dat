/**
 * Test if PumpFun supports Token2022 direct buys on devnet
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import fs from "fs";

const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const FEE_PROGRAM = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const payer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  console.log("🔍 Testing PumpFun Token2022 support...\n");
  console.log("👤 Buyer:", payer.publicKey.toString());

  // Token info
  const tokenInfo = JSON.parse(fs.readFileSync("devnet-token-mayhem.json", "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);

  console.log("🪙 Token:", tokenMint.toString());
  console.log("📈 Bonding Curve:", bondingCurve.toString());

  // Derive buyer's Token2022 ATA
  const buyerAta = await getAssociatedTokenAddress(
    tokenMint,
    payer.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  console.log("💎 Buyer ATA:", buyerAta.toString());

  // Check if ATA exists, create if not
  let needsAtaCreation = false;
  try {
    await getAccount(connection, buyerAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    console.log("✅ Buyer ATA exists\n");
  } catch {
    console.log("⚠️ Buyer ATA doesn't exist, creating it...\n");
    needsAtaCreation = true;
  }

  // Derive pool Token2022 ATA
  const poolAta = await getAssociatedTokenAddress(
    tokenMint,
    bondingCurve,
    true,
    TOKEN_2022_PROGRAM_ID
  );

  const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
  const poolWsolAta = await getAssociatedTokenAddress(
    WSOL_MINT,
    bondingCurve,
    true,
    TOKEN_2022_PROGRAM_ID
  );

  // Protocol fee recipient
  const protocolFeeRecipient = new PublicKey("6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs");

  // Derive protocol fee recipient ATA
  const protocolAta = await getAssociatedTokenAddress(
    tokenMint,
    protocolFeeRecipient,
    true,
    TOKEN_2022_PROGRAM_ID
  );

  // Derive creator vault
  const tokenCreator = new PublicKey(tokenInfo.creator);
  const [creatorVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), tokenCreator.toBuffer()],
    PUMP_PROGRAM
  );

  // Derive PumpFun PDAs
  const [pumpGlobalConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    PUMP_PROGRAM
  );

  const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM
  );

  const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_volume_accumulator")],
    PUMP_PROGRAM
  );

  const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_volume_accumulator"), payer.publicKey.toBuffer()],
    PUMP_PROGRAM
  );

  const [feeConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("fee_config"), PUMP_PROGRAM.toBuffer()],
    FEE_PROGRAM
  );

  console.log("📝 Attempting direct PumpFun buy with 0.001 SOL...\n");

  // Build buy instruction manually
  const buyAmount = 1_000_000; // 0.001 SOL
  const minTokens = 1; // Accept any amount

  // PumpFun Buy discriminator + args
  const discriminator = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
  const minOutBuf = Buffer.alloc(8);
  minOutBuf.writeBigUInt64LE(BigInt(minTokens));
  const maxInBuf = Buffer.alloc(8);
  maxInBuf.writeBigUInt64LE(BigInt(buyAmount * 200)); // maxSolCost
  const useWsolBuf = Buffer.from([0]); // false

  const data = Buffer.concat([discriminator, minOutBuf, maxInBuf, useWsolBuf]);

  const keys = [
    { pubkey: pumpGlobalConfig, isSigner: false, isWritable: false },
    { pubkey: protocolFeeRecipient, isSigner: false, isWritable: true }, // fee_recipient
    { pubkey: tokenMint, isSigner: false, isWritable: true },
    { pubkey: bondingCurve, isSigner: false, isWritable: true },
    { pubkey: poolAta, isSigner: false, isWritable: true },
    { pubkey: buyerAta, isSigner: false, isWritable: true },
    { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // user
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program
    { pubkey: creatorVault, isSigner: false, isWritable: true },
    { pubkey: pumpEventAuthority, isSigner: false, isWritable: false },
    { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false }, // program
    { pubkey: globalVolumeAccumulator, isSigner: false, isWritable: false },
    { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },
    { pubkey: feeConfig, isSigner: false, isWritable: false },
    { pubkey: FEE_PROGRAM, isSigner: false, isWritable: false },
  ];

  const instruction = {
    programId: PUMP_PROGRAM,
    keys,
    data,
  };

  try {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

    const instructions = [];

    // Add ATA creation if needed
    if (needsAtaCreation) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          buyerAta,
          payer.publicKey,
          tokenMint,
          TOKEN_2022_PROGRAM_ID
        )
      );
      console.log("📝 Adding ATA creation instruction");
    }

    instructions.push(instruction);

    const message = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    tx.sign([payer]);

    console.log("📤 Sending transaction...");
    const sig = await connection.sendTransaction(tx, {
      maxRetries: 3,
      skipPreflight: false,
    });

    console.log("⏳ Confirming...");
    await connection.confirmTransaction({
      signature: sig,
      blockhash,
      lastValidBlockHeight,
    });

    console.log("\n✅ SUCCESS! PumpFun supports Token2022 on devnet");
    console.log("🔗 TX:", `https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  } catch (error: any) {
    console.log("\n❌ FAILED:", error.message);
    if (error.logs) {
      console.log("\n📋 Error logs:");
      error.logs.forEach((l: string) => console.log(`   ${l}`));
    }
  }
}

main();
