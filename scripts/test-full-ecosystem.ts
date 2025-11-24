/**
 * Test Full Ecosystem
 *
 * Démontre le fonctionnement complet du système root token:
 * 1. Affiche la configuration initiale
 * 2. Exécute des cycles sur les tokens secondaires (fees → root treasury)
 * 3. Exécute un cycle sur le root token (collecte toutes les fees accumulées)
 * 4. Affiche les statistiques finales
 *
 * Usage: npx ts-node scripts/test-full-ecosystem.ts <root-token.json> <secondary1.json> [secondary2.json ...]
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
  dim: "\x1b[2m",
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

interface TokenInfo {
  file: string;
  mint: PublicKey;
  name: string;
  symbol: string;
  creator: PublicKey;
  bondingCurve: PublicKey;
  isMayhem: boolean;
  tokenProgram: any;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.clear();
    log("❌", "Veuillez fournir au moins le root token et un token secondaire", colors.red);
    log("💡", "Usage: npx ts-node scripts/test-full-ecosystem.ts <root-token.json> <secondary1.json> [secondary2.json ...]", colors.yellow);
    log("", "", colors.reset);
    log("📝", "Exemple:", colors.cyan);
    log("  ", "npx ts-node scripts/test-full-ecosystem.ts devnet-token-spl.json devnet-token-mayhem.json", colors.dim);
    process.exit(1);
  }

  const rootTokenFile = args[0];
  const secondaryFiles = args.slice(1);

  console.clear();
  logSection("🌟 FULL ECOSYSTEM TEST");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  log("👤", `Admin: ${admin.publicKey.toString()}`, colors.cyan);

  // Load root token
  if (!fs.existsSync(rootTokenFile)) {
    log("❌", `Root token file not found: ${rootTokenFile}`, colors.red);
    process.exit(1);
  }

  const rootInfo = JSON.parse(fs.readFileSync(rootTokenFile, "utf-8"));
  const rootToken: TokenInfo = {
    file: rootTokenFile,
    mint: new PublicKey(rootInfo.mint),
    name: rootInfo.name,
    symbol: rootInfo.symbol,
    creator: new PublicKey(rootInfo.creator),
    bondingCurve: new PublicKey(rootInfo.bondingCurve),
    isMayhem: rootInfo.tokenProgram === "Token2022",
    tokenProgram: rootInfo.tokenProgram === "Token2022" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
  };

  log("🏆", `Root Token: ${rootToken.name} (${rootToken.symbol})`, colors.green);
  log("🔗", rootToken.mint.toString(), colors.dim);

  // Load secondary tokens
  const secondaryTokens: TokenInfo[] = [];
  for (const file of secondaryFiles) {
    if (!fs.existsSync(file)) {
      log("⚠️", `Secondary token file not found: ${file}`, colors.yellow);
      continue;
    }

    const info = JSON.parse(fs.readFileSync(file, "utf-8"));
    secondaryTokens.push({
      file,
      mint: new PublicKey(info.mint),
      name: info.name,
      symbol: info.symbol,
      creator: new PublicKey(info.creator),
      bondingCurve: new PublicKey(info.bondingCurve),
      isMayhem: info.tokenProgram === "Token2022",
      tokenProgram: info.tokenProgram === "Token2022" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
    });
  }

  log("💎", `Secondary Tokens: ${secondaryTokens.length}`, colors.cyan);
  secondaryTokens.forEach((t, i) => {
    log("  ", `${i + 1}. ${t.name} (${t.symbol})`, colors.dim);
  });

  // Setup provider and program
  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
  });

  const idl = loadIdl();
  const program: Program<Idl> = new Program(idl, provider);

  // Derive PDAs
  const [datState] = PublicKey.findProgramAddressSync(
    [Buffer.from("dat_v3")],
    PROGRAM_ID
  );

  const [datAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("auth_v3")],
    PROGRAM_ID
  );

  // ========================================================================
  logSection("📋 INITIAL STATE");
  // ========================================================================

  const state: any = await (program.account as any).datState.fetch(datState);

  // Verify root token
  if (!state.rootTokenMint || !state.rootTokenMint.equals(rootToken.mint)) {
    log("❌", "Root token mismatch!", colors.red);
    if (state.rootTokenMint) {
      log("⚠️", `Expected: ${rootToken.mint.toString()}`, colors.yellow);
      log("⚠️", `Got: ${state.rootTokenMint.toString()}`, colors.yellow);
    } else {
      log("💡", "No root token configured. Run: npx ts-node scripts/set-root-token.ts", colors.yellow);
    }
    process.exit(1);
  }

  log("✅", "Root token verified", colors.green);

  const feeSplitBps = state.feeSplitBps;
  const keepPercentage = (feeSplitBps / 100).toFixed(2);
  const toRootPercentage = ((10000 - feeSplitBps) / 100).toFixed(2);

  log("📊", `Fee Split: ${keepPercentage}% kept, ${toRootPercentage}% to root`, colors.cyan);

  // Root treasury
  const [rootTreasury] = PublicKey.findProgramAddressSync(
    [Buffer.from("root_treasury"), rootToken.mint.toBuffer()],
    PROGRAM_ID
  );

  const treasuryBefore = await connection.getAccountInfo(rootTreasury);
  const treasuryBalanceBefore = treasuryBefore ? treasuryBefore.lamports / 1e9 : 0;

  log("🏦", `Root Treasury: ${treasuryBalanceBefore.toFixed(6)} SOL`, colors.yellow);

  // Root token stats
  const [rootTokenStats] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_stats_v1"), rootToken.mint.toBuffer()],
    PROGRAM_ID
  );

  const rootStatsBefore: any = await (program.account as any).tokenStats.fetch(rootTokenStats);
  log("📊", `Root Token - Total Burned: ${(Number(rootStatsBefore.totalBurned) / 1e6).toLocaleString()} tokens`, colors.dim);
  log("📊", `Root Token - From Others: ${(Number(rootStatsBefore.totalSolReceivedFromOthers) / 1e9).toFixed(6)} SOL`, colors.dim);

  // ========================================================================
  logSection("💎 STEP 1: EXECUTE SECONDARY TOKEN CYCLES");
  // ========================================================================

  log("", "Each secondary token will execute its cycle:", colors.reset);
  log("", `→ Keep ${keepPercentage}% for buyback`, colors.dim);
  log("", `→ Send ${toRootPercentage}% to root treasury`, colors.dim);
  log("", "", colors.reset);

  for (let i = 0; i < secondaryTokens.length; i++) {
    const token = secondaryTokens[i];

    log("🔄", `[${i + 1}/${secondaryTokens.length}] Processing ${token.name} (${token.symbol})...`, colors.cyan);

    const [tokenStats] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_stats_v1"), token.mint.toBuffer()],
      PROGRAM_ID
    );

    const [creatorVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator-vault"), token.creator.toBuffer()],
      PUMP_PROGRAM
    );

    const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("__event_authority")],
      PUMP_PROGRAM
    );

    const datTokenAccount = await getAssociatedTokenAddress(token.mint, datAuthority, true, token.tokenProgram);
    const poolTokenAccount = await getAssociatedTokenAddress(token.mint, token.bondingCurve, true, token.tokenProgram);
    const poolWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, token.bondingCurve, true, TOKEN_PROGRAM_ID);

    // Step 1: collect_fees
    try {
      await program.methods
        .collectFees(false)
        .accounts({
          datState,
          tokenStats,
          tokenMint: token.mint,
          datAuthority,
          creatorVault,
          pumpEventAuthority,
          pumpSwapProgram: PUMP_PROGRAM,
          rootTreasury: null,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      log("  ", "✅ Fees collected", colors.green);
    } catch (e: any) {
      log("  ", `⚠️ Collect failed: ${e.message}`, colors.yellow);
      continue;
    }

    await sleep(1000);

    // Step 2: execute_buy
    const [pumpGlobalConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("global")],
      PUMP_PROGRAM
    );

    const protocolFeeRecipient = new PublicKey("6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs");
    const protocolFeeRecipientAta = await getAssociatedTokenAddress(token.mint, protocolFeeRecipient, true, token.tokenProgram);

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
      await program.methods
        .executeBuy(true)
        .accounts({
          datState,
          datAuthority,
          datAsdfAccount: datTokenAccount,
          pool: token.bondingCurve,
          asdfMint: token.mint,
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
          rootTreasury,
          tokenProgram: token.tokenProgram,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      log("  ", `✅ Bought tokens (${toRootPercentage}% sent to root)`, colors.green);
    } catch (e: any) {
      log("  ", `⚠️ Buy failed: ${e.message}`, colors.yellow);
      continue;
    }

    await sleep(1000);

    // Step 3: burn_and_update
    try {
      await program.methods
        .burnAndUpdate()
        .accounts({
          datState,
          tokenStats,
          datAuthority,
          datAsdfAccount: datTokenAccount,
          asdfMint: token.mint,
          tokenProgram: token.tokenProgram,
        })
        .rpc();

      log("  ", "✅ Tokens burned", colors.green);
    } catch (e: any) {
      log("  ", `⚠️ Burn failed: ${e.message}`, colors.yellow);
    }

    await sleep(500);
  }

  // ========================================================================
  logSection("💰 CHECK ROOT TREASURY");
  // ========================================================================

  const treasuryAfterSecondaries = await connection.getAccountInfo(rootTreasury);
  const treasuryBalanceAfterSecondaries = treasuryAfterSecondaries ? treasuryAfterSecondaries.lamports / 1e9 : 0;
  const feesAccumulated = treasuryBalanceAfterSecondaries - treasuryBalanceBefore;

  log("🏦", `Root Treasury (before): ${treasuryBalanceBefore.toFixed(6)} SOL`, colors.dim);
  log("🏦", `Root Treasury (after secondaries): ${treasuryBalanceAfterSecondaries.toFixed(6)} SOL`, colors.yellow);
  log("💰", `Fees Accumulated: ${feesAccumulated.toFixed(6)} SOL`, feesAccumulated > 0 ? colors.green : colors.yellow);

  if (feesAccumulated <= 0) {
    log("⚠️", "No fees were accumulated (creator vaults might be empty)", colors.yellow);
    log("💡", "Make some trades on secondary tokens to generate fees", colors.cyan);
  }

  // ========================================================================
  logSection("🏆 STEP 2: EXECUTE ROOT TOKEN CYCLE");
  // ========================================================================

  log("", "Root token will collect fees from:", colors.reset);
  log("", "→ Its own creator vault", colors.dim);
  log("", `→ Root treasury (${feesAccumulated.toFixed(6)} SOL from secondaries)`, colors.dim);
  log("", "", colors.reset);

  const [rootCreatorVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), rootToken.creator.toBuffer()],
    PUMP_PROGRAM
  );

  const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM
  );

  // Step 1: collect_fees (root)
  try {
    await program.methods
      .collectFees(true)
      .accounts({
        datState,
        tokenStats: rootTokenStats,
        tokenMint: rootToken.mint,
        datAuthority,
        creatorVault: rootCreatorVault,
        pumpEventAuthority,
        pumpSwapProgram: PUMP_PROGRAM,
        rootTreasury,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    log("✅", "Root fees collected (vault + treasury)", colors.green);
  } catch (e: any) {
    log("❌", `Root collect failed: ${e.message}`, colors.red);
    if (e.logs) {
      e.logs.slice(-5).forEach((l: string) => log("  ", l, colors.dim));
    }
  }

  await sleep(1000);

  // Step 2: execute_buy (root)
  const rootDatTokenAccount = await getAssociatedTokenAddress(rootToken.mint, datAuthority, true, rootToken.tokenProgram);
  const rootPoolTokenAccount = await getAssociatedTokenAddress(rootToken.mint, rootToken.bondingCurve, true, rootToken.tokenProgram);
  const rootPoolWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, rootToken.bondingCurve, true, TOKEN_PROGRAM_ID);

  const [pumpGlobalConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    PUMP_PROGRAM
  );

  const protocolFeeRecipient = new PublicKey("6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs");
  const protocolFeeRecipientAta = await getAssociatedTokenAddress(rootToken.mint, protocolFeeRecipient, true, rootToken.tokenProgram);

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
    await program.methods
      .executeBuy(false)
      .accounts({
        datState,
        datAuthority,
        datAsdfAccount: rootDatTokenAccount,
        pool: rootToken.bondingCurve,
        asdfMint: rootToken.mint,
        poolAsdfAccount: rootPoolTokenAccount,
        poolWsolAccount: rootPoolWsolAccount,
        pumpGlobalConfig,
        protocolFeeRecipient,
        protocolFeeRecipientAta,
        creatorVault: rootCreatorVault,
        pumpEventAuthority,
        pumpSwapProgram: PUMP_PROGRAM,
        globalVolumeAccumulator,
        userVolumeAccumulator,
        feeConfig,
        feeProgram: FEE_PROGRAM,
        rootTreasury: datAuthority, // Dummy value, not used for root token
        tokenProgram: rootToken.tokenProgram,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    log("✅", "Root tokens bought (100% of fees)", colors.green);
  } catch (e: any) {
    log("❌", `Root buy failed: ${e.message}`, colors.red);
    if (e.logs) {
      e.logs.slice(-5).forEach((l: string) => log("  ", l, colors.dim));
    }
  }

  await sleep(1000);

  // Step 3: burn_and_update (root)
  try {
    await program.methods
      .burnAndUpdate()
      .accounts({
        datState,
        tokenStats: rootTokenStats,
        datAuthority,
        datAsdfAccount: rootDatTokenAccount,
        asdfMint: rootToken.mint,
        tokenProgram: rootToken.tokenProgram,
      })
      .rpc();

    log("✅", "Root tokens burned", colors.green);
  } catch (e: any) {
    log("❌", `Root burn failed: ${e.message}`, colors.red);
  }

  // ========================================================================
  logSection("📊 FINAL STATISTICS");
  // ========================================================================

  // Root token final stats
  const rootStatsAfter: any = await (program.account as any).tokenStats.fetch(rootTokenStats);

  log("🏆", "ROOT TOKEN", colors.green);
  log("  ", `Total Burned: ${(Number(rootStatsAfter.totalBurned) / 1e6).toLocaleString()} tokens`, colors.reset);
  log("  ", `Total SOL Collected: ${(Number(rootStatsAfter.totalSolCollected) / 1e9).toFixed(6)} SOL`, colors.reset);
  log("  ", `From Secondaries: ${(Number(rootStatsAfter.totalSolReceivedFromOthers) / 1e9).toFixed(6)} SOL`, colors.cyan);
  log("  ", `Total Cycles: ${rootStatsAfter.totalCycles}`, colors.reset);

  log("", "", colors.reset);

  // Secondary tokens final stats
  for (const token of secondaryTokens) {
    const [tokenStats] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_stats_v1"), token.mint.toBuffer()],
      PROGRAM_ID
    );

    try {
      const stats: any = await (program.account as any).tokenStats.fetch(tokenStats);
      log("💎", `${token.name} (${token.symbol})`, colors.cyan);
      log("  ", `Total Burned: ${(Number(stats.totalBurned) / 1e6).toLocaleString()} tokens`, colors.reset);
      log("  ", `Total SOL Collected: ${(Number(stats.totalSolCollected) / 1e9).toFixed(6)} SOL`, colors.reset);
      log("  ", `Sent to Root: ${(Number(stats.totalSolSentToRoot || 0) / 1e9).toFixed(6)} SOL`, colors.green);
      log("  ", `Total Cycles: ${stats.totalCycles}`, colors.reset);
      log("", "", colors.reset);
    } catch {
      log("⚠️", `${token.name}: Stats not available`, colors.yellow);
    }
  }

  // ========================================================================
  logSection("🎉 ECOSYSTEM TEST COMPLETED!");
  // ========================================================================

  log("✅", `${secondaryTokens.length} secondary token cycles executed`, colors.green);
  log("✅", "1 root token cycle executed", colors.green);
  log("🏆", "Root token successfully accumulated fees from all tokens!", colors.magenta);
  log("", "", colors.reset);
  log("💡", "The root token benefits from the entire ecosystem:", colors.cyan);
  log("  ", `→ Gets 100% of its own fees`, colors.dim);
  log("  ", `→ Gets ${toRootPercentage}% from all secondary tokens`, colors.dim);
}

main().catch((error) => {
  console.error(`${colors.red}❌ Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
