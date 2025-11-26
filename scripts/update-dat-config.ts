import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, Idl, BN } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";
import { getNetworkConfig, printNetworkBanner } from "../lib/network-config";

const PROGRAM_ID = new PublicKey("ASDfNfUHwVGfrg3SV7SQYWhaVxnrCUZyWmMpWJAPu4MZ");

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
  // Parse network argument
  const args = process.argv.slice(2);
  const networkConfig = getNetworkConfig(args);

  printNetworkBanner(networkConfig);

  const connection = new Connection(networkConfig.rpcUrl, "confirmed");

  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(networkConfig.wallet, "utf-8")))
  );

  const [datState] = PublicKey.findProgramAddressSync(
    [Buffer.from("dat_v3")],
    PROGRAM_ID
  );

  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
  });

  const idl = loadIdl();
  const program: Program<Idl> = new Program(idl, provider);

  console.log("📝 Mise à jour de la configuration DAT...\n");

  // Update config to lower min_fees_threshold to 10,000 lamports (0.00001 SOL)
  // Rust signature: update_parameters(new_min_fees, new_max_fees, new_slippage_bps, new_min_interval)
  const tx = await program.methods
    .updateParameters(
      new BN(10000), // new_min_fees: min_fees_threshold (0.00001 SOL)
      null, // new_max_fees: max_fees_per_cycle
      null, // new_slippage_bps: slippage_bps
      null, // new_min_interval: min_cycle_interval
    )
    .accounts({
      datState,
      admin: admin.publicKey,
    })
    .rpc();

  console.log("✅ Configuration mise à jour!");
  const cluster = networkConfig.name === "Mainnet" ? "" : "?cluster=devnet";
  console.log(`🔗 TX: https://explorer.solana.com/tx/${tx}${cluster}`);
  console.log("\n📊 Nouveau min_fees_threshold: 0.00001 SOL (10,000 lamports)");
}

main().catch(console.error);
