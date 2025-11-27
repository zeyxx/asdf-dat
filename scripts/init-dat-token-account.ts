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
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import fs from "fs";

const PROGRAM_ID = new PublicKey("ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui");

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const payer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  const tokenFile = process.argv[2] || "devnet-token-mayhem.json";
  const tokenInfo = JSON.parse(fs.readFileSync(tokenFile, "utf-8"));
  const tokenMint = new PublicKey(tokenInfo.mint);
  const isMayhem = tokenInfo.tokenProgram === "Token2022";

  const [datAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("auth_v3")],
    PROGRAM_ID
  );

  const TOKEN_PROGRAM = isMayhem ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

  console.log(`DAT Authority: ${datAuthority.toString()}`);
  console.log(`Token Mint: ${tokenMint.toString()}`);
  console.log(`Token Program: ${isMayhem ? "Token2022" : "SPL"}`);

  const datTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    datAuthority,
    true,
    TOKEN_PROGRAM
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
    TOKEN_PROGRAM,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [payer]);

  console.log(`✅ Created DAT Token Account`);
  console.log(`TX: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
}

main().catch(console.error);
