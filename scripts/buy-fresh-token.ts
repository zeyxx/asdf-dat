import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import fs from "fs";

const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const FEE_PROGRAM = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
const FEE_RECIPIENT = new PublicKey("6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs");

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
};

console.clear();
console.log(`\n${"=".repeat(60)}`);
console.log(`${colors.cyan}💰 ACHAT SUR NOUVEAU TOKEN DAT${colors.reset}`);
console.log(`${"=".repeat(60)}\n`);

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const buyer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  // Load fresh token info
  const tokenInfo = JSON.parse(fs.readFileSync("devnet-token-fresh.json", "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);
  const creator = new PublicKey(tokenInfo.creator);

  console.log(`${colors.cyan}🪙 Token: ${tokenMint.toString()}${colors.reset}`);
  console.log(`${colors.cyan}👨‍💼 Creator (DAT Authority): ${creator.toString()}${colors.reset}\n`);

  // Derive PDAs
  const [pumpGlobalConfig] = PublicKey.findProgramAddressSync([Buffer.from("global")], PUMP_PROGRAM);
  const [creatorVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), creator.toBuffer()],
    PUMP_PROGRAM
  );
  const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
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

  const poolTokenAccount = await getAssociatedTokenAddress(tokenMint, bondingCurve, true);
  const buyerTokenAccount = await getAssociatedTokenAddress(tokenMint, buyer.publicKey);

  // Buy 0.05 SOL worth of tokens
  const BUY_AMOUNT_SOL = 0.05;
  const BUY_AMOUNT_LAMPORTS = BigInt(BUY_AMOUNT_SOL * 1e9);

  console.log(`${colors.yellow}💎 Achat de ${BUY_AMOUNT_SOL} SOL de tokens...${colors.reset}\n`);

  const tx = new Transaction();
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      buyer.publicKey,
      buyerTokenAccount,
      buyer.publicKey,
      tokenMint
    )
  );

  // Build buy instruction
  const discriminator = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
  const amount = Buffer.alloc(8);
  amount.writeBigUInt64LE(BigInt(50000000)); // 50M tokens
  const maxSolCost = Buffer.alloc(8);
  maxSolCost.writeBigUInt64LE(BUY_AMOUNT_LAMPORTS);
  const trackVolume = Buffer.from([0]);

  const data = Buffer.concat([discriminator, amount, maxSolCost, trackVolume]);

  const buyIx = {
    programId: PUMP_PROGRAM,
    keys: [
      { pubkey: pumpGlobalConfig, isSigner: false, isWritable: false },
      { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: true },
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: bondingCurve, isSigner: false, isWritable: true },
      { pubkey: poolTokenAccount, isSigner: false, isWritable: true },
      { pubkey: buyerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: creatorVault, isSigner: false, isWritable: true },
      { pubkey: pumpEventAuthority, isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: globalVolumeAccumulator, isSigner: false, isWritable: false },
      { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },
      { pubkey: feeConfig, isSigner: false, isWritable: false },
      { pubkey: FEE_PROGRAM, isSigner: false, isWritable: false },
    ],
    data,
  };

  tx.add(buyIx);

  const sig = await sendAndConfirmTransaction(connection, tx, [buyer]);
  console.log(`${colors.green}✅ Tokens achetés!${colors.reset}`);
  console.log(`${colors.cyan}🔗 TX: https://explorer.solana.com/tx/${sig}?cluster=devnet${colors.reset}\n`);

  // Check creator vault balance
  const creatorVaultInfo = await connection.getAccountInfo(creatorVault);
  if (creatorVaultInfo) {
    const balance = creatorVaultInfo.lamports / 1e9;
    console.log(`${colors.green}💰 Creator Vault Balance: ${balance.toFixed(6)} SOL${colors.reset}`);
    console.log(`${colors.green}✅ Des fees ont été générés!${colors.reset}\n`);
  }

  console.log(`${colors.green}🎯 Prêt pour tester le cycle DAT complet!${colors.reset}`);
}

main().catch(console.error);
