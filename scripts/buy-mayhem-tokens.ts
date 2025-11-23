import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import fs from "fs";

const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const FEE_PROGRAM = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");

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
  console.log("\n" + "=".repeat(70));
  console.log(`${colors.bright}${colors.cyan}🛒 ACHAT MANUEL TOKEN MAYHEM MODE${colors.reset}`);
  console.log("=".repeat(70) + "\n");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Load buyer wallet
  const buyer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("./devnet-wallet.json", "utf-8")))
  );

  log("👤", `Buyer: ${buyer.publicKey.toString()}`, colors.cyan);

  const balance = await connection.getBalance(buyer.publicKey);
  log("💰", `Balance: ${(balance / 1e9).toFixed(4)} SOL`, colors.cyan);

  // Load token info
  const tokenInfo = JSON.parse(fs.readFileSync("devnet-token-mayhem.json", "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);
  const tokenCreator = new PublicKey(tokenInfo.creator);

  log("🪙", `Token: ${tokenMint.toString()}`, colors.cyan);
  log("📈", `Bonding Curve: ${bondingCurve.toString()}`, colors.cyan);

  // Derive PDAs
  const [mintAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint-authority")],
    PUMP_PROGRAM
  );

  const [global] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    PUMP_PROGRAM
  );

  const [eventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM
  );

  const [creatorVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), tokenCreator.toBuffer()],
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

  // Token2022 ATAs for pool
  const poolTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    bondingCurve,
    true,
    TOKEN_2022_PROGRAM_ID
  );

  const poolWsolAccount = await getAssociatedTokenAddress(
    WSOL_MINT,
    bondingCurve,
    true
  );

  // Buyer's Token2022 ATA
  const buyerTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    buyer.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  log("🏦", `Buyer Token Account: ${buyerTokenAccount.toString()}`, colors.cyan);

  // Protocol fee recipient
  const protocolFeeRecipient = new PublicKey("6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs");
  const protocolFeeRecipientAta = await getAssociatedTokenAddress(
    WSOL_MINT,
    protocolFeeRecipient,
    true
  );

  // Check if buyer's token account exists
  const buyerTokenAccountInfo = await connection.getAccountInfo(buyerTokenAccount);

  const tx = new Transaction();

  if (!buyerTokenAccountInfo) {
    log("⚠️", "Creating buyer's Token2022 ATA...", colors.yellow);
    const createAtaIx = createAssociatedTokenAccountInstruction(
      buyer.publicKey,
      buyerTokenAccount,
      buyer.publicKey,
      tokenMint,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    tx.add(createAtaIx);
  } else {
    log("✅", "Buyer's Token2022 ATA exists", colors.green);
  }

  // Buy instruction
  const buyAmount = 0.01 * 1e9; // 0.01 SOL
  const minTokensOut = 1; // Accept any amount for initialization
  const maxSolCost = buyAmount * 2;

  log("💵", `Buying with: ${buyAmount / 1e9} SOL`, colors.yellow);

  // Build buy instruction data
  const buyData = Buffer.alloc(25);
  buyData.writeBigUInt64LE(BigInt("16927863322537952870"), 0); // buy discriminator
  buyData.writeBigUInt64LE(BigInt(minTokensOut), 8);
  buyData.writeBigUInt64LE(BigInt(maxSolCost), 16);
  buyData.writeUInt8(0, 24); // no referrer

  const buyIx = new TransactionInstruction({
    programId: PUMP_PROGRAM,
    keys: [
      { pubkey: global, isSigner: false, isWritable: false },
      { pubkey: protocolFeeRecipient, isSigner: false, isWritable: true },
      { pubkey: tokenMint, isSigner: false, isWritable: true },
      { pubkey: bondingCurve, isSigner: false, isWritable: true },
      { pubkey: poolTokenAccount, isSigner: false, isWritable: true },
      { pubkey: buyerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: creatorVault, isSigner: false, isWritable: true },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: globalVolumeAccumulator, isSigner: false, isWritable: false },
      { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },
      { pubkey: feeConfig, isSigner: false, isWritable: false },
      { pubkey: FEE_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: buyData,
  });

  tx.add(buyIx);

  console.log("\n" + "=".repeat(70));
  log("⏳", "Envoi de la transaction...", colors.yellow);
  console.log("=".repeat(70) + "\n");

  try {
    const sig = await connection.sendTransaction(tx, [buyer], {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });

    await connection.confirmTransaction(sig, "confirmed");

    console.log("\n" + "=".repeat(70));
    log("✅", "ACHAT RÉUSSI!", colors.bright + colors.green);
    console.log("=".repeat(70) + "\n");

    log("📜", `Signature: ${sig}`, colors.green);
    log("🔗", `Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`, colors.cyan);

    // Check token balance
    const { getAccount } = await import("@solana/spl-token");
    const tokenAccount = await getAccount(
      connection,
      buyerTokenAccount,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    log("💎", `Tokens reçus: ${tokenAccount.amount.toLocaleString()}`, colors.green);

    console.log("\n" + "=".repeat(70));
    log("🎉", "PROCHAINES ÉTAPES:", colors.bright + colors.cyan);
    console.log("=".repeat(70) + "\n");

    log("1️⃣", "Le pool est maintenant initialisé", colors.cyan);
    log("2️⃣", "Vous pouvez tester le cycle DAT complet", colors.cyan);
    log("💊", "npx ts-node --transpile-only scripts/test-mayhem-cycle.ts", colors.yellow);

  } catch (error: any) {
    console.log("\n" + "=".repeat(70));
    log("❌", "ERREUR", colors.bright + colors.red);
    console.log("=".repeat(70) + "\n");

    log("❌", `Erreur: ${error.message}`, colors.red);

    if (error.logs) {
      console.log("\n📋 Logs de transaction:");
      error.logs.forEach((l: string) => console.log(`   ${l}`));
    }

    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`${colors.red}❌ Erreur fatale: ${error.message}${colors.reset}`);
  process.exit(1);
});
