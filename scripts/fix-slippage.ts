import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, Idl } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";

const PROGRAM_ID = new PublicKey("ASDFznSwUWikqQMNE1Y7qqskDDkbE74GXZdUe6wu4UCz");

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
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  const provider = new AnchorProvider(connection, new Wallet(admin), { commitment: "confirmed" });
  const idl = loadIdl();
  const program: Program<Idl> = new Program(idl, provider);

  const [datState] = PublicKey.findProgramAddressSync([Buffer.from("dat_v3")], PROGRAM_ID);

  console.log("🔧 Fixing slippage_bps from 10000 to 50 (0.5%)...");

  const tx = await program.methods
    .updateParameters(
      null, // new_min_fees
      null, // new_max_fees
      50,   // new_slippage_bps: 50 = 0.5%
      null  // new_min_interval
    )
    .accounts({
      datState,
      admin: admin.publicKey,
    })
    .rpc();

  console.log("✅ Slippage updated!");
  console.log("TX:", tx);
}

main().catch(console.error);
