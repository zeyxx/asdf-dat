/**
 * Initialize Pool Accounts for ANY Token (SPL or Token2022)
 *
 * Creates the pool and DAT Authority token accounts needed for DAT buyback cycle.
 * Automatically detects the token program (SPL or Token2022) from the token config.
 *
 * Usage:
 *   npx ts-node scripts/init-pool-accounts.ts <token-config.json>
 *   npx ts-node scripts/init-pool-accounts.ts devnet-tokens/05-dsm1.json
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import fs from "fs";
import path from "path";

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

const PROGRAM_ID = new PublicKey("ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

async function main() {
  console.clear();
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.bright}${colors.cyan}🔧 INITIALIZE POOL ACCOUNTS (SPL / Token2022)${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);

  // Get token file from command line
  const tokenFile = process.argv[2];
  if (!tokenFile) {
    console.error(`${colors.red}Usage: npx ts-node scripts/init-pool-accounts.ts <token-config.json>${colors.reset}`);
    console.error(`${colors.yellow}Example: npx ts-node scripts/init-pool-accounts.ts devnet-tokens/05-dsm1.json${colors.reset}`);
    process.exit(1);
  }

  // Load token config
  const tokenPath = path.resolve(tokenFile);
  if (!fs.existsSync(tokenPath)) {
    console.error(`${colors.red}Token file not found: ${tokenPath}${colors.reset}`);
    process.exit(1);
  }

  const tokenInfo = JSON.parse(fs.readFileSync(tokenPath, "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);

  // Determine token program from config
  const isToken2022 = tokenInfo.tokenProgram === "Token2022" || tokenInfo.mayhemMode === true;
  const tokenProgram = isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const tokenProgramName = isToken2022 ? "Token2022" : "SPL";

  // Network detection
  const network = tokenInfo.network || "devnet";
  const isDevnet = network === "devnet";
  const rpcUrl = isDevnet ? "https://api.devnet.solana.com" : process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
  const walletFile = isDevnet ? "devnet-wallet.json" : "mainnet-wallet.json";

  const connection = new Connection(rpcUrl, "confirmed");

  const payer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletFile, "utf-8")))
  );

  log("📄", `Token Config: ${tokenFile}`, colors.cyan);
  log("🪙", `Symbol: ${tokenInfo.symbol}`, colors.cyan);
  log("🔑", `Mint: ${tokenMint.toString()}`, colors.cyan);
  log("📈", `Bonding Curve: ${bondingCurve.toString()}`, colors.cyan);
  log("🔗", `Token Program: ${tokenProgramName}`, isToken2022 ? colors.yellow : colors.green);
  log("🌐", `Network: ${network}`, colors.cyan);
  log("👤", `Payer: ${payer.publicKey.toString()}`, colors.cyan);

  const instructions = [];

  // 1. Pool Token Account (using correct token program)
  const poolTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    bondingCurve,
    true,
    tokenProgram
  );

  log("\n📦", `Checking Pool Token Account (${tokenProgramName})...`, colors.yellow);
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
        tokenProgram,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  } else {
    log("✅", "Pool Token Account exists", colors.green);
  }

  // 2. Pool WSOL Account (always SPL Token Program for WSOL)
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

  // 3. DAT Authority Token Account (for receiving bought tokens)
  const [datAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("auth_v3")],
    PROGRAM_ID
  );

  const datTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    datAuthority,
    true,
    tokenProgram  // Use same token program as the token
  );

  log("\n🔑", "Checking DAT Authority Token Account...", colors.yellow);
  log("🔑", `DAT Authority: ${datAuthority.toString()}`, colors.cyan);
  log("🔑", `Token Account: ${datTokenAccount.toString()}`, colors.cyan);

  const datTokenInfo = await connection.getAccountInfo(datTokenAccount);
  if (!datTokenInfo) {
    log("⚠️", "DAT Authority Token Account doesn't exist, will create", colors.yellow);
    instructions.push(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        datTokenAccount,
        datAuthority,
        tokenMint,
        tokenProgram,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  } else {
    log("✅", "DAT Authority Token Account exists", colors.green);
  }

  // 4. DAT Authority WSOL Account (for collecting fees - always SPL)
  const datWsolAccount = await getAssociatedTokenAddress(
    WSOL_MINT,
    datAuthority,
    true,
    TOKEN_PROGRAM_ID
  );

  log("\n💰", "Checking DAT Authority WSOL Account...", colors.yellow);
  log("🔑", `Address: ${datWsolAccount.toString()}`, colors.cyan);

  const datWsolInfo = await connection.getAccountInfo(datWsolAccount);
  if (!datWsolInfo) {
    log("⚠️", "DAT Authority WSOL Account doesn't exist, will create", colors.yellow);
    instructions.push(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        datWsolAccount,
        datAuthority,
        WSOL_MINT,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  } else {
    log("✅", "DAT Authority WSOL Account exists", colors.green);
  }

  // Execute if there are instructions
  if (instructions.length > 0) {
    log("\n🚀", `Creating ${instructions.length} account(s)...`, colors.yellow);

    const tx = new Transaction().add(...instructions);
    const sig = await sendAndConfirmTransaction(connection, tx, [payer]);

    log("✅", "Accounts created successfully!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${sig}?cluster=${network}`, colors.cyan);
  } else {
    log("\n✅", "All accounts already exist!", colors.green);
  }

  // Summary
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.bright}${colors.green}✅ ${tokenInfo.symbol} POOL ACCOUNTS READY (${tokenProgramName})${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);

  log("📦", `Pool Token (${tokenProgramName}): ${poolTokenAccount.toString()}`, colors.cyan);
  log("💰", `Pool WSOL: ${poolWsolAccount.toString()}`, colors.cyan);
  log("🔑", `DAT Token Account: ${datTokenAccount.toString()}`, colors.cyan);
  log("💰", `DAT WSOL Account: ${datWsolAccount.toString()}`, colors.cyan);
}

main().catch((error) => {
  console.error(`${colors.red}❌ Error: ${error.message}${colors.reset}`);
  console.error(error.stack);
  process.exit(1);
});
