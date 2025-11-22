import { Connection, PublicKey } from "@solana/web3.js";

const PUMP_SWAP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

async function findGlobalAccount() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  console.log("🔍 Recherche du compte global PumpSwap sur devnet...\n");

  // Tester différentes dérivations possibles
  const seeds = [
    "global",
    "global_config",
    "config",
    "pumpswap_global",
  ];

  for (const seed of seeds) {
    try {
      const [pda, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from(seed)],
        PUMP_SWAP_PROGRAM
      );

      console.log(`Seed "${seed}": ${pda.toString()}`);

      const account = await connection.getAccountInfo(pda);
      if (account) {
        console.log(`  ✅ Compte trouvé! Owner: ${account.owner.toString()}`);
        console.log(`  Data length: ${account.data.length}`);
        console.log(`  Discriminator: ${account.data.slice(0, 8).toString("hex")}`);
      } else {
        console.log(`  ❌ Compte n'existe pas`);
      }
    } catch (e) {
      console.log(`  ❌ Erreur: ${e}`);
    }
    console.log();
  }

  // Vérifier l'adresse hardcodée mainnet
  console.log("\n🔍 Vérification adresse mainnet sur devnet:");
  const mainnetGlobal = new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");
  console.log(`Adresse: ${mainnetGlobal.toString()}`);
  
  const account = await connection.getAccountInfo(mainnetGlobal);
  if (account) {
    console.log(`  ✅ Compte existe sur devnet`);
    console.log(`  Owner: ${account.owner.toString()}`);
    console.log(`  Data length: ${account.data.length}`);
  } else {
    console.log(`  ❌ Compte n'existe PAS sur devnet`);
  }

  // Chercher des comptes du programme PumpSwap
  console.log("\n🔍 Recherche de tous les comptes PumpSwap...");
  try {
    const accounts = await connection.getProgramAccounts(PUMP_SWAP_PROGRAM, {
      filters: [
        {
          dataSize: 32, // Ajuster selon la taille attendue du compte global
        }
      ]
    });

    console.log(`Trouvé ${accounts.length} comptes de taille 32 bytes`);
    accounts.slice(0, 5).forEach(({ pubkey, account }) => {
      console.log(`  ${pubkey.toString()}`);
      console.log(`    Discriminator: ${account.data.slice(0, 8).toString("hex")}`);
    });
  } catch (e) {
    console.log("  Erreur lors de la recherche");
  }
}

findGlobalAccount().catch(console.error);
