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
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { AnchorProvider, Program, Wallet, Idl } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";

const PROGRAM_ID = new PublicKey("ASDFznSwUWikqQMNE1Y7qqskDDkbE74GXZdUe6wu4UCz");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const FEE_PROGRAM = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
const FEE_RECIPIENT = new PublicKey("6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs");

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

function logSection(title: string) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.bright}${colors.magenta}${title}${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);
}

function loadIdl(): Idl {
  const idlPath = path.join(__dirname, "../target/idl/asdf_dat.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8")) as Idl;
  if (idl.metadata) {
    (idl.metadata as any).address = PROGRAM_ID.toString();
  } else {
    (idl as any).metadata = { address: PROGRAM_ID.toString() };
  }
  return idl;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.clear();
  logSection("🚀 WORKFLOW COMPLET: CRÉATION TOKEN → GÉNÉRATION FEES → CYCLE DAT");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  const [datState] = PublicKey.findProgramAddressSync([Buffer.from("dat_v3")], PROGRAM_ID);
  const [datAuthority] = PublicKey.findProgramAddressSync([Buffer.from("auth_v3")], PROGRAM_ID);

  log("👤", `Admin: ${admin.publicKey.toString()}`, colors.cyan);
  log("🏛️", `DAT Authority: ${datAuthority.toString()}`, colors.cyan);

  const provider = new AnchorProvider(connection, new Wallet(admin), { commitment: "confirmed" });
  const idl = loadIdl();
  const program: Program<Idl> = new Program(idl, provider);

  // =================================================================
  logSection("PHASE 1: CRÉATION DU TOKEN DAT");
  // =================================================================

  const tokenMint = Keypair.generate();
  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), tokenMint.publicKey.toBuffer()],
    PUMP_PROGRAM
  );
  const [mintAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint-authority")],
    PUMP_PROGRAM
  );

  const tokenName = "DAT Cycle Test";
  const tokenSymbol = "CYCLE";
  const tokenUri = "https://example.com/token.json";

  log("🪙", `Token Mint: ${tokenMint.publicKey.toString()}`, colors.yellow);
  log("📈", `Bonding Curve: ${bondingCurve.toString()}`, colors.yellow);

  const [pumpGlobalConfig] = PublicKey.findProgramAddressSync([Buffer.from("global")], PUMP_PROGRAM);
  const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM
  );

  const poolTokenAccount = await getAssociatedTokenAddress(tokenMint.publicKey, bondingCurve, true);
  const poolWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, bondingCurve, true);

  const MPL_TOKEN_METADATA = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
  const [metadata] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), MPL_TOKEN_METADATA.toBuffer(), tokenMint.publicKey.toBuffer()],
    MPL_TOKEN_METADATA
  );

  try {
    const tx1 = await program.methods
      .createPumpfunToken(tokenName, tokenSymbol, tokenUri)
      .accounts({
        datState,
        datAuthority,
        payer: admin.publicKey,
        mint: tokenMint.publicKey,
        mintAuthority,
        bondingCurve,
        associatedBondingCurve: poolTokenAccount,
        global: pumpGlobalConfig,
        mplTokenMetadata: MPL_TOKEN_METADATA,
        metadata,
        wsolMint: WSOL_MINT,
        pumpProgram: PUMP_PROGRAM,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: new PublicKey("SysvarRent111111111111111111111111111111111"),
        systemProgram: SystemProgram.programId,
        eventAuthority: pumpEventAuthority,
      })
      .signers([tokenMint])
      .rpc();

    log("✅", "Token créé avec succès!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx1}?cluster=devnet`, colors.cyan);

    // Save token info
    const tokenInfo = {
      mint: tokenMint.publicKey.toString(),
      bondingCurve: bondingCurve.toString(),
      creator: datAuthority.toString(),
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync("devnet-token-cycle.json", JSON.stringify(tokenInfo, null, 2));
    log("💾", "Token info sauvegardé dans devnet-token-cycle.json", colors.green);

    await sleep(2000); // Wait for confirmation
  } catch (error: any) {
    log("❌", `Erreur création token: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-5).forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }

  // =================================================================
  logSection("PHASE 2: ACHAT INITIAL POUR GÉNÉRER DES FEES");
  // =================================================================

  const [creatorVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), datAuthority.toBuffer()],
    PUMP_PROGRAM
  );
  const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_volume_accumulator")],
    PUMP_PROGRAM
  );
  const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_volume_accumulator"), admin.publicKey.toBuffer()],
    PUMP_PROGRAM
  );
  const [feeConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("fee_config"), PUMP_PROGRAM.toBuffer()],
    FEE_PROGRAM
  );

  const buyerTokenAccount = await getAssociatedTokenAddress(tokenMint.publicKey, admin.publicKey);
  const feeRecipientAta = await getAssociatedTokenAddress(WSOL_MINT, FEE_RECIPIENT, true);

  const BUY_AMOUNT_SOL = 0.05;
  const BUY_AMOUNT_LAMPORTS = BigInt(BUY_AMOUNT_SOL * 1e9);

  log("💎", `Montant d'achat: ${BUY_AMOUNT_SOL} SOL`, colors.yellow);

  const tx2 = new Transaction();

  // Create buyer token account
  tx2.add(
    createAssociatedTokenAccountIdempotentInstruction(
      admin.publicKey,
      buyerTokenAccount,
      admin.publicKey,
      tokenMint.publicKey
    )
  );

  // Build buy instruction
  const discriminator = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
  const amount = Buffer.alloc(8);
  amount.writeBigUInt64LE(BigInt(1000000)); // 1M tokens
  const maxSolCost = Buffer.alloc(8);
  maxSolCost.writeBigUInt64LE(BUY_AMOUNT_LAMPORTS);
  const trackVolume = Buffer.from([0]);

  const data = Buffer.concat([discriminator, amount, maxSolCost, trackVolume]);

  const buyIx = {
    programId: PUMP_PROGRAM,
    keys: [
      { pubkey: pumpGlobalConfig, isSigner: false, isWritable: false },
      { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: true },
      { pubkey: tokenMint.publicKey, isSigner: false, isWritable: false },
      { pubkey: bondingCurve, isSigner: false, isWritable: true },
      { pubkey: poolTokenAccount, isSigner: false, isWritable: true },
      { pubkey: buyerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
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

  tx2.add(buyIx);

  try {
    const sig2 = await sendAndConfirmTransaction(connection, tx2, [admin]);
    log("✅", "Tokens achetés - fees générés!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${sig2}?cluster=devnet`, colors.cyan);

    await sleep(2000);

    const creatorVaultInfo = await connection.getAccountInfo(creatorVault);
    if (creatorVaultInfo) {
      const balance = creatorVaultInfo.lamports / 1e9;
      log("💰", `Creator Vault Balance: ${balance.toFixed(6)} SOL`, colors.green);
    }
  } catch (error: any) {
    log("❌", `Erreur achat: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }

  // =================================================================
  logSection("PHASE 2.5: INITIALISATION DU POOL WSOL");
  // =================================================================

  // Create and fund pool WSOL account
  try {
    await getAccount(connection, poolWsolAccount);
    log("✅", "Pool WSOL Account exists", colors.green);
  } catch {
    log("⏳", "Creating and funding Pool WSOL Account...", colors.yellow);
    const createPoolWsolTx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        admin.publicKey,
        poolWsolAccount,
        bondingCurve,
        WSOL_MINT
      )
    );
    await sendAndConfirmTransaction(connection, createPoolWsolTx, [admin]);
    log("✅", "Pool WSOL Account created!", colors.green);
    await sleep(1000);
  }

  // =================================================================
  logSection("PHASE 3: EXÉCUTION DU CYCLE DAT COMPLET");
  // =================================================================

  const datWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, datAuthority, true);
  const datTokenAccount = await getAssociatedTokenAddress(tokenMint.publicKey, datAuthority, true);
  const protocolFeeRecipientAta = await getAssociatedTokenAddress(WSOL_MINT, FEE_RECIPIENT, true);
  const [datUserVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_volume_accumulator"), datAuthority.toBuffer()],
    PUMP_PROGRAM
  );

  // Create DAT token account if needed
  try {
    await getAccount(connection, datTokenAccount);
  } catch {
    log("⏳", "Creating DAT Token Account...", colors.yellow);
    const createAtaTx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        admin.publicKey,
        datTokenAccount,
        datAuthority,
        tokenMint.publicKey
      )
    );
    await sendAndConfirmTransaction(connection, createAtaTx, [admin]);
    log("✅", "DAT Token Account created!", colors.green);
    await sleep(1000);
  }

  // Check balances before
  const wsolInfoBefore = await getAccount(connection, datWsolAccount);
  const wsolBalanceBefore = Number(wsolInfoBefore.amount) / 1e9;
  const creatorVaultInfoBefore = await connection.getAccountInfo(creatorVault);
  const creatorVaultBalanceBefore = creatorVaultInfoBefore ? creatorVaultInfoBefore.lamports / 1e9 : 0;

  log("💰", `DAT WSOL (avant): ${wsolBalanceBefore.toFixed(6)} SOL`, colors.yellow);
  log("💎", `Creator Vault (avant): ${creatorVaultBalanceBefore.toFixed(6)} SOL`, colors.yellow);

  // STEP 1: COLLECT FEES
  logSection("ÉTAPE 1/3: COLLECT FEES");

  try {
    const tx3 = await program.methods
      .collectFees()
      .accounts({
        datState,
        datAuthority,
        creatorVault,
        wsolMint: WSOL_MINT,
        datWsolAccount,
        pumpEventAuthority,
        pumpSwapProgram: PUMP_PROGRAM,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    log("✅", "Fees collectés!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx3}?cluster=devnet`, colors.cyan);

    await sleep(2000);

    const wsolInfoAfter = await getAccount(connection, datWsolAccount);
    const wsolBalanceAfter = Number(wsolInfoAfter.amount) / 1e9;
    const collected = wsolBalanceAfter - wsolBalanceBefore;
    log("💰", `Collecté: ${collected.toFixed(6)} SOL`, colors.green);
    log("💰", `DAT WSOL (après): ${wsolBalanceAfter.toFixed(6)} SOL`, colors.green);
  } catch (error: any) {
    log("❌", `Erreur collect_fees: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-5).forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }

  // STEP 2: EXECUTE BUY
  logSection("ÉTAPE 2/3: EXECUTE BUY");

  try {
    const tx4 = await program.methods
      .executeBuy()
      .accounts({
        datState,
        datAuthority,
        datWsolAccount,
        datAsdfAccount: datTokenAccount,
        pool: bondingCurve,
        asdfMint: tokenMint.publicKey,
        wsolMint: WSOL_MINT,
        poolAsdfAccount: poolTokenAccount,
        poolWsolAccount,
        pumpGlobalConfig,
        protocolFeeRecipient: FEE_RECIPIENT,
        protocolFeeRecipientAta,
        creatorVault,
        pumpEventAuthority,
        pumpSwapProgram: PUMP_PROGRAM,
        globalVolumeAccumulator,
        userVolumeAccumulator: datUserVolumeAccumulator,
        feeConfig,
        feeProgram: FEE_PROGRAM,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    log("✅", "Tokens achetés!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx4}?cluster=devnet`, colors.cyan);

    await sleep(2000);

    const tokenInfoAccount = await getAccount(connection, datTokenAccount);
    const tokenBalance = Number(tokenInfoAccount.amount);
    log("💎", `Tokens achetés: ${tokenBalance.toLocaleString()}`, colors.green);
  } catch (error: any) {
    log("❌", `Erreur execute_buy: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-5).forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }

  // STEP 3: BURN AND UPDATE
  logSection("ÉTAPE 3/3: BURN AND UPDATE");

  try {
    const tx5 = await program.methods
      .burnAndUpdate()
      .accounts({
        datState,
        datAuthority,
        datAsdfAccount: datTokenAccount,
        asdfMint: tokenMint.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    log("✅", "Tokens brûlés!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx5}?cluster=devnet`, colors.cyan);

    await sleep(2000);

    const tokenInfoAccount = await getAccount(connection, datTokenAccount);
    const tokenBalance = Number(tokenInfoAccount.amount);
    log("💎", `Tokens restants: ${tokenBalance}`, tokenBalance === 0 ? colors.green : colors.yellow);
  } catch (error: any) {
    log("❌", `Erreur burn_and_update: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-5).forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }

  // =================================================================
  logSection("🎉 WORKFLOW COMPLET TERMINÉ AVEC SUCCÈS!");
  // =================================================================

  log("✅", "CRÉATION: Token DAT créé avec bonding curve initialisée", colors.green);
  log("✅", "GÉNÉRATION: Fees générés dans le creator vault via achat", colors.green);
  log("✅", "COLLECT FEES: Fees collectés du creator vault et wrappés en WSOL", colors.green);
  log("✅", "EXECUTE BUY: Tokens achetés avec les fees collectés", colors.green);
  log("✅", "BURN AND UPDATE: Tous les tokens achetés ont été brûlés", colors.green);
  log("", "", colors.reset);
  log("🔥", "LE SYSTÈME DAT BUYBACK-AND-BURN EST 100% OPÉRATIONNEL!", colors.magenta);
  log("", "", colors.reset);
  log("📊", "Prêt pour la production!", colors.cyan);
}

main().catch((error) => {
  console.error(`${colors.red}❌ Erreur fatale: ${error.message}${colors.reset}`);
  process.exit(1);
});
