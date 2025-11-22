import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {  
  getAssociatedTokenAddress,
  NATIVE_MINT,
  createSyncNativeInstruction,
} from "@solana/spl-token";
import fs from "fs";

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("./devnet-wallet.json", "utf-8")))
  );

  const tokenInfo = JSON.parse(fs.readFileSync("devnet-token-info.json", "utf-8"));
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);

  const poolWsolAccount = await getAssociatedTokenAddress(NATIVE_MINT, bondingCurve, true);

  console.log("Funding Pool WSOL Account:", poolWsolAccount.toString());
  console.log("Amount: 0.5 SOL");

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: admin.publicKey,
      toPubkey: poolWsolAccount,
      lamports: 0.5 * 1e9,
    }),
    createSyncNativeInstruction(poolWsolAccount)
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [admin]);
  console.log("✅ Funded! TX:", sig);
}

main();
