/**
 * Update Fee Split
 *
 * Modifie le ratio de distribution des fees entre tokens secondaires et root token
 * Par défaut: 5520 bps = 55.2% gardé par le token, 44.8% envoyé au root
 */

import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";

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

function bpsToPercentage(bps: number): string {
  return (bps / 100).toFixed(2);
}

function validateBps(bps: number): boolean {
  return bps >= 0 && bps <= 10000;
}

async function main() {
  // Get new fee split from command line
  const newSplitArg = process.argv[2];

  console.clear();
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.bright}${colors.magenta}⚙️  UPDATE FEE SPLIT${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);

  if (!newSplitArg) {
    log("❌", "Veuillez fournir le nouveau fee split en basis points", colors.red);
    log("💡", "Usage: npx ts-node scripts/update-fee-split.ts <basis_points>", colors.yellow);
    log("", "", colors.reset);
    log("📊", "Exemples:", colors.cyan);
    log("  ", "5520 bps = 55.2% gardé, 44.8% au root (défaut)", colors.reset);
    log("  ", "6000 bps = 60.0% gardé, 40.0% au root", colors.reset);
    log("  ", "5000 bps = 50.0% gardé, 50.0% au root", colors.reset);
    log("  ", "7000 bps = 70.0% gardé, 30.0% au root", colors.reset);
    process.exit(1);
  }

  const newSplitBps = parseInt(newSplitArg);

  if (isNaN(newSplitBps) || !validateBps(newSplitBps)) {
    log("❌", `Valeur invalide: ${newSplitArg}`, colors.red);
    log("💡", "Le fee split doit être entre 0 et 10000 basis points (0-100%)", colors.yellow);
    process.exit(1);
  }

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  log("👤", `Admin: ${admin.publicKey.toString()}`, colors.cyan);

  // Derive PDA
  const [datState] = PublicKey.findProgramAddressSync(
    [Buffer.from("dat_v3")],
    PROGRAM_ID
  );

  log("📦", `DAT State: ${datState.toString()}`, colors.cyan);

  // Setup provider and program
  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
  });

  const idl = loadIdl();
  const program = new Program(idl, provider);

  // Check current state
  log("\n📋", "Configuration actuelle:", colors.yellow);
  try {
    const state = await (program.account as any).datState.fetch(datState);
    const currentKeep = bpsToPercentage(state.feeSplitBps);
    const currentToRoot = bpsToPercentage(10000 - state.feeSplitBps);

    log("📊", `Fee Split actuel: ${state.feeSplitBps} bps`, colors.cyan);
    log("  ", `→ ${currentKeep}% gardé par les tokens secondaires`, colors.reset);
    log("  ", `→ ${currentToRoot}% envoyé au root token`, colors.reset);

    if (state.rootTokenMint) {
      log("🏆", `Root Token: ${state.rootTokenMint.toString()}`, colors.cyan);
    } else {
      log("⚠️", "Aucun root token défini", colors.yellow);
      log("💡", "Définissez d'abord avec: npx ts-node scripts/set-root-token.ts", colors.yellow);
    }
  } catch (e: any) {
    log("❌", `Erreur lecture state: ${e.message}`, colors.red);
    process.exit(1);
  }

  // Show new configuration
  const newKeep = bpsToPercentage(newSplitBps);
  const newToRoot = bpsToPercentage(10000 - newSplitBps);

  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.bright}${colors.magenta}🎯 NOUVELLE CONFIGURATION${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);

  log("📊", `Nouveau Fee Split: ${newSplitBps} bps`, colors.green);
  log("  ", `→ ${newKeep}% gardé par les tokens secondaires`, colors.reset);
  log("  ", `→ ${newToRoot}% envoyé au root token`, colors.reset);

  // Update fee split
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.bright}${colors.magenta}⚡ MISE À JOUR${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);

  try {
    const tx = await program.methods
      .updateFeeSplit(newSplitBps)
      .accounts({
        datState,
        admin: admin.publicKey,
      })
      .rpc();

    log("✅", "FEE SPLIT MIS À JOUR AVEC SUCCÈS!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx}?cluster=devnet`, colors.cyan);

    // Fetch updated state
    const updatedState = await (program.account as any).datState.fetch(datState);

    console.log(`\n${"=".repeat(70)}`);
    console.log(`${colors.bright}${colors.green}✅ CONFIRMATION${colors.reset}`);
    console.log(`${"=".repeat(70)}\n`);

    log("📊", `Fee Split confirmé: ${updatedState.feeSplitBps} bps`, colors.green);
    log("  ", `→ ${bpsToPercentage(updatedState.feeSplitBps)}% gardé`, colors.reset);
    log("  ", `→ ${bpsToPercentage(10000 - updatedState.feeSplitBps)}% au root`, colors.reset);
    log("", "", colors.reset);
    log("💡", "Tous les prochains cycles utiliseront ce nouveau ratio", colors.cyan);

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
