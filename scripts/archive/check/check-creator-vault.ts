/**
 * Check Creator Vault Status
 *
 * Verifies if the creator vault has been created and checks its balance.
 * Uses the creator from the token info file.
 */

import {
  Connection,
  PublicKey,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import { PumpSdk, OnlinePumpSdk } from "@pump-fun/pump-sdk";
import fs from "fs";

const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

function log(emoji: string, message: string, color = colors.reset) {
  console.log(`${color}${emoji} ${message}${colors.reset}`);
}

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("🔍 CHECK CREATOR VAULT STATUS");
  console.log("=".repeat(60) + "\n");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Load token info
  const tokenInfoPath = "devnet-token-info.json";
  if (!fs.existsSync(tokenInfoPath)) {
    log("❌", "Token info not found", colors.red);
    process.exit(1);
  }

  const tokenInfo = JSON.parse(fs.readFileSync(tokenInfoPath, "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);

  log("🪙", `Token Mint: ${tokenMint.toString()}`, colors.cyan);

  // Fetch bonding curve to get creator
  const sdk = new PumpSdk();
  const onlineSdk = new OnlinePumpSdk(connection);

  const bondingCurveData = await onlineSdk.fetchBondingCurve(tokenMint);
  const creator = bondingCurveData.creator;

  log("👤", `Creator: ${creator.toString()}`, colors.cyan);

  // Derive vault authority PDA (uses PUMP_PROGRAM, not pAMMBay)
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), creator.toBuffer()],
    PUMP_PROGRAM
  );

  log("🔑", `Vault Authority: ${vaultAuthority.toString()}`, colors.cyan);

  // Get creator vault ATA (WSOL)
  const creatorVault = await getAssociatedTokenAddress(
    WSOL_MINT,
    vaultAuthority,
    true
  );

  log("🏦", `Creator Vault: ${creatorVault.toString()}`, colors.cyan);

  console.log("\n" + "=".repeat(60));
  console.log("📊 VAULT STATUS");
  console.log("=".repeat(60) + "\n");

  try {
    const vaultAccount = await getAccount(connection, creatorVault);

    log("✅", "Creator Vault EXISTS!", colors.green);
    log("💰", `Balance: ${(Number(vaultAccount.amount) / 1e9).toFixed(6)} SOL`, colors.green);

    if (Number(vaultAccount.amount) > 0) {
      log("🎉", "Vault has fees! Ready to test collect_fees", colors.green);
    } else {
      log("⚠️", "Vault exists but has no fees yet", colors.yellow);
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ NEXT STEPS");
    console.log("=".repeat(60) + "\n");

    log("1️⃣", "The creator vault is created ✓", colors.cyan);

    if (Number(vaultAccount.amount) > 0) {
      log("2️⃣", "Ready to test DAT collect_fees:", colors.cyan);
      log("📝", "npx ts-node tests/scripts/test-dat-cycle.ts", colors.cyan);
    } else {
      log("2️⃣", "Make more trades to accumulate fees:", colors.cyan);
      log("📝", "npx ts-node scripts/buy-token-sdk.ts", colors.cyan);
    }

  } catch (error) {
    log("❌", "Creator Vault DOES NOT EXIST", colors.red);
    log("📝", "The vault is created automatically on the first trade.", colors.yellow);

    console.log("\n" + "=".repeat(60));
    console.log("⏭️ NEXT STEPS");
    console.log("=".repeat(60) + "\n");

    log("1️⃣", "Make a trade to create the vault:", colors.cyan);
    log("📝", "npx ts-node scripts/buy-token-sdk.ts", colors.cyan);

    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`${colors.red}❌ Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
