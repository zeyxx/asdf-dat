import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";

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
  console.log("\n" + "=".repeat(70));
  console.log(`${colors.bright}${colors.magenta}🔄 TRANSFERT D'ADMINISTRATION DAT${colors.reset}`);
  console.log("=".repeat(70) + "\n");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Current admin wallet (old one)
  const oldWalletPath = "./devnet-wallet-old.json";
  // New admin wallet
  const newWalletPath = "./devnet-wallet.json";

  if (!fs.existsSync(oldWalletPath)) {
    log("❌", "Wallet actuel (devnet-wallet-old.json) non trouvé!", colors.red);
    process.exit(1);
  }
  if (!fs.existsSync(newWalletPath)) {
    log("❌", "Nouveau wallet (devnet-wallet.json) non trouvé!", colors.red);
    process.exit(1);
  }

  // Load CURRENT admin wallet
  log("🔑", `Chargement du wallet actuel depuis: ${oldWalletPath}`, colors.yellow);
  const oldAdmin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(oldWalletPath, "utf-8")))
  );
  log("👤", `Admin actuel: ${oldAdmin.publicKey.toString()}`, colors.cyan);

  // Load NEW admin wallet
  log("🔑", `Chargement du nouveau wallet depuis: ${newWalletPath}`, colors.yellow);
  const newAdminKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(newWalletPath, "utf-8")))
  );
  const newAdmin = newAdminKeypair.publicKey;
  log("👤", `Nouveau Admin: ${newAdmin.toString()}`, colors.green);

  // Setup provider with OLD admin
  const provider = new AnchorProvider(connection, new Wallet(oldAdmin), {
    commitment: "confirmed",
  });
  const idl = loadIdl();
  const program = new Program(idl, provider);

  // Derive DAT State PDA
  const [datState] = PublicKey.findProgramAddressSync(
    [Buffer.from("dat_v3")],
    PROGRAM_ID
  );

  log("📦", `DAT State: ${datState.toString()}`, colors.cyan);

  // Fetch current state
  log("🔍", "Vérification de l'état actuel...", colors.yellow);
  const state = await (program.account as any).datState.fetch(datState);
  log("✅", `Admin actuel: ${state.admin.toString()}`, colors.green);

  if (state.admin.toString() !== oldAdmin.publicKey.toString()) {
    log("❌", "ERREUR: Le wallet chargé n'est pas l'admin actuel!", colors.red);
    log("⚠️", `Admin requis: ${state.admin.toString()}`, colors.yellow);
    log("⚠️", `Wallet fourni: ${oldAdmin.publicKey.toString()}`, colors.yellow);
    process.exit(1);
  }

  console.log("\n" + "=".repeat(70));
  log("⚠️", "ATTENTION: Vous allez transférer l'administration!", colors.yellow);
  log("  ", `De: ${oldAdmin.publicKey.toString()}`, colors.yellow);
  log("  ", `À:  ${newAdmin.toString()}`, colors.green);
  console.log("=".repeat(70) + "\n");

  log("⏳", "Exécution du transfert...", colors.yellow);

  try {
    const tx = await program.methods
      .transferAdmin()
      .accounts({
        datState,
        admin: oldAdmin.publicKey,
        newAdmin: newAdmin,
      })
      .rpc();

    console.log("\n" + "=".repeat(70));
    log("✅", "TRANSFERT RÉUSSI!", colors.bright + colors.green);
    console.log("=".repeat(70) + "\n");

    log("📜", `Signature: ${tx}`, colors.green);
    log("🔗", `Explorer: https://explorer.solana.com/tx/${tx}?cluster=devnet`, colors.cyan);
    log("👤", `Nouvel admin: ${newAdmin.toString()}`, colors.green);

    console.log("\n" + "=".repeat(70));
    log("🎉", "VOUS POUVEZ MAINTENANT:", colors.bright + colors.green);
    log("  ", "1. Supprimer l'ancien wallet en toute sécurité", colors.green);
    log("  ", "2. Utiliser le nouveau wallet pour toutes les opérations", colors.green);
    log("  ", "3. Créer des tokens Mayhem Mode avec le nouveau wallet", colors.green);
    console.log("=".repeat(70) + "\n");

  } catch (error: any) {
    console.log("\n" + "=".repeat(70));
    log("❌", "ERREUR", colors.bright + colors.red);
    console.log("=".repeat(70) + "\n");

    log("❌", `Erreur: ${error.message}`, colors.red);

    if (error.logs) {
      console.log("\n📋 Logs de transaction:");
      error.logs.forEach((l: string) => console.log(`   ${l}`));
    }

    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`${colors.red}❌ Erreur fatale: ${error.message}${colors.reset}`);
  process.exit(1);
});
