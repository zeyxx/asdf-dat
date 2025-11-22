import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import fs from "fs";

const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const TOKEN_MINT = new PublicKey("3Xai2JhK9spvyTAbDbVBpXTDNdY13VJwmRh2Bs8PExQx");
const BONDING_CURVE = new PublicKey("8D4SySZrzM1AW4rYQg34QFAxdXFa52Lks18Sck24kP9E");
const PUMP_SWAP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

async function setupAccounts() {
  console.log("🔧 Configuration des comptes ATA...\n");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  const config = JSON.parse(fs.readFileSync("devnet-config.json", "utf-8"));
  const datAuthority = new PublicKey(config.datAuthority);

  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("coin-creator-vault-authority"), BONDING_CURVE.toBuffer()],
    PUMP_SWAP_PROGRAM
  );

  const accounts = [
    { name: "DAT WSOL", mint: WSOL_MINT, owner: datAuthority },
    { name: "DAT ASDF", mint: TOKEN_MINT, owner: datAuthority },
    { name: "Creator Vault WSOL", mint: WSOL_MINT, owner: vaultAuthority },
  ];

  const tx = new Transaction();
  let needsCreate = false;

  for (const acc of accounts) {
    const ata = await getAssociatedTokenAddress(acc.mint, acc.owner, true);
    const info = await connection.getAccountInfo(ata);
    
    if (!info) {
      console.log(`❌ ${acc.name}: ${ata.toString()}`);
      tx.add(createAssociatedTokenAccountInstruction(wallet.publicKey, ata, acc.owner, acc.mint));
      needsCreate = true;
    } else {
      console.log(`✅ ${acc.name}: ${ata.toString()}`);
    }
  }

  if (needsCreate) {
    console.log("\n📤 Création des comptes manquants...");
    const sig = await connection.sendTransaction(tx, [wallet]);
    await connection.confirmTransaction(sig);
    console.log(`✅ Signature: ${sig}`);
  } else {
    console.log("\n✅ Tous les comptes existent déjà");
  }
}

setupAccounts().catch(console.error);
