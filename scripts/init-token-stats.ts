/**
 * Initialize TokenStats PDA and DAT ATA for a token
 *
 * This script prepares a token for DAT cycles by:
 * 1. Creating the TokenStats PDA (tracks burn metrics)
 * 2. Creating the DAT Authority's ATA for this token (receives bought tokens)
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import fs from "fs";
import idl from "../target/idl/asdf_dat.json";
import { getNetworkConfig, printNetworkBanner } from "../src/network/config";

const PROGRAM_ID = new PublicKey("ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui");
const TOKEN_STATS_SEED = Buffer.from("token_stats_v1");
const DAT_AUTHORITY_SEED = Buffer.from("auth_v3");

async function main() {
  // Parse arguments
  const args = process.argv.slice(2);
  const networkConfig = getNetworkConfig(args);

  // Get token file from non-flag args or default
  const tokenFile = args.find(a => !a.startsWith('--')) || networkConfig.tokens[0];

  console.log(`\n${"=".repeat(70)}`);
  console.log(`🔧 INITIALIZE TOKEN STATS`);
  console.log(`${"=".repeat(70)}\n`);

  // Print network banner
  printNetworkBanner(networkConfig);

  console.log(`📄 Token file: ${tokenFile}`);

  const connection = new Connection(networkConfig.rpcUrl, "confirmed");

  const payer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(networkConfig.wallet, "utf-8")))
  );

  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  const program = new Program(idl as any, provider);

  const tokenInfo = JSON.parse(fs.readFileSync(tokenFile, "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);

  console.log(`🪙 Token Mint: ${tokenMint.toString()}`);
  console.log(`📛 Name: ${tokenInfo.name}`);
  console.log(`🏷️  Symbol: ${tokenInfo.symbol}`);

  // Derive TokenStats PDA
  const [tokenStats, bump] = PublicKey.findProgramAddressSync(
    [TOKEN_STATS_SEED, tokenMint.toBuffer()],
    PROGRAM_ID
  );

  // Derive DAT Authority PDA
  const [datAuthority] = PublicKey.findProgramAddressSync(
    [DAT_AUTHORITY_SEED],
    PROGRAM_ID
  );

  // Determine token program
  const tokenProgramId = tokenInfo.tokenProgram === "Token2022"
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;

  // Derive DAT's ATA for this token
  const datAta = getAssociatedTokenAddressSync(
    tokenMint,
    datAuthority,
    true, // allowOwnerOffCurve (PDA owner)
    tokenProgramId
  );

  console.log(`📊 TokenStats PDA: ${tokenStats.toString()}`);
  console.log(`🔢 Bump: ${bump}`);
  console.log(`🔑 DAT Authority: ${datAuthority.toString()}`);
  console.log(`💰 DAT ATA: ${datAta.toString()}`);
  console.log(`🏦 Token Program: ${tokenInfo.tokenProgram || "TokenkegQfe..."}`);

  const cluster = networkConfig.name === "Mainnet" ? "" : "?cluster=devnet";

  // Step 1: Check/Create TokenStats
  const tokenStatsInfo = await connection.getAccountInfo(tokenStats);
  if (tokenStatsInfo) {
    console.log("\n✅ TokenStats already exists");
  } else {
    console.log("\n🔨 Creating TokenStats account...");

    const tx = await program.methods
      .initializeTokenStats()
      .accounts({
        tokenStats,
        mint: tokenMint,
        payer: payer.publicKey,
        systemProgram: PublicKey.default,
      })
      .rpc();

    console.log(`✅ TokenStats initialized!`);
    console.log(`🔗 TX: https://explorer.solana.com/tx/${tx}${cluster}`);
  }

  // Step 2: Check/Create DAT ATA
  const datAtaInfo = await connection.getAccountInfo(datAta);
  if (datAtaInfo) {
    console.log("✅ DAT ATA already exists");
  } else {
    console.log("\n🔨 Creating DAT ATA...");

    const createAtaIx = createAssociatedTokenAccountInstruction(
      payer.publicKey,     // payer
      datAta,              // ata
      datAuthority,        // owner (PDA)
      tokenMint,           // mint
      tokenProgramId
    );

    const tx = new Transaction().add(createAtaIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
      commitment: "confirmed",
    });

    console.log(`✅ DAT ATA created!`);
    console.log(`🔗 TX: https://explorer.solana.com/tx/${sig}${cluster}`);
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`✅ TOKEN READY FOR DAT CYCLES`);
  console.log(`${"=".repeat(70)}`);
  console.log(`📊 TokenStats: ${tokenStats.toString()}`);
  console.log(`💰 DAT ATA: ${datAta.toString()}`);
  console.log(`\n💡 You can now execute cycles for this token`);
}

main().catch((error) => {
  console.error(`\n❌ Error: ${error.message}`);
  if (error.logs) {
    console.log("\n📋 Logs:");
    error.logs.forEach((log: string) => console.log(`   ${log}`));
  }
  process.exit(1);
});
