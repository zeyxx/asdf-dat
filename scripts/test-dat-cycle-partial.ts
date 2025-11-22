import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import { AnchorProvider, Program, Wallet, Idl } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";

const PROGRAM_ID = new PublicKey("ASDFznSwUWikqQMNE1Y7qqskDDkbE74GXZdUe6wu4UCz");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
// 6EF8... is the PUMP_PROGRAM used for BOTH token creation AND buy/sell (verified from @pump-fun/pump-sdk)
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

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

async function main() {
  console.clear();
  logSection("🧪 TEST CYCLE DAT PARTIEL (BUY + BURN)");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  log("👤", `Admin: ${admin.publicKey.toString()}`, colors.cyan);

  // Derive PDAs
  const [datState] = PublicKey.findProgramAddressSync(
    [Buffer.from("dat_v3")],
    PROGRAM_ID
  );

  const [datAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("auth_v3")],
    PROGRAM_ID
  );

  log("📦", `DAT State: ${datState.toString()}`, colors.cyan);
  log("🔑", `DAT Authority: ${datAuthority.toString()}`, colors.cyan);

  // Load token info
  const tokenInfo = JSON.parse(fs.readFileSync("devnet-token-info.json", "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);

  log("🪙", `Token Mint: ${tokenMint.toString()}`, colors.cyan);
  log("📈", `Bonding Curve: ${bondingCurve.toString()}`, colors.cyan);

  // Setup provider and program
  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
  });

  const idl = loadIdl();
  const program: Program<Idl> = new Program(idl, provider);

  log("✅", "Programme chargé", colors.green);

  // Check DAT WSOL balance
  const datWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, datAuthority, true);

  try {
    const wsolInfo = await getAccount(connection, datWsolAccount);
    const wsolBalance = Number(wsolInfo.amount) / 1e9;
    log("💰", `DAT WSOL Balance: ${wsolBalance} SOL`, wsolBalance > 0 ? colors.green : colors.red);

    if (wsolBalance < 0.01) {
      log("❌", "Insufficient WSOL! Run: npx ts-node scripts/fund-dat-authority.ts", colors.red);
      process.exit(1);
    }
  } catch {
    log("❌", "DAT WSOL account doesn't exist!", colors.red);
    process.exit(1);
  }

  logSection("ÉTAPE 1: EXECUTE BUY");

  const datTokenAccount = await getAssociatedTokenAddress(tokenMint, datAuthority, true);
  const poolTokenAccount = await getAssociatedTokenAddress(tokenMint, bondingCurve, true);
  const poolWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, bondingCurve, true);

  // Create DAT token account if it doesn't exist
  try {
    await getAccount(connection, datTokenAccount);
    log("✅", "DAT Token Account exists", colors.green);
  } catch {
    log("⏳", "Creating DAT Token Account...", colors.yellow);
    const { createAssociatedTokenAccountInstruction } = await import("@solana/spl-token");
    const { Transaction, sendAndConfirmTransaction } = await import("@solana/web3.js");

    const createAtaTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        admin.publicKey,
        datTokenAccount,
        datAuthority,
        tokenMint
      )
    );

    const createAtaSig = await sendAndConfirmTransaction(connection, createAtaTx, [admin]);
    log("✅", "DAT Token Account created!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${createAtaSig}?cluster=devnet`, colors.cyan);
  }

  const [pumpGlobalConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    PUMP_PROGRAM
  );

  // Use DEVNET fee recipient (different from mainnet!)
  const protocolFeeRecipient = new PublicKey("6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs");
  const protocolFeeRecipientAta = await getAssociatedTokenAddress(WSOL_MINT, protocolFeeRecipient, true);

  // Derive creator vault from token creator
  const tokenCreator = new PublicKey(tokenInfo.creator);
  const [creatorVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), tokenCreator.toBuffer()],
    PUMP_PROGRAM
  );

  log("🏦", `Creator Vault: ${creatorVault.toString()}`, colors.cyan);

  const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM
  );

  const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_volume_accumulator")],
    PUMP_PROGRAM
  );

  const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_volume_accumulator"), datAuthority.toBuffer()],
    PUMP_PROGRAM
  );

  const FEE_PROGRAM = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");

  const [feeConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("fee_config"), PUMP_PROGRAM.toBuffer()],
    FEE_PROGRAM
  );

  log("📊", `Global Volume Accumulator: ${globalVolumeAccumulator.toString()}`, colors.cyan);
  log("📊", `User Volume Accumulator: ${userVolumeAccumulator.toString()}`, colors.cyan);
  log("💰", `Fee Config: ${feeConfig.toString()}`, colors.cyan);
  log("💰", `Fee Program: ${FEE_PROGRAM.toString()}`, colors.cyan);

  try {
    const tx = await program.methods
      .executeBuy()
      .accounts({
        datState,
        datAuthority,
        datWsolAccount,
        datAsdfAccount: datTokenAccount,
        pool: bondingCurve,
        asdfMint: tokenMint,
        wsolMint: WSOL_MINT,
        poolAsdfAccount: poolTokenAccount,
        poolWsolAccount,
        pumpGlobalConfig,
        protocolFeeRecipient,
        protocolFeeRecipientAta,
        creatorVault,
        pumpEventAuthority,
        pumpSwapProgram: PUMP_PROGRAM,
        globalVolumeAccumulator,
        userVolumeAccumulator,
        feeConfig,
        feeProgram: FEE_PROGRAM,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    log("✅", "Tokens achetés!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx}?cluster=devnet`, colors.cyan);

    // Check token balance
    const tokenInfo = await getAccount(connection, datTokenAccount);
    const tokenBalance = Number(tokenInfo.amount);
    log("💎", `Tokens achetés: ${tokenBalance}`, colors.green);

  } catch (error: any) {
    log("❌", `Erreur: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-5).forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }

  logSection("ÉTAPE 2: BURN");

  try {
    const tx = await program.methods
      .burnAndUpdate()
      .accounts({
        datState,
        datAuthority,
        datAsdfAccount: datTokenAccount,
        asdfMint: tokenMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    log("✅", "Tokens brûlés!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx}?cluster=devnet`, colors.cyan);
  } catch (error: any) {
    log("❌", `Erreur: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-5).forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }

  logSection("✅ CYCLE TERMINÉ AVEC SUCCÈS!");

  log("🎉", "2/3 du cycle DAT validé:", colors.green);
  log("  ✅", "execute_buy fonctionne", colors.green);
  log("  ✅", "burn_and_update fonctionne", colors.green);
  log("  ⏭️", "collect_fees (non testé car token non créé par DAT)", colors.yellow);
}

main().catch((error) => {
  console.error(`${colors.red}❌ Erreur fatale: ${error.message}${colors.reset}`);
  process.exit(1);
});
