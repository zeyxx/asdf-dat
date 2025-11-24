/**
 * Buy SPL Tokens (Simplified)
 * Uses the same account order as our working CPI in lib.rs
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import fs from "fs";
import BN from "bn.js";

const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const FEE_PROGRAM = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");

const BUY_DISCRIMINATOR = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);

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
  const NUM_BUYS = 5;
  const BUY_AMOUNT_SOL = 0.005; // Larger buys to generate more fees

  const tokenFile = process.argv[2] || "devnet-token-spl.json";

  console.log("\n" + "=".repeat(60));
  console.log(`${colors.bright}${colors.cyan}🛒 BUY SPL TOKENS (${NUM_BUYS}x)${colors.reset}`);
  console.log("=".repeat(60) + "\n");

  log("📄", `Token file: ${tokenFile}`, colors.cyan);

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const buyer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  log("👤", `Buyer: ${buyer.publicKey.toString()}`, colors.cyan);

  const balance = await connection.getBalance(buyer.publicKey);
  log("💰", `Balance: ${(balance / 1e9).toFixed(4)} SOL`, balance > 0.01 * 1e9 ? colors.green : colors.yellow);

  const tokenInfo = JSON.parse(fs.readFileSync(tokenFile, "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);
  const creator = new PublicKey(tokenInfo.creator);

  log("🪙", `Token Mint: ${tokenMint.toString()}`, colors.cyan);
  log("📈", `Bonding Curve: ${bondingCurve.toString()}`, colors.cyan);

  // Derive PDAs (same as lib.rs)
  const [global] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    PUMP_PROGRAM
  );

  const [creatorVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), creator.toBuffer()],
    PUMP_PROGRAM
  );

  const [eventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM
  );

  const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_volume_accumulator")],
    PUMP_PROGRAM
  );

  const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_volume_accumulator"), buyer.publicKey.toBuffer()],
    PUMP_PROGRAM
  );

  const [feeConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("fee_config"), PUMP_PROGRAM.toBuffer()],
    FEE_PROGRAM
  );

  // Fee recipient (same as lib.rs)
  const feeRecipient = new PublicKey("6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs");

  const buyerTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    buyer.publicKey,
    false,
    TOKEN_PROGRAM_ID
  );

  const bondingCurveTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    bondingCurve,
    true,
    TOKEN_PROGRAM_ID
  );

  // Check creator vault before
  const vaultBefore = await connection.getAccountInfo(creatorVault);
  const vaultBalanceBefore = vaultBefore ? vaultBefore.lamports / 1e9 : 0;
  log("🏦", `Creator Vault (before): ${vaultBalanceBefore.toFixed(6)} SOL`, colors.yellow);

  // Execute buys
  for (let i = 0; i < NUM_BUYS; i++) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`${colors.bright}${colors.yellow}⏳ BUY ${i + 1}/${NUM_BUYS}${colors.reset}`);
    console.log(`${"=".repeat(60)}\n`);

    try {
      const tx = new Transaction();

      // Create buyer token account if needed
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          buyer.publicKey,
          buyerTokenAccount,
          buyer.publicKey,
          tokenMint,
          TOKEN_PROGRAM_ID
        )
      );

      // Build instruction data: [discriminator(8)][token_amount(8)][max_sol_cost(8)][track_volume(1)]
      const tokenAmount = new BN(1_000_000); // 1 token (6 decimals)
      const maxSolCost = new BN(Math.floor(BUY_AMOUNT_SOL * 1e9));

      const data = Buffer.concat([
        BUY_DISCRIMINATOR,
        tokenAmount.toArrayLike(Buffer, "le", 8),
        maxSolCost.toArrayLike(Buffer, "le", 8),
        Buffer.from([0]), // track_volume: None
      ]);

      // Account order MUST match lib.rs execute_buy_cpi
      const buyIx = new TransactionInstruction({
        programId: PUMP_PROGRAM,
        keys: [
          { pubkey: global, isSigner: false, isWritable: false },                    // 0 - global
          { pubkey: feeRecipient, isSigner: false, isWritable: true },               // 1 - fee_recipient
          { pubkey: tokenMint, isSigner: false, isWritable: false },                 // 2 - mint
          { pubkey: bondingCurve, isSigner: false, isWritable: true },               // 3 - bonding_curve
          { pubkey: bondingCurveTokenAccount, isSigner: false, isWritable: true },   // 4 - associated_bonding_curve
          { pubkey: buyerTokenAccount, isSigner: false, isWritable: true },          // 5 - associated_user
          { pubkey: buyer.publicKey, isSigner: true, isWritable: true },             // 6 - user (SIGNER)
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },   // 7 - system_program
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },          // 8 - token_program
          { pubkey: creatorVault, isSigner: false, isWritable: true },               // 9 - creator_vault
          { pubkey: eventAuthority, isSigner: false, isWritable: false },            // 10 - event_authority
          { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },              // 11 - program
          { pubkey: globalVolumeAccumulator, isSigner: false, isWritable: true },    // 12 - global_volume_accumulator
          { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },      // 13 - user_volume_accumulator
          { pubkey: feeConfig, isSigner: false, isWritable: false },                 // 14 - fee_config
          { pubkey: FEE_PROGRAM, isSigner: false, isWritable: false },               // 15 - fee_program
        ],
        data,
      });

      tx.add(buyIx);

      const sig = await sendAndConfirmTransaction(connection, tx, [buyer], {
        commitment: "confirmed",
        skipPreflight: true, // Skip simulation like execute-cycle-secondary
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
        error.logs.slice(-10).forEach((l: string) => console.log(`   ${l}`));
      }
    }
  }

  // Check creator vault after
  console.log("\n" + "=".repeat(60));
  console.log(`${colors.bright}${colors.cyan}📊 RESULTS${colors.reset}`);
  console.log("=".repeat(60) + "\n");

  const vaultAfter = await connection.getAccountInfo(creatorVault);
  const vaultBalanceAfter = vaultAfter ? vaultAfter.lamports / 1e9 : 0;

  log("🏦", `Creator Vault (before): ${vaultBalanceBefore.toFixed(6)} SOL`, colors.yellow);
  log("🏦", `Creator Vault (after): ${vaultBalanceAfter.toFixed(6)} SOL`, colors.green);
  log("📈", `Fees Generated: ${(vaultBalanceAfter - vaultBalanceBefore).toFixed(6)} SOL`, colors.cyan);

  if (vaultBalanceAfter > 0.001) {
    console.log("\n" + "=".repeat(60));
    console.log(`${colors.bright}${colors.green}✅ READY FOR DAT CYCLE TEST${colors.reset}`);
    console.log("=".repeat(60) + "\n");

    log("🔥", "Run: npx ts-node scripts/execute-cycle-secondary.ts", colors.green);
  } else {
    log("⚠️", "Need more fees. Try buying more tokens.", colors.yellow);
  }
}

main().catch((error) => {
  console.error(`${colors.red}❌ Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
