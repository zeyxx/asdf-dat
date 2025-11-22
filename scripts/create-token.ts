import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "fs";

const PROGRAM_ID = new PublicKey("ASDFznSwUWikqQMNE1Y7qqskDDkbE74GXZdUe6wu4UCz");
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const MPL_TOKEN_METADATA = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

const DAT_STATE_SEED = Buffer.from("dat_v3");
const DAT_AUTHORITY_SEED = Buffer.from("auth_v3");

function getDiscriminator(): Buffer {
  return Buffer.from([0x20, 0xd9, 0x4d, 0xd1, 0x59, 0x24, 0x41, 0x23]);
}

function serializeString(str: string): Buffer {
  const bytes = Buffer.from(str, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([len, bytes]);
}

function derivePumpPDAs(mint: PublicKey) {
  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint.toBuffer()],
    PUMP_PROGRAM
  );

  const [mintAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint-authority")],
    PUMP_PROGRAM
  );

  const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
    [bondingCurve.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const [metadata] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), MPL_TOKEN_METADATA.toBuffer(), mint.toBuffer()],
    MPL_TOKEN_METADATA
  );

  const [global] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    PUMP_PROGRAM
  );

  const [eventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM
  );

  return { bondingCurve, mintAuthority, associatedBondingCurve, metadata, global, eventAuthority };
}

async function main() {
  console.log("🚀 Création token DAT\n");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("./devnet-wallet.json", "utf-8")))
  );

  console.log("👤 Admin:", admin.publicKey.toString());
  console.log("💰 Balance:", ((await connection.getBalance(admin.publicKey)) / 1e9).toFixed(4), "SOL");

  const [datState] = PublicKey.findProgramAddressSync([DAT_STATE_SEED], PROGRAM_ID);
  const [datAuthority] = PublicKey.findProgramAddressSync([DAT_AUTHORITY_SEED], PROGRAM_ID);

  console.log("🔑 DAT Authority:", datAuthority.toString());

  if (!(await connection.getAccountInfo(datState))) {
    console.error("❌ DAT non initialisé");
    process.exit(1);
  }

  const mintKeypair = Keypair.generate();
  const pdas = derivePumpPDAs(mintKeypair.publicKey);

  console.log("🪙 Mint:", mintKeypair.publicKey.toString());

  const name = "ASDF DAT Test";
  const symbol = "ASDFT";
  const uri = "https://pump.fun/ASDFT-devnet";

  const instructionData = Buffer.concat([
    getDiscriminator(),
    serializeString(name),
    serializeString(symbol),
    serializeString(uri),
  ]);

  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: datState, isSigner: false, isWritable: false },
      { pubkey: datAuthority, isSigner: false, isWritable: true },
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: mintKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: pdas.mintAuthority, isSigner: false, isWritable: true },
      { pubkey: pdas.bondingCurve, isSigner: false, isWritable: true },
      { pubkey: pdas.associatedBondingCurve, isSigner: false, isWritable: true },
      { pubkey: pdas.metadata, isSigner: false, isWritable: true },
      { pubkey: pdas.global, isSigner: false, isWritable: true },
      { pubkey: MPL_TOKEN_METADATA, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: pdas.eventAuthority, isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false }, // pump_program
    ],
    data: instructionData,
  });

  const transaction = new Transaction().add(instruction);
  transaction.feePayer = admin.publicKey;

  console.log("\n⏳ Envoi...");

  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [admin, mintKeypair],
      { commitment: "confirmed" }
    );

    console.log("\n✅ TOKEN CRÉÉ !\n");
    console.log("📜 Signature:", signature);
    console.log("🔗 Explorer:", `https://explorer.solana.com/tx/${signature}?cluster=devnet`);
    console.log("🎯 Creator:", datAuthority.toString());

    fs.writeFileSync(
      "devnet-token-info.json",
      JSON.stringify({
        mint: mintKeypair.publicKey.toString(),
        bondingCurve: pdas.bondingCurve.toString(),
        creator: datAuthority.toString(),
        name, symbol, uri, signature,
        timestamp: new Date().toISOString(),
      }, null, 2)
    );

    console.log("💾 Sauvegardé: devnet-token-info.json");
  } catch (error: any) {
    console.error("\n❌ ERREUR:", error.message);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.forEach((log: string) => console.log("  ", log));
    }
    throw error;
  }
}

main().catch(console.error);
