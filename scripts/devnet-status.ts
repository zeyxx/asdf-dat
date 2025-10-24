import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AsdfDat } from "../target/types/asdf_dat";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";

/**
 * Script de monitoring pour devnet
 * Affiche l'état actuel du protocole DAT
 */
async function getStatus() {
  console.log("📊 ASDF DAT Protocol Status (Devnet)\n");

  // Configuration
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AsdfDat as Program<AsdfDat>;

  console.log("Program ID:", program.programId.toString());
  console.log("RPC Endpoint:", provider.connection.rpcEndpoint);
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

  try {
    // Récupérer l'état
    const state = await program.account.datState.fetch(datState);

    console.log("================================");
    console.log("PROTOCOL STATE");
    console.log("================================");
    console.log();

    console.log("📍 Addresses:");
    console.log("  DAT State:", datState.toString());
    console.log("  DAT Authority:", datAuthority.toString());
    console.log("  Admin:", state.admin.toString());
    console.log();

    console.log("🎯 Configuration:");
    console.log("  ASDF Mint:", state.asdfMint.toString());
    console.log("  WSOL Mint:", state.wsolMint.toString());
    console.log("  Pool Address:", state.poolAddress.toString());
    console.log("  PumpSwap Program:", state.pumpSwapProgram.toString());
    console.log();

    console.log("📊 Status:");
    console.log("  Is Active:", state.isActive ? "✅ Yes" : "❌ No");
    console.log("  Emergency Pause:", state.emergencyPause ? "⚠️  Yes" : "✅ No");
    console.log();

    console.log("📈 Metrics:");
    console.log("  Total Burned:", state.totalBurned.toString(), "tokens");
    console.log("  Total SOL Collected:", (state.totalSolCollected.toNumber() / 1e9).toFixed(4), "SOL");
    console.log("  Total Buybacks:", state.totalBuybacks);
    console.log("  Failed Cycles:", state.failedCycles);
    console.log("  Consecutive Failures:", state.consecutiveFailures);
    console.log();

    console.log("⏱️  Timing:");
    const lastCycle = state.lastCycleTimestamp.toNumber();
    if (lastCycle > 0) {
      const lastCycleDate = new Date(lastCycle * 1000);
      const now = new Date();
      const timeSince = Math.floor((now.getTime() - lastCycleDate.getTime()) / 1000);
      console.log("  Last Cycle:", lastCycleDate.toLocaleString());
      console.log("  Time Since Last:", formatDuration(timeSince));
    } else {
      console.log("  Last Cycle: Never executed");
    }

    const initialized = new Date(state.initializedAt.toNumber() * 1000);
    console.log("  Initialized At:", initialized.toLocaleString());

    const lastAM = state.lastAmExecution.toNumber();
    const lastPM = state.lastPmExecution.toNumber();
    if (lastAM > 0) {
      console.log("  Last AM Execution:", new Date(lastAM * 1000).toLocaleString());
    }
    if (lastPM > 0) {
      console.log("  Last PM Execution:", new Date(lastPM * 1000).toLocaleString());
    }
    console.log();

    console.log("⚙️  Parameters:");
    console.log("  Min Fees Threshold:", (state.minFeesThreshold.toNumber() / 1e9).toFixed(4), "SOL");
    console.log("  Max Fees Per Cycle:", (state.maxFeesPerCycle.toNumber() / 1e9).toFixed(2), "SOL");
    console.log("  Slippage BPS:", state.slippageBps, `(${state.slippageBps / 100}%)`);
    console.log("  Min Cycle Interval:", state.minCycleInterval, "seconds", `(${formatDuration(state.minCycleInterval.toNumber())})`);
    console.log();

    console.log("💰 Last Cycle:");
    if (state.totalBuybacks > 0) {
      console.log("  SOL Used:", (state.lastCycleSol.toNumber() / 1e9).toFixed(4), "SOL");
      console.log("  Tokens Burned:", state.lastCycleBurned.toString());
      if (state.lastCycleSol.toNumber() > 0) {
        const rate = state.lastCycleBurned.toNumber() / (state.lastCycleSol.toNumber() / 1e9);
        console.log("  Rate:", rate.toFixed(0), "tokens per SOL");
      }
    } else {
      console.log("  No cycles executed yet");
    }
    console.log();

    // Vérifier les token accounts
    console.log("================================");
    console.log("TOKEN ACCOUNTS");
    console.log("================================");
    console.log();

    try {
      const wsolATA = await getAssociatedTokenAddress(
        state.wsolMint,
        datAuthority,
        true
      );

      const asdfATA = await getAssociatedTokenAddress(
        state.asdfMint,
        datAuthority,
        true
      );

      console.log("DAT Authority Token Accounts:");

      // WSOL account
      try {
        const wsolAccount = await provider.connection.getTokenAccountBalance(wsolATA);
        console.log("  WSOL:", wsolATA.toString());
        console.log("    Balance:", (parseInt(wsolAccount.value.amount) / 1e9).toFixed(4), "SOL");
      } catch (e) {
        console.log("  WSOL:", wsolATA.toString(), "(not created)");
      }

      // ASDF account
      try {
        const asdfAccount = await provider.connection.getTokenAccountBalance(asdfATA);
        console.log("  ASDF:", asdfATA.toString());
        console.log("    Balance:", asdfAccount.value.amount, "tokens");
      } catch (e) {
        console.log("  ASDF:", asdfATA.toString(), "(not created)");
      }

      console.log();
    } catch (error: any) {
      console.log("⚠️  Could not fetch token accounts");
      console.log();
    }

    // Next cycle eligibility
    console.log("================================");
    console.log("NEXT CYCLE ELIGIBILITY");
    console.log("================================");
    console.log();

    const now = Math.floor(Date.now() / 1000);
    const timeSinceLastCycle = now - lastCycle;
    const canExecute = timeSinceLastCycle >= state.minCycleInterval.toNumber();

    if (lastCycle === 0) {
      console.log("✅ Ready to execute first cycle");
    } else if (canExecute) {
      console.log("✅ Eligible for next cycle");
      console.log("  Time since last:", formatDuration(timeSinceLastCycle));
    } else {
      const timeRemaining = state.minCycleInterval.toNumber() - timeSinceLastCycle;
      console.log("⏳ Must wait before next cycle");
      console.log("  Time remaining:", formatDuration(timeRemaining));
    }

    if (!state.isActive) {
      console.log("❌ Protocol is not active");
    }
    if (state.emergencyPause) {
      console.log("⚠️  Emergency pause is enabled");
    }
    console.log();

    // Explorer links
    console.log("================================");
    console.log("EXPLORER LINKS");
    console.log("================================");
    console.log();
    console.log("Program:", `https://explorer.solana.com/address/${program.programId}?cluster=devnet`);
    console.log("DAT State:", `https://explorer.solana.com/address/${datState}?cluster=devnet`);
    console.log("DAT Authority:", `https://explorer.solana.com/address/${datAuthority}?cluster=devnet`);
    console.log();

  } catch (error: any) {
    console.error("❌ Error fetching protocol state:");

    if (error.message?.includes("Account does not exist")) {
      console.log("\n⚠️  Protocol has not been initialized yet.");
      console.log("   Run: ts-node scripts/devnet-init.ts");
    } else {
      console.error(error);
    }
  }
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  } else if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  } else {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    return `${days}d ${hours}h`;
  }
}

// Exécuter
getStatus()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
