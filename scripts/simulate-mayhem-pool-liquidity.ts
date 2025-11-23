/**
 * Simulate Pool Liquidity for Mayhem Token
 *
 * Manually adds SOL and tokens to the pool to simulate trading activity
 * This allows testing the DAT cycle without needing real PumpFun trading
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createSyncNativeInstruction,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import fs from "fs";

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
  console.clear();
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.bright}${colors.cyan}💧 SIMULATE MAYHEM POOL LIQUIDITY${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  log("👤", `Admin: ${admin.publicKey.toString()}`, colors.cyan);

  // Load token info
  const tokenInfo = JSON.parse(fs.readFileSync("devnet-token-mayhem.json", "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);
  const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

  log("🪙", `Token Mint: ${tokenMint.toString()}`, colors.cyan);
  log("📈", `Bonding Curve: ${bondingCurve.toString()}`, colors.cyan);

  // Derive pool accounts
  const poolWsolAccount = await getAssociatedTokenAddress(
    WSOL_MINT,
    bondingCurve,
    true,
    TOKEN_PROGRAM_ID
  );

  const poolTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    bondingCurve,
    true,
    TOKEN_2022_PROGRAM_ID
  );

  log("\n📦", "Pool Accounts:", colors.yellow);
  log("💰", `Pool WSOL: ${poolWsolAccount.toString()}`, colors.cyan);
  log("🪙", `Pool Token: ${poolTokenAccount.toString()}`, colors.cyan);

  // Amounts to add
  const solAmount = 0.1; // 0.1 SOL
  const solLamports = Math.floor(solAmount * LAMPORTS_PER_SOL);

  log("\n💧", "Adding liquidity to pool:", colors.yellow);
  log("💵", `${solAmount} SOL to pool WSOL account`, colors.cyan);

  // Transfer SOL to pool WSOL account and sync
  const tx = new Transaction();

  tx.add(
    SystemProgram.transfer({
      fromPubkey: admin.publicKey,
      toPubkey: poolWsolAccount,
      lamports: solLamports,
    }),
    createSyncNativeInstruction(poolWsolAccount, TOKEN_PROGRAM_ID)
  );

  log("\n🚀", "Sending transaction...", colors.yellow);

  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [admin]);

    log("✅", "Liquidity added successfully!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${sig}?cluster=devnet`, colors.cyan);

    // Check balances
    const poolWsolInfo = await connection.getTokenAccountBalance(poolWsolAccount);
    const poolTokenInfo = await connection.getTokenAccountBalance(poolTokenAccount);

    log("\n📊", "Pool Status:", colors.green);
    log("💰", `WSOL Reserve: ${Number(poolWsolInfo.value.amount) / LAMPORTS_PER_SOL} SOL`, colors.green);
    log("🪙", `Token Reserve: ${Number(poolTokenInfo.value.amount).toLocaleString()} tokens`, colors.green);

    console.log(`\n${"=".repeat(70)}`);
    console.log(`${colors.bright}${colors.green}✅ POOL READY FOR DAT CYCLE${colors.reset}`);
    console.log(`${"=".repeat(70)}\n`);

    log("🔥", "Now run: npx ts-node scripts/test-mayhem-cycle.ts", colors.cyan);
  } catch (error: any) {
    log("❌", `Error: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-10).forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`${colors.red}❌ Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
