/**
 * Buy Token Using PumpFun SDK - Creates Creator Vault
 *
 * Uses the official @pump-fun/pump-sdk to buy tokens.
 * This will automatically create the creator vault on the first trade.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  PumpSdk,
  OnlinePumpSdk,
} from "@pump-fun/pump-sdk";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddress
} from "@solana/spl-token";
import fs from "fs";
import BN from "bn.js";

// Buy amount in SOL (increased to generate more fees)
const BUY_AMOUNT_SOL = 0.1;
const BUY_AMOUNT_LAMPORTS = new BN(Math.floor(BUY_AMOUNT_SOL * 1e9));

// Fee recipient - DEVNET AUTHORIZED (from global.feeRecipients[0])
// This is different from mainnet! Use scripts/fetch-fee-recipients.ts to get the list
const FEE_RECIPIENT = new PublicKey("6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs");

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
  console.log("🛒 BUY TOKEN - CREATE CREATOR VAULT (SDK)");
  console.log("=".repeat(60) + "\n");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Load buyer wallet
  const walletPath = "devnet-wallet.json";
  if (!fs.existsSync(walletPath)) {
    log("❌", `Wallet not found: ${walletPath}`, colors.red);
    process.exit(1);
  }

  const buyer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  log("👤", `Buyer: ${buyer.publicKey.toString()}`, colors.cyan);

  // Check balance
  const balance = await connection.getBalance(buyer.publicKey);
  log("💰", `Balance: ${(balance / 1e9).toFixed(4)} SOL`,
    balance > 0.05 * 1e9 ? colors.green : colors.yellow);

  if (balance < 0.05 * 1e9) {
    log("⚠️", "Low balance! Need at least 0.05 SOL", colors.yellow);
    log("💡", "Get devnet SOL: solana airdrop 1", colors.yellow);
  }

  // Load token info
  const tokenInfoPath = "devnet-token-info.json";
  if (!fs.existsSync(tokenInfoPath)) {
    log("❌", "Token info not found", colors.red);
    process.exit(1);
  }

  log("📄", "Loading token info...", colors.cyan);
  const tokenInfo = JSON.parse(fs.readFileSync(tokenInfoPath, "utf-8"));

  if (!tokenInfo.mint) {
    log("❌", "Token info missing 'mint' field", colors.red);
    process.exit(1);
  }
  if (!tokenInfo.bondingCurve) {
    log("❌", "Token info missing 'bondingCurve' field", colors.red);
    process.exit(1);
  }

  const tokenMint = new PublicKey(tokenInfo.mint);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);

  log("🪙", `Token Mint: ${tokenMint.toString()}`, colors.cyan);
  log("💵", `Buy Amount: ${BUY_AMOUNT_SOL} SOL`, colors.cyan);

  console.log("\n" + "=".repeat(60));
  console.log("🔧 PREPARING TRANSACTION");
  console.log("=".repeat(60) + "\n");

  // Initialize SDK
  const sdk = new PumpSdk();
  const onlineSdk = new OnlinePumpSdk(connection);

  log("✅", "PumpFun SDK initialized", colors.green);

  console.log("\n" + "=".repeat(60));
  console.log("🚀 EXECUTING BUY");
  console.log("=".repeat(60) + "\n");

  try {
    // Get buyer token ATA
    const buyerTokenAta = await getAssociatedTokenAddress(
      tokenMint,
      buyer.publicKey
    );

    // Fetch buy state to calculate token amount
    log("📊", "Fetching bonding curve state...", colors.cyan);
    const global = await onlineSdk.fetchGlobal();
    const feeConfig = await onlineSdk.fetchFeeConfig();
    const bondingCurveData = await onlineSdk.fetchBondingCurve(tokenMint);

    // Get creator from bonding curve
    const creator = bondingCurveData.creator;

    // Use SDK to calculate token amount (this is for informational purposes)
    log("👤", `Creator (from bonding curve): ${creator.toString()}`, colors.cyan);
    log("📊", `Virtual SOL Reserves: ${bondingCurveData.virtualSolReserves.toString()}`, colors.cyan);
    log("📊", `Virtual Token Reserves: ${bondingCurveData.virtualTokenReserves.toString()}`, colors.cyan);

    // For simplicity, we'll let the SDK calculate the exact amount
    // We pass a large token amount and the actual SOL amount we want to spend
    const tokensToReceive = new BN("1000000000"); // Large number - actual will be limited by SOL amount

    // Build transaction
    const tx = new Transaction();

    // Create buyer ATA if needed (idempotent)
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        buyer.publicKey,
        buyerTokenAta,
        buyer.publicKey,
        tokenMint
      )
    );

    log("➕", "Added: Create buyer token ATA (if needed)", colors.cyan);

    // Get buy instruction from SDK
    const buyIx = await sdk.getBuyInstructionRaw({
      user: buyer.publicKey,
      mint: tokenMint,
      creator: creator,
      amount: tokensToReceive,
      solAmount: BUY_AMOUNT_LAMPORTS,
      feeRecipient: FEE_RECIPIENT,
    });

    tx.add(buyIx);

    log("➕", "Added: Buy instruction", colors.cyan);
    log("⏳", "Sending transaction...", colors.yellow);

    // Send and confirm
    const signature = await sendAndConfirmTransaction(
      connection,
      tx,
      [buyer],
      { commitment: "confirmed" }
    );

    log("✅", "TRADE SUCCESS!", colors.green);
    log("🔗", `https://explorer.solana.com/tx/${signature}?cluster=devnet`, colors.cyan);

    console.log("\n" + "=".repeat(60));
    console.log("✅ SUCCESS!");
    console.log("=".repeat(60) + "\n");

    log("💡", "Now verify the creator vault was created:", colors.cyan);
    log("📝", "npx ts-node scripts/init-creator-vault.ts", colors.cyan);

  } catch (error: any) {
    console.log("\n" + "=".repeat(60));
    console.log("❌ ERROR");
    console.log("=".repeat(60) + "\n");

    log("❌", `Failed: ${error.message}`, colors.red);

    if (error.logs) {
      console.log("\n📋 Transaction Logs:");
      error.logs.forEach((l: string) => console.log(`   ${l}`));
    }

    console.log("\n💡 TROUBLESHOOTING:\n");
    log("1️⃣", "Check token exists: solana account " + tokenMint.toString() + " --url devnet", colors.cyan);
    log("2️⃣", "Check bonding curve exists", colors.cyan);
    log("3️⃣", "Try smaller amount (e.g., 0.001 SOL)", colors.cyan);
    log("4️⃣", "Use PumpFun devnet UI to buy manually", colors.cyan);

    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`${colors.red}❌ Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
