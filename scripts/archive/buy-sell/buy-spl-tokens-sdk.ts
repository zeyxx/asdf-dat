/**
 * Buy SPL Tokens using Official Pump SDK
 *
 * Makes multiple buys to add liquidity to the pool and generate creator fees
 */

import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { OnlinePumpSdk, getBuyTokenAmountFromSolAmount } from "@pump-fun/pump-sdk";
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
  const NUM_BUYS = 10;
  const BUY_AMOUNT_SOL = 0.05; // 0.05 SOL per buy - INCREASED for pool liquidity

  // Accept token file from command line or default
  const tokenFile = process.argv[2] || "devnet-token-spl.json";

  console.log("\n" + "=".repeat(70));
  console.log(`${colors.bright}${colors.cyan}🛒 BUY SPL TOKENS WITH OFFICIAL SDK${colors.reset}`);
  console.log("=".repeat(70) + "\n");

  log("📄", `Token file: ${tokenFile}`, colors.cyan);

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const sdk = new OnlinePumpSdk(connection);

  const buyer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  log("👤", `Buyer: ${buyer.publicKey.toString()}`, colors.cyan);

  const balance = await connection.getBalance(buyer.publicKey);
  log("💰", `Balance: ${(balance / 1e9).toFixed(4)} SOL`, balance > 0.05 * 1e9 ? colors.green : colors.yellow);

  if (balance < NUM_BUYS * BUY_AMOUNT_SOL * 1e9) {
    log("⚠️", `Insufficient balance for ${NUM_BUYS} buys of ${BUY_AMOUNT_SOL} SOL each`, colors.yellow);
  }

  // Load SPL token info
  const tokenInfo = JSON.parse(fs.readFileSync(tokenFile, "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const creator = new PublicKey(tokenInfo.creator);

  log("🪙", `Token Mint: ${tokenMint.toString()}`, colors.cyan);
  log("👨‍🎨", `Token Creator: ${creator.toString()}`, colors.cyan);

  // Check creator vault before
  const vaultBalanceBefore = await sdk.getCreatorVaultBalanceBothPrograms(creator);
  log("🏦", `Creator Vault (before): ${(Number(vaultBalanceBefore) / 1e9).toFixed(6)} SOL`, colors.yellow);

  // Execute buys
  for (let i = 0; i < NUM_BUYS; i++) {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`${colors.bright}${colors.yellow}⏳ BUY ${i + 1}/${NUM_BUYS}${colors.reset}`);
    console.log(`${"=".repeat(70)}\n`);

    try {
      // Fetch global config and bonding curve state
      const global = await sdk.fetchGlobal();
      const { bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo } =
        await sdk.fetchBuyState(tokenMint, buyer.publicKey, TOKEN_PROGRAM_ID);

      const solAmount = new BN(Math.floor(BUY_AMOUNT_SOL * 1e9));
      const tokenAmount = getBuyTokenAmountFromSolAmount({
        global,
        feeConfig: null,
        mintSupply: null,
        bondingCurve,
        amount: solAmount,
      });

      log("💵", `Buying with ${BUY_AMOUNT_SOL} SOL`, colors.cyan);
      log("🎯", `Expected tokens: ${(Number(tokenAmount) / 1e6).toLocaleString()}`, colors.cyan);

      // Get buy instructions from SDK (needs PumpSdk, not OnlinePumpSdk)
      const offlineSdk = new (await import("@pump-fun/pump-sdk")).PumpSdk();
      const instructions = await offlineSdk.buyInstructions({
        global,
        bondingCurveAccountInfo,
        bondingCurve,
        associatedUserAccountInfo,
        mint: tokenMint,
        user: buyer.publicKey,
        solAmount,
        amount: tokenAmount,
        slippage: 30, // 30% slippage tolerance (devnet volatility + price impact)
        tokenProgram: TOKEN_PROGRAM_ID,
      });

      // Create and send transaction
      const tx = new Transaction();
      for (const ix of instructions) {
        tx.add(ix);
      }

      const sig = await sendAndConfirmTransaction(connection, tx, [buyer], {
        commitment: "confirmed",
      });

      log("✅", `Buy ${i + 1} successful!`, colors.green);
      log("🔗", `TX: https://explorer.solana.com/tx/${sig}?cluster=devnet`, colors.cyan);

      // Wait between buys
      if (i < NUM_BUYS - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (error: any) {
      log("❌", `Buy ${i + 1} failed: ${error.message}`, colors.red);

      if (error.logs) {
        console.log("\n📋 Logs:");
        error.logs.slice(-5).forEach((l: string) => console.log(`   ${l}`));
      }

      // Continue with next buy
    }
  }

  // Check creator vault after
  console.log("\n" + "=".repeat(70));
  console.log(`${colors.bright}${colors.cyan}📊 RESULTS${colors.reset}`);
  console.log("=".repeat(70) + "\n");

  const vaultBalanceAfter = await sdk.getCreatorVaultBalanceBothPrograms(creator);

  log("🏦", `Creator Vault (before): ${(Number(vaultBalanceBefore) / 1e9).toFixed(6)} SOL`, colors.yellow);
  log("🏦", `Creator Vault (after): ${(Number(vaultBalanceAfter) / 1e9).toFixed(6)} SOL`, colors.green);
  log("📈", `Fees Generated: ${((Number(vaultBalanceAfter) - Number(vaultBalanceBefore)) / 1e9).toFixed(6)} SOL`, colors.cyan);

  if (Number(vaultBalanceAfter) > 0.001 * 1e9) {
    console.log("\n" + "=".repeat(70));
    console.log(`${colors.bright}${colors.green}✅ READY FOR DAT CYCLE TEST${colors.reset}`);
    console.log("=".repeat(70) + "\n");

    log("🔥", "Run: npx ts-node scripts/test-spl-full-cycle-batch.ts", colors.green);
  } else {
    log("⚠️", "WARNING: Very low fees. May need more trades.", colors.yellow);
  }
}

main().catch((error) => {
  console.error(`${colors.red}❌ Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
