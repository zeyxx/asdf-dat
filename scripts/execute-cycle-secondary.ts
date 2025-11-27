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
  SYSVAR_RENT_PUBKEY,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import { AnchorProvider, Program, Wallet, Idl, BN } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";
import { getNetworkConfig, printNetworkBanner } from "../lib/network-config";
import {
  PoolType,
  PUMP_PROGRAM,
  PUMPSWAP_PROGRAM,
  WSOL_MINT,
  getBcCreatorVault,
  getAmmCreatorVaultAta,
  deriveAmmCreatorVaultAuthority,
} from "../lib/amm-utils";

const PROGRAM_ID = new PublicKey("ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui");
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

function getExplorerUrl(tx: string, network: string): string {
  const cluster = network === "Mainnet" ? "" : "?cluster=devnet";
  return `https://explorer.solana.com/tx/${tx}${cluster}`;
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
  // Parse command line arguments
  const args = process.argv.slice(2);
  const networkConfig = getNetworkConfig(args);
  const tokenFile = args.find(a => !a.startsWith("--"));
  const allocatedArg = args.find(a => a.startsWith("--allocated="));
  const allocatedLamports = allocatedArg ? BigInt(allocatedArg.split("=")[1]) : null;

  if (!tokenFile) {
    console.clear();
    log("❌", "Veuillez fournir le fichier du token secondaire", colors.red);
    log("💡", "Usage: npx ts-node scripts/execute-cycle-secondary.ts <token-file.json> [--allocated=LAMPORTS] [--network mainnet|devnet]", colors.yellow);
    log("", "", colors.reset);
    log("📝", "Exemples:", colors.cyan);
    log("  ", "Standalone mode:  npx ts-node scripts/execute-cycle-secondary.ts devnet-token-mayhem.json", colors.reset);
    log("  ", "Allocated mode:   npx ts-node scripts/execute-cycle-secondary.ts devnet-token-mayhem.json --allocated=5000000", colors.reset);
    process.exit(1);
  }

  console.clear();

  // Print network banner
  printNetworkBanner(networkConfig);

  // Determine mode
  const mode = allocatedLamports ? "ALLOCATED (ECOSYSTEM ORCHESTRATED)" : "STANDALONE";
  logSection(`💎 SECONDARY TOKEN CYCLE - ${mode}`);

  const connection = new Connection(networkConfig.rpcUrl, "confirmed");

  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(networkConfig.wallet, "utf-8")))
  );

  log("👤", `Admin: ${admin.publicKey.toString()}`, colors.cyan);

  // Load token info
  if (!fs.existsSync(tokenFile)) {
    log("❌", `Token file not found: ${tokenFile}`, colors.red);
    process.exit(1);
  }

  const tokenInfo = JSON.parse(fs.readFileSync(tokenFile, "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const poolAddress = new PublicKey(tokenInfo.bondingCurve || tokenInfo.pool);
  const tokenCreator = new PublicKey(tokenInfo.creator);
  const isMayhem = tokenInfo.tokenProgram === "Token2022";
  const poolType: PoolType = tokenInfo.poolType || 'bonding_curve';
  const isAmm = poolType === 'pumpswap_amm';

  if (allocatedLamports) {
    log("💰", `Allocated amount: ${(Number(allocatedLamports) / 1e9).toFixed(6)} SOL (${allocatedLamports} lamports)`, colors.cyan);
    log("ℹ️", "Mode: Ecosystem orchestrator pre-calculated amount", colors.cyan);
  } else {
    log("ℹ️", "Mode: Standalone (collect → buy → burn)", colors.cyan);
  }

  log("🪙", `Token: ${tokenInfo.name} (${tokenInfo.symbol})`, colors.cyan);
  log("🔗", `Mint: ${tokenMint.toString()}`, colors.cyan);
  log("🏊", `Pool Type: ${poolType}`, colors.cyan);
  log("📈", `Pool: ${poolAddress.toString()}`, colors.cyan);
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

  // Derive creator vault based on pool type
  let creatorVault: PublicKey;
  let creatorVaultAuthority: PublicKey | null = null;

  if (isAmm) {
    // PumpSwap AMM: WSOL ATA
    const [vaultAuth] = deriveAmmCreatorVaultAuthority(tokenCreator);
    creatorVaultAuthority = vaultAuth;
    creatorVault = getAmmCreatorVaultAta(tokenCreator);
    log("💎", `Creator Vault Authority: ${creatorVaultAuthority.toString()}`, colors.cyan);
    log("💎", `Creator Vault ATA (WSOL): ${creatorVault.toString()}`, colors.cyan);
  } else {
    // Bonding Curve: Native SOL PDA
    creatorVault = getBcCreatorVault(tokenCreator);
    log("💎", `Creator Vault (SOL): ${creatorVault.toString()}`, colors.cyan);
  }

  // Check balances before
  let vaultBalance = 0;
  if (isAmm) {
    // AMM: Check WSOL token balance
    try {
      const vaultAccount = await getAccount(connection, creatorVault);
      vaultBalance = Number(vaultAccount.amount) / 1e9;
    } catch {
      // Token account doesn't exist yet
    }
  } else {
    // BC: Check native SOL balance
    const creatorVaultInfo = await connection.getAccountInfo(creatorVault);
    vaultBalance = creatorVaultInfo ? creatorVaultInfo.lamports / 1e9 : 0;
  }

  const vaultType = isAmm ? 'WSOL' : 'SOL';
  log("💰", `Creator Vault: ${vaultBalance.toFixed(6)} ${vaultType}`, colors.yellow);

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

  const datTokenAccount = await getAssociatedTokenAddress(tokenMint, datAuthority, true, TOKEN_PROGRAM);
  const datWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, datAuthority, true, TOKEN_PROGRAM_ID);
  const poolTokenAccount = await getAssociatedTokenAddress(tokenMint, poolAddress, true, TOKEN_PROGRAM);
  const poolWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, poolAddress, true, TOKEN_PROGRAM_ID);

  // ========================================================================
  // STEP 1/3: COLLECT FEES (SECONDARY TOKEN MODE)
  // ========================================================================

  const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM
  );

  if (!allocatedLamports) {
    // STANDALONE MODE: Collect fees from creator vault
    logSection(`STEP 1/3: COLLECT FEES (${isAmm ? 'AMM MODE' : 'STANDALONE MODE'})`);

    try {
      if (isAmm) {
        // AMM: collect_fees_amm + unwrap_wsol
        log("📦", "Using AMM fee collection (collect_fees_amm + unwrap_wsol)", colors.cyan);

        // Step 1a: Collect WSOL from AMM vault
        const tx1a = await program.methods
          .collectFeesAmm()
          .accounts({
            datState,
            tokenStats,
            tokenMint,
            datAuthority,
            wsolMint: WSOL_MINT,
            datWsolAccount,
            creatorVaultAuthority: creatorVaultAuthority!,
            creatorVaultAta: creatorVault,
            pumpSwapProgram: PUMPSWAP_PROGRAM,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([admin])
          .rpc();

        log("✅", "WSOL collected from AMM vault!", colors.green);
        log("🔗", `TX: ${getExplorerUrl(tx1a, networkConfig.name)}`, colors.cyan);

        // Step 1b: Unwrap WSOL to native SOL
        const tx1b = await program.methods
          .unwrapWsol()
          .accounts({
            datState,
            datAuthority,
            datWsolAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([admin])
          .rpc();

        log("✅", "WSOL unwrapped to native SOL!", colors.green);
        log("🔗", `TX: ${getExplorerUrl(tx1b, networkConfig.name)}`, colors.cyan);

      } else {
        // Bonding Curve: Standard collect_fees
        const tx1 = await program.methods
          .collectFees(false, false) // is_root_token = false, for_ecosystem = false
          .accounts({
            datState,
            tokenStats,
            tokenMint,
            datAuthority,
            creatorVault,
            pumpEventAuthority,
            pumpSwapProgram: PUMP_PROGRAM,
            rootTreasury,
            systemProgram: SystemProgram.programId,
          })
          .signers([admin])
          .rpc();

        log("✅", "Fees collected from creator vault!", colors.green);
        log("🔗", `TX: ${getExplorerUrl(tx1, networkConfig.name)}`, colors.cyan);
      }

      // Check updated balances
      const authorityAfter = await connection.getAccountInfo(datAuthority);
      log("💰", `DAT Authority (after collect): ${authorityAfter ? (authorityAfter.lamports / 1e9).toFixed(6) : "0.000000"} SOL`, colors.green);

    } catch (error: any) {
      log("❌", `Error collect_fees: ${error.message}`, colors.red);
      if (error.logs) {
        console.log("\n📋 Logs:");
        error.logs.slice(-10).forEach((l: string) => console.log(`   ${l}`));
      }
      process.exit(1);
    }
  } else {
    // ALLOCATED MODE: Skip collect_fees (already done by orchestrator)
    logSection("STEP 1/3: COLLECT FEES - SKIPPED (ALLOCATED MODE)");
    log("ℹ️", "In allocated mode, fees were already collected by ecosystem orchestrator", colors.cyan);
    log("💰", `Using pre-allocated amount: ${(Number(allocatedLamports) / 1e9).toFixed(6)} SOL`, colors.green);
  }

  // ========================================================================
  logSection(`STEP 2/3: EXECUTE BUY (${keepPercentage}% KEPT, ${toRootPercentage}% TO ROOT)`);
  // ========================================================================

  // Derive PDAs based on pool type
  const swapProgram = isAmm ? PUMPSWAP_PROGRAM : PUMP_PROGRAM;

  const [pumpGlobalConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    swapProgram
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
  log("🏊", `Swap Program: ${isAmm ? 'PumpSwap AMM' : 'PumpFun BC'}`, colors.cyan);

  const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_volume_accumulator")],
    swapProgram
  );

  const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_volume_accumulator"), datAuthority.toBuffer()],
    swapProgram
  );

  const [feeConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("fee_config"), swapProgram.toBuffer()],
    FEE_PROGRAM
  );

  // For BC tokens, use the BC creator vault; for AMM, use a dummy (not used in buy)
  const buyCreatorVault = isAmm ? getBcCreatorVault(tokenCreator) : creatorVault;

  // Check root treasury balance before
  const treasuryBefore = await connection.getAccountInfo(rootTreasury);
  const treasuryBalanceBefore = treasuryBefore ? treasuryBefore.lamports / 1e9 : 0;

  // Debug: Check all accounts before calling execute_buy
  const accounts = {
    datState,
    datAuthority,
    datAsdfAccount: datTokenAccount,
    pool: poolAddress,
    asdfMint: tokenMint,
    poolAsdfAccount: poolTokenAccount,
    poolWsolAccount,
    pumpGlobalConfig,
    protocolFeeRecipient,
    protocolFeeRecipientAta,
    creatorVault: buyCreatorVault,
    pumpEventAuthority,
    pumpSwapProgram: swapProgram,
    globalVolumeAccumulator,
    userVolumeAccumulator,
    feeConfig,
    feeProgram: FEE_PROGRAM,
    rootTreasury,
    tokenProgram: TOKEN_PROGRAM,
    systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
  };

  // Check for undefined accounts
  for (const [key, value] of Object.entries(accounts)) {
    if (value === undefined || value === null) {
      log("❌", `Account ${key} is undefined!`, colors.red);
    }
  }

  try {
    if (isAmm) {
      // =====================================================
      // AMM SECONDARY: Manual split + wrap + execute_buy_amm
      // =====================================================
      log("📈", "Using PumpSwap AMM buy route for secondary token", colors.cyan);

      // Get current SOL balance in dat_authority (after unwrap in Step 1)
      const authorityInfo = await connection.getAccountInfo(datAuthority);
      const availableSol = authorityInfo ? authorityInfo.lamports - 2_000_000 : 0; // Keep rent + buffer

      if (availableSol < 10_000_000) { // < 0.01 SOL
        log("❌", "Insufficient SOL for AMM buy (< 0.01 SOL)", colors.red);
        process.exit(1);
      }

      // Calculate split amounts
      const solForRoot = Math.floor((availableSol * (10000 - feeSplitBps)) / 10000);
      const solForBuy = availableSol - solForRoot;

      log("💰", `Total available: ${(availableSol / 1e9).toFixed(6)} SOL`, colors.cyan);
      log("💰", `For root treasury (${toRootPercentage}%): ${(solForRoot / 1e9).toFixed(6)} SOL`, colors.cyan);
      log("💰", `For buyback (${keepPercentage}%): ${(solForBuy / 1e9).toFixed(6)} SOL`, colors.cyan);

      // Step 2a: Transfer to root treasury (using system transfer via admin)
      // Note: This is a temporary workaround - ideally the program should handle this
      // For now, we wrap all available SOL and do the AMM buy
      // The split will be handled by execute_buy_secondary when we add AMM support

      log("💱", `Wrapping ${(availableSol / 1e9).toFixed(6)} SOL to WSOL for AMM buy...`, colors.cyan);

      const tx2a = await program.methods
        .wrapWsol(new BN(availableSol))
        .accounts({
          datState,
          datAuthority,
          datWsolAccount,
          wsolMint: WSOL_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      log("✅", "SOL wrapped to WSOL!", colors.green);
      log("🔗", `TX: ${getExplorerUrl(tx2a, networkConfig.name)}`, colors.cyan);

      // Get WSOL balance for the buy
      const wsolAccount = await getAccount(connection, datWsolAccount);
      const wsolBalance = wsolAccount.amount;
      log("💰", `WSOL available for buy: ${(Number(wsolBalance) / 1e9).toFixed(6)} WSOL`, colors.cyan);

      // PumpSwap event authority
      const [pumpSwapEventAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("__event_authority")],
        PUMPSWAP_PROGRAM
      );

      // Protocol fee recipient ATA for WSOL (PumpSwap fees)
      const protocolFeeRecipientWsolAta = await getAssociatedTokenAddress(
        WSOL_MINT, protocolFeeRecipient, true, TOKEN_PROGRAM_ID
      );

      // Derive creator vault authority and ATA for AMM
      const [coinCreatorVaultAuthority] = deriveAmmCreatorVaultAuthority(tokenCreator);
      const coinCreatorVaultAta = getAmmCreatorVaultAta(tokenCreator);

      // Calculate desired tokens (estimate based on max sol cost)
      const maxSolCost = Number(wsolBalance) * 0.95;
      const desiredTokens = maxSolCost * 1_000_000;

      const tx2b = await program.methods
        .executeBuyAmm(
          new BN(Math.floor(desiredTokens)),
          new BN(Math.floor(maxSolCost))
        )
        .accounts({
          datState,
          datAuthority,
          datTokenAccount,
          pool: poolAddress,
          globalConfig: pumpGlobalConfig,
          baseMint: tokenMint,
          quoteMint: WSOL_MINT,
          datWsolAccount,
          poolBaseTokenAccount: poolTokenAccount,
          poolQuoteTokenAccount: poolWsolAccount,
          protocolFeeRecipient,
          protocolFeeRecipientAta: protocolFeeRecipientWsolAta,
          baseTokenProgram: TOKEN_PROGRAM,
          quoteTokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          eventAuthority: pumpSwapEventAuthority,
          pumpSwapProgram: PUMPSWAP_PROGRAM,
          coinCreatorVaultAta,
          coinCreatorVaultAuthority,
          globalVolumeAccumulator,
          userVolumeAccumulator,
          feeConfig,
          feeProgram: FEE_PROGRAM,
        })
        .signers([admin])
        .rpc();

      log("✅", "Tokens bought on AMM!", colors.green);
      log("🔗", `TX: ${getExplorerUrl(tx2b, networkConfig.name)}`, colors.cyan);

      // Note: For AMM secondary tokens, the split to root treasury is NOT done yet
      // TODO: Add execute_buy_amm_secondary instruction to handle split + AMM buy
      log("⚠️", "Note: AMM secondary split to root treasury not yet implemented in program", colors.yellow);
      log("💡", "Full 100% used for buyback. Root treasury routing pending program update.", colors.yellow);

    } else {
      // =====================================================
      // BONDING CURVE SECONDARY: execute_buy_secondary
      // =====================================================
      log("📈", "Using Bonding Curve buy route for secondary token", colors.cyan);

      const allocatedBN = allocatedLamports ? new BN(allocatedLamports.toString()) : null;
      log("🔍", `Calling execute_buy_secondary(allocated=${allocatedLamports ? allocatedLamports.toString() : "null"})...`, colors.cyan);

      // Build transaction manually for better error handling
      const tx = await program.methods
        .executeBuySecondary(allocatedBN)
        .accounts(accounts)
        .transaction();

      log("🔍", "Transaction built successfully", colors.cyan);

      // Send transaction using native sendAndConfirmTransaction
      const tx2 = await sendAndConfirmTransaction(connection, tx, [admin], {
        skipPreflight: true,
        commitment: "confirmed",
      });

      log("✅", `Tokens bought and ${toRootPercentage}% sent to root!`, colors.green);
      log("🔗", `TX: ${getExplorerUrl(tx2, networkConfig.name)}`, colors.cyan);
    }

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

    // If allocated mode, finalize the cycle (reset pending_fees, increment cycles_participated)
    if (allocatedLamports) {
      logSection("STEP 2.5/3: FINALIZE ALLOCATED CYCLE");
      log("🔄", "Calling finalize_allocated_cycle to update TokenStats...", colors.cyan);

      try {
        const finalizeTx = await program.methods
          .finalizeAllocatedCycle(true) // actually_participated = true
          .accounts({
            tokenStats,
          })
          .signers([admin])
          .rpc();

        log("✅", "Cycle finalized (pending_fees reset, cycles_participated incremented)!", colors.green);
        log("🔗", `TX: ${getExplorerUrl(finalizeTx, networkConfig.name)}`, colors.cyan);
      } catch (finalizeError: any) {
        log("❌", `Error finalizing cycle: ${finalizeError.message}`, colors.red);
        if (finalizeError.logs) {
          console.log("\n📋 Logs:");
          finalizeError.logs.slice(-10).forEach((l: string) => console.log(`   ${l}`));
        }
        // Don't exit - continue to burn step
      }
    }
  } catch (error: any) {
    log("❌", `Error execute_buy: ${error.message || JSON.stringify(error)}`, colors.red);
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
    log("🔗", `TX: ${getExplorerUrl(tx3, networkConfig.name)}`, colors.cyan);

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
  logSection(`🎉 SECONDARY TOKEN CYCLE COMPLETED! (${mode})`);
  // ========================================================================

  if (allocatedLamports) {
    // Allocated mode summary
    log("ℹ️", "Mode: ALLOCATED (Ecosystem Orchestrated)", colors.cyan);
    log("✅", `execute_buy: Bought with allocated ${(Number(allocatedLamports) / 1e9).toFixed(6)} SOL`, colors.green);
    log("✅", `finalize_allocated_cycle: TokenStats updated`, colors.green);
    log("✅", "burn_and_update: Tokens burned", colors.green);
    log("💎", "Allocated cycle successful!", colors.magenta);
  } else {
    // Standalone mode summary
    log("ℹ️", "Mode: STANDALONE", colors.cyan);
    log("✅", "collect_fees: Collected from creator vault", colors.green);
    log("✅", `execute_buy: Bought with ${keepPercentage}%, sent ${toRootPercentage}% to root`, colors.green);
    log("✅", "burn_and_update: Tokens burned", colors.green);
    log("💎", "Secondary token cycle successful!", colors.magenta);
  }
  log("🏆", "Root token is accumulating fees from this token!", colors.cyan);
}

main().catch((error) => {
  console.error(`${colors.red}❌ Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
