import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as fs from "fs";
import { createHash } from "crypto";

const PROGRAM_ID = new PublicKey("ASDFznSwUWikqQMNE1Y7qqskDDkbE74GXZdUe6wu4UCz");

function getDiscriminator(name: string): Buffer {
  return createHash("sha256")
    .update(`global:${name}`)
    .digest()
    .slice(0, 8);
}

async function main() {
  console.log("🚀 Initialisation DAT v3\n");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const walletPath = "./devnet-wallet.json";
  const adminKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  console.log("👤 Admin:", adminKeypair.publicKey.toString());

  const balance = await connection.getBalance(adminKeypair.publicKey);
  console.log("💰 Balance:", (balance / 1e9).toFixed(4), "SOL");

  // Derive PDAs with v3 seeds
  const [datState] = PublicKey.findProgramAddressSync(
    [Buffer.from("dat_v3")],
    PROGRAM_ID
  );

  const [datAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("auth_v3")],
    PROGRAM_ID
  );

  console.log("\n📦 DAT State v3:", datState.toString());
  console.log("🔑 DAT Authority v3:", datAuthority.toString());

  // Check if already initialized
  const existingAccount = await connection.getAccountInfo(datState);
  if (existingAccount) {
    console.log("\n⚠️  DAT v3 déjà initialisé !");
    console.log("Owner:", existingAccount.owner.toString());
    console.log("Data length:", existingAccount.data.length);
    return;
  }

  const discriminator = getDiscriminator("initialize");
  console.log("\n🔢 Discriminator:", discriminator.toString("hex"));

  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: datState, isSigner: false, isWritable: true },
      { pubkey: datAuthority, isSigner: false, isWritable: false },
      { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: discriminator,
  });

  const transaction = new Transaction().add(instruction);
  transaction.feePayer = adminKeypair.publicKey;

  console.log("\n⏳ Initialisation...");

  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [adminKeypair],
      { commitment: "confirmed" }
    );

    console.log("\n✅ DAT v3 initialisé avec succès ! 🎉\n");
    console.log("📜 Signature:", signature);
    console.log("🔗 Explorer:", `https://explorer.solana.com/tx/${signature}?cluster=devnet`);
    console.log("\n📦 DAT State:", datState.toString());
    console.log("🔑 DAT Authority:", datAuthority.toString());

    const config = {
      datState: datState.toString(),
      datAuthority: datAuthority.toString(),
      admin: adminKeypair.publicKey.toString(),
      signature,
      timestamp: new Date().toISOString(),
      version: "v3",
    };

    fs.writeFileSync("devnet-config.json", JSON.stringify(config, null, 2));
    console.log("\n💾 Config sauvegardée: devnet-config.json");

  } catch (error: any) {
    console.error("\n❌ ERREUR:", error.message);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.forEach((log: string) => console.log("  ", log));
    }
    throw error;
  }
}

main().catch((err) => {
  console.error("💥 Erreur:", err);
  process.exit(1);
});
