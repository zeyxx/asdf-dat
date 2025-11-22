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
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

function log(emoji: string, message: string, color = colors.reset) {
  console.log(`${color}${emoji} ${message}${colors.reset}`);
}

function logSection(title: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`${colors.bright}${colors.cyan}${title}${colors.reset}`);
  console.log(`${"=".repeat(60)}\n`);
}

async function main() {
  console.clear();
  logSection("💰 ACHAT SUR TOKEN DAT POUR GÉNÉRER DES FEES");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const buyer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  log("👤", `Buyer: ${buyer.publicKey.toString()}`, colors.cyan);

  // Load DAT token info
  const tokenInfo = JSON.parse(fs.readFileSync("devnet-token-info.json", "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);
  const creator = new PublicKey(tokenInfo.creator);

  log("🪙", `Token Mint: ${tokenMint.toString()}`, colors.cyan);
  log("📈", `Bonding Curve: ${bondingCurve.toString()}`, colors.cyan);
  log("👨‍💼", `Creator (DAT Authority): ${creator.toString()}`, colors.cyan);

  // Derive PDAs
  const [pumpGlobalConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    PUMP_PROGRAM
  );

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

  log("🏦", `Creator Vault: ${creatorVault.toString()}`, colors.cyan);

  // Get token accounts
  const poolTokenAccount = await getAssociatedTokenAddress(tokenMint, bondingCurve, true);
  const poolWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, bondingCurve, true);
  const buyerTokenAccount = await getAssociatedTokenAddress(tokenMint, buyer.publicKey);
  const feeRecipientAta = await getAssociatedTokenAddress(WSOL_MINT, FEE_RECIPIENT, true);

  // Buy amount: 0.02 SOL (small amount to generate fees without depleting pool)
  const BUY_AMOUNT_SOL = 0.02;
  const BUY_AMOUNT_LAMPORTS = BigInt(BUY_AMOUNT_SOL * 1e9);

  log("💎", `Montant d'achat: ${BUY_AMOUNT_SOL} SOL`, colors.yellow);

  logSection("ÉTAPE 1: CRÉATION DES COMPTES");

  const tx = new Transaction();

  // Create buyer token account if needed
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      buyer.publicKey,
      buyerTokenAccount,
      buyer.publicKey,
      tokenMint
    )
  );

  logSection("ÉTAPE 2: ACHAT DE TOKENS");

  // Build buy instruction manually
  const discriminator = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
  const amount = Buffer.alloc(8);
  amount.writeBigUInt64LE(BigInt(1000000)); // Tokens to receive (1M)
  const maxSolCost = Buffer.alloc(8);
  maxSolCost.writeBigUInt64LE(BUY_AMOUNT_LAMPORTS);
  const trackVolume = Buffer.from([0]); // OptionBool::None

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

  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [buyer]);
    log("✅", "Tokens achetés avec succès!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${sig}?cluster=devnet`, colors.cyan);

    // Check creator vault balance
    const creatorVaultInfo = await connection.getAccountInfo(creatorVault);
    if (creatorVaultInfo) {
      const balance = creatorVaultInfo.lamports / 1e9;
      log("💰", `Creator Vault Balance: ${balance} SOL`, colors.green);
      log("✅", "Des fees ont été générés dans le creator vault!", colors.green);
    }
  } catch (error: any) {
    log("❌", `Erreur: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }

  logSection("✅ ACHAT TERMINÉ");
  log("🎯", "Vous pouvez maintenant tester collect_fees!", colors.green);
}

main().catch((error) => {
  console.error(`${colors.red}❌ Erreur fatale: ${error.message}${colors.reset}`);
  process.exit(1);
});
