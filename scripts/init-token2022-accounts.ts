/**
 * Initialize All Required Accounts for Token2022 (Mayhem) DAT Cycles
 *
 * Creates all missing token accounts needed for execute_buy and burn_and_update
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import fs from "fs";

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
  console.clear();
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.bright}${colors.magenta}🔧 INITIALIZE TOKEN2022 ACCOUNTS${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Load payer wallet
  const payer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  log("👤", `Payer: ${payer.publicKey.toString()}`, colors.cyan);

  // Load token info
  const tokenInfo = JSON.parse(fs.readFileSync("devnet-token-mayhem.json", "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);

  log("🪙", `Token Mint: ${tokenMint.toString()}`, colors.cyan);
  log("📈", `Bonding Curve: ${bondingCurve.toString()}`, colors.cyan);

  // Protocol fee recipient (from PumpFun)
  const protocolFeeRecipient = new PublicKey("6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs");
  log("💰", `Protocol Fee Recipient: ${protocolFeeRecipient.toString()}`, colors.cyan);

  // Derive all required ATAs for Token2022
  const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

  const accounts = [
    {
      name: "Protocol Fee Recipient ATA (Token2022)",
      address: await getAssociatedTokenAddress(
        tokenMint,
        protocolFeeRecipient,
        true,
        TOKEN_2022_PROGRAM_ID
      ),
      mint: tokenMint,
      owner: protocolFeeRecipient,
      programId: TOKEN_2022_PROGRAM_ID,
    },
    {
      name: "Protocol Fee Recipient ATA (WSOL)",
      address: await getAssociatedTokenAddress(
        WSOL_MINT,
        protocolFeeRecipient,
        true,
        TOKEN_PROGRAM_ID
      ),
      mint: WSOL_MINT,
      owner: protocolFeeRecipient,
      programId: TOKEN_PROGRAM_ID,
    },
  ];

  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.bright}${colors.yellow}📋 CHECKING ACCOUNTS${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);

  const accountsToCreate: typeof accounts = [];

  for (const acc of accounts) {
    try {
      await getAccount(connection, acc.address, "confirmed", acc.programId);
      log("✅", `${acc.name}: exists`, colors.green);
      log("  ", `${acc.address.toString()}`, colors.reset);
    } catch {
      log("⚠️", `${acc.name}: needs creation`, colors.yellow);
      log("  ", `${acc.address.toString()}`, colors.reset);
      accountsToCreate.push(acc);
    }
  }

  if (accountsToCreate.length === 0) {
    log("\n✅", "All required accounts already exist!", colors.green);
    return;
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.bright}${colors.magenta}🚀 CREATING ACCOUNTS${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);

  log("📝", `Creating ${accountsToCreate.length} account(s)...`, colors.yellow);

  const transaction = new Transaction();

  for (const acc of accountsToCreate) {
    log("➕", `Adding instruction for: ${acc.name}`, colors.cyan);
    transaction.add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey, // payer
        acc.address, // ata
        acc.owner, // owner
        acc.mint, // mint
        acc.programId // token program
      )
    );
  }

  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [payer],
      { commitment: "confirmed" }
    );

    log("\n✅", "Accounts created successfully!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${signature}?cluster=devnet`, colors.cyan);

    console.log(`\n${"=".repeat(70)}`);
    console.log(`${colors.bright}${colors.green}✅ ALL ACCOUNTS READY${colors.reset}`);
    console.log(`${"=".repeat(70)}\n`);

    for (const acc of accountsToCreate) {
      log("📦", acc.name, colors.cyan);
      log("  ", acc.address.toString(), colors.reset);
    }

    log("\n🎉", "You can now run the complete DAT cycle!", colors.magenta);
    log("📝", "npx ts-node scripts/execute-cycle-secondary.ts devnet-token-mayhem.json", colors.cyan);

  } catch (error: any) {
    log("\n❌", `Error creating accounts: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`${colors.red}❌ Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
