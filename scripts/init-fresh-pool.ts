import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddress,
  NATIVE_MINT,
} from "@solana/spl-token";
import fs from "fs";

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const payer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("./devnet-wallet.json", "utf-8")))
  );

  const tokenInfo = JSON.parse(fs.readFileSync("devnet-token-fresh.json", "utf-8"));
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);
  const poolWsolAccount = await getAssociatedTokenAddress(NATIVE_MINT, bondingCurve, true);

  console.log("Creating pool WSOL account:", poolWsolAccount.toString());

  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      poolWsolAccount,
      bondingCurve,
      NATIVE_MINT
    )
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [payer]);
  console.log("✅ Created! TX:", sig);
}

main();
