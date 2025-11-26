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

const PROGRAM_ID = new PublicKey("ASDfNfUHwVGfrg3SV7SQYWhaVxnrCUZyWmMpWJAPu4MZ");
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
  // Parse arguments
  const args = process.argv.slice(2);
  const networkConfig = getNetworkConfig(args);

  // Get token file from non-flag args or default
  const tokenFile = args.find(a => !a.startsWith('--')) || networkConfig.tokens[0];

  console.clear();
  logSection("🏆 ROOT TOKEN CYCLE (COLLECT → BUY → BURN)");

  // Print network banner
  printNetworkBanner(networkConfig);

  const connection = new Connection(networkConfig.rpcUrl, "confirmed");

  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(networkConfig.wallet, "utf-8")))
  );

  log("👤", `Admin: ${admin.publicKey.toString()}`, colors.cyan);

  // Load token info
  if (!fs.existsSync(tokenFile)) {
    log("❌", `Token file not found: ${tokenFile}`, colors.red);
    log("💡", "Usage: npx ts-node scripts/execute-cycle-root.ts <token-file.json> --network mainnet|devnet", colors.yellow);
    process.exit(1);
  }

  const tokenInfo = JSON.parse(fs.readFileSync(tokenFile, "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const poolAddress = new PublicKey(tokenInfo.bondingCurve || tokenInfo.pool);
  const tokenCreator = new PublicKey(tokenInfo.creator);
  const isMayhem = tokenInfo.tokenProgram === "Token2022";
  const poolType: PoolType = tokenInfo.poolType || 'bonding_curve';
  const isAmm = poolType === 'pumpswap_amm';

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

  const rootTreasuryInfo = await connection.getAccountInfo(rootTreasury);
  const treasuryBalance = rootTreasuryInfo ? rootTreasuryInfo.lamports / 1e9 : 0;
  const totalFees = vaultBalance + treasuryBalance;

  const vaultType = isAmm ? 'WSOL' : 'SOL';
  log("💰", `Creator Vault: ${vaultBalance.toFixed(6)} ${vaultType}`, colors.yellow);
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
  const datWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, datAuthority, true, TOKEN_PROGRAM_ID);
  const poolTokenAccount = await getAssociatedTokenAddress(tokenMint, poolAddress, true, TOKEN_PROGRAM);
  const poolWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, poolAddress, true, TOKEN_PROGRAM_ID);

  // ========================================================================
  logSection(`STEP 1/3: COLLECT FEES (${isAmm ? 'AMM MODE' : 'ROOT TOKEN MODE'})`);
  // ========================================================================

  const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM
  );

  // Track available SOL for wrapping (used in AMM mode)

  try {
    if (isAmm) {
      // AMM Root: Keep WSOL for buyback, collect treasury SOL separately
      log("📦", "Using AMM fee collection (collect_fees_amm)", colors.cyan);

      // Step 1a: Collect WSOL from AMM vault (don't unwrap, will use for AMM buy)
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

      // Check how much WSOL we have
      try {
        const wsolAccount = await getAccount(connection, datWsolAccount);
        log("💰", `DAT WSOL Account: ${(Number(wsolAccount.amount) / 1e9).toFixed(6)} WSOL`, colors.green);
      } catch {
        log("⚠️", "DAT WSOL account not found or empty", colors.yellow);
      }

      // Step 1b: Collect from root treasury if any (native SOL)
      const rootTreasuryInfo2 = await connection.getAccountInfo(rootTreasury);
      if (rootTreasuryInfo2 && rootTreasuryInfo2.lamports > 0) {
        const bcCreatorVault = getBcCreatorVault(tokenCreator);
        const tx1b = await program.methods
          .collectFees(true, false) // is_root_token = true
          .accounts({
            datState,
            tokenStats,
            tokenMint,
            datAuthority,
            creatorVault: bcCreatorVault, // dummy for BC, won't be used
            pumpEventAuthority,
            pumpSwapProgram: PUMP_PROGRAM,
            rootTreasury,
            systemProgram: SystemProgram.programId,
          })
          .signers([admin])
          .rpc();

        log("✅", "Root treasury SOL collected!", colors.green);
        log("🔗", `TX: ${getExplorerUrl(tx1b, networkConfig.name)}`, colors.cyan);
      }

      // Step 1c: Wrap treasury SOL to WSOL (if we have SOL to wrap)
      const authorityInfo = await connection.getAccountInfo(datAuthority);
      const availableSol = authorityInfo ? authorityInfo.lamports - 2_000_000 : 0; // Keep rent + buffer

      if (availableSol > 10_000_000) { // Minimum 0.01 SOL worth wrapping
        log("💱", `Wrapping ${(availableSol / 1e9).toFixed(6)} SOL to WSOL for AMM buy...`, colors.cyan);

        const tx1c = await program.methods
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
        log("🔗", `TX: ${getExplorerUrl(tx1c, networkConfig.name)}`, colors.cyan);
      }

    } else {
      // Bonding Curve: Standard collect_fees
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
          rootTreasury,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      log("✅", "Fees collected from vault + root treasury!", colors.green);
      log("🔗", `TX: ${getExplorerUrl(tx1, networkConfig.name)}`, colors.cyan);
    }

    // Check updated balances
    const treasuryAfter = await connection.getAccountInfo(rootTreasury);
    const authorityAfter = await connection.getAccountInfo(datAuthority);

    log("💰", `Root Treasury (after): ${treasuryAfter ? (treasuryAfter.lamports / 1e9).toFixed(6) : "0.000000"} SOL`, colors.green);
    log("💰", `DAT Authority (after collect): ${authorityAfter ? (authorityAfter.lamports / 1e9).toFixed(6) : "0.000000"} SOL`, colors.green);

    if (isAmm) {
      try {
        const wsolAccount = await getAccount(connection, datWsolAccount);
        log("💰", `DAT WSOL Account (after wrap): ${(Number(wsolAccount.amount) / 1e9).toFixed(6)} WSOL`, colors.green);
      } catch {
        log("⚠️", "DAT WSOL account not found", colors.yellow);
      }
    }
  } catch (error: any) {
    log("❌", `Error collect_fees: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.slice(-10).forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }

  // ========================================================================
  logSection(`STEP 2/3: EXECUTE BUY (${isAmm ? 'AMM' : 'BONDING CURVE'})`);
  // ========================================================================

  // Derive PDAs based on pool type
  const swapProgram = isAmm ? PUMPSWAP_PROGRAM : PUMP_PROGRAM;

  const [pumpGlobalConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    swapProgram
  );

  const protocolFeeRecipient = new PublicKey("6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs");
  const protocolFeeRecipientAta = await getAssociatedTokenAddress(tokenMint, protocolFeeRecipient, true, TOKEN_PROGRAM);

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

  try {
    // Create protocol fee recipient ATA if it doesn't exist
    const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
      admin.publicKey,
      protocolFeeRecipientAta,
      protocolFeeRecipient,
      tokenMint,
      TOKEN_PROGRAM
    );

    if (isAmm) {
      // =====================================================
      // AMM ROUTE: execute_buy_amm with WSOL
      // =====================================================
      log("📈", "Using PumpSwap AMM buy route", colors.cyan);

      // Get WSOL balance for the buy
      let wsolBalance = BigInt(0);
      try {
        const wsolAccount = await getAccount(connection, datWsolAccount);
        wsolBalance = wsolAccount.amount;
        log("💰", `WSOL available for buy: ${(Number(wsolBalance) / 1e9).toFixed(6)} WSOL`, colors.cyan);
      } catch {
        log("❌", "No WSOL available for AMM buy!", colors.red);
        process.exit(1);
      }

      if (wsolBalance < BigInt(10_000_000)) { // < 0.01 WSOL
        log("❌", "Insufficient WSOL for AMM buy (< 0.01 WSOL)", colors.red);
        process.exit(1);
      }

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
      // Use 95% of WSOL to account for price impact and fees
      const maxSolCost = Number(wsolBalance) * 0.95;
      const desiredTokens = maxSolCost * 1_000_000; // Rough estimate: 1 SOL = 1M tokens (slippage will adjust)

      const tx2 = await program.methods
        .executeBuyAmm(
          new BN(Math.floor(desiredTokens)), // desired_tokens
          new BN(Math.floor(maxSolCost))     // max_sol_cost
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
        .preInstructions([createAtaIx])
        .signers([admin])
        .rpc();

      log("✅", "Tokens bought on AMM with WSOL!", colors.green);
      log("🔗", `TX: ${getExplorerUrl(tx2, networkConfig.name)}`, colors.cyan);

    } else {
      // =====================================================
      // BONDING CURVE ROUTE: execute_buy with native SOL
      // =====================================================
      log("📈", "Using Bonding Curve buy route", colors.cyan);

      const tx2 = await program.methods
        .executeBuy(null) // allocated_lamports = null (use balance)
        .accounts({
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
          creatorVault,
          pumpEventAuthority,
          pumpSwapProgram: swapProgram,
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

      log("✅", "Tokens bought on Bonding Curve!", colors.green);
      log("🔗", `TX: ${getExplorerUrl(tx2, networkConfig.name)}`, colors.cyan);
    }

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
    log("🔗", `TX: ${getExplorerUrl(tx3, networkConfig.name)}`, colors.cyan);

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
