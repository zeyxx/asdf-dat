import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AsdfDat } from "../target/types/asdf_dat";
import { PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

/**
 * Script de configuration des token accounts pour devnet
 * Crée tous les ATAs nécessaires pour le DAT Authority
 */

// Configuration - À ADAPTER SELON VOTRE SETUP DEVNET
const DEVNET_CONFIG = {
  ASDF_MINT: new PublicKey("9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump"), // À REMPLACER
  WSOL_MINT: new PublicKey("So11111111111111111111111111111111111111112"),
};

async function setupAccounts() {
  console.log("🔧 Setting up Token Accounts for DAT Authority on Devnet\n");

  // Configuration
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AsdfDat as Program<AsdfDat>;

  console.log("Program ID:", program.programId.toString());
  console.log("Payer:", provider.wallet.publicKey.toString());
  console.log();

  // Dériver DAT Authority PDA
  const [datAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("dat-authority")],
    program.programId
  );

  console.log("📍 DAT Authority PDA:", datAuthority.toString());
  console.log();

  // Calculer les ATAs
  const wsolATA = await getAssociatedTokenAddress(
    DEVNET_CONFIG.WSOL_MINT,
    datAuthority,
    true // allowOwnerOffCurve = true for PDAs
  );

  const asdfATA = await getAssociatedTokenAddress(
    DEVNET_CONFIG.ASDF_MINT,
    datAuthority,
    true
  );

  console.log("📍 Associated Token Accounts:");
  console.log("  WSOL ATA:", wsolATA.toString());
  console.log("  ASDF ATA:", asdfATA.toString());
  console.log();

  // Vérifier et créer les comptes si nécessaire
  const accountsToCreate = [];

  // Vérifier WSOL ATA
  console.log("🔍 Checking WSOL ATA...");
  try {
    const wsolAccount = await provider.connection.getAccountInfo(wsolATA);
    if (wsolAccount) {
      console.log("  ✅ WSOL ATA already exists");
      const balance = await provider.connection.getTokenAccountBalance(wsolATA);
      console.log("     Balance:", (parseInt(balance.value.amount) / 1e9).toFixed(4), "SOL");
    } else {
      console.log("  ⚠️  WSOL ATA does not exist, will create");
      accountsToCreate.push({
        ata: wsolATA,
        mint: DEVNET_CONFIG.WSOL_MINT,
        name: "WSOL"
      });
    }
  } catch (e) {
    console.log("  ⚠️  WSOL ATA does not exist, will create");
    accountsToCreate.push({
      ata: wsolATA,
      mint: DEVNET_CONFIG.WSOL_MINT,
      name: "WSOL"
    });
  }
  console.log();

  // Vérifier ASDF ATA
  console.log("🔍 Checking ASDF ATA...");
  try {
    const asdfAccount = await provider.connection.getAccountInfo(asdfATA);
    if (asdfAccount) {
      console.log("  ✅ ASDF ATA already exists");
      const balance = await provider.connection.getTokenAccountBalance(asdfATA);
      console.log("     Balance:", balance.value.amount, "tokens");
    } else {
      console.log("  ⚠️  ASDF ATA does not exist, will create");
      accountsToCreate.push({
        ata: asdfATA,
        mint: DEVNET_CONFIG.ASDF_MINT,
        name: "ASDF"
      });
    }
  } catch (e) {
    console.log("  ⚠️  ASDF ATA does not exist, will create");
    accountsToCreate.push({
      ata: asdfATA,
      mint: DEVNET_CONFIG.ASDF_MINT,
      name: "ASDF"
    });
  }
  console.log();

  // Créer les comptes manquants
  if (accountsToCreate.length === 0) {
    console.log("✅ All token accounts already exist. Nothing to do!");
    return;
  }

  console.log(`📝 Creating ${accountsToCreate.length} token account(s)...\n`);

  for (const account of accountsToCreate) {
    try {
      console.log(`⏳ Creating ${account.name} ATA...`);

      const ix = createAssociatedTokenAccountInstruction(
        provider.wallet.publicKey, // payer
        account.ata,                // associatedToken
        datAuthority,               // owner (PDA)
        account.mint                // mint
      );

      const tx = new anchor.web3.Transaction().add(ix);

      const signature = await provider.sendAndConfirm(tx);

      console.log(`  ✅ ${account.name} ATA created successfully`);
      console.log(`     Address: ${account.ata.toString()}`);
      console.log(`     Signature: ${signature}`);
      console.log(`     Explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
      console.log();

    } catch (error: any) {
      console.error(`  ❌ Failed to create ${account.name} ATA:`, error);
      console.log();
    }
  }

  // Vérification finale
  console.log("================================");
  console.log("FINAL VERIFICATION");
  console.log("================================\n");

  try {
    const wsolBalance = await provider.connection.getTokenAccountBalance(wsolATA);
    console.log("WSOL ATA:");
    console.log("  Address:", wsolATA.toString());
    console.log("  Balance:", (parseInt(wsolBalance.value.amount) / 1e9).toFixed(4), "SOL");
    console.log("  ✅ Ready");
  } catch (e) {
    console.log("WSOL ATA: ❌ Not found");
  }
  console.log();

  try {
    const asdfBalance = await provider.connection.getTokenAccountBalance(asdfATA);
    console.log("ASDF ATA:");
    console.log("  Address:", asdfATA.toString());
    console.log("  Balance:", asdfBalance.value.amount, "tokens");
    console.log("  ✅ Ready");
  } catch (e) {
    console.log("ASDF ATA: ❌ Not found");
  }
  console.log();

  console.log("🎯 Next Steps:");
  console.log("================================");
  console.log("1. Transfer coin_creator ownership to DAT Authority on PumpFun");
  console.log("   DAT Authority:", datAuthority.toString());
  console.log();
  console.log("2. Generate trading activity to accumulate creator fees");
  console.log();
  console.log("3. Check status: ts-node scripts/devnet-status.ts");
  console.log();
  console.log("4. Execute cycle: ts-node scripts/devnet-execute-cycle.ts");
  console.log();
}

// Exécuter
setupAccounts()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
