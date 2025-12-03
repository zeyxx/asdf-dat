#!/usr/bin/env npx ts-node

/**
 * Update ASDF Mint (TESTING MODE ONLY)
 *
 * Updates the ASDF mint in DAT state for devnet testing.
 * This instruction is ONLY available when the program is built with --features testing.
 *
 * Usage:
 *   npx ts-node scripts/update-asdf-mint.ts <new-mint-address> --network devnet
 */

import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";
import { getNetworkConfig, printNetworkBanner } from "../lib/network-config";
import { getTypedAccounts } from "../lib/types";

const PROGRAM_ID = new PublicKey("ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui");

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function log(emoji: string, message: string, color = colors.reset) {
  console.log(`${color}${emoji} ${message}${colors.reset}`);
}

function loadIdl(): any {
  const idlPath = path.join(__dirname, "../target/idl/asdf_dat.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  idl.metadata = { address: PROGRAM_ID.toString() };
  idl.address = PROGRAM_ID.toString();
  return idl;
}

async function main() {
  // Parse arguments
  const args = process.argv.slice(2);
  const networkConfig = getNetworkConfig(args);

  // Get new mint address from non-flag args
  const newMintArg = args.find(a => !a.startsWith('--'));
  if (!newMintArg) {
    log("", "Usage: npx ts-node scripts/update-asdf-mint.ts <new-mint-address> --network devnet", colors.red);
    process.exit(1);
  }

  const newAsdfMint = new PublicKey(newMintArg);

  console.clear();
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.bright}${colors.magenta}  UPDATE ASDF MINT (TESTING MODE)${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);

  // Print network banner
  printNetworkBanner(networkConfig);

  // Warn if mainnet
  if (networkConfig.name === "Mainnet") {
    log("", "This instruction is ONLY available in TESTING mode.", colors.red);
    log("", "It will FAIL on mainnet builds.", colors.red);
    process.exit(1);
  }

  const connection = new Connection(networkConfig.rpcUrl, "confirmed");

  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(networkConfig.wallet, "utf-8")))
  );

  log("", `Admin: ${admin.publicKey.toString()}`, colors.cyan);
  log("", `New ASDF Mint: ${newAsdfMint.toString()}`, colors.cyan);

  // Verify the new mint is a valid token
  const mintInfo = await connection.getAccountInfo(newAsdfMint);
  if (!mintInfo) {
    log("", `Mint account not found: ${newAsdfMint.toString()}`, colors.red);
    process.exit(1);
  }
  if (mintInfo.executable) {
    log("", `Address is a program, not a token mint!`, colors.red);
    process.exit(1);
  }

  // Derive PDAs
  const [datState] = PublicKey.findProgramAddressSync(
    [Buffer.from("dat_v3")],
    PROGRAM_ID
  );

  log("", `DAT State: ${datState.toString()}`, colors.cyan);

  // Setup provider and program
  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
  });

  const idl = loadIdl();
  const program = new Program(idl, provider);

  // Check current state
  log("\n", "Current state:", colors.yellow);
  const state = await getTypedAccounts(program).datState.fetch(datState);
  log("  ", `Current ASDF Mint: ${state.asdfMint.toString()}`, colors.reset);

  if (state.asdfMint.equals(newAsdfMint)) {
    log("", "ASDF mint is already set to this value!", colors.green);
    process.exit(0);
  }

  // Update ASDF mint
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.bright}${colors.magenta}  UPDATING ASDF MINT${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);

  try {
    const tx = await program.methods
      .updateAsdfMint(newAsdfMint)
      .accounts({
        datState,
        admin: admin.publicKey,
      })
      .rpc();

    log("", "ASDF MINT UPDATED!", colors.green);
    const cluster = networkConfig.name === "Mainnet" ? "" : "?cluster=devnet";
    log("", `TX: https://explorer.solana.com/tx/${tx}${cluster}`, colors.cyan);

    // Verify
    const updatedState = await getTypedAccounts(program).datState.fetch(datState);
    log("\n", "Updated state:", colors.green);
    log("  ", `ASDF Mint: ${updatedState.asdfMint.toString()}`, colors.green);

  } catch (error: any) {
    log("", `Error: ${error.message}`, colors.red);
    if (error.message.includes("Custom(3012)") || error.message.includes("not found")) {
      log("", "This instruction is only available in TESTING mode builds.", colors.yellow);
      log("", "Make sure the program was built with: anchor build -- --features testing", colors.yellow);
    }
    if (error.logs) {
      console.log("\n Logs:");
      error.logs.slice(-15).forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`${colors.red} Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
