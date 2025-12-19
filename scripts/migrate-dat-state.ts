import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";

const PROGRAM_ID = new PublicKey("ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui");

function loadIdl(): any {
  const idlPath = path.join(__dirname, "../target/idl/asdf_burn_engine.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  idl.metadata = { address: PROGRAM_ID.toString() };
  idl.address = PROGRAM_ID.toString();
  return idl;
}

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("MIGRATION DU DAT STATE (382 -> 390 bytes)");
  console.log("=".repeat(70) + "\n");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // The admin that needs to sign is the one stored in the on-chain account
  // Currently: EG7MiZWRcfWNZR4Z54G6azsGKwu9QzZePNzHE4TVdXR5 (old wallet)
  const adminWalletPath = "./devnet-wallet-old.json";

  if (!fs.existsSync(adminWalletPath)) {
    console.log("Admin wallet not found:", adminWalletPath);
    process.exit(1);
  }

  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(adminWalletPath, "utf-8")))
  );
  console.log("Admin wallet:", admin.publicKey.toString());

  // Setup provider
  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
  });
  const idl = loadIdl();
  const program = new Program(idl, provider);

  // Derive DAT State PDA
  const [datState] = PublicKey.findProgramAddressSync(
    [Buffer.from("dat_v3")],
    PROGRAM_ID
  );
  console.log("DAT State PDA:", datState.toString());

  // Check current account size
  const accountInfo = await connection.getAccountInfo(datState);
  if (!accountInfo) {
    console.log("DAT State account not found!");
    process.exit(1);
  }

  console.log("\nCurrent account size:", accountInfo.data.length, "bytes");
  console.log("Target size: 390 bytes");

  if (accountInfo.data.length >= 390) {
    console.log("\nAccount already migrated!");
    return;
  }

  console.log("\nExecuting migration...");

  try {
    const tx = await program.methods
      .migrateDatState()
      .accounts({
        datState,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("\n" + "=".repeat(70));
    console.log("MIGRATION RÉUSSIE!");
    console.log("=".repeat(70));
    console.log("\nSignature:", tx);
    console.log("Explorer: https://explorer.solana.com/tx/" + tx + "?cluster=devnet");

    // Verify new size
    const newAccountInfo = await connection.getAccountInfo(datState);
    if (newAccountInfo) {
      console.log("\nNew account size:", newAccountInfo.data.length, "bytes");
    }
  } catch (error: any) {
    console.error("\nError:", error.message);
    if (error.logs) {
      console.log("\nLogs:");
      error.logs.forEach((l: string) => console.log("  " + l));
    }
    process.exit(1);
  }
}

main().catch(console.error);
