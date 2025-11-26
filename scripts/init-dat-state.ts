/**
 * Initialize DAT State
 *
 * Initialise le state principal du programme DAT
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";
import { getNetworkConfig, printNetworkBanner } from "../lib/network-config";

const PROGRAM_ID = new PublicKey("ASDfNfUHwVGfrg3SV7SQYWhaVxnrCUZyWmMpWJAPu4MZ");

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
  // Parse network argument
  const args = process.argv.slice(2);
  const networkConfig = getNetworkConfig(args);

  console.clear();
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.bright}${colors.magenta}⚙️  INITIALIZE DAT STATE${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);

  // Print network banner
  printNetworkBanner(networkConfig);

  const connection = new Connection(networkConfig.rpcUrl, "confirmed");

  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(networkConfig.wallet, "utf-8")))
  );

  log("👤", `Admin: ${admin.publicKey.toString()}`, colors.cyan);

  // Derive PDAs
  const [datState] = PublicKey.findProgramAddressSync(
    [Buffer.from("dat_v3")],
    PROGRAM_ID
  );

  const [datAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("auth_v3")],
    PROGRAM_ID
  );

  log("📦", `DAT State: ${datState.toString()}`, colors.cyan);
  log("🔑", `DAT Authority: ${datAuthority.toString()}`, colors.cyan);

  // Setup provider and program
  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
  });

  const idl = loadIdl();
  const program = new Program(idl, provider);

  // Check if already initialized
  try {
    await (program.account as any).datState.fetch(datState);
    log("⚠️", "DAT State already initialized!", colors.yellow);
    log("📊", "Current state:", colors.cyan);
    const state = await (program.account as any).datState.fetch(datState);
    log("  ", `Admin: ${state.admin.toString()}`, colors.reset);
    log("  ", `Active: ${state.isActive}`, colors.reset);
    log("  ", `Emergency Pause: ${state.emergencyPause}`, colors.reset);
    process.exit(0);
  } catch {
    log("✅", "DAT State not initialized yet, proceeding...", colors.green);
  }

  // Initialize DAT state
  log("\n⚡", "Initializing DAT state...", colors.yellow);

  try {
    const tx = await program.methods
      .initialize()
      .accounts({
        datState,
        datAuthority,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    log("✅", "DAT STATE INITIALIZED!", colors.green);
    const cluster = networkConfig.name === "Mainnet" ? "" : "?cluster=devnet";
    log("🔗", `TX: https://explorer.solana.com/tx/${tx}${cluster}`, colors.cyan);

    // Fetch and display state
    const state = await (program.account as any).datState.fetch(datState);

    console.log(`\n${"=".repeat(70)}`);
    console.log(`${colors.bright}${colors.green}📊 DAT CONFIGURATION${colors.reset}`);
    console.log(`${"=".repeat(70)}\n`);

    log("👤", `Admin: ${state.admin.toString()}`, colors.cyan);
    log("🔧", `Active: ${state.isActive}`, colors.green);
    log("🚨", `Emergency Pause: ${state.emergencyPause}`, colors.green);
    log("📊", `Fee Split BPS: ${state.feeSplitBps} (${state.feeSplitBps / 100}%)`, colors.cyan);
    log("⏱️ ", `Min Cycle Interval: ${state.minCycleInterval}s`, colors.cyan);
    log("💰", `Min Fees Threshold: ${state.minFeesThreshold / 1e9} SOL`, colors.cyan);
    log("💎", `Max Fees Per Cycle: ${state.maxFeesPerCycle / 1e9} SOL`, colors.cyan);
    log("📉", `Slippage BPS: ${state.slippageBps} (${state.slippageBps / 100}%)`, colors.cyan);

    if (state.rootTokenMint) {
      log("🏆", `Root Token: ${state.rootTokenMint.toString()}`, colors.magenta);
    } else {
      log("⚠️", "No root token set yet", colors.yellow);
    }

  } catch (error: any) {
    log("❌", `Error: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-15).forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`${colors.red}❌ Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
