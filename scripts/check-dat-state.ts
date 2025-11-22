import { Connection, PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet, Idl } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import fs from "fs";
import path from "path";

const PROGRAM_ID = new PublicKey("ASDFznSwUWikqQMNE1Y7qqskDDkbE74GXZdUe6wu4UCz");

function loadIdl(): Idl {
  const idlPath = path.join(__dirname, "../target/idl/asdf_dat.json");
  return JSON.parse(fs.readFileSync(idlPath, "utf-8")) as Idl;
}

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const dummyWallet = Keypair.generate();
  const provider = new AnchorProvider(connection, new Wallet(dummyWallet), {});

  const idl = loadIdl();
  const program: Program<Idl> = new Program(idl, provider);

  const [datState] = PublicKey.findProgramAddressSync(
    [Buffer.from("dat_v3")],
    PROGRAM_ID
  );

  const [datAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("auth_v3")],
    PROGRAM_ID
  );

  console.log("\n=== DAT Configuration ===\n");
  console.log("DAT State PDA:", datState.toString());
  console.log("DAT Authority PDA:", datAuthority.toString());

  try {
    const state = await program.account.datState.fetch(datState);
    console.log("\n=== DAT State Data ===\n");
    console.log("Admin:", state.admin.toString());
    console.log("ASDF Mint:", state.asdfMint.toString());
    console.log("Is Active:", state.isActive);
    console.log("Emergency Pause:", state.emergencyPause);
    console.log("Total Burned:", state.totalBurned.toString());
    console.log("Total SOL Collected:", state.totalSolCollected.toString());
    console.log("Total Buybacks:", state.totalBuybacks);
    console.log("DAT Authority Bump:", state.datAuthorityBump);

    console.log("\n=== Comparison ===\n");
    console.log("Config DAT Authority:", "HzZ2AFNYVdCR1dvg8Mb9vuxZnpkmx3P2vMiq7f6gEi7J");
    console.log("Derived DAT Authority:", datAuthority.toString());
    console.log("Match:", datAuthority.toString() === "HzZ2AFNYVdCR1dvg8Mb9vuxZnpkmx3P2vMiq7f6gEi7J" ? "YES" : "NO");

  } catch (error: any) {
    console.error("Failed to fetch DAT state:", error.message);
  }
}

main().catch(console.error);
