/**
 * Create Token Directly with PumpFun (Not via DAT)
 *
 * Creates a token directly on PumpFun devnet for testing purposes.
 * This bypasses DAT to avoid any initialization issues.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { PumpSdk } from "@pump-fun/pump-sdk";
import fs from "fs";

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
  console.log("🚀 CREATE TOKEN DIRECTLY ON PUMPFUN DEVNET");
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
  log("💰", `Balance: ${(balance / 1e9).toFixed(4)} SOL`,
    balance > 0.1 * 1e9 ? colors.green : colors.yellow);

  if (balance < 0.1 * 1e9) {
    log("❌", "Insufficient balance! Need at least 0.1 SOL", colors.red);
    process.exit(1);
  }

  // Token metadata
  const metadata = {
    name: "Test Token Direct",
    symbol: "TESTD",
    description: "Test token created directly on PumpFun devnet",
    image: "", // Empty for now
    showName: true,
    createdOn: "https://pump.fun",
    twitter: "",
    telegram: "",
    website: "",
  };

  log("🏷️", `Name: ${metadata.name}`, colors.cyan);
  log("🔤", `Symbol: ${metadata.symbol}`, colors.cyan);

  // For devnet, use a short placeholder URI
  // In production, you'd upload to IPFS/Arweave
  const metadataUri = "https://pump.fun/test";

  log("📄", "Using placeholder metadata URI (devnet only)", colors.yellow);

  console.log("\n" + "=".repeat(60));
  console.log("🔧 CREATING TOKEN");
  console.log("=".repeat(60) + "\n");

  try {
    const sdk = new PumpSdk();
    const mint = Keypair.generate();

    log("🪙", `Mint: ${mint.publicKey.toString()}`, colors.cyan);
    log("⏳", "Building create instruction...", colors.yellow);

    // Use the create instruction from the SDK
    const createIx = await sdk.createInstruction({
      mint: mint.publicKey,
      name: metadata.name,
      symbol: metadata.symbol,
      uri: metadataUri,
      creator: creator.publicKey,
      user: creator.publicKey,
    });

    const tx = new Transaction().add(createIx);

    log("⏳", "Sending transaction...", colors.yellow);

    const signature = await sendAndConfirmTransaction(
      connection,
      tx,
      [creator, mint],
      { commitment: "confirmed" }
    );

    log("✅", "TOKEN CREATED!", colors.green);
    log("🔗", `https://explorer.solana.com/tx/${signature}?cluster=devnet`, colors.cyan);

    // Save token info
    const tokenInfo = {
      mint: mint.publicKey.toString(),
      creator: creator.publicKey.toString(),
      name: metadata.name,
      symbol: metadata.symbol,
      uri: metadataUri,
      network: "devnet",
      timestamp: new Date().toISOString(),
      transaction: signature,
    };

    fs.writeFileSync("devnet-token-info.json", JSON.stringify(tokenInfo, null, 2));

    log("💾", "Token info saved to devnet-token-info.json", colors.green);

    console.log("\n" + "=".repeat(60));
    console.log("✅ SUCCESS!");
    console.log("=".repeat(60) + "\n");

    log("💡", "Add bonding curve to token info:", colors.cyan);
    log("📝", "npx ts-node scripts/find-bonding-curve.ts", colors.cyan);

  } catch (error: any) {
    console.log("\n" + "=".repeat(60));
    console.log("❌ ERROR");
    console.log("=".repeat(60) + "\n");

    log("❌", `Failed: ${error.message}`, colors.red);

    if (error.logs) {
      console.log("\n📋 Transaction Logs:");
      error.logs.forEach((l: string) => console.log(`   ${l}`));
    }

    console.log("\n💡 ALTERNATIVES:\n");
    log("1️⃣", "Use PumpFun devnet UI: https://pump.fun (switch to devnet)", colors.cyan);
    log("2️⃣", "Deploy to mainnet with Mayhem Mode (ready to use!)", colors.cyan);
    log("3️⃣", "Check if PumpFun is available on devnet", colors.cyan);

    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`${colors.red}❌ Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
