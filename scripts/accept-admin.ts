import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";

const PROGRAM_ID = new PublicKey("ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui");

function loadIdl(): any {
  const idlPath = path.join(__dirname, "../target/idl/asdf_dat.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  idl.metadata = { address: PROGRAM_ID.toString() };
  idl.address = PROGRAM_ID.toString();
  return idl;
}

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("ACCEPTATION DU TRANSFERT D'ADMIN DAT");
  console.log("=".repeat(70) + "\n");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // The NEW admin needs to sign to accept the transfer
  const newAdminWalletPath = "./devnet-wallet.json";

  if (!fs.existsSync(newAdminWalletPath)) {
    console.log("New admin wallet not found:", newAdminWalletPath);
    process.exit(1);
  }

  const newAdmin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(newAdminWalletPath, "utf-8")))
  );
  console.log("New admin wallet:", newAdmin.publicKey.toString());

  // Setup provider
  const provider = new AnchorProvider(connection, new Wallet(newAdmin), {
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

  // Fetch current state to verify pending_admin
  const state = await (program.account as any).datState.fetch(datState);
  console.log("\nCurrent admin:", state.admin.toString());
  console.log("Pending admin:", state.pendingAdmin ? state.pendingAdmin.toString() : "None");

  if (!state.pendingAdmin) {
    console.log("\nNo pending admin transfer!");
    process.exit(1);
  }

  if (state.pendingAdmin.toString() !== newAdmin.publicKey.toString()) {
    console.log("\nPending admin does not match this wallet!");
    console.log("Expected:", state.pendingAdmin.toString());
    console.log("Got:", newAdmin.publicKey.toString());
    process.exit(1);
  }

  console.log("\nAccepting admin transfer...");

  try {
    const tx = await program.methods
      .acceptAdminTransfer()
      .accounts({
        datState,
        newAdmin: newAdmin.publicKey,
      })
      .rpc();

    console.log("\n" + "=".repeat(70));
    console.log("TRANSFERT ACCEPTÉ!");
    console.log("=".repeat(70));
    console.log("\nSignature:", tx);
    console.log("Explorer: https://explorer.solana.com/tx/" + tx + "?cluster=devnet");
    console.log("\nNew admin:", newAdmin.publicKey.toString());

    // Verify
    const newState = await (program.account as any).datState.fetch(datState);
    console.log("\nVerification - Current admin:", newState.admin.toString());
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
