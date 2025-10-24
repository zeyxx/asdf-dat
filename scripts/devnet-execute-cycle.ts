import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AsdfDat } from "../target/types/asdf_dat";
import { PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from "@solana/spl-token";

/**
 * Script d'exécution de cycle pour devnet
 * Execute un cycle de buyback/burn sur devnet
 */

// IMPORTANT: Remplacez ces valeurs par vos adresses devnet réelles
const DEVNET_CONFIG = {
  ASDF_MINT: new PublicKey("9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump"), // À REMPLACER
  WSOL_MINT: new PublicKey("So11111111111111111111111111111111111111112"),
  POOL_PUMPSWAP: new PublicKey("DuhRX5JTPtsWU5n44t8tcFEfmzy2Eu27p4y6z8Rhf2bb"), // À REMPLACER
  PUMP_SWAP_PROGRAM: new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"), // À REMPLACER
  FEE_PROGRAM: new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"), // À REMPLACER
  PROTOCOL_FEE_RECIPIENT: new PublicKey("62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV"), // Peut utiliser votre wallet
};

async function executeCycle() {
  console.log("🔄 Executing DAT Cycle on Devnet...\n");

  // Configuration
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AsdfDat as Program<AsdfDat>;

  console.log("Program ID:", program.programId.toString());
  console.log("Executor:", provider.wallet.publicKey.toString());
  console.log();

  // Dériver les PDAs
  const [datState] = PublicKey.findProgramAddressSync(
    [Buffer.from("dat-state")],
    program.programId
  );

  const [datAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("dat-authority")],
    program.programId
  );

  // PumpSwap PDAs
  const [pumpGlobalConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_config")],
    DEVNET_CONFIG.PUMP_SWAP_PROGRAM
  );

  const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    DEVNET_CONFIG.PUMP_swap_PROGRAM
  );

  const [coinCreatorVaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator_vault"), datAuthority.toBuffer()],
    DEVNET_CONFIG.PUMP_SWAP_PROGRAM
  );

  const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_volume_accumulator")],
    DEVNET_CONFIG.PUMP_SWAP_PROGRAM
  );

  const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_volume_accumulator"), datAuthority.toBuffer()],
    DEVNET_CONFIG.PUMP_SWAP_PROGRAM
  );

  // Fee config (seed exact from program)
  const feeConfigSeed = Buffer.from([
    12, 20, 222, 252, 130, 94, 198, 118, 148, 37, 8, 24, 187, 101, 64, 101,
    244, 41, 141, 49, 86, 213, 113, 180, 212, 248, 9, 12, 24, 233, 168, 99
  ]);

  const [feeConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("fee_config"), feeConfigSeed],
    DEVNET_CONFIG.FEE_PROGRAM
  );

  // Token accounts
  const datWsolAccount = await getAssociatedTokenAddress(
    DEVNET_CONFIG.WSOL_MINT,
    datAuthority,
    true
  );

  const datAsdfAccount = await getAssociatedTokenAddress(
    DEVNET_CONFIG.ASDF_MINT,
    datAuthority,
    true
  );

  const creatorVaultAta = await getAssociatedTokenAddress(
    DEVNET_CONFIG.WSOL_MINT,
    coinCreatorVaultAuthority,
    true
  );

  const poolAsdfAccount = await getAssociatedTokenAddress(
    DEVNET_CONFIG.ASDF_MINT,
    DEVNET_CONFIG.POOL_PUMPSWAP,
    true
  );

  const poolWsolAccount = await getAssociatedTokenAddress(
    DEVNET_CONFIG.WSOL_MINT,
    DEVNET_CONFIG.POOL_PUMPSWAP,
    true
  );

  const protocolFeeRecipientAta = await getAssociatedTokenAddress(
    DEVNET_CONFIG.WSOL_MINT,
    DEVNET_CONFIG.PROTOCOL_FEE_RECIPIENT,
    true
  );

  console.log("📍 Derived Addresses:");
  console.log("  DAT State:", datState.toString());
  console.log("  DAT Authority:", datAuthority.toString());
  console.log("  Creator Vault Authority:", coinCreatorVaultAuthority.toString());
  console.log();

  try {
    // Vérifier l'état avant exécution
    const stateBefore = await program.account.datState.fetch(datState);

    console.log("📊 State Before Cycle:");
    console.log("  Is Active:", stateBefore.isActive);
    console.log("  Emergency Pause:", stateBefore.emergencyPause);
    console.log("  Total Buybacks:", stateBefore.totalBuybacks);
    console.log("  Total Burned:", stateBefore.totalBurned.toString());
    console.log();

    if (!stateBefore.isActive) {
      console.log("❌ Protocol is not active. Cannot execute cycle.");
      return;
    }

    if (stateBefore.emergencyPause) {
      console.log("❌ Protocol is paused. Cannot execute cycle.");
      return;
    }

    // Vérifier le solde de la creator vault
    try {
      const vaultBalance = await provider.connection.getTokenAccountBalance(creatorVaultAta);
      console.log("💰 Creator Vault Balance:",
        (parseInt(vaultBalance.value.amount) / 1e9).toFixed(4), "SOL");

      if (parseInt(vaultBalance.value.amount) < stateBefore.minFeesThreshold.toNumber()) {
        console.log("⚠️  Insufficient fees in vault.");
        console.log("   Required:", (stateBefore.minFeesThreshold.toNumber() / 1e9).toFixed(4), "SOL");
        console.log("   Available:", (parseInt(vaultBalance.value.amount) / 1e9).toFixed(4), "SOL");
        console.log("\n💡 Generate trading activity on your token to accumulate fees.");
        return;
      }
    } catch (e) {
      console.log("❌ Creator vault account not found.");
      console.log("   Make sure you transferred coin_creator ownership to DAT Authority");
      return;
    }

    // Vérifier l'intervalle minimum
    const now = Math.floor(Date.now() / 1000);
    const timeSince = now - stateBefore.lastCycleTimestamp.toNumber();

    if (stateBefore.lastCycleTimestamp.toNumber() > 0 &&
        timeSince < stateBefore.minCycleInterval.toNumber()) {
      const remaining = stateBefore.minCycleInterval.toNumber() - timeSince;
      console.log("⏳ Must wait before next cycle");
      console.log("   Time remaining:", remaining, "seconds");
      return;
    }

    console.log("✅ All checks passed. Executing cycle...\n");

    // Exécuter le cycle
    console.log("⏳ Sending transaction...");

    const tx = await program.methods
      .executeCycle()
      .accounts({
        datState: datState,
        datAuthority: datAuthority,
        datWsolAccount: datWsolAccount,
        datAsdfAccount: datAsdfAccount,
        creatorVaultAta: creatorVaultAta,
        coinCreatorVaultAuthority: coinCreatorVaultAuthority,
        asdfMint: DEVNET_CONFIG.ASDF_MINT,
        wsolMint: DEVNET_CONFIG.WSOL_MINT,
        pool: DEVNET_CONFIG.POOL_PUMPSWAP,
        poolAsdfAccount: poolAsdfAccount,
        poolWsolAccount: poolWsolAccount,
        pumpGlobalConfig: pumpGlobalConfig,
        pumpEventAuthority: pumpEventAuthority,
        protocolFeeRecipient: DEVNET_CONFIG.PROTOCOL_FEE_RECIPIENT,
        protocolFeeRecipientAta: protocolFeeRecipientAta,
        globalVolumeAccumulator: globalVolumeAccumulator,
        userVolumeAccumulator: userVolumeAccumulator,
        feeConfig: feeConfig,
        feeProgram: DEVNET_CONFIG.FEE_PROGRAM,
        pumpSwapProgram: DEVNET_CONFIG.PUMP_SWAP_PROGRAM,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc({ skipPreflight: false });

    console.log("✅ Cycle executed successfully!\n");

    console.log("📝 Transaction Details:");
    console.log("  Signature:", tx);
    console.log("  Explorer:", `https://explorer.solana.com/tx/${tx}?cluster=devnet`);
    console.log();

    // Récupérer l'état après exécution
    const stateAfter = await program.account.datState.fetch(datState);

    console.log("📊 Cycle Results:");
    console.log("================================");
    console.log("Cycle #:", stateAfter.totalBuybacks);
    console.log();
    console.log("This Cycle:");
    console.log("  SOL Used:", (stateAfter.lastCycleSol.toNumber() / 1e9).toFixed(4), "SOL");
    console.log("  Tokens Burned:", stateAfter.lastCycleBurned.toString());
    if (stateAfter.lastCycleSol.toNumber() > 0) {
      const rate = stateAfter.lastCycleBurned.toNumber() / (stateAfter.lastCycleSol.toNumber() / 1e9);
      console.log("  Rate:", rate.toFixed(0), "tokens per SOL");
    }
    console.log();
    console.log("Cumulative:");
    console.log("  Total Burned:", stateAfter.totalBurned.toString(), "tokens");
    console.log("  Total SOL Used:", (stateAfter.totalSolCollected.toNumber() / 1e9).toFixed(4), "SOL");
    console.log("  Total Cycles:", stateAfter.totalBuybacks);
    console.log();

    console.log("🎉 Success! The protocol is working correctly on devnet.");
    console.log();

  } catch (error: any) {
    console.error("❌ Cycle execution failed:");
    console.error(error);

    if (error.logs) {
      console.log("\n📋 Program Logs:");
      error.logs.forEach(log => console.log("  ", log));
    }

    // Try to record the failure
    try {
      console.log("\n⏳ Recording failure...");
      await program.methods
        .recordFailure(0)
        .accounts({
          datState: datState,
        })
        .rpc();
      console.log("✅ Failure recorded");
    } catch (recordError) {
      console.log("⚠️  Could not record failure");
    }
  }
}

// Exécuter
executeCycle()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
