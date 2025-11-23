/**
 * Initialize DAT Authority Token Account
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import fs from "fs";

const PROGRAM_ID = new PublicKey("ASDFznSwUWikqQMNE1Y7qqskDDkbE74GXZdUe6wu4UCz");

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const payer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  const tokenInfo = JSON.parse(fs.readFileSync("devnet-token-mayhem.json", "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);

  const [datAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("auth_v3")],
    PROGRAM_ID
  );

  console.log(`DAT Authority: ${datAuthority.toString()}`);
  console.log(`Token Mint: ${tokenMint.toString()}`);

  const datTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    datAuthority,
    true,
    TOKEN_2022_PROGRAM_ID
  );

  console.log(`DAT Token Account: ${datTokenAccount.toString()}`);

  const accountInfo = await connection.getAccountInfo(datTokenAccount);
  if (accountInfo) {
    console.log("✅ Account already exists");
    return;
  }

  const ix = createAssociatedTokenAccountInstruction(
    payer.publicKey,
    datTokenAccount,
    datAuthority,
    tokenMint,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [payer]);

  console.log(`✅ Created DAT Token Account`);
  console.log(`TX: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
}

main().catch(console.error);
