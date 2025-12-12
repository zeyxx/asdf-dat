/**
 * Sell Token2022 (Mayhem Mode) Tokens using Official Pump SDK
 */

import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAccount, getAssociatedTokenAddress } from "@solana/spl-token";
import { OnlinePumpSdk } from "@pump-fun/pump-sdk";
import fs from "fs";
import BN from "bn.js";

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

function log(emoji: string, message: string, color = colors.reset) {
  console.log(`${color}${emoji} ${message}${colors.reset}`);
}

async function main() {
  const tokenFile = process.argv[2] || "devnet-token-mayhem.json";

  console.log("\n" + "=".repeat(70));
  console.log(`${colors.bright}${colors.yellow}💰 SELL TOKEN2022 (MAYHEM MODE)${colors.reset}`);
  console.log("=".repeat(70) + "\n");

  log("📄", `Token file: ${tokenFile}`, colors.cyan);

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const sdk = new OnlinePumpSdk(connection);

  const seller = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  log("👤", `Seller: ${seller.publicKey.toString()}`, colors.cyan);

  // Load Token2022 info
  const tokenInfo = JSON.parse(fs.readFileSync(tokenFile, "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const creator = new PublicKey(tokenInfo.creator);

  log("🪙", `Token Mint: ${tokenMint.toString()}`, colors.cyan);
  log("🔥", `Mayhem Mode: ${tokenInfo.mayhemMode}`, colors.yellow);

  // Get seller's token account
  const sellerTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    seller.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  try {
    // Get token balance
    const tokenAccountInfo = await getAccount(
      connection,
      sellerTokenAccount,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );

    const tokenBalance = tokenAccountInfo.amount;

    if (tokenBalance === 0n) {
      log("⚠️", "No tokens to sell!", colors.yellow);
      return;
    }

    const tokenBalanceNum = Number(tokenBalance) / 1e6;

    // Skip dust (less than 100 tokens ≈ negligible value)
    if (tokenBalanceNum < 100) {
      log("ℹ️", `Skipping dust: ${tokenBalanceNum.toFixed(2)} tokens (< 100)`, colors.yellow);
      return;
    }

    log("💎", `Selling ${tokenBalanceNum.toLocaleString()} tokens`, colors.cyan);

    // Fetch sell state
    const global = await sdk.fetchGlobal();
    const { bondingCurveAccountInfo, bondingCurve } =
      await sdk.fetchSellState(tokenMint, seller.publicKey, TOKEN_2022_PROGRAM_ID);

    const tokenAmount = new BN(tokenBalance.toString());

    // Build sell instructions with reasonable slippage
    // Use minimal solAmount and let slippage tolerance handle the rest
    const offlineSdk = new (await import("@pump-fun/pump-sdk")).PumpSdk();
    const instructions = await offlineSdk.sellInstructions({
      global,
      bondingCurveAccountInfo,
      bondingCurve,
      mint: tokenMint,
      user: seller.publicKey,
      amount: tokenAmount,
      solAmount: new BN(1), // Minimal amount, slippage will adjust
      slippage: 25, // 25% slippage for devnet (accounts for low liquidity)
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      mayhemMode: true, // Mayhem mode for Token2022
    });

    const tx = new Transaction();
    for (const ix of instructions) {
      tx.add(ix);
    }

    const sig = await sendAndConfirmTransaction(connection, tx, [seller], {
      commitment: "confirmed",
    });

    log("✅", "Sell successful!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${sig}?cluster=devnet`, colors.cyan);

    // Check balance after
    const balance = await connection.getBalance(seller.publicKey);
    log("💰", `Balance after: ${(balance / 1e9).toFixed(4)} SOL`, colors.green);

  } catch (error: any) {
    log("❌", `Sell failed: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-5).forEach((l: string) => console.log(`   ${l}`));
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(`${colors.red}❌ Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
