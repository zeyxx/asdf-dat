import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, Idl, BN } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";
import { getNetworkConfig, printNetworkBanner } from "../lib/network-config";

const PROGRAM_ID = new PublicKey("ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui");

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

  // Configure threshold based on network
  // Mainnet: 0.019 SOL (minimum ~0.015 SOL + safety margin for root token only)
  // Devnet: 0.006 SOL (MIN_FEES_FOR_SPLIT + margin for testing)
  const isMainnet = networkConfig.name === "Mainnet";
  const newMinFees = isMainnet ? 19_000_000 : 6_000_000; // lamports
  const newMinFeesSOL = newMinFees / 1_000_000_000;

  console.log("📝 Updating DAT configuration...\n");
  console.log(`   Network: ${networkConfig.name}`);
  console.log(`   New min_fees_threshold: ${newMinFeesSOL} SOL (${newMinFees.toLocaleString()} lamports)\n`);

  // Rust signature: update_parameters(new_min_fees, new_max_fees, new_slippage_bps, new_min_interval)
  const tx = await program.methods
    .updateParameters(
      new BN(newMinFees), // new_min_fees: min_fees_threshold
      null, // new_max_fees: max_fees_per_cycle
      null, // new_slippage_bps: slippage_bps
      null, // new_min_interval: min_cycle_interval
    )
    .accounts({
      datState,
      admin: admin.publicKey,
    })
    .rpc();

  console.log("✅ Configuration updated!");
  const cluster = isMainnet ? "" : "?cluster=devnet";
  console.log(`🔗 TX: https://explorer.solana.com/tx/${tx}${cluster}`);
  console.log(`\n📊 New min_fees_threshold: ${newMinFeesSOL} SOL (${newMinFees.toLocaleString()} lamports)`);
}

main().catch(console.error);
