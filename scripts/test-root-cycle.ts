/**
 * Minimal test: Exactly replicate what execute-ecosystem-cycle does for root token
 *
 * Usage:
 *   npx ts-node scripts/test-root-cycle.ts --creator <pubkey>
 *   CREATOR=xxx npx ts-node scripts/test-root-cycle.ts
 */
import { Connection, PublicKey, Keypair, Transaction, SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import * as fs from "fs";
import { TokenLoader } from "../src/utils/token-loader";

const PROGRAM_ID = new PublicKey("ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui");
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

// Parse args
function parseArgs(): { creator: string | undefined } {
  const args = process.argv.slice(2);
  let creator: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--creator" || args[i] === "-c") {
      creator = args[++i];
    }
  }

  if (!creator) creator = process.env.CREATOR;
  return { creator };
}

// From execute-ecosystem-cycle.ts
function getBcCreatorVault(creator: PublicKey): PublicKey {
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), creator.toBuffer()],
    PUMP_PROGRAM
  );
  return vault;
}

async function main() {
  const { creator } = parseArgs();

  if (!creator) {
    console.error("Error: Creator pubkey required. Use --creator or set CREATOR env var");
    process.exit(1);
  }

  // Use HELIUS - same as execute-ecosystem-cycle
  const rpcUrl = process.env.HELIUS_DEVNET_RPC || "https://devnet.helius-rpc.com/?api-key=ac94987a-2acd-4778-8759-1bb4708e905b";
  console.log("Using RPC:", rpcUrl.slice(0, 50) + "...");
  const conn = new Connection(rpcUrl, "confirmed");
  const admin = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8"))));

  const provider = new AnchorProvider(conn, new Wallet(admin), { commitment: "confirmed" });
  const idl = JSON.parse(fs.readFileSync("target/idl/asdf_dat.json", "utf-8"));
  idl.address = PROGRAM_ID.toString();
  const program: any = new Program(idl, provider);

  // Load root token from state/API (auto-discovery)
  const creatorPubkey = new PublicKey(creator);
  const loader = new TokenLoader({ connection: conn, creatorPubkey });
  const rootConfig = await loader.getRootToken();

  if (!rootConfig) {
    console.error("Error: Root token not found. Make sure daemon has discovered it.");
    process.exit(1);
  }

  const rootToken = {
    mint: new PublicKey(rootConfig.mint),
    bondingCurve: new PublicKey(rootConfig.bondingCurve),
    creator: new PublicKey(rootConfig.creator),
    symbol: rootConfig.symbol,
  };

  // Derive PDAs - EXACTLY as script does
  const [datState] = PublicKey.findProgramAddressSync([Buffer.from("dat_v3")], PROGRAM_ID);
  const [datAuthority] = PublicKey.findProgramAddressSync([Buffer.from("auth_v3")], PROGRAM_ID);
  const [tokenStats] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_stats_v1"), rootToken.mint.toBuffer()],
    PROGRAM_ID
  );
  const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM
  );

  // Use the token's creator - EXACTLY as script does
  const tokenCreator = rootToken.creator;
  const creatorVault = getBcCreatorVault(tokenCreator);

  const [rootTreasury] = PublicKey.findProgramAddressSync(
    [Buffer.from("root_treasury"), rootToken.mint.toBuffer()],
    PROGRAM_ID
  );

  console.log("=== ACCOUNTS USED ===");
  console.log("datState:", datState.toString());
  console.log("datAuthority:", datAuthority.toString());
  console.log("tokenStats:", tokenStats.toString());
  console.log("tokenMint:", rootToken.mint.toString());
  console.log("creator:", tokenCreator.toString());
  console.log("creatorVault:", creatorVault.toString());
  console.log("pumpEventAuthority:", pumpEventAuthority.toString());
  console.log("rootTreasury:", rootTreasury.toString());
  console.log("");

  // Check vault balance
  const vaultBal = await conn.getBalance(creatorVault);
  console.log("Creator Vault balance:", vaultBal, "lamports");

  // Build EXACTLY as script does (line 2516-2530)
  console.log("");
  console.log("Building collect_fees instruction (is_root=true, for_ecosystem=true)...");

  const collectIx = await program.methods
    .collectFees(true, true) // is_root_token=true, for_ecosystem=true
    .accounts({
      datState,
      tokenStats,
      tokenMint: rootToken.mint,
      datAuthority,
      creatorVault,
      pumpEventAuthority,
      pumpSwapProgram: PUMP_PROGRAM,
      rootTreasury,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  console.log("collectIx accounts count:", collectIx.keys.length);
  console.log("collectIx accounts:");
  collectIx.keys.forEach((k: any, i: number) => {
    console.log("  " + i + ": " + k.pubkey.toString().slice(0,20) + "... signer=" + k.isSigner + " writable=" + k.isWritable);
  });

  // Build transaction with compute budget - EXACTLY as script does
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 500000 }));
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }));
  tx.add(collectIx);

  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.feePayer = admin.publicKey;

  console.log("");
  console.log("Simulating transaction...");

  const simResult = await conn.simulateTransaction(tx);

  if (simResult.value.err) {
    console.log("");
    console.log("❌ SIMULATION FAILED");
    console.log("Error:", JSON.stringify(simResult.value.err));
  } else {
    console.log("");
    console.log("✅ SIMULATION SUCCESS");
  }

  console.log("");
  console.log("Logs:");
  (simResult.value.logs || []).forEach(l => console.log("  ", l));
}

main().catch(console.error);
