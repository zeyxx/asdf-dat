import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  LAMPORTS_PER_SOL,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";

// Configuration
const PROGRAM_ID = new PublicKey("ASDFznSwUWikqQMNE1Y7qqskDDkbE74GXZdUe6wu4UCz");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const PUMP_SWAP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

const DAT_STATE_SEED = Buffer.from("dat_v3");
const DAT_AUTHORITY_SEED = Buffer.from("auth_v3");

const NUM_TEST_WALLETS = 3;
const SOL_PER_WALLET = 2; // 2 SOL par wallet pour les tests
const SOL_PER_TRADE = 0.5; // 0.5 SOL par trade

// Couleurs pour les logs
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

function log(emoji: string, message: string, color = colors.reset) {
  console.log(`${color}${emoji} ${message}${colors.reset}`);
}

function logSection(title: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`${colors.bright}${colors.cyan}${title}${colors.reset}`);
  console.log(`${"=".repeat(60)}\n`);
}

// Charger l'IDL
function loadIdl(): any {
  const possiblePaths = [
    "target/idl/asdf_dat.json",
    "../target/idl/asdf_dat.json",
    "./target/idl/asdf_dat.json",
    path.join(__dirname, "../target/idl/asdf_dat.json"),
  ];

  for (const idlPath of possiblePaths) {
    try {
      if (fs.existsSync(idlPath)) {
        const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
        return idl;
      }
    } catch (error) {
      continue;
    }
  }

  throw new Error("❌ IDL non trouvé. Exécutez: anchor build");
}

// Airdrop SOL sur devnet
async function airdropSol(connection: Connection, publicKey: PublicKey, amount: number) {
  try {
    const signature = await connection.requestAirdrop(publicKey, amount * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(signature);
    return true;
  } catch (error) {
    return false;
  }
}

// Créer ou charger les wallets de test
async function setupTestWallets(connection: Connection): Promise<Keypair[]> {
  logSection("PHASE 1: SETUP DES WALLETS DE TEST");

  const wallets: Keypair[] = [];
  const walletsDir = "./test-wallets";

  if (!fs.existsSync(walletsDir)) {
    fs.mkdirSync(walletsDir);
  }

  for (let i = 0; i < NUM_TEST_WALLETS; i++) {
    const walletPath = `${walletsDir}/test-wallet-${i}.json`;
    let wallet: Keypair;

    if (fs.existsSync(walletPath)) {
      wallet = Keypair.fromSecretKey(
        new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
      );
      log("♻️", `Wallet ${i + 1} chargé: ${wallet.publicKey.toString()}`, colors.yellow);
    } else {
      wallet = Keypair.generate();
      fs.writeFileSync(walletPath, JSON.stringify(Array.from(wallet.secretKey)));
      log("✨", `Wallet ${i + 1} créé: ${wallet.publicKey.toString()}`, colors.green);
    }

    // Vérifier le balance et airdrop si nécessaire
    const balance = await connection.getBalance(wallet.publicKey);
    if (balance < SOL_PER_WALLET * LAMPORTS_PER_SOL) {
      log("💰", `Airdrop de ${SOL_PER_WALLET} SOL vers wallet ${i + 1}...`, colors.cyan);
      const success = await airdropSol(connection, wallet.publicKey, SOL_PER_WALLET);
      if (success) {
        log("✅", `Airdrop réussi pour wallet ${i + 1}`, colors.green);
      } else {
        log("⚠️", `Airdrop échoué, balance: ${balance / LAMPORTS_PER_SOL} SOL`, colors.yellow);
      }
      // Attendre un peu pour ne pas spam le faucet
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } else {
      log("✅", `Wallet ${i + 1} a déjà ${(balance / LAMPORTS_PER_SOL).toFixed(2)} SOL`, colors.green);
    }

    wallets.push(wallet);
  }

  return wallets;
}

// Simuler des trades pour générer des fees
async function simulateTrading(
  connection: Connection,
  wallets: Keypair[],
  tokenMint: PublicKey,
  bondingCurve: PublicKey
) {
  logSection("PHASE 2: SIMULATION DE TRADING");

  log("📊", `Nombre de wallets: ${wallets.length}`, colors.cyan);
  log("🎯", `Token: ${tokenMint.toString()}`, colors.cyan);
  log("📈", `Bonding Curve: ${bondingCurve.toString()}`, colors.cyan);

  // Vérifier le vault avant trading
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("coin-creator-vault-authority"), bondingCurve.toBuffer()],
    PUMP_SWAP_PROGRAM
  );
  const creatorVault = await getAssociatedTokenAddress(WSOL_MINT, vaultAuthority, true);

  let initialVaultBalance = 0;
  try {
    const vaultAccount = await getAccount(connection, creatorVault);
    initialVaultBalance = Number(vaultAccount.amount);
    log("💼", `Creator Vault balance initial: ${initialVaultBalance / LAMPORTS_PER_SOL} SOL`, colors.yellow);
  } catch (error) {
    log("⚠️", "Creator Vault non initialisé ou vide", colors.yellow);
  }

  // Simuler des achats avec chaque wallet
  log("\n🔄", "Simulation d'achats pour générer des fees...\n", colors.bright);

  const pumpSwapIdl = {
    version: "0.1.0",
    name: "pump_swap",
    instructions: [
      {
        name: "buy",
        accounts: [
          { name: "global", isMut: false, isSigner: false },
          { name: "feeRecipient", isMut: true, isSigner: false },
          { name: "mint", isMut: true, isSigner: false },
          { name: "bondingCurve", isMut: true, isSigner: false },
          { name: "associatedBondingCurve", isMut: true, isSigner: false },
          { name: "associatedUser", isMut: true, isSigner: false },
          { name: "user", isMut: true, isSigner: true },
          { name: "systemProgram", isMut: false, isSigner: false },
          { name: "tokenProgram", isMut: false, isSigner: false },
          { name: "rent", isMut: false, isSigner: false },
          { name: "eventAuthority", isMut: false, isSigner: false },
          { name: "program", isMut: false, isSigner: false },
        ],
        args: [
          { name: "amount", type: "u64" },
          { name: "maxSolCost", type: "u64" },
        ],
      },
    ],
  };

  let totalTrades = 0;
  let successfulTrades = 0;

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];

    try {
      const provider = new AnchorProvider(
        connection,
        new Wallet(wallet),
        { commitment: "confirmed" }
      );

      const program = new Program(pumpSwapIdl, provider);

      // Créer l'ATA du user si nécessaire
      const userTokenAccount = await getAssociatedTokenAddress(tokenMint, wallet.publicKey);

      let needsAta = false;
      try {
        await getAccount(connection, userTokenAccount);
      } catch {
        needsAta = true;
      }

      if (needsAta) {
        log("🔧", `Création de l'ATA pour wallet ${i + 1}...`, colors.cyan);
        const tx = new Transaction().add(
          createAssociatedTokenAccountInstruction(
            wallet.publicKey,
            userTokenAccount,
            wallet.publicKey,
            tokenMint
          )
        );
        await sendAndConfirmTransaction(connection, tx, [wallet]);
      }

      // Dériver les comptes nécessaires
      const [global] = PublicKey.findProgramAddressSync(
        [Buffer.from("global")],
        PUMP_SWAP_PROGRAM
      );

      const [eventAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("__event_authority")],
        PUMP_SWAP_PROGRAM
      );

      const bondingCurveTokenAccount = await getAssociatedTokenAddress(
        tokenMint,
        bondingCurve,
        true
      );

      const feeRecipient = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM");

      // Calculer le montant de tokens à acheter (approximatif)
      const tokenAmount = 1000000; // 1M tokens (ajustez selon le supply)
      const maxSolCost = SOL_PER_TRADE * LAMPORTS_PER_SOL;

      log("🛒", `Wallet ${i + 1} achète ~${tokenAmount / 1e6}M tokens...`, colors.blue);

      totalTrades++;

      try {
        await program.methods
          .buy(new anchor.BN(tokenAmount), new anchor.BN(maxSolCost))
          .accounts({
            global,
            feeRecipient,
            mint: tokenMint,
            bondingCurve,
            associatedBondingCurve: bondingCurveTokenAccount,
            associatedUser: userTokenAccount,
            user: wallet.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
            eventAuthority,
            program: PUMP_SWAP_PROGRAM,
          })
          .rpc();

        successfulTrades++;
        log("✅", `Trade ${i + 1} réussi`, colors.green);
      } catch (error: any) {
        log("❌", `Trade ${i + 1} échoué: ${error.message.slice(0, 80)}`, colors.red);
      }

      // Attendre un peu entre les trades
      await new Promise((resolve) => setTimeout(resolve, 1000));

    } catch (error: any) {
      log("❌", `Erreur setup wallet ${i + 1}: ${error.message.slice(0, 80)}`, colors.red);
    }
  }

  // Vérifier le vault après trading
  log("\n📊", "Vérification des fees accumulées...", colors.cyan);

  try {
    const vaultAccount = await getAccount(connection, creatorVault);
    const finalVaultBalance = Number(vaultAccount.amount);
    const feesGenerated = finalVaultBalance - initialVaultBalance;

    log("💼", `Creator Vault balance final: ${finalVaultBalance / LAMPORTS_PER_SOL} SOL`, colors.yellow);
    log("💰", `Fees générées: ${feesGenerated / LAMPORTS_PER_SOL} SOL`, colors.green);
    log("📈", `Trades réussis: ${successfulTrades}/${totalTrades}`, colors.cyan);

    if (feesGenerated < 0.01 * LAMPORTS_PER_SOL) {
      log("⚠️", "Pas assez de fees pour déclencher un cycle (min: 0.01 SOL)", colors.yellow);
      log("💡", "Le test va continuer, mais collect_fees échouera probablement", colors.yellow);
    }

    return feesGenerated;
  } catch (error) {
    log("❌", "Impossible de lire le Creator Vault", colors.red);
    return 0;
  }
}

// Exécuter le cycle DAT complet
async function executeDATCycle(
  connection: Connection,
  program: Program,
  admin: Keypair,
  tokenMint: PublicKey,
  bondingCurve: PublicKey,
  datState: PublicKey,
  datAuthority: PublicKey
) {
  logSection("PHASE 3: EXÉCUTION DU CYCLE DAT");

  // === ÉTAPE 1: Collect Fees ===
  log("💰", "Étape 1/3: Collecte des fees...", colors.bright);

  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("coin-creator-vault-authority"), bondingCurve.toBuffer()],
    PUMP_SWAP_PROGRAM
  );

  const creatorVaultAta = await getAssociatedTokenAddress(WSOL_MINT, vaultAuthority, true);
  const datWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, datAuthority, true);

  const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_SWAP_PROGRAM
  );

  try {
    const tx = await program.methods
      .collectFees()
      .accounts({
        datState,
        datAuthority,
        pool: bondingCurve,
        wsolMint: WSOL_MINT,
        coinCreatorVaultAuthority: vaultAuthority,
        creatorVaultAta,
        datWsolAccount,
        pumpEventAuthority,
        pumpSwapProgram: PUMP_SWAP_PROGRAM,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    log("✅", `Fees collectées | TX: ${tx.slice(0, 20)}...`, colors.green);

    // Vérifier le balance du DAT WSOL account
    const datWsolInfo = await getAccount(connection, datWsolAccount);
    log("💼", `DAT WSOL balance: ${Number(datWsolInfo.amount) / LAMPORTS_PER_SOL} SOL`, colors.cyan);
  } catch (error: any) {
    log("❌", `Collecte échouée: ${error.message.slice(0, 100)}`, colors.red);
    if (error.message.includes("InsufficientFees")) {
      log("💡", "Pas assez de fees dans le vault (min: 0.01 SOL)", colors.yellow);
    }
    throw error;
  }

  // === ÉTAPE 2: Execute Buy ===
  log("\n🛒", "Étape 2/3: Achat de tokens...", colors.bright);

  const datTokenAccount = await getAssociatedTokenAddress(tokenMint, datAuthority, true);
  const poolTokenAccount = await getAssociatedTokenAddress(tokenMint, bondingCurve, true);
  const poolWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, bondingCurve, true);

  const [pumpGlobalConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    PUMP_SWAP_PROGRAM
  );

  const protocolFeeRecipient = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM");
  const protocolFeeRecipientAta = await getAssociatedTokenAddress(WSOL_MINT, protocolFeeRecipient, true);

  try {
    const tx = await program.methods
      .executeBuy()
      .accounts({
        datState,
        datAuthority,
        datWsolAccount,
        datAsdfAccount: datTokenAccount,
        pool: bondingCurve,
        asdfMint: tokenMint,
        wsolMint: WSOL_MINT,
        poolAsdfAccount: poolTokenAccount,
        poolWsolAccount,
        pumpGlobalConfig,
        protocolFeeRecipient,
        protocolFeeRecipientAta,
        pumpEventAuthority,
        pumpSwapProgram: PUMP_SWAP_PROGRAM,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    log("✅", `Tokens achetés | TX: ${tx.slice(0, 20)}...`, colors.green);

    // Vérifier le balance de tokens
    const datTokenInfo = await getAccount(connection, datTokenAccount);
    log("🪙", `DAT token balance: ${Number(datTokenInfo.amount) / 1e6} tokens`, colors.cyan);
  } catch (error: any) {
    log("❌", `Achat échoué: ${error.message.slice(0, 100)}`, colors.red);
    throw error;
  }

  // === ÉTAPE 3: Burn ===
  log("\n🔥", "Étape 3/3: Burn des tokens...", colors.bright);

  try {
    const tx = await program.methods
      .burnAndUpdate()
      .accounts({
        datState,
        datAuthority,
        datAsdfAccount: datTokenAccount,
        asdfMint: tokenMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    log("✅", `Tokens brûlés | TX: ${tx.slice(0, 20)}...`, colors.green);
  } catch (error: any) {
    log("❌", `Burn échoué: ${error.message.slice(0, 100)}`, colors.red);
    throw error;
  }

  log("\n🎉", "Cycle DAT complété avec succès!", colors.bright + colors.green);
}

// Afficher les statistiques finales
async function displayStats(connection: Connection, program: Program, datState: PublicKey) {
  logSection("PHASE 4: STATISTIQUES FINALES");

  try {
    // Fetch using connection directly to avoid Anchor type issues
    const accountInfo = await connection.getAccountInfo(datState);
    if (!accountInfo) {
      log("❌", "DAT State account non trouvé", colors.red);
      return;
    }

    // Decode the account data manually
    const data = accountInfo.data;

    // Parse the state (skip 8-byte discriminator)
    const isActive = data[328] === 1;
    const emergencyPause = data[329] === 1;

    // Pour simplifier, affichons juste l'info basique
    const state = {
      isActive,
      emergencyPause,
      admin: new PublicKey(data.slice(8, 40)),
      totalBurned: Number(data.readBigUInt64LE(168)),
      totalSolCollected: Number(data.readBigUInt64LE(176)),
      totalBuybacks: data.readUInt32LE(184),
      failedCycles: data.readUInt32LE(188),
      consecutiveFailures: data[192],
      lastCycleBurned: Number(data.readBigUInt64LE(224)),
      lastCycleSol: Number(data.readBigUInt64LE(216)),
      lastCycleTimestamp: Number(data.readBigInt64LE(200)),
      minFeesThreshold: Number(data.readBigUInt64LE(232)),
      maxFeesPerCycle: Number(data.readBigUInt64LE(240)),
      slippageBps: data.readUInt16LE(248),
      minCycleInterval: Number(data.readBigInt64LE(250)),
    };

    console.log(`${colors.cyan}╔════════════════════════════════════════════════╗`);
    console.log(`║          📊 STATISTIQUES DU PROTOCOLE          ║`);
    console.log(`╚════════════════════════════════════════════════╝${colors.reset}\n`);

    console.log(`${colors.bright}État du Protocole:${colors.reset}`);
    console.log(`  ✅ Actif: ${state.isActive}`);
    console.log(`  🚨 Pause d'urgence: ${state.emergencyPause}`);
    console.log(`  👤 Admin: ${state.admin.toString()}\n`);

    console.log(`${colors.bright}Statistiques Globales:${colors.reset}`);
    console.log(`  🔥 Total brûlé: ${(Number(state.totalBurned) / 1e6).toFixed(2)} tokens`);
    console.log(`  💰 Total SOL collecté: ${(Number(state.totalSolCollected) / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    console.log(`  🔄 Total de cycles: ${state.totalBuybacks}`);
    console.log(`  ❌ Cycles échoués: ${state.failedCycles}`);
    console.log(`  ⚠️  Échecs consécutifs: ${state.consecutiveFailures}\n`);

    console.log(`${colors.bright}Dernier Cycle:${colors.reset}`);
    console.log(`  🪙 Tokens brûlés: ${(Number(state.lastCycleBurned) / 1e6).toFixed(2)}`);
    console.log(`  💵 SOL utilisé: ${(Number(state.lastCycleSol) / LAMPORTS_PER_SOL).toFixed(4)}`);
    console.log(`  ⏰ Timestamp: ${new Date(Number(state.lastCycleTimestamp) * 1000).toISOString()}\n`);

    console.log(`${colors.bright}Paramètres:${colors.reset}`);
    console.log(`  📊 Seuil min fees: ${(Number(state.minFeesThreshold) / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    console.log(`  📈 Max fees par cycle: ${(Number(state.maxFeesPerCycle) / LAMPORTS_PER_SOL).toFixed(2)} SOL`);
    console.log(`  🎯 Slippage: ${state.slippageBps / 100}%`);
    console.log(`  ⏱️  Intervalle min: ${state.minCycleInterval}s\n`);

  } catch (error: any) {
    log("❌", `Erreur lors de la lecture des stats: ${error.message}`, colors.red);
  }
}

// Main
async function main() {
  console.clear();
  console.log(`${colors.bright}${colors.magenta}`);
  console.log(`╔══════════════════════════════════════════════════════════╗`);
  console.log(`║                                                          ║`);
  console.log(`║     🧪 TEST END-TO-END - PROTOCOLE ASDF DAT DEVNET      ║`);
  console.log(`║                                                          ║`);
  console.log(`╚══════════════════════════════════════════════════════════╝`);
  console.log(colors.reset);

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Charger le wallet admin
  const adminPath = "./devnet-wallet.json";
  if (!fs.existsSync(adminPath)) {
    log("❌", "Wallet admin non trouvé: devnet-wallet.json", colors.red);
    process.exit(1);
  }

  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(adminPath, "utf-8")))
  );

  log("👤", `Admin: ${admin.publicKey.toString()}`, colors.cyan);

  // Charger la config
  const configPath = "./devnet-config.json";
  if (!fs.existsSync(configPath)) {
    log("❌", "Config non trouvée. Exécutez d'abord: npm run ts-node scripts/devnet-init-v3.ts", colors.red);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const datState = new PublicKey(config.datState);
  const datAuthority = new PublicKey(config.datAuthority);

  log("📦", `DAT State: ${datState.toString()}`, colors.cyan);
  log("🔑", `DAT Authority: ${datAuthority.toString()}`, colors.cyan);

  // Charger les infos du token
  const tokenInfoPath = "./devnet-token-info.json";
  if (!fs.existsSync(tokenInfoPath)) {
    log("❌", "Token info non trouvé. Exécutez d'abord: npm run ts-node scripts/create-token-final.ts", colors.red);
    process.exit(1);
  }

  const tokenInfo = JSON.parse(fs.readFileSync(tokenInfoPath, "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);

  log("🪙", `Token Mint: ${tokenMint.toString()}`, colors.cyan);
  log("📈", `Bonding Curve: ${bondingCurve.toString()}`, colors.cyan);

  // Setup provider et programme
  const provider = new AnchorProvider(
    connection,
    new Wallet(admin),
    { commitment: "confirmed" }
  );

  const idl = loadIdl();
  const program = new Program(idl, provider);

  log("✅", "Programme chargé", colors.green);

  try {
    // Phase 1: Setup wallets
    const testWallets = await setupTestWallets(connection);

    // Phase 2: Simuler du trading
    const feesGenerated = await simulateTrading(connection, testWallets, tokenMint, bondingCurve);

    if (feesGenerated === 0) {
      log("⚠️", "Aucune fee générée - le test va s'arrêter ici", colors.yellow);
      log("💡", "Vérifiez que le bonding curve est actif et que les wallets ont du SOL", colors.yellow);
      return;
    }

    // Attendre un peu avant le cycle DAT
    log("\n⏳", "Attente de 5 secondes avant le cycle DAT...", colors.yellow);
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Phase 3: Exécuter le cycle DAT
    await executeDATCycle(
      connection,
      program,
      admin,
      tokenMint,
      bondingCurve,
      datState,
      datAuthority
    );

    // Phase 4: Afficher les stats
    await displayStats(connection, program, datState);

    logSection("✅ TEST TERMINÉ AVEC SUCCÈS!");

  } catch (error: any) {
    logSection("❌ ERREUR PENDANT LE TEST");
    console.error(`${colors.red}${error.message}${colors.reset}`);

    if (error.logs) {
      console.log("\n📋 Logs de transaction:");
      error.logs.forEach((log: string) => console.log(`   ${log}`));
    }

    process.exit(1);
  }
}

// Gestion des erreurs
process.on("unhandledRejection", (error: any) => {
  console.error(`\n${colors.red}❌ Erreur non gérée: ${error?.message || error}${colors.reset}`);
  process.exit(1);
});

process.on("SIGINT", () => {
  console.log(`\n\n${colors.yellow}👋 Test interrompu par l'utilisateur${colors.reset}`);
  process.exit(0);
});

main().catch((error) => {
  console.error(`${colors.red}❌ Erreur fatale: ${error}${colors.reset}`);
  process.exit(1);
});
