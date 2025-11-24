import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { AnchorProvider, Program, Wallet, Idl } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";

const PROGRAM_ID = new PublicKey("ASDfNfUHwVGfrg3SV7SQYWhaVxnrCUZyWmMpWJAPu4MZ");
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const MAYHEM_PROGRAM = new PublicKey("MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e");

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

function log(emoji: string, message: string, color = colors.reset) {
  console.log(`${color}${emoji} ${message}${colors.reset}`);
}

function loadIdl(): any {
  const idlPath = path.join(__dirname, "../target/idl/asdf_dat.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  // Force metadata to have correct program ID
  idl.metadata = { address: PROGRAM_ID.toString() };
  idl.address = PROGRAM_ID.toString();
  return idl;
}

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log(`${colors.bright}${colors.cyan}🔥 CRÉATION TOKEN MAYHEM MODE${colors.reset}`);
  console.log("=".repeat(60) + "\n");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Load admin wallet
  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("./devnet-wallet.json", "utf-8")))
  );

  log("👤", `Admin: ${admin.publicKey.toString()}`, colors.cyan);

  const balance = await connection.getBalance(admin.publicKey);
  log("💰", `Balance: ${(balance / 1e9).toFixed(4)} SOL`, colors.cyan);

  // Setup provider and program
  log("🔄", "Setting up provider...", colors.yellow);
  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
  });

  log("📂", "Loading IDL...", colors.yellow);
  const idl = loadIdl();

  log("🏗️", "Creating program instance...", colors.yellow);
  const program = new Program(idl, provider);

  log("✅", "Program instance created successfully", colors.green);

  // Derive DAT PDAs
  log("🔍", "Deriving DAT PDAs...", colors.yellow);
  const [datState] = PublicKey.findProgramAddressSync(
    [Buffer.from("dat_v3")],
    PROGRAM_ID
  );

  const [datAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("auth_v3")],
    PROGRAM_ID
  );

  log("📦", `DAT State: ${datState.toString()}`, colors.cyan);
  log("🔑", `DAT Authority (Creator): ${datAuthority.toString()}`, colors.cyan);

  log("🔍", "Checking DAT state...", colors.yellow);
  try {
    const state = await (program.account as any).datState.fetch(datState);
    log("✅", `DAT State admin: ${state.admin.toString()}`, colors.green);
    log("✅", `Current wallet: ${admin.publicKey.toString()}`, colors.green);

    if (state.admin.toString() !== admin.publicKey.toString()) {
      log("❌", "ERROR: Current wallet is not the DAT admin!", colors.red);
      log("⚠️", `Admin is: ${state.admin.toString()}`, colors.yellow);
      log("⚠️", `You are: ${admin.publicKey.toString()}`, colors.yellow);
      process.exit(1);
    }
  } catch (e: any) {
    log("❌", `DAT State not found or error: ${e.message}`, colors.red);
    log("⚠️", "Make sure DAT is initialized first!", colors.yellow);
    throw e;
  }

  // Generate mint keypair
  const mint = Keypair.generate();
  log("🪙", `New Mint: ${mint.publicKey.toString()}`, colors.cyan);

  // Derive PumpFun PDAs
  const [mintAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint-authority")],
    PUMP_PROGRAM
  );

  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint.publicKey.toBuffer()],
    PUMP_PROGRAM
  );

  // For Token2022, ATA uses Token2022 program
  const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
    [
      bondingCurve.toBuffer(),
      TOKEN_2022_PROGRAM_ID.toBuffer(),
      mint.publicKey.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const [global] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    PUMP_PROGRAM
  );

  const [eventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM
  );

  // Mayhem-specific PDAs
  const [globalParams] = PublicKey.findProgramAddressSync(
    [Buffer.from("global-params")],
    MAYHEM_PROGRAM
  );

  const [solVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("sol-vault")],
    MAYHEM_PROGRAM
  );

  const [mayhemState] = PublicKey.findProgramAddressSync(
    [Buffer.from("mayhem-state"), mint.publicKey.toBuffer()],
    MAYHEM_PROGRAM
  );

  const [mayhemTokenVault] = PublicKey.findProgramAddressSync(
    [
      solVault.toBuffer(),
      TOKEN_2022_PROGRAM_ID.toBuffer(),
      mint.publicKey.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  log("📈", `Bonding Curve: ${bondingCurve.toString()}`, colors.cyan);
  log("🔥", `Mayhem Mode: ENABLED (Token2022)`, colors.yellow);

  const name = "DAT Mayhem Test";
  const symbol = "DATM";
  const uri = "https://pump.fun/dat-mayhem-test";

  log("📝", `Name: ${name}`, colors.cyan);
  log("🏷️", `Symbol: ${symbol}`, colors.cyan);

  console.log("\n" + "=".repeat(60));
  console.log(`${colors.bright}${colors.yellow}⏳ Création en cours...${colors.reset}`);
  console.log("=".repeat(60) + "\n");

  try {
    // @ts-ignore - Type instantiation depth issue with Anchor types
    const tx = await program.methods
      .createPumpfunTokenMayhem(name, symbol, uri)
      .accounts({
        datState,
        datAuthority,
        admin: admin.publicKey,
        mint: mint.publicKey,
        mintAuthority,
        bondingCurve,
        associatedBondingCurve,
        global,
        systemProgram: SystemProgram.programId,
        token2022Program: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        mayhemProgram: MAYHEM_PROGRAM,
        globalParams,
        solVault,
        mayhemState,
        mayhemTokenVault,
        eventAuthority,
        pumpProgram: PUMP_PROGRAM,
      })
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ])
      .signers([mint])
      .rpc();

    console.log("\n" + "=".repeat(60));
    console.log(`${colors.bright}${colors.green}✅ TOKEN MAYHEM CRÉÉ AVEC SUCCÈS!${colors.reset}`);
    console.log("=".repeat(60) + "\n");

    log("📜", `Signature: ${tx}`, colors.green);
    log("🔗", `Explorer: https://explorer.solana.com/tx/${tx}?cluster=devnet`, colors.cyan);
    log("🎯", `Creator: ${datAuthority.toString()}`, colors.green);
    log("🔥", `Mayhem Mode: AI agent will trade for 24h`, colors.yellow);
    log("💎", `Supply: 2 billion tokens (1B base + 1B for AI agent)`, colors.yellow);

    // Save token info
    const tokenInfo = {
      mint: mint.publicKey.toString(),
      bondingCurve: bondingCurve.toString(),
      creator: datAuthority.toString(),
      name,
      symbol,
      uri,
      mayhemMode: true,
      tokenProgram: "Token2022",
      network: "devnet",
      timestamp: new Date().toISOString(),
      transaction: tx,
    };

    fs.writeFileSync(
      "devnet-token-mayhem.json",
      JSON.stringify(tokenInfo, null, 2)
    );

    log("💾", "Sauvegardé dans: devnet-token-mayhem.json", colors.green);

    console.log("\n" + "=".repeat(60));
    console.log(`${colors.bright}${colors.cyan}📋 PROCHAINES ÉTAPES${colors.reset}`);
    console.log("=".repeat(60) + "\n");

    log("1️⃣", "Attendre 24h que l'AI agent trade (ou faire des trades manuels)", colors.cyan);
    log("2️⃣", "Tester le cycle DAT complet", colors.cyan);
    log("📝", "Copier les infos dans devnet-token-info.json", colors.yellow);
    log("📝", "npx ts-node tests/scripts/test-dat-cycle.ts", colors.yellow);

  } catch (error: any) {
    console.log("\n" + "=".repeat(60));
    console.log(`${colors.bright}${colors.red}❌ ERREUR${colors.reset}`);
    console.log("=".repeat(60) + "\n");

    log("❌", `Erreur: ${error.message}`, colors.red);

    if (error.logs) {
      console.log("\n📋 Logs de transaction:");
      error.logs.forEach((l: string) => console.log(`   ${l}`));
    }

    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`${colors.red}❌ Erreur fatale: ${error.message}${colors.reset}`);
  process.exit(1);
});
