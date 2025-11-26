import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import fs from "fs";
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

async function main() {
  // Parse network argument
  const args = process.argv.slice(2);
  const networkConfig = getNetworkConfig(args);

  console.log("\n" + "=".repeat(70));
  console.log(`${colors.bright}${colors.magenta}🔄 TRANSFERT PROGRAM UPGRADE AUTHORITY${colors.reset}`);
  console.log("=".repeat(70) + "\n");

  printNetworkBanner(networkConfig);

  const connection = new Connection(networkConfig.rpcUrl, "confirmed");

  // Determine wallet paths based on network
  const isMainnet = networkConfig.name === "Mainnet";
  const walletPrefix = isMainnet ? "mainnet" : "devnet";

  // Load old wallet (current upgrade authority)
  let oldWalletPath = `./old-${walletPrefix}-wallet.json`;
  if (!fs.existsSync(oldWalletPath)) {
    oldWalletPath = `./${walletPrefix}-wallet-backup.json`;
    if (!fs.existsSync(oldWalletPath)) {
      log("❌", "Ancien wallet non trouvé!", colors.red);
      log("⚠️", "Besoin de l'ancien wallet pour transférer l'upgrade authority", colors.yellow);
      log("💡", `Placez l'ancien wallet dans: old-${walletPrefix}-wallet.json`, colors.cyan);
      process.exit(1);
    }
  }

  const oldWallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(oldWalletPath, "utf-8")))
  );

  log("🔑", `Ancien wallet (current authority): ${oldWallet.publicKey.toString()}`, colors.yellow);

  // Load new wallet
  const newWallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(networkConfig.wallet, "utf-8")))
  );

  log("🔑", `Nouveau wallet (new authority): ${newWallet.publicKey.toString()}`, colors.green);

  // Get program account info
  const programInfo = await connection.getAccountInfo(PROGRAM_ID);
  if (!programInfo) {
    log("❌", "Programme non trouvé!", colors.red);
    process.exit(1);
  }

  log("📦", `Programme ID: ${PROGRAM_ID.toString()}`, colors.cyan);

  console.log("\n" + "=".repeat(70));
  log("⚠️", "ATTENTION: Transfer program upgrade authority", colors.yellow);
  log("  ", `De: ${oldWallet.publicKey.toString()}`, colors.yellow);
  log("  ", `À:  ${newWallet.publicKey.toString()}`, colors.green);
  console.log("=".repeat(70) + "\n");

  log("⏳", "Exécution du transfert...", colors.yellow);

  try {
    const { execSync } = require('child_process');

    // Use solana program set-upgrade-authority command
    const clusterUrl = networkConfig.name === "Mainnet" ? "mainnet-beta" : "devnet";
    const command = `solana program set-upgrade-authority ${PROGRAM_ID.toString()} --new-upgrade-authority ${newWallet.publicKey.toString()} --keypair ${oldWalletPath} --url ${clusterUrl}`;

    log("🔧", "Command: " + command, colors.cyan);

    const output = execSync(command, { encoding: 'utf-8' });

    console.log("\n" + "=".repeat(70));
    log("✅", "TRANSFERT RÉUSSI!", colors.bright + colors.green);
    console.log("=".repeat(70) + "\n");

    log("📜", output.trim(), colors.green);
    log("👤", `Nouveau upgrade authority: ${newWallet.publicKey.toString()}`, colors.green);

    console.log("\n" + "=".repeat(70));
    log("🎉", "VOUS POUVEZ MAINTENANT:", colors.bright + colors.green);
    log("  ", "1. Deployer le programme avec le nouveau wallet", colors.green);
    log("  ", "2. Supprimer l'ancien wallet en toute sécurité", colors.green);
    console.log("=".repeat(70) + "\n");

  } catch (error: any) {
    console.log("\n" + "=".repeat(70));
    log("❌", "ERREUR", colors.bright + colors.red);
    console.log("=".repeat(70) + "\n");

    log("❌", `Erreur: ${error.message}`, colors.red);
    if (error.stderr) {
      console.log("\n📋 stderr:\n", error.stderr.toString());
    }
    if (error.stdout) {
      console.log("\n📋 stdout:\n", error.stdout.toString());
    }

    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`${colors.red}❌ Erreur fatale: ${error.message}${colors.reset}`);
  process.exit(1);
});
