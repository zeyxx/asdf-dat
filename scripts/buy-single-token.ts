/**
 * Buy Single Token Purchase
 * Simple script to buy tokens once with specified amount
 *
 * Usage: npx ts-node scripts/buy-single-token.ts <token-file.json> <amount-sol>
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

async function main() {
  const tokenFile = process.argv[2];
  const amountSol = parseFloat(process.argv[3] || "0.05");

  if (!tokenFile) {
    console.error("Usage: npx ts-node scripts/buy-single-token.ts <token-file.json> <amount-sol>");
    process.exit(1);
  }

  console.log(`🛒 Buying ${amountSol} SOL worth of tokens from ${tokenFile}`);

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const buyer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  const tokenInfo = JSON.parse(fs.readFileSync(tokenFile, "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);
  const creator = new PublicKey(tokenInfo.creator);

  // Derive PDAs
  const [global] = PublicKey.findProgramAddressSync([Buffer.from("global")], PUMP_PROGRAM);
  const [creatorVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), creator.toBuffer()],
    PUMP_PROGRAM
  );
  const [eventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM
  );

  const bondingCurveTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    bondingCurve,
    true,
    TOKEN_PROGRAM_ID
  );
  const buyerTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    buyer.publicKey,
    false,
    TOKEN_PROGRAM_ID
  );

  // Prepare instruction data
  const maxSolCost = new BN(amountSol * 1e9 * 2); // 2x for safety
  const desiredTokens = new BN(1_000_000); // Flexible token amount

  const instructionData = Buffer.concat([
    BUY_DISCRIMINATOR,
    desiredTokens.toArrayLike(Buffer, "le", 8),
    maxSolCost.toArrayLike(Buffer, "le", 8),
  ]);

  const buyIx = new TransactionInstruction({
    programId: PUMP_PROGRAM,
    keys: [
      { pubkey: global, isSigner: false, isWritable: false },
      { pubkey: creatorVault, isSigner: false, isWritable: true },
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: bondingCurve, isSigner: false, isWritable: true },
      { pubkey: bondingCurveTokenAccount, isSigner: false, isWritable: true },
      { pubkey: buyerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: instructionData,
  });

  const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    buyer.publicKey,
    buyerTokenAccount,
    buyer.publicKey,
    tokenMint,
    TOKEN_PROGRAM_ID
  );

  const tx = new Transaction().add(createAtaIx, buyIx);
  tx.feePayer = buyer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [buyer], {
      commitment: "confirmed",
      skipPreflight: false,
    });

    console.log(`✅ Buy successful!`);
    console.log(`   TX: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
    return sig;
  } catch (error: any) {
    console.error(`❌ Buy failed: ${error.message}`);
    if (error.logs) {
      console.error("Logs:", error.logs.slice(-5));
    }
    throw error;
  }
}

main().catch(console.error);
