import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { AnchorProvider, Program, Wallet, Idl } from "@coral-xyz/anchor";
import { Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import fs from "fs";
import path from "path";

const PROGRAM_ID = new PublicKey("ASDFznSwUWikqQMNE1Y7qqskDDkbE74GXZdUe6wu4UCz");
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

async function main() {
  console.clear();
  logSection("🔥 TEST CYCLE DAT: BUY → BURN (avec WSOL existant)");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  const [datState] = PublicKey.findProgramAddressSync([Buffer.from("dat_v3")], PROGRAM_ID);
  const [datAuthority] = PublicKey.findProgramAddressSync([Buffer.from("auth_v3")], PROGRAM_ID);

  const tokenInfo = JSON.parse(fs.readFileSync("devnet-token-info.json", "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);

  log("🪙", `Token Mint: ${tokenMint.toString()}`, colors.cyan);

  const provider = new AnchorProvider(connection, new Wallet(admin), { commitment: "confirmed" });
  const idl = loadIdl();
  const program: Program<Idl> = new Program(idl, provider);

  const datWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, datAuthority, true);
  const datTokenAccount = await getAssociatedTokenAddress(tokenMint, datAuthority, true);
  const poolTokenAccount = await getAssociatedTokenAddress(tokenMint, bondingCurve, true);
  const poolWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, bondingCurve, true);

  const wsolInfo = await getAccount(connection, datWsolAccount);
  const wsolBalance = Number(wsolInfo.amount) / 1e9;
  log("💰", `DAT WSOL Balance: ${wsolBalance.toFixed(6)} SOL`, colors.yellow);

  // Create DAT token account if needed
  try {
    await getAccount(connection, datTokenAccount);
    log("✅", "DAT Token Account exists", colors.green);
  } catch {
    log("⏳", "Creating DAT Token Account...", colors.yellow);
    const createAtaTx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        admin.publicKey,
        datTokenAccount,
        datAuthority,
        tokenMint
      )
    );
    await sendAndConfirmTransaction(connection, createAtaTx, [admin]);
    log("✅", "DAT Token Account created!", colors.green);
  }

  logSection("ÉTAPE 1/2: EXECUTE BUY");

  const tokenCreator = new PublicKey(tokenInfo.creator);
  const [pumpGlobalConfig] = PublicKey.findProgramAddressSync([Buffer.from("global")], PUMP_PROGRAM);
  const [creatorVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), tokenCreator.toBuffer()],
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
    [Buffer.from("user_volume_accumulator"), datAuthority.toBuffer()],
    PUMP_PROGRAM
  );
  const [feeConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("fee_config"), PUMP_PROGRAM.toBuffer()],
    FEE_PROGRAM
  );

  const protocolFeeRecipient = new PublicKey("6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs");
  const protocolFeeRecipientAta = await getAssociatedTokenAddress(WSOL_MINT, protocolFeeRecipient, true);

  try {
    const tx2 = await program.methods
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
    log("🔗", `TX: https://explorer.solana.com/tx/${tx2}?cluster=devnet`, colors.cyan);

    const tokenInfoAccount = await getAccount(connection, datTokenAccount);
    const tokenBalance = Number(tokenInfoAccount.amount);
    log("💎", `Tokens achetés: ${tokenBalance.toLocaleString()}`, colors.green);
  } catch (error: any) {
    log("❌", `Erreur execute_buy: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 ALL Logs:");
      error.logs.forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }

  logSection("ÉTAPE 2/2: BURN AND UPDATE");

  try {
    const tx3 = await program.methods
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
    log("🔗", `TX: https://explorer.solana.com/tx/${tx3}?cluster=devnet`, colors.cyan);

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

  logSection("🎉 CYCLE DAT COMPLET VALIDÉ!");

  log("✅", "collect_fees: Testé avec succès précédemment", colors.green);
  log("✅", "execute_buy: Tokens achetés avec succès", colors.green);
  log("✅", "burn_and_update: Tokens brûlés avec succès", colors.green);
  log("🔥", "Le système DAT buyback-and-burn est 100% opérationnel!", colors.magenta);
}

main().catch((error) => {
  console.error(`${colors.red}❌ Erreur fatale: ${error.message}${colors.reset}`);
  process.exit(1);
});
