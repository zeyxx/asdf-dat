import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { AnchorProvider, Program, Wallet, Idl } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";

const PROGRAM_ID = new PublicKey("ASDFznSwUWikqQMNE1Y7qqskDDkbE74GXZdUe6wu4UCz");
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

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
  console.log(`\n${"=".repeat(60)}`);
  console.log(`${colors.bright}${colors.magenta}${title}${colors.reset}`);
  console.log(`${"=".repeat(60)}\n`);
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
  console.clear();
  logSection("🚀 CRÉATION NOUVEAU TOKEN DAT POUR CYCLE COMPLET");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  log("👤", `Admin: ${admin.publicKey.toString()}`, colors.cyan);

  // Derive PDAs
  const [datState] = PublicKey.findProgramAddressSync(
    [Buffer.from("dat_v3")],
    PROGRAM_ID
  );

  const [datAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("auth_v3")],
    PROGRAM_ID
  );

  log("📦", `DAT State: ${datState.toString()}`, colors.cyan);
  log("🔑", `DAT Authority: ${datAuthority.toString()}`, colors.cyan);

  // Setup provider and program
  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
  });

  const idl = loadIdl();
  const program: Program<Idl> = new Program(idl, provider);

  log("✅", "Programme chargé", colors.green);

  logSection("CRÉATION DU TOKEN");

  const tokenName = "DAT Cycle Test";
  const tokenSymbol = "DATCT";
  const tokenUri = "https://pump.fun/dat-cycle-test";

  log("📝", `Nom: ${tokenName}`, colors.yellow);
  log("📝", `Symbole: ${tokenSymbol}`, colors.yellow);
  log("📝", `URI: ${tokenUri}`, colors.yellow);

  const tokenMintKeypair = Keypair.generate();
  const tokenMint = tokenMintKeypair.publicKey;

  log("🪙", `Token Mint: ${tokenMint.toString()}`, colors.cyan);

  // Derive bonding curve PDA
  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), tokenMint.toBuffer()],
    PUMP_PROGRAM
  );

  // Derive mint authority PDA
  const [mintAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint-authority")],
    PUMP_PROGRAM
  );

  log("📈", `Bonding Curve: ${bondingCurve.toString()}`, colors.cyan);
  log("🔐", `Mint Authority: ${mintAuthority.toString()}`, colors.cyan);

  // Derive other required PDAs
  const [pumpGlobalConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    PUMP_PROGRAM
  );

  const [metadata] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s").toBuffer(),
      tokenMint.toBuffer(),
    ],
    new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")
  );

  const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM
  );

  try {
    const tx = await program.methods
      .createPumpfunToken(tokenName, tokenSymbol, tokenUri)
      .accounts({
        datState,
        datAuthority,
        payer: admin.publicKey,
        mint: tokenMint,
        mintAuthority,
        bondingCurve,
        associatedBondingCurve: await import("@solana/spl-token").then((spl) =>
          spl.getAssociatedTokenAddress(tokenMint, bondingCurve, true)
        ),
        global: pumpGlobalConfig,
        mplTokenMetadata: new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"),
        metadata,
        wsolMint: WSOL_MINT,
        pumpProgram: PUMP_PROGRAM,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: new PublicKey("SysvarRent111111111111111111111111111111111"),
        systemProgram: SystemProgram.programId,
        eventAuthority: pumpEventAuthority,
      })
      .signers([tokenMintKeypair])
      .rpc();

    log("✅", "Token créé avec succès!", colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${tx}?cluster=devnet`, colors.cyan);

    // Save token info
    const tokenInfo = {
      mint: tokenMint.toString(),
      bondingCurve: bondingCurve.toString(),
      creator: datAuthority.toString(),
      name: tokenName,
      symbol: tokenSymbol,
      uri: tokenUri,
      network: "devnet",
      timestamp: new Date().toISOString(),
      transaction: tx,
    };

    fs.writeFileSync("devnet-token-fresh.json", JSON.stringify(tokenInfo, null, 2));

    logSection("✅ TOKEN CRÉÉ AVEC SUCCÈS!");

    log("🪙", `Mint: ${tokenMint.toString()}`, colors.green);
    log("📈", `Bonding Curve: ${bondingCurve.toString()}`, colors.green);
    log("👨‍💼", `Creator (DAT Authority): ${datAuthority.toString()}`, colors.green);
    log("💾", "Info sauvegardée dans: devnet-token-fresh.json", colors.yellow);
  } catch (error: any) {
    log("❌", `Erreur: ${error.message}`, colors.red);
    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.forEach((l: string) => console.log(`   ${l}`));
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`${colors.red}❌ Erreur fatale: ${error.message}${colors.reset}`);
  process.exit(1);
});
