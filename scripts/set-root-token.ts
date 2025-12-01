/**
 * Set Root Token
 *
 * Définit le token root qui recevra 44.8% des fees de tous les autres tokens
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

  // Get root token file from non-flag args or default
  const rootTokenFile = args.find(a => !a.startsWith('--')) || networkConfig.tokens[0];

  console.clear();
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.bright}${colors.magenta}🏆 SET ROOT TOKEN${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);

  // Print network banner
  printNetworkBanner(networkConfig);

  const connection = new Connection(networkConfig.rpcUrl, "confirmed");

  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(networkConfig.wallet, "utf-8")))
  );

  log("👤", `Admin: ${admin.publicKey.toString()}`, colors.cyan);

  // Load token info
  if (!fs.existsSync(rootTokenFile)) {
    log("❌", `Token file not found: ${rootTokenFile}`, colors.red);
    log("💡", "Usage: npx ts-node scripts/set-root-token.ts <token-file.json> --network mainnet|devnet", colors.yellow);
    process.exit(1);
  }

  const tokenInfo = JSON.parse(fs.readFileSync(rootTokenFile, "utf-8"));
  const rootMint = new PublicKey(tokenInfo.mint);

  log("🪙", `Root Token Mint: ${rootMint.toString()}`, colors.cyan);
  log("📛", `Name: ${tokenInfo.name}`, colors.cyan);
  log("🏷️ ", `Symbol: ${tokenInfo.symbol}`, colors.cyan);

  // Derive PDAs
  const [datState] = PublicKey.findProgramAddressSync(
    [Buffer.from("dat_v3")],
    PROGRAM_ID
  );

  const [rootTokenStats] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_stats_v1"), rootMint.toBuffer()],
    PROGRAM_ID
  );

  log("📦", `DAT State: ${datState.toString()}`, colors.cyan);
  log("📊", `Root Token Stats: ${rootTokenStats.toString()}`, colors.cyan);

  // Setup provider and program
  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
  });

  const idl = loadIdl();
  const program = new Program(idl, provider);

  // Check current state
  log("\n📋", "État actuel:", colors.yellow);
  try {
    const state = await getTypedAccounts(program).datState.fetch(datState);
    if (state.rootTokenMint) {
      log("⚠️", `Root token déjà défini: ${state.rootTokenMint.toString()}`, colors.yellow);
      log("💡", `Fee split: ${state.feeSplitBps / 100}% keep, ${(10000 - state.feeSplitBps) / 100}% to root`, colors.yellow);
    } else {
      log("ℹ️", "Aucun root token défini", colors.cyan);
    }
  } catch (e: any) {
    log("❌", `Erreur lecture state: ${e.message}`, colors.red);
    process.exit(1);
  }

  // Check if TokenStats exists
  try {
    await getTypedAccounts(program).tokenStats.fetch(rootTokenStats);
    log("✅", "TokenStats existe pour ce token", colors.green);
  } catch {
    log("❌", "TokenStats n'existe pas pour ce token", colors.red);
    log("💡", `Créez d'abord avec: npx ts-node scripts/init-token-stats.ts ${rootTokenFile}`, colors.yellow);
    process.exit(1);
  }

  // Set root token
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.bright}${colors.magenta}⚡ DÉFINIR ROOT TOKEN${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);

  try {
    const tx = await program.methods
      .setRootToken(rootMint)
      .accounts({
        datState,
        rootTokenStats,
        admin: admin.publicKey,
      })
      .rpc();

    log("✅", "ROOT TOKEN DÉFINI AVEC SUCCÈS!", colors.green);
    const cluster = networkConfig.name === "Mainnet" ? "" : "?cluster=devnet";
    log("🔗", `TX: https://explorer.solana.com/tx/${tx}${cluster}`, colors.cyan);

    // Fetch updated state
    const updatedState = await getTypedAccounts(program).datState.fetch(datState);

    console.log(`\n${"=".repeat(70)}`);
    console.log(`${colors.bright}${colors.green}📊 CONFIGURATION ROOT TOKEN${colors.reset}`);
    console.log(`${"=".repeat(70)}\n`);

    log("🏆", `Root Token: ${updatedState.rootTokenMint?.toString() ?? 'Not set'}`, colors.green);
    log("📊", `Fee Split: ${updatedState.feeSplitBps / 100}% keep, ${(10000 - updatedState.feeSplitBps) / 100}% to root`, colors.green);
    log("", "", colors.reset);
    log("💡", "Les tokens secondaires enverront maintenant 44.8% de leurs fees au root treasury", colors.cyan);
    log("💡", "Le root token collectera 100% de ses fees + les fees reçues des autres", colors.cyan);

  } catch (error: any) {
    log("❌", `Erreur: ${error.message}`, colors.red);
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
