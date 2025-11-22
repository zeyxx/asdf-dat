import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, Idl } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";

const PROGRAM_ID = new PublicKey("ASDFznSwUWikqQMNE1Y7qqskDDkbE74GXZdUe6wu4UCz");

console.log("🔍 DEBUG: Chargement du programme\n");

// Load wallet
const adminPath = "./devnet-wallet.json";
if (!fs.existsSync(adminPath)) {
  console.error("❌ devnet-wallet.json not found");
  process.exit(1);
}

const admin = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(fs.readFileSync(adminPath, "utf-8")))
);

console.log("✅ Wallet chargé:", admin.publicKey.toString());

// Setup connection
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
console.log("✅ Connection établie");

// Load IDL
const idlPath = "target/idl/asdf_dat.json";
if (!fs.existsSync(idlPath)) {
  console.error("❌ IDL not found at:", idlPath);
  process.exit(1);
}

const idlContent = fs.readFileSync(idlPath, "utf-8");
console.log("✅ IDL lu, taille:", idlContent.length, "bytes");

let idl: any;
try {
  idl = JSON.parse(idlContent);
  console.log("✅ IDL parsé");
  console.log("   - version:", idl.version);
  console.log("   - name:", idl.name);
  console.log("   - instructions:", idl.instructions?.length);
  console.log("   - accounts:", idl.accounts?.length || 0);
  console.log("   - metadata.address:", idl.metadata?.address);
} catch (error: any) {
  console.error("❌ Erreur parsing IDL:", error.message);
  process.exit(1);
}

// Fix metadata
console.log("\n🔧 Fixing metadata address...");
if (idl.metadata) {
  console.log("   Avant:", idl.metadata.address);
  idl.metadata.address = PROGRAM_ID.toString();
  console.log("   Après:", idl.metadata.address);
} else {
  console.log("   Création metadata");
  idl.metadata = { address: PROGRAM_ID.toString() };
}

// Setup provider
console.log("\n🔧 Création du provider...");
try {
  const provider = new AnchorProvider(
    connection,
    new Wallet(admin),
    { commitment: "confirmed" }
  );
  console.log("✅ Provider créé");

  // Try to create program
  console.log("\n🔧 Création du Program...");
  console.log("   IDL type:", typeof idl);
  console.log("   IDL keys:", Object.keys(idl).join(", "));

  // Anchor 0.26.0 approach: new Program(idl, programId, provider)
  console.log("\n🔧 Tentative 1: new Program(idl, PROGRAM_ID, provider)");
  try {
    const program = new Program(idl, PROGRAM_ID, provider);
    console.log("✅ Program créé!");
    console.log("   Program ID:", program.programId.toString());
    console.log("   Methods:", Object.keys(program.methods).slice(0, 5).join(", "));
    console.log("\n🎉 SUCCÈS! Utilisez cette approche dans les scripts.");
  } catch (error: any) {
    console.error("❌ Tentative 1 échouée:", error.message);
    console.error("   Stack:", error.stack?.split("\n").slice(0, 3).join("\n   "));

    // Try with Idl type cast
    console.log("\n🔧 Tentative 2: new Program(idl as Idl, PROGRAM_ID, provider)");
    try {
      const program2 = new Program(idl as Idl, PROGRAM_ID, provider);
      console.log("✅ Program créé (tentative 2)!");
      console.log("   Program ID:", program2.programId.toString());
    } catch (error2: any) {
      console.error("❌ Tentative 2 échouée:", error2.message);

      // Try without programId
      console.log("\n🔧 Tentative 3: new Program(idl, provider) - dépend de metadata");
      try {
        const program3 = new Program(idl as Idl, provider);
        console.log("✅ Program créé (tentative 3)!");
        console.log("   Program ID:", program3.programId.toString());
      } catch (error3: any) {
        console.error("❌ Tentative 3 échouée:", error3.message);
      }
    }
  }
} catch (error: any) {
  console.error("❌ Erreur provider:", error.message);
  process.exit(1);
}
