import { 
  Connection, 
  Keypair, 
  PublicKey, 
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction
} from "@solana/web3.js";
import * as borsh from "borsh";
import fs from "fs";

// Schéma Borsh pour l'instruction Initialize (discriminator uniquement)
class InitializeInstruction {
  instruction = 0; // discriminator pour initialize
  
  constructor() {}
}

const initializeSchema = new Map([
  [InitializeInstruction, { kind: 'struct', fields: [] }]
]);

async function main() {
  // Configuration
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  // Charger le wallet
  const walletPath = "./target/deploy/asdf_dat-keypair.json";
  const walletKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  
  // Program ID déployé
  const programId = new PublicKey("GbzSATFmbZEZ2SPQsHsRaQCBw9fFxSDWWUN1CW45o1hV");
  
  console.log("🔑 Wallet:", walletKeypair.publicKey.toBase58());
  console.log("📋 Program ID:", programId.toBase58());
  console.log("🌐 Network: devnet");

  // Dériver les PDAs
  const [datState, datStateBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("dat_state")],
    programId
  );
  
  const [datAuthority, datAuthorityBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("dat_authority")],
    programId
  );

  console.log("\n📍 PDAs:");
  console.log("   DAT State:", datState.toBase58());
  console.log("   DAT Authority:", datAuthority.toBase58());
  console.log("   (← Utilisez cette adresse comme CREATOR du token!)");

  // Vérifier le solde
  const balance = await connection.getBalance(walletKeypair.publicKey);
  console.log("\n💰 Solde wallet:", balance / 1e9, "SOL");
  
  if (balance < 0.1e9) {
    console.log("⚠️  Solde faible! Faites un airdrop:");
    console.log("   solana airdrop 2 --url devnet");
  }

  // Vérifier si déjà initialisé
  const accountInfo = await connection.getAccountInfo(datState);
  if (accountInfo) {
    console.log("\n✅ Programme DÉJÀ initialisé!");
    console.log("   Account exists with", accountInfo.data.length, "bytes");
  } else {
    console.log("\n📝 Initialisation du programme...");

    // Calculer le discriminator pour "global:initialize"
    // Anchor utilise les 8 premiers bytes du sha256 de "global:initialize"
    const crypto = await import('crypto');
    const discriminator = crypto
      .createHash('sha256')
      .update('global:initialize')
      .digest()
      .slice(0, 8);

    console.log("   Discriminator:", discriminator.toString('hex'));

    // Créer l'instruction
    const instruction = new TransactionInstruction({
      programId: programId,
      keys: [
        { pubkey: datState, isSigner: false, isWritable: true },
        { pubkey: datAuthority, isSigner: false, isWritable: false },
        { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: discriminator, // Just the discriminator, no other data needed
    });

    // Créer et envoyer la transaction
    const transaction = new Transaction().add(instruction);
    
    try {
      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [walletKeypair],
        { commitment: 'confirmed' }
      );
      
      console.log("✅ Programme initialisé!");
      console.log("📜 Signature:", signature);
      console.log("🔗 Explorer:", `https://explorer.solana.com/tx/${signature}?cluster=devnet`);
    } catch (error: any) {
      console.error("❌ Erreur lors de l'initialisation:", error.message);
      if (error.logs) {
        console.log("\n📋 Logs:");
        error.logs.forEach((log: string) => console.log("   ", log));
      }
      throw error;
    }
  }

  // Sauvegarder les infos
  const deploymentInfo = {
    programId: programId.toBase58(),
    datState: datState.toBase58(),
    datAuthority: datAuthority.toBase58(),
    datStateBump: datStateBump,
    datAuthorityBump: datAuthorityBump,
    admin: walletKeypair.publicKey.toBase58(),
    network: "devnet",
    deployedAt: new Date().toISOString(),
    instructions: {
      step1: "✅ Programme initialisé",
      step2: "Créer un token PumpFun sur devnet",
      step3: "Utiliser comme CREATOR: " + datAuthority.toBase58(),
      step4: "Les fees iront au creator vault du programme!",
    }
  };

  fs.writeFileSync("devnet-dat-deployment.json", JSON.stringify(deploymentInfo, null, 2));
  console.log("\n💾 Infos sauvegardées dans: devnet-dat-deployment.json");
  
  console.log("\n" + "=".repeat(60));
  console.log("🎯 PROCHAINE ÉTAPE: Créer le token PumpFun");
  console.log("=".repeat(60));
  console.log("\n📋 Utilisez cette adresse comme CREATOR:");
  console.log("   ", datAuthority.toBase58());
  console.log("\n💡 Le creator vault recevra automatiquement les trading fees!");
  console.log("   Le programme DAT pourra ensuite faire buyback & burn\n");
}

main()
  .then(() => {
    console.log("✅ Terminé!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Erreur:", error);
    process.exit(1);
  });
