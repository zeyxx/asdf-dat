import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AsdfDat } from "../target/types/asdf_dat";
import { PublicKey } from "@solana/web3.js";

/**
 * Script d'initialisation pour devnet
 * Initialise le protocole DAT sur Solana devnet
 */
async function initialize() {
  console.log("🚀 Initializing ASDF DAT Protocol on Devnet...\n");

  // Configuration
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AsdfDat as Program<AsdfDat>;

  console.log("Program ID:", program.programId.toString());
  console.log("Admin/Wallet:", provider.wallet.publicKey.toString());
  console.log("RPC Endpoint:", provider.connection.rpcEndpoint);
  console.log();

  // Dériver les PDAs
  const [datState, stateBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("dat-state")],
    program.programId
  );

  const [datAuthority, authorityBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("dat-authority")],
    program.programId
  );

  console.log("📍 Derived Addresses:");
  console.log("  DAT State PDA:", datState.toString());
  console.log("  DAT State Bump:", stateBump);
  console.log("  DAT Authority PDA:", datAuthority.toString());
  console.log("  DAT Authority Bump:", authorityBump);
  console.log();

  // Vérifier si déjà initialisé
  try {
    const existingState = await program.account.datState.fetch(datState);
    console.log("⚠️  Protocol already initialized!");
    console.log("  Admin:", existingState.admin.toString());
    console.log("  Is Active:", existingState.isActive);
    console.log("  Total Buybacks:", existingState.totalBuybacks);
    console.log();
    console.log("Skipping initialization...");
    return;
  } catch (error) {
    // Pas encore initialisé, continuer
    console.log("✓ Protocol not yet initialized, proceeding...\n");
  }

  // Vérifier le solde
  const balance = await provider.connection.getBalance(provider.wallet.publicKey);
  console.log("💰 Wallet Balance:", balance / 1e9, "SOL");

  if (balance < 0.1 * 1e9) {
    console.error("❌ Insufficient balance! Need at least 0.1 SOL for initialization");
    console.log("   Get devnet SOL: solana airdrop 2");
    return;
  }
  console.log();

  // Initialiser
  try {
    console.log("⏳ Sending initialization transaction...");

    const tx = await program.methods
      .initialize()
      .accounts({
        datState: datState,
        datAuthority: datAuthority,
        admin: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("✅ Initialized successfully!\n");
    console.log("📝 Transaction Details:");
    console.log("  Signature:", tx);
    console.log("  Explorer:", `https://explorer.solana.com/tx/${tx}?cluster=devnet`);
    console.log();

    // Récupérer et afficher l'état initial
    const state = await program.account.datState.fetch(datState);

    console.log("📊 Initial Protocol State:");
    console.log("================================");
    console.log("Admin:", state.admin.toString());
    console.log("ASDF Mint:", state.asdfMint.toString());
    console.log("WSOL Mint:", state.wsolMint.toString());
    console.log("Pool Address:", state.poolAddress.toString());
    console.log("PumpSwap Program:", state.pumpSwapProgram.toString());
    console.log();
    console.log("Status:");
    console.log("  Is Active:", state.isActive);
    console.log("  Emergency Pause:", state.emergencyPause);
    console.log();
    console.log("Metrics:");
    console.log("  Total Burned:", state.totalBurned.toString());
    console.log("  Total SOL Collected:", state.totalSolCollected.toString());
    console.log("  Total Buybacks:", state.totalBuybacks);
    console.log();
    console.log("Parameters:");
    console.log("  Min Fees Threshold:", state.minFeesThreshold.toString(), "lamports");
    console.log("  Max Fees Per Cycle:", state.maxFeesPerCycle.toString(), "lamports");
    console.log("  Slippage BPS:", state.slippageBps);
    console.log("  Min Cycle Interval:", state.minCycleInterval, "seconds");
    console.log();

    console.log("🎯 Next Steps:");
    console.log("================================");
    console.log("1. Transfer coin_creator ownership to DAT Authority on PumpFun:");
    console.log("   DAT Authority:", datAuthority.toString());
    console.log();
    console.log("2. Create token accounts for DAT Authority (will be done automatically)");
    console.log();
    console.log("3. Generate some trading activity to accumulate creator fees");
    console.log();
    console.log("4. Execute a test cycle using:");
    console.log("   ts-node scripts/devnet-execute-cycle.ts");
    console.log();

  } catch (error) {
    console.error("❌ Initialization failed:");
    console.error(error);

    if (error.logs) {
      console.log("\n📋 Program Logs:");
      error.logs.forEach(log => console.log("  ", log));
    }
  }
}

// Exécuter
initialize()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
