/**
 * Execute Root Token Cycle (3 Steps)
 *
 * Exécute le cycle complet pour le ROOT TOKEN:
 * 1. collect_fees(is_root_token=true) - Collecte fees du vault + root treasury
 * 2. execute_buy(is_secondary_token=false) - Achète tokens avec 100% des fees
 * 3. burn_and_update - Brûle les tokens achetés
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { AnchorProvider, Program, Wallet, Idl } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";

const PROGRAM_ID = new PublicKey("ASDfNfUHwVGfrg3SV7SQYWhaVxnrCUZyWmMpWJAPu4MZ");
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const FEE_PROGRAM = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

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
  // Get token file from command line or default
  const tokenFile = process.argv[2] || "devnet-token-spl.json";

  console.clear();
  logSection("🏆 ROOT TOKEN CYCLE (COLLECT → BUY → BURN)");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  log("👤", `Admin: ${admin.publicKey.toString()}`, colors.cyan);

  // Load token info
  if (!fs.existsSync(tokenFile)) {
    log("❌", `Token file not found: ${tokenFile}`, colors.red);
    log("💡", "Usage: npx ts-node scripts/execute-cycle-root.ts <token-file.json>", colors.yellow);
    process.exit(1);
  }

  const tokenInfo = JSON.parse(fs.readFileSync(tokenFile, "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);
  const tokenCreator = new PublicKey(tokenInfo.creator);
  const isMayhem = tokenInfo.tokenProgram === "Token2022";

  log("🪙", `Token: ${tokenInfo.name} (${tokenInfo.symbol})`, colors.cyan);
  log("🔗", `Mint: ${tokenMint.toString()}`, colors.cyan);
  log("📈", `Bonding Curve: ${bondingCurve.toString()}`, colors.cyan);
  log("🔧", `Token Program: ${isMayhem ? "Token2022 (Mayhem)" : "SPL"}`, colors.cyan);

  const TOKEN_PROGRAM = isMayhem ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

  // Derive PDAs
  const [datState] = PublicKey.findProgramAddressSync(
    [Buffer.from("dat_v3")],
    PROGRAM_ID
  );

  const [datAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("auth_v3")],
    PROGRAM_ID
  );

  const [tokenStats] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_stats_v1"), tokenMint.toBuffer()],
    PROGRAM_ID
  );

  log("📦", `DAT State: ${datState.toString()}`, colors.cyan);
  log("🔑", `DAT Authority: ${datAuthority.toString()}`, colors.cyan);
  log("📊", `Token Stats: ${tokenStats.toString()}`, colors.cyan);

  // Setup provider and program
  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
  });

  const idl = loadIdl();
  const program: Program<Idl> = new Program(idl, provider);

  // Verify this is the root token
  const stateAccount: any = await (program.account as any).datState.fetch(datState);
  if (!stateAccount.rootTokenMint || !stateAccount.rootTokenMint.equals(tokenMint)) {
    log("❌", "Ce token n'est PAS le root token!", colors.red);
    if (stateAccount.rootTokenMint) {
      log("🏆", `Root token actuel: ${stateAccount.rootTokenMint.toString()}`, colors.yellow);
    } else {
      log("💡", "Aucun root token défini. Utilisez: npx ts-node scripts/set-root-token.ts", colors.yellow);
    }
    process.exit(1);
  }

  log("✅", "Confirmed: This is the ROOT TOKEN", colors.green);

  // Derive root treasury
  const [rootTreasury] = PublicKey.findProgramAddressSync(
    [Buffer.from("root_treasury"), tokenMint.toBuffer()],
    PROGRAM_ID
  );

  log("🏦", `Root Treasury: ${rootTreasury.toString()}`, colors.cyan);

  // Derive creator vault
  const [creatorVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), tokenCreator.toBuffer()],
    PUMP_PROGRAM
  );

  log("💎", `Creator Vault: ${creatorVault.toString()}`, colors.cyan);

  // Check balances before
  const creatorVaultInfo = await connection.getAccountInfo(creatorVault);
  const rootTreasuryInfo = await connection.getAccountInfo(rootTreasury);

  const vaultBalance = creatorVaultInfo ? creatorVaultInfo.lamports / 1e9 : 0;
  const treasuryBalance = rootTreasuryInfo ? rootTreasuryInfo.lamports / 1e9 : 0;
  const totalFees = vaultBalance + treasuryBalance;

  log("💰", `Creator Vault: ${vaultBalance.toFixed(6)} SOL`, colors.yellow);
  log("💰", `Root Treasury: ${treasuryBalance.toFixed(6)} SOL`, colors.yellow);
  log("💰", `Total Fees: ${totalFees.toFixed(6)} SOL`, colors.bright + colors.yellow);

  if (totalFees < 0.001) {
    log("⚠️", "WARNING: Very low fees available!", colors.yellow);
    log("💡", "Make trades or wait for secondary tokens to send fees", colors.yellow);
  }

  // Check token stats
  try {
    const stats: any = await (program.account as any).tokenStats.fetch(tokenStats);
    log("📊", `Total SOL Collected: ${(Number(stats.totalSolCollected) / 1e9).toFixed(6)} SOL`, colors.cyan);
    log("📊", `Total SOL from Others: ${(Number(stats.totalSolReceivedFromOthers) / 1e9).toFixed(6)} SOL`, colors.cyan);
    log("📊", `Total Burned: ${(Number(stats.totalBurned) / 1e6).toLocaleString()} tokens`, colors.cyan);
  } catch {
    log("❌", "TokenStats not found!", colors.red);
    log("💡", `Run: npx ts-node scripts/init-token-stats.ts ${tokenFile}`, colors.yellow);
    process.exit(1);
  }

  const datTokenAccount = await getAssociatedTokenAddress(tokenMint, datAuthority, true, TOKEN_PROGRAM);
  const poolTokenAccount = await getAssociatedTokenAddress(tokenMint, bondingCurve, true, TOKEN_PROGRAM);
  const poolWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, bondingCurve, true, TOKEN_PROGRAM_ID);

  // ========================================================================
  logSection("STEP 1/3: COLLECT FEES (ROOT TOKEN MODE)");
  // ========================================================================

  const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM
  );

  try {
    const tx1 = await program.methods
      .collectFees(true, false) // is_root_token = true, for_ecosystem = false
      .accounts({
        datState,
        tokenStats,
        tokenMint,
        datAuthority,
        creatorVault,
        pumpEventAuthority,
        pumpSwapProgram: PUMP_PROGRAM,
        rootTreasury, // Include root treasury for collection
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    log("✅", "Fees collected from vault + root treasury!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx1}?cluster=devnet`, colors.cyan);

    // Check updated balances
    const vaultAfter = await connection.getAccountInfo(creatorVault);
    const treasuryAfter = await connection.getAccountInfo(rootTreasury);
    const authorityAfter = await connection.getAccountInfo(datAuthority);

    log("💰", `Creator Vault (after): ${vaultAfter ? (vaultAfter.lamports / 1e9).toFixed(6) : "0.000000"} SOL`, colors.green);
    log("💰", `Root Treasury (after): ${treasuryAfter ? (treasuryAfter.lamports / 1e9).toFixed(6) : "0.000000"} SOL`, colors.green);
    log("💰", `DAT Authority (after collect): ${authorityAfter ? (authorityAfter.lamports / 1e9).toFixed(6) : "0.000000"} SOL`, colors.green);
  } catch (error: any) {
    log("❌", `Error collect_fees: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-10).forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }

  // ========================================================================
  logSection("STEP 2/3: EXECUTE BUY (100% KEPT FOR ROOT)");
  // ========================================================================

  const [pumpGlobalConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    PUMP_PROGRAM
  );

  const protocolFeeRecipient = new PublicKey("6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs");
  const protocolFeeRecipientAta = await getAssociatedTokenAddress(tokenMint, protocolFeeRecipient, true, TOKEN_PROGRAM);

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

  try {
    // Create protocol fee recipient ATA if it doesn't exist
    const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
      admin.publicKey,
      protocolFeeRecipientAta,
      protocolFeeRecipient,
      tokenMint,
      TOKEN_PROGRAM
    );

    const tx2 = await program.methods
      .executeBuy(false, null) // is_secondary_token = false, allocated_lamports = null (use balance)
      .accounts({
        datState,
        datAuthority,
        datAsdfAccount: datTokenAccount,
        pool: bondingCurve,
        asdfMint: tokenMint,
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
        rootTreasury, // Not used for root token but required by struct
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .preInstructions([createAtaIx])
      .signers([admin])
      .rpc();

    log("✅", "Tokens bought with 100% of fees!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx2}?cluster=devnet`, colors.cyan);

    // Check token balance
    const tokenInfoAccount = await getAccount(connection, datTokenAccount, "confirmed", TOKEN_PROGRAM);
    const tokenBalance = Number(tokenInfoAccount.amount) / 1e6;
    log("💎", `Tokens bought: ${tokenBalance.toLocaleString()} tokens`, colors.green);
  } catch (error: any) {
    log("❌", `Error execute_buy: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-10).forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }

  // ========================================================================
  logSection("STEP 3/3: BURN AND UPDATE");
  // ========================================================================

  try {
    const tx3 = await program.methods
      .burnAndUpdate()
      .accounts({
        datState,
        tokenStats,
        datAuthority,
        datAsdfAccount: datTokenAccount,
        asdfMint: tokenMint,
        tokenProgram: TOKEN_PROGRAM,
      })
      .signers([admin])
      .rpc();

    log("✅", "Tokens burned!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx3}?cluster=devnet`, colors.cyan);

    // Verify token balance is 0
    const tokenInfoAccount = await getAccount(connection, datTokenAccount, "confirmed", TOKEN_PROGRAM);
    const tokenBalance = Number(tokenInfoAccount.amount);
    log("💎", `Tokens remaining: ${tokenBalance}`, tokenBalance === 0 ? colors.green : colors.yellow);

    // Check updated stats
    const statsAfter: any = await (program.account as any).tokenStats.fetch(tokenStats);
    const totalBurned = Number(statsAfter.totalBurned) / 1e6;
    const totalCollected = Number(statsAfter.totalSolCollected) / 1e9;
    const fromOthers = Number(statsAfter.totalSolReceivedFromOthers) / 1e9;

    log("📊", `Total Burned: ${totalBurned.toLocaleString()} tokens`, colors.green);
    log("📊", `Total SOL Collected: ${totalCollected.toFixed(6)} SOL`, colors.green);
    log("📊", `From Secondary Tokens: ${fromOthers.toFixed(6)} SOL`, colors.green);
  } catch (error: any) {
    log("❌", `Error burn_and_update: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-10).forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }

  // ========================================================================
  logSection("🎉 ROOT TOKEN CYCLE COMPLETED!");
  // ========================================================================

  log("✅", "collect_fees: Collected from vault + root treasury", colors.green);
  log("✅", "execute_buy: Bought tokens with 100% of fees", colors.green);
  log("✅", "burn_and_update: Tokens burned", colors.green);
  log("🏆", "Root token cycle successful!", colors.magenta);
  log("💡", "Root token accumulates fees from ALL tokens in the ecosystem", colors.cyan);
}

main().catch((error) => {
  console.error(`${colors.red}❌ Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
