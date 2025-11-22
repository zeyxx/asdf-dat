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
} from "@solana/spl-token";
import { AnchorProvider, Program, Wallet, Idl } from "@coral-xyz/anchor";
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
  logSection("🚀 TEST BATCH CYCLE DAT: COLLECT → BUY → BURN (1 TRANSACTION)");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  const [datState] = PublicKey.findProgramAddressSync([Buffer.from("dat_v3")], PROGRAM_ID);
  const [datAuthority] = PublicKey.findProgramAddressSync([Buffer.from("auth_v3")], PROGRAM_ID);

  const tokenInfo = JSON.parse(fs.readFileSync("devnet-token-info.json", "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);
  const tokenCreator = new PublicKey(tokenInfo.creator);

  log("👤", `Admin: ${admin.publicKey.toString()}`, colors.cyan);
  log("🪙", `Token: ${tokenMint.toString()}`, colors.cyan);
  log("📈", `Bonding Curve: ${bondingCurve.toString()}`, colors.cyan);

  const provider = new AnchorProvider(connection, new Wallet(admin), { commitment: "confirmed" });
  const idl = loadIdl();
  const program: Program<Idl> = new Program(idl, provider);

  // Derive all PDAs and accounts
  const datAsdfAccount = await getAssociatedTokenAddress(tokenMint, datAuthority, true);
  const poolTokenAccount = await getAssociatedTokenAddress(tokenMint, bondingCurve, true);
  const poolWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, bondingCurve, true);

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

  // Check balances before
  const creatorVaultBefore = await connection.getBalance(creatorVault);
  const datAuthorityBefore = await connection.getBalance(datAuthority);

  log("💰", `Creator Vault (avant): ${(creatorVaultBefore / 1e9).toFixed(6)} SOL`, colors.yellow);
  log("💰", `DAT Authority (avant): ${(datAuthorityBefore / 1e9).toFixed(6)} SOL`, colors.yellow);

  logSection("🔥 EXÉCUTION DU CYCLE BATCH (TOUT EN 1 TX)");

  try {
    const tx = await program.methods
      .executeFullCycle()
      .accounts({
        datState,
        datAuthority,
        creatorVault,
        datAsdfAccount,
        pool: bondingCurve,
        asdfMint: tokenMint,
        poolAsdfAccount: poolTokenAccount,
        poolWsolAccount,
        pumpGlobalConfig,
        protocolFeeRecipient,
        protocolFeeRecipientAta,
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

    log("✅", "Cycle batch exécuté avec succès!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx}?cluster=devnet`, colors.cyan);

    // Check balances after
    const creatorVaultAfter = await connection.getBalance(creatorVault);
    const datAuthorityAfter = await connection.getBalance(datAuthority);
    const datAsdfInfo = await getAccount(connection, datAsdfAccount);

    log("💰", `Creator Vault (après): ${(creatorVaultAfter / 1e9).toFixed(6)} SOL`, colors.yellow);
    log("💰", `DAT Authority (après): ${(datAuthorityAfter / 1e9).toFixed(6)} SOL`, colors.yellow);
    log("💎", `Tokens DAT restants: ${datAsdfInfo.amount}`, colors.yellow);

    const collected = creatorVaultBefore - creatorVaultAfter;
    log("✅", `SOL collecté: ${(collected / 1e9).toFixed(6)} SOL`, colors.green);

    logSection("🎉 CYCLE BATCH VALIDÉ!");

    log("⚡", "AVANTAGES DU BATCH:", colors.bright);
    log("  ", "1. Atomicité: Soit tout réussit, soit tout échoue", colors.green);
    log("  ", "2. Moins de frais: 1 signature au lieu de 3", colors.green);
    log("  ", "3. Plus simple: Un seul appel pour tout le cycle", colors.green);
    log("  ", "4. Plus sécurisé: Pas d'état intermédiaire", colors.green);

  } catch (error: any) {
    log("❌", `Erreur: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`${colors.red}❌ Erreur fatale: ${error.message}${colors.reset}`);
  process.exit(1);
});
