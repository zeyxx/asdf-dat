import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import fs from "fs";

const TOKEN_MINT = new PublicKey("3Xai2JhK9spvyTAbDbVBpXTDNdY13VJwmRh2Bs8PExQx");
const BONDING_CURVE = new PublicKey("8D4SySZrzM1AW4rYQg34QFAxdXFa52Lks18Sck24kP9E");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

async function initPoolAccounts() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  console.log("🔧 Initialisation des pool accounts...\n");

  const poolWsol = await getAssociatedTokenAddress(WSOL_MINT, BONDING_CURVE, true);
  const poolAsdf = await getAssociatedTokenAddress(TOKEN_MINT, BONDING_CURVE, true);

  const tx = new Transaction();
  let needed = false;

  const wsolInfo = await connection.getAccountInfo(poolWsol);
  if (!wsolInfo) {
    console.log(`➕ Pool WSOL: ${poolWsol.toString()}`);
    tx.add(createAssociatedTokenAccountInstruction(wallet.publicKey, poolWsol, BONDING_CURVE, WSOL_MINT));
    needed = true;
  } else {
    console.log(`✅ Pool WSOL existe`);
  }

  const asdfInfo = await connection.getAccountInfo(poolAsdf);
  if (!asdfInfo) {
    console.log(`➕ Pool ASDF: ${poolAsdf.toString()}`);
    tx.add(createAssociatedTokenAccountInstruction(wallet.publicKey, poolAsdf, BONDING_CURVE, TOKEN_MINT));
    needed = true;
  } else {
    console.log(`✅ Pool ASDF existe`);
  }

  if (needed) {
    const sig = await connection.sendTransaction(tx, [wallet]);
    console.log(`\n✅ Signature: ${sig}`);
  } else {
    console.log(`\n✅ Tous les accounts existent`);
  }
}

initPoolAccounts().catch(console.error);
