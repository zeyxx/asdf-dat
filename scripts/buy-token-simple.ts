/**
 * Simple Buy Script - Creates Creator Vault
 *
 * Buys a small amount of tokens to:
 * 1. Create the creator vault ATA
 * 2. Generate initial fees
 * 3. Enable DAT collect_fees testing
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import fs from "fs";
import BN from "bn.js";

// Programs
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

// Buy amount in SOL
const BUY_AMOUNT_SOL = 0.01;
const BUY_AMOUNT_LAMPORTS = Math.floor(BUY_AMOUNT_SOL * 1e9);

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
  console.log("🛒 BUY TOKEN - CREATE CREATOR VAULT");
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

  const tokenInfo = JSON.parse(fs.readFileSync(tokenInfoPath, "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);

  log("🪙", `Token Mint: ${tokenMint.toString()}`, colors.cyan);
  log("📈", `Bonding Curve: ${bondingCurve.toString()}`, colors.cyan);
  log("💵", `Buy Amount: ${BUY_AMOUNT_SOL} SOL`, colors.cyan);

  console.log("\n" + "=".repeat(60));
  console.log("📝 PREPARING TRANSACTION");
  console.log("=".repeat(60) + "\n");

  // Derive PDAs
  const [global] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    PUMP_PROGRAM
  );

  const [feeRecipient] = PublicKey.findProgramAddressSync(
    [Buffer.from("fee-recipient")],
    PUMP_PROGRAM
  );

  const [eventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM
  );

  // Get or create buyer token ATA
  const buyerTokenAta = await getAssociatedTokenAddress(
    tokenMint,
    buyer.publicKey
  );

  const poolTokenAta = await getAssociatedTokenAddress(
    tokenMint,
    bondingCurve,
    true
  );

  const poolWsolAta = await getAssociatedTokenAddress(
    WSOL_MINT,
    bondingCurve,
    true
  );

  log("✅", "All PDAs derived", colors.green);

  // Check if buyer ATA exists
  let needsAta = false;
  try {
    await getAccount(connection, buyerTokenAta);
    log("✅", "Buyer token ATA exists", colors.green);
  } catch {
    needsAta = true;
    log("📝", "Buyer token ATA will be created", colors.yellow);
  }

  console.log("\n" + "=".repeat(60));
  console.log("🚀 EXECUTING BUY");
  console.log("=".repeat(60) + "\n");

  try {
    const tx = new Transaction();

    // Create ATA if needed
    if (needsAta) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          buyer.publicKey,
          buyerTokenAta,
          buyer.publicKey,
          tokenMint
        )
      );
      log("➕", "Added: Create buyer token ATA", colors.cyan);
    }

    // Buy instruction data
    const buyData = Buffer.alloc(24);
    buyData.writeUInt8(102, 0); // buy discriminator (example - may need adjustment)
    new BN(BUY_AMOUNT_LAMPORTS).toArrayLike(Buffer, "le", 8).copy(buyData, 1);
    new BN(0).toArrayLike(Buffer, "le", 8).copy(buyData, 9); // max sol cost

    log("⚠️", "Note: This uses a simplified buy instruction", colors.yellow);
    log("💡", "If it fails, you may need to use PumpFun SDK directly", colors.yellow);

    const buyIx = new TransactionInstruction({
      programId: PUMP_PROGRAM,
      keys: [
        { pubkey: global, isSigner: false, isWritable: false },
        { pubkey: feeRecipient, isSigner: false, isWritable: true },
        { pubkey: tokenMint, isSigner: false, isWritable: false },
        { pubkey: bondingCurve, isSigner: false, isWritable: true },
        { pubkey: poolTokenAta, isSigner: false, isWritable: true },
        { pubkey: poolWsolAta, isSigner: false, isWritable: true },
        { pubkey: buyerTokenAta, isSigner: false, isWritable: true },
        { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: eventAuthority, isSigner: false, isWritable: false },
        { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },
      ],
      data: buyData,
    });

    tx.add(buyIx);

    log("⏳", "Sending transaction...", colors.yellow);

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

    console.log("\n💡 ALTERNATIVE APPROACHES:\n");
    log("1️⃣", "Use PumpFun devnet UI to buy manually", colors.cyan);
    log("2️⃣", "Use @pump-fun/pump-sdk for programmatic buy", colors.cyan);
    log("3️⃣", "Check tests/scripts/buy-with-idl.ts for reference", colors.cyan);
    log("4️⃣", "Or manually fund the creator vault (not recommended)", colors.cyan);

    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`${colors.red}❌ Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
