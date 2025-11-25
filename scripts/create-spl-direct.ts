/**
 * Create SPL token directly via PumpFun
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import fs from "fs";

const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const METAPLEX_METADATA_PROGRAM = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const MPL_TOKEN_METADATA_PROGRAM = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const RENT = new PublicKey("SysvarRent111111111111111111111111111111111");

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const creator = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  console.log("\n🪙 Creating SPL Token via PumpFun\n");
  console.log("👤 Creator:", creator.publicKey.toString());

  // Token metadata
  const name = "DAT Test 2";
  const symbol = "DATT2";
  const uri = "https://pump.fun/dat-test-2";

  // Generate new mint
  const newMint = Keypair.generate();
  console.log("🪙 Mint:", newMint.publicKey.toString());

  // Derive accounts
  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), newMint.publicKey.toBuffer()],
    PUMP_PROGRAM
  );

  const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
    [
      bondingCurve.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      newMint.publicKey.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const [metadata] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      MPL_TOKEN_METADATA_PROGRAM.toBuffer(),
      newMint.publicKey.toBuffer(),
    ],
    MPL_TOKEN_METADATA_PROGRAM
  );

  console.log("📈 Bonding Curve:", bondingCurve.toString());

  // PumpFun create instruction discriminator
  const discriminator = Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]);

  // Encode name (4 bytes length + string)
  const nameBytes = Buffer.from(name, "utf-8");
  const nameLengthBuf = Buffer.alloc(4);
  nameLengthBuf.writeUInt32LE(nameBytes.length);

  // Encode symbol (4 bytes length + string)
  const symbolBytes = Buffer.from(symbol, "utf-8");
  const symbolLengthBuf = Buffer.alloc(4);
  symbolLengthBuf.writeUInt32LE(symbolBytes.length);

  // Encode URI (4 bytes length + string)
  const uriBytes = Buffer.from(uri, "utf-8");
  const uriLengthBuf = Buffer.alloc(4);
  uriLengthBuf.writeUInt32LE(uriBytes.length);

  const data = Buffer.concat([
    discriminator,
    nameLengthBuf,
    nameBytes,
    symbolLengthBuf,
    symbolBytes,
    uriLengthBuf,
    uriBytes,
  ]);

  const keys = [
    { pubkey: newMint.publicKey, isSigner: true, isWritable: true },
    { pubkey: bondingCurve, isSigner: false, isWritable: true },
    { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
    { pubkey: metadata, isSigner: false, isWritable: true },
    { pubkey: creator.publicKey, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: RENT, isSigner: false, isWritable: false },
    { pubkey: MPL_TOKEN_METADATA_PROGRAM, isSigner: false, isWritable: false },
  ];

  const instruction = {
    programId: PUMP_PROGRAM,
    keys,
    data,
  };

  try {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

    const message = new TransactionMessage({
      payerKey: creator.publicKey,
      recentBlockhash: blockhash,
      instructions: [instruction],
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    tx.sign([creator, newMint]);

    console.log("\n📤 Sending transaction...");
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

    console.log("\n✅ SUCCESS! Token created");
    console.log("🔗 TX:", `https://explorer.solana.com/tx/${sig}?cluster=devnet`);
    console.log("🪙 Mint:", newMint.publicKey.toString());

    // Save token info
    const tokenInfo = {
      mint: newMint.publicKey.toString(),
      bondingCurve: bondingCurve.toString(),
      creator: creator.publicKey.toString(),
      name,
      symbol,
      uri,
      mayhemMode: false,
      tokenProgram: "SPL",
      network: "devnet",
      timestamp: new Date().toISOString(),
      transaction: sig,
    };

    const filename = "devnet-token-secondary.json";
    fs.writeFileSync(filename, JSON.stringify(tokenInfo, null, 2));
    console.log("💾 Saved to:", filename);
  } catch (error: any) {
    console.log("\n❌ FAILED:", error.message);
    if (error.logs) {
      console.log("\n📋 Error logs:");
      error.logs.forEach((l: string) => console.log(`   ${l}`));
    }
  }
}

main();
