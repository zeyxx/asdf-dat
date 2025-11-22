import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, Idl } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";

const PROGRAM_ID = new PublicKey("ASDFznSwUWikqQMNE1Y7qqskDDkbE74GXZdUe6wu4UCz");

console.log("=".repeat(60));
console.log("🔍 DEBUG PROGRAM INITIALIZATION");
console.log("=".repeat(60));

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Load wallet
  const walletPath = "devnet-wallet.json";
  if (!fs.existsSync(walletPath)) {
    console.error("❌ Wallet not found");
    process.exit(1);
  }

  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  console.log("✅ Admin loaded:", admin.publicKey.toString());

  // Setup provider
  const provider = new AnchorProvider(
    connection,
    new Wallet(admin),
    { commitment: "confirmed" }
  );

  console.log("✅ Provider created");

  // Load IDL
  const idlPath = "target/idl/asdf_dat.json";
  if (!fs.existsSync(idlPath)) {
    console.error("❌ IDL not found at:", idlPath);
    process.exit(1);
  }

  console.log("✅ IDL file exists");

  const idlRaw = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  console.log("✅ IDL parsed");
  console.log("   - Name:", idlRaw.name);
  console.log("   - Version:", idlRaw.version);
  console.log("   - Instructions:", idlRaw.instructions?.length || 0);

  // Set metadata.address
  if (idlRaw.metadata) {
    (idlRaw.metadata as any).address = PROGRAM_ID.toString();
    console.log("✅ Metadata.address set");
  } else {
    (idlRaw as any).metadata = { address: PROGRAM_ID.toString() };
    console.log("✅ Metadata created with address");
  }

  const idl = idlRaw as Idl;

  // Try to create Program
  console.log("\n🔧 Creating Program...");

  try {
    const program: Program<Idl> = new Program(idl, provider);
    console.log("✅ Program created!");
    console.log("   - Program ID:", program.programId.toString());
    console.log("   - Methods available:", Object.keys(program.methods).length > 0 ? "Yes" : "No");

    if (Object.keys(program.methods).length > 0) {
      console.log("   - Available methods:", Object.keys(program.methods).slice(0, 5).join(", "));
    }
  } catch (error: any) {
    console.error("❌ Failed to create Program");
    console.error("   Error:", error.message);
    console.error("   Stack:", error.stack);
    process.exit(1);
  }

  console.log("\n✅ All checks passed!");
}

main().catch((error) => {
  console.error("❌ Fatal error:", error.message);
  console.error(error.stack);
  process.exit(1);
});
