/**
 * Buy Mayhem Token to Initialize Pool Liquidity
 *
 * Makes a small purchase to add SOL liquidity to the bonding curve
 * This is needed before testing DAT cycles
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
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

const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const FEE_PROGRAM = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");

async function main() {
  console.clear();
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.bright}${colors.cyan}💰 BUY MAYHEM TOKEN TO INIT POOL${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const buyer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  log("👤", `Buyer: ${buyer.publicKey.toString()}`, colors.cyan);

  // Load token info
  const tokenInfo = JSON.parse(fs.readFileSync("devnet-token-mayhem.json", "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);

  log("🪙", `Token Mint: ${tokenMint.toString()}`, colors.cyan);
  log("📈", `Bonding Curve: ${bondingCurve.toString()}`, colors.cyan);

  // Amount to buy (0.01 SOL)
  const buyAmountSOL = 0.01;
  const buyAmountLamports = Math.floor(buyAmountSOL * LAMPORTS_PER_SOL);

  log("💵", `Buy Amount: ${buyAmountSOL} SOL`, colors.yellow);

  // Derive accounts
  const buyerTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    buyer.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  const buyerWsolAccount = await getAssociatedTokenAddress(
    WSOL_MINT,
    buyer.publicKey,
    false,
    TOKEN_PROGRAM_ID
  );

  const poolTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    bondingCurve,
    true,
    TOKEN_2022_PROGRAM_ID
  );

  const poolWsolAccount = await getAssociatedTokenAddress(
    WSOL_MINT,
    bondingCurve,
    true,
    TOKEN_PROGRAM_ID
  );

  const [globalConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    PUMP_PROGRAM
  );

  const [eventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM
  );

  const [feeConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("fee_config"), PUMP_PROGRAM.toBuffer()],
    FEE_PROGRAM
  );

  const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_volume_accumulator")],
    PUMP_PROGRAM
  );

  const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_volume_accumulator"), buyer.publicKey.toBuffer()],
    PUMP_PROGRAM
  );

  const protocolFeeRecipient = new PublicKey("6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs");
  const protocolFeeRecipientAta = await getAssociatedTokenAddress(
    WSOL_MINT,
    protocolFeeRecipient,
    true,
    TOKEN_PROGRAM_ID
  );

  const tokenCreator = new PublicKey(tokenInfo.creator);
  const [creatorVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), tokenCreator.toBuffer()],
    PUMP_PROGRAM
  );

  // Build transaction
  const instructions = [];

  // Add compute budget
  instructions.push(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 })
  );

  // Create buyer token account if needed
  const buyerTokenInfo = await connection.getAccountInfo(buyerTokenAccount);
  if (!buyerTokenInfo) {
    log("📦", "Creating buyer token account...", colors.yellow);
    instructions.push(
      createAssociatedTokenAccountInstruction(
        buyer.publicKey,
        buyerTokenAccount,
        buyer.publicKey,
        tokenMint,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }

  // Create/fund buyer WSOL account
  const buyerWsolInfo = await connection.getAccountInfo(buyerWsolAccount);
  if (!buyerWsolInfo) {
    log("💰", "Creating and funding WSOL account...", colors.yellow);
    instructions.push(
      createAssociatedTokenAccountInstruction(
        buyer.publicKey,
        buyerWsolAccount,
        buyer.publicKey,
        WSOL_MINT,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      ),
      SystemProgram.transfer({
        fromPubkey: buyer.publicKey,
        toPubkey: buyerWsolAccount,
        lamports: buyAmountLamports,
      }),
      createSyncNativeInstruction(buyerWsolAccount, TOKEN_PROGRAM_ID)
    );
  } else {
    log("💰", "Funding existing WSOL account...", colors.yellow);
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: buyer.publicKey,
        toPubkey: buyerWsolAccount,
        lamports: buyAmountLamports,
      }),
      createSyncNativeInstruction(buyerWsolAccount, TOKEN_PROGRAM_ID)
    );
  }

  // Buy instruction
  const buyIx = {
    programId: PUMP_PROGRAM,
    keys: [
      { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
      { pubkey: bondingCurve, isSigner: false, isWritable: true },
      { pubkey: poolTokenAccount, isSigner: false, isWritable: true },
      { pubkey: poolWsolAccount, isSigner: false, isWritable: true },
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: buyerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: buyerWsolAccount, isSigner: false, isWritable: true },
      { pubkey: globalConfig, isSigner: false, isWritable: false },
      { pubkey: protocolFeeRecipient, isSigner: false, isWritable: true },
      { pubkey: protocolFeeRecipientAta, isSigner: false, isWritable: true },
      { pubkey: creatorVault, isSigner: false, isWritable: true },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: globalVolumeAccumulator, isSigner: false, isWritable: true },
      { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },
      { pubkey: feeConfig, isSigner: false, isWritable: false },
      { pubkey: FEE_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([
      0x66, 0x06, 0x3d, 0x12, 0x01, 0xda, 0xeb, 0xea, // buy discriminator
      ...Buffer.from(new Uint8Array(new BigUint64Array([BigInt(buyAmountLamports)]).buffer)),
      ...Buffer.from(new Uint8Array(new BigUint64Array([BigInt(0)]).buffer)), // min tokens (0 for testing)
    ]),
  };

  instructions.push(buyIx);

  log("\n🚀", "Sending buy transaction...", colors.yellow);

  try {
    const tx = new Transaction().add(...instructions);
    const sig = await sendAndConfirmTransaction(connection, tx, [buyer], {
      skipPreflight: false,
      commitment: "confirmed",
    });

    log("✅", "Purchase successful!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${sig}?cluster=devnet`, colors.cyan);

    // Check balances
    const buyerTokenInfo = await connection.getTokenAccountBalance(buyerTokenAccount);
    log("💎", `Tokens received: ${Number(buyerTokenInfo.value.amount).toLocaleString()}`, colors.green);

    const poolWsolInfo = await connection.getTokenAccountBalance(poolWsolAccount);
    log("💰", `Pool now has: ${Number(poolWsolInfo.value.amount) / LAMPORTS_PER_SOL} SOL`, colors.green);

    console.log(`\n${"=".repeat(70)}`);
    console.log(`${colors.bright}${colors.green}✅ POOL INITIALIZED WITH LIQUIDITY${colors.reset}`);
    console.log(`${"=".repeat(70)}\n`);

    log("🔥", "You can now test DAT cycle: npx ts-node scripts/test-mayhem-cycle.ts", colors.cyan);
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
