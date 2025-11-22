/**
 * Collect Creator Fee - Creates Vault and Collects Fees
 *
 * Calls the PumpFun collect_creator_fee instruction which:
 * 1. Creates the creator vault (if it doesn't exist)
 * 2. Transfers accumulated fees to the creator
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { PumpSdk, OnlinePumpSdk } from "@pump-fun/pump-sdk";
import fs from "fs";

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
  console.log("💰 COLLECT CREATOR FEE - CREATE VAULT");
  console.log("=".repeat(60) + "\n");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Load creator wallet
  const walletPath = "devnet-wallet.json";
  if (!fs.existsSync(walletPath)) {
    log("❌", `Wallet not found: ${walletPath}`, colors.red);
    process.exit(1);
  }

  const creator = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  log("👤", `Creator: ${creator.publicKey.toString()}`, colors.cyan);

  // Check balance
  const balance = await connection.getBalance(creator.publicKey);
  log("💰", `Balance: ${(balance / 1e9).toFixed(4)} SOL`, colors.cyan);

  // Load token info
  const tokenInfoPath = "devnet-token-info.json";
  if (!fs.existsSync(tokenInfoPath)) {
    log("❌", "Token info not found", colors.red);
    process.exit(1);
  }

  const tokenInfo = JSON.parse(fs.readFileSync(tokenInfoPath, "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);

  log("🪙", `Token Mint: ${tokenMint.toString()}`, colors.cyan);

  // Verify we're the creator
  const sdk = new PumpSdk();
  const onlineSdk = new OnlinePumpSdk(connection);
  const bondingCurve = await onlineSdk.fetchBondingCurve(tokenMint);

  if (!bondingCurve.creator.equals(creator.publicKey)) {
    log("❌", "You are not the creator of this token!", colors.red);
    log("📝", `Creator is: ${bondingCurve.creator.toString()}`, colors.yellow);
    process.exit(1);
  }

  log("✅", "You are the creator!", colors.green);

  console.log("\n" + "=".repeat(60));
  console.log("🔧 PREPARING TRANSACTION");
  console.log("=".repeat(60) + "\n");

  // Derive PDAs
  const [creatorVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), creator.publicKey.toBuffer()],
    PUMP_PROGRAM
  );

  const [eventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM
  );

  log("🏦", `Creator Vault PDA: ${creatorVault.toString()}`, colors.cyan);

  // Build instruction data
  // Discriminator for collect_creator_fee: [20, 22, 86, 123, 198, 28, 219, 132]
  const data = Buffer.from([20, 22, 86, 123, 198, 28, 219, 132]);

  const ix = {
    programId: PUMP_PROGRAM,
    keys: [
      { pubkey: creator.publicKey, isSigner: true, isWritable: true },
      { pubkey: creatorVault, isSigner: false, isWritable: true },
      { pubkey: PublicKey.default, isSigner: false, isWritable: false }, // system_program
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },
    ],
    data,
  };

  // Fix system program
  ix.keys[2].pubkey = new PublicKey("11111111111111111111111111111111");

  const tx = new Transaction().add(ix);

  console.log("\n" + "=".repeat(60));
  console.log("🚀 COLLECTING FEES");
  console.log("=".repeat(60) + "\n");

  try {
    log("⏳", "Sending transaction...", colors.yellow);

    const signature = await sendAndConfirmTransaction(
      connection,
      tx,
      [creator],
      { commitment: "confirmed" }
    );

    log("✅", "FEES COLLECTED!", colors.green);
    log("🔗", `https://explorer.solana.com/tx/${signature}?cluster=devnet`, colors.cyan);

    console.log("\n" + "=".repeat(60));
    console.log("✅ SUCCESS!");
    console.log("=".repeat(60) + "\n");

    log("💡", "The creator vault should now exist:", colors.cyan);
    log("📝", "npx ts-node scripts/check-creator-vault.ts", colors.cyan);

    // Check new balance
    const newBalance = await connection.getBalance(creator.publicKey);
    const feesCollected = (newBalance - balance) / 1e9;

    if (feesCollected > 0) {
      log("💰", `Fees collected: ${feesCollected.toFixed(6)} SOL`, colors.green);
    }

  } catch (error: any) {
    console.log("\n" + "=".repeat(60));
    console.log("❌ ERROR");
    console.log("=".repeat(60) + "\n");

    log("❌", `Failed: ${error.message}`, colors.red);

    if (error.logs) {
      console.log("\n📋 Transaction Logs:");
      error.logs.forEach((l: string) => console.log(`   ${l}`));
    }

    console.log("\n💡 POSSIBLE REASONS:\n");
    log("1️⃣", "No fees accumulated yet (make more trades)", colors.cyan);
    log("2️⃣", "Creator vault account needs rent (unlikely)", colors.cyan);
    log("3️⃣", "Instruction format incorrect (check discriminator)", colors.cyan);

    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`${colors.red}❌ Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
