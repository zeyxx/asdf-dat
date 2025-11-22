import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddress, NATIVE_MINT } from "@solana/spl-token";
import fs from "fs";

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const payer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("./devnet-wallet.json", "utf-8")))
  );

  const feeRecipient = new PublicKey("6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs");
  const feeRecipientAta = await getAssociatedTokenAddress(NATIVE_MINT, feeRecipient, true);

  console.log("Creating fee recipient WSOL ATA:", feeRecipientAta.toString());

  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      feeRecipientAta,
      feeRecipient,
      NATIVE_MINT
    )
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [payer]);
  console.log("✅ Created! TX:", sig);
}

main();
