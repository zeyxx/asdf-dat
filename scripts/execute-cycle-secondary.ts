/**
 * Execute Secondary Token Cycle (3 Steps)
 *
 * Exécute le cycle complet pour un TOKEN SECONDAIRE:
 * 1. collect_fees(is_root_token=false) - Collecte fees du vault seulement
 * 2. execute_buy(is_secondary_token=true) - Achète avec 55.2%, envoie 44.8% au root
 * 3. burn_and_update - Brûle les tokens achetés
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import { AnchorProvider, Program, Wallet, Idl } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";

const PROGRAM_ID = new PublicKey("ASDfNfUHwVGfrg3SV7SQYWhaVxnrCUZyWmMpWJAPu4MZ");
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
  // Get token file from command line or default
  const tokenFile = process.argv[2];

  if (!tokenFile) {
    console.clear();
    log("❌", "Veuillez fournir le fichier du token secondaire", colors.red);
    log("💡", "Usage: npx ts-node scripts/execute-cycle-secondary.ts <token-file.json>", colors.yellow);
    log("", "", colors.reset);
    log("📝", "Exemple:", colors.cyan);
    log("  ", "npx ts-node scripts/execute-cycle-secondary.ts devnet-token-mayhem.json", colors.reset);
    process.exit(1);
  }

  console.clear();
  logSection("💎 SECONDARY TOKEN CYCLE (COLLECT → BUY → BURN)");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  log("👤", `Admin: ${admin.publicKey.toString()}`, colors.cyan);

  // Load token info
  if (!fs.existsSync(tokenFile)) {
    log("❌", `Token file not found: ${tokenFile}`, colors.red);
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

  // Get state and verify root token is set
  const stateAccount: any = await (program.account as any).datState.fetch(datState);
  if (!stateAccount.rootTokenMint) {
    log("❌", "Aucun root token défini dans le système!", colors.red);
    log("💡", "Définissez d'abord avec: npx ts-node scripts/set-root-token.ts", colors.yellow);
    process.exit(1);
  }

  const rootTokenMint = stateAccount.rootTokenMint;
  log("🏆", `Root Token: ${rootTokenMint.toString()}`, colors.cyan);

  // Verify this is NOT the root token
  if (rootTokenMint.equals(tokenMint)) {
    log("❌", "Ce token EST le root token!", colors.red);
    log("💡", "Utilisez execute-cycle-root.ts pour le root token", colors.yellow);
    process.exit(1);
  }

  log("✅", "Confirmed: This is a SECONDARY TOKEN", colors.green);

  const feeSplitBps = stateAccount.feeSplitBps;
  const keepPercentage = (feeSplitBps / 100).toFixed(2);
  const toRootPercentage = ((10000 - feeSplitBps) / 100).toFixed(2);

  log("📊", `Fee Split: ${keepPercentage}% kept, ${toRootPercentage}% to root`, colors.cyan);

  // Derive root treasury
  const [rootTreasury] = PublicKey.findProgramAddressSync(
    [Buffer.from("root_treasury"), rootTokenMint.toBuffer()],
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
  const vaultBalance = creatorVaultInfo ? creatorVaultInfo.lamports / 1e9 : 0;

  log("💰", `Creator Vault: ${vaultBalance.toFixed(6)} SOL`, colors.yellow);

  if (vaultBalance < 0.001) {
    log("⚠️", "WARNING: Very low fees available!", colors.yellow);
    log("💡", "Make some trades first to accumulate fees", colors.yellow);
  }

  // Check token stats
  try {
    const stats: any = await (program.account as any).tokenStats.fetch(tokenStats);
    log("📊", `Total SOL Collected: ${(Number(stats.totalSolCollected) / 1e9).toFixed(6)} SOL`, colors.cyan);
    log("📊", `Total SOL Sent to Root: ${(Number(stats.totalSolSentToRoot) / 1e9).toFixed(6)} SOL`, colors.cyan);
    log("📊", `Total Burned: ${(Number(stats.totalBurned) / 1e6).toLocaleString()} tokens`, colors.cyan);
  } catch {
    log("❌", "TokenStats not found!", colors.red);
    log("💡", `Run: npx ts-node scripts/init-token-stats.ts ${tokenFile}`, colors.yellow);
    process.exit(1);
  }

  const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

  const datTokenAccount = await getAssociatedTokenAddress(tokenMint, datAuthority, true, TOKEN_PROGRAM);
  const poolTokenAccount = await getAssociatedTokenAddress(tokenMint, bondingCurve, true, TOKEN_PROGRAM);
  const poolWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, bondingCurve, true, TOKEN_PROGRAM_ID);

  // ========================================================================
  logSection("STEP 1/3: COLLECT FEES (SECONDARY TOKEN MODE)");
  // ========================================================================

  const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM
  );

  try {
    const tx1 = await program.methods
      .collectFees(false) // is_root_token = false
      .accounts({
        datState,
        tokenStats,
        tokenMint,
        datAuthority,
        creatorVault,
        pumpEventAuthority,
        pumpSwapProgram: PUMP_PROGRAM,
        rootTreasury, // Pass it but won't be used (is_root_token=false)
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    log("✅", "Fees collected from creator vault!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx1}?cluster=devnet`, colors.cyan);

    // Check updated balances
    const vaultAfter = await connection.getAccountInfo(creatorVault);
    const authorityAfter = await connection.getAccountInfo(datAuthority);

    log("💰", `Creator Vault (after): ${vaultAfter ? (vaultAfter.lamports / 1e9).toFixed(6) : "0.000000"} SOL`, colors.green);
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
  logSection(`STEP 2/3: EXECUTE BUY (${keepPercentage}% KEPT, ${toRootPercentage}% TO ROOT)`);
  // ========================================================================

  const [pumpGlobalConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    PUMP_PROGRAM
  );

  // For Mayhem Mode (Token2022), use Mayhem fee recipient
  // For normal SPL tokens, use standard protocol fee recipient
  const MAYHEM_FEE_RECIPIENTS = [
    "GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS",
    "4budycTjhs9fD6xw62VBducVTNgMgJJ5BgtKq7mAZwn6",
    "8SBKzEQU4nLSzcwF4a74F2iaUDQyTfjGndn6qUWBnrpR",
    "4UQeTP1T39KZ9Sfxzo3WR5skgsaP6NZa87BAkuazLEKH",
    "8sNeir4QsLsJdYpc9RZacohhK1Y5FLU3nC5LXgYB4aa6",
    "Fh9HmeLNUMVCvejxCtCL2DbYaRyBFVJ5xrWkLnMH6fdk",
    "463MEnMeGyJekNZFQSTUABBEbLnvMTALbT6ZmsxAbAdq",
  ];

  const protocolFeeRecipient = isMayhem
    ? new PublicKey(MAYHEM_FEE_RECIPIENTS[0]) // Use first Mayhem fee recipient
    : new PublicKey("6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs");

  // For Mayhem Mode: protocol fee account is WSOL ATA of Mayhem fee recipient
  // For normal SPL: protocol fee account is token ATA of protocol fee recipient
  const protocolFeeRecipientAta = isMayhem
    ? await getAssociatedTokenAddress(WSOL_MINT, protocolFeeRecipient, true, TOKEN_PROGRAM_ID)
    : await getAssociatedTokenAddress(tokenMint, protocolFeeRecipient, true, TOKEN_PROGRAM);

  log("💰", `Fee Recipient: ${protocolFeeRecipient.toString()}`, colors.cyan);
  log("📦", `Fee Recipient ATA: ${protocolFeeRecipientAta.toString()}`, colors.cyan);

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

  // Check root treasury balance before
  const treasuryBefore = await connection.getAccountInfo(rootTreasury);
  const treasuryBalanceBefore = treasuryBefore ? treasuryBefore.lamports / 1e9 : 0;

  try {
    const tx2 = await program.methods
      .executeBuy(true) // is_secondary_token = true (split fees)
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
        rootTreasury, // Root treasury for fee split
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    log("✅", `Tokens bought and ${toRootPercentage}% sent to root!`, colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx2}?cluster=devnet`, colors.cyan);

    // Check token balance
    const tokenInfoAccount = await getAccount(connection, datTokenAccount, "confirmed", TOKEN_PROGRAM);
    const tokenBalance = Number(tokenInfoAccount.amount) / 1e6;
    log("💎", `Tokens bought: ${tokenBalance.toLocaleString()} tokens`, colors.green);

    // Check root treasury balance after
    const treasuryAfter = await connection.getAccountInfo(rootTreasury);
    const treasuryBalanceAfter = treasuryAfter ? treasuryAfter.lamports / 1e9 : 0;
    const sentToRoot = treasuryBalanceAfter - treasuryBalanceBefore;

    if (sentToRoot > 0) {
      log("🏆", `SOL sent to root treasury: ${sentToRoot.toFixed(6)} SOL (${toRootPercentage}%)`, colors.magenta);
    }
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
    const sentToRoot = Number(statsAfter.totalSolSentToRoot || 0) / 1e9;

    log("📊", `Total Burned: ${totalBurned.toLocaleString()} tokens`, colors.green);
    log("📊", `Total SOL Collected: ${totalCollected.toFixed(6)} SOL`, colors.green);
    log("📊", `Total Sent to Root: ${sentToRoot.toFixed(6)} SOL`, colors.green);
  } catch (error: any) {
    log("❌", `Error burn_and_update: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-10).forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }

  // ========================================================================
  logSection("🎉 SECONDARY TOKEN CYCLE COMPLETED!");
  // ========================================================================

  log("✅", "collect_fees: Collected from creator vault", colors.green);
  log("✅", `execute_buy: Bought with ${keepPercentage}%, sent ${toRootPercentage}% to root`, colors.green);
  log("✅", "burn_and_update: Tokens burned", colors.green);
  log("💎", "Secondary token cycle successful!", colors.magenta);
  log("🏆", "Root token is accumulating fees from this token!", colors.cyan);
}

main().catch((error) => {
  console.error(`${colors.red}❌ Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
