/**
 * Initialize Missing Pool Accounts for Mayhem Token
 *
 * Creates the pool WSOL and token accounts needed for trading
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
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
  console.log(`${colors.bright}${colors.cyan}🔧 INITIALIZE MAYHEM POOL ACCOUNTS${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const payer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  log("👤", `Payer: ${payer.publicKey.toString()}`, colors.cyan);

  // Load token info
  const tokenInfo = JSON.parse(fs.readFileSync("devnet-token-mayhem.json", "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);
  const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

  log("🪙", `Token Mint: ${tokenMint.toString()}`, colors.cyan);
  log("📈", `Bonding Curve: ${bondingCurve.toString()}`, colors.cyan);

  const instructions = [];

  // 1. Pool Token Account (Token2022)
  const poolTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    bondingCurve,
    true,
    TOKEN_2022_PROGRAM_ID
  );

  log("\n📦", "Checking Pool Token Account (Token2022)...", colors.yellow);
  log("🔑", `Address: ${poolTokenAccount.toString()}`, colors.cyan);

  const poolTokenInfo = await connection.getAccountInfo(poolTokenAccount);
  if (!poolTokenInfo) {
    log("⚠️", "Pool Token Account doesn't exist, will create", colors.yellow);
    instructions.push(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        poolTokenAccount,
        bondingCurve,
        tokenMint,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  } else {
    log("✅", "Pool Token Account exists", colors.green);
  }

  // 2. Pool WSOL Account (Regular Token Program)
  const poolWsolAccount = await getAssociatedTokenAddress(
    WSOL_MINT,
    bondingCurve,
    true,
    TOKEN_PROGRAM_ID
  );

  log("\n💰", "Checking Pool WSOL Account...", colors.yellow);
  log("🔑", `Address: ${poolWsolAccount.toString()}`, colors.cyan);

  const poolWsolInfo = await connection.getAccountInfo(poolWsolAccount);
  if (!poolWsolInfo) {
    log("⚠️", "Pool WSOL Account doesn't exist, will create", colors.yellow);
    instructions.push(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        poolWsolAccount,
        bondingCurve,
        WSOL_MINT,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  } else {
    log("✅", "Pool WSOL Account exists", colors.green);
  }

  // Execute if there are instructions
  if (instructions.length > 0) {
    log("\n🚀", `Creating ${instructions.length} account(s)...`, colors.yellow);

    const tx = new Transaction().add(...instructions);
    const sig = await sendAndConfirmTransaction(connection, tx, [payer]);

    log("✅", "Accounts created successfully!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${sig}?cluster=devnet`, colors.cyan);
  } else {
    log("\n✅", "All accounts already exist!", colors.green);
  }

  // Summary
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.bright}${colors.green}✅ POOL ACCOUNTS READY${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);

  log("📦", `Pool Token (Token2022): ${poolTokenAccount.toString()}`, colors.cyan);
  log("💰", `Pool WSOL: ${poolWsolAccount.toString()}`, colors.cyan);
  log("🔥", "You can now run: npx ts-node scripts/test-mayhem-cycle.ts", colors.green);
}

main().catch((error) => {
  console.error(`${colors.red}❌ Error: ${error.message}${colors.reset}`);
  process.exit(1);
});
