import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import fs from "fs";

const TOKEN_MINT = new PublicKey("3Xai2JhK9spvyTAbDbVBpXTDNdY13VJwmRh2Bs8PExQx");
const BONDING_CURVE = new PublicKey("8D4SySZrzM1AW4rYQg34QFAxdXFa52Lks18Sck24kP9E");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const PUMP_SWAP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const PROTOCOL_FEE_RECIPIENT = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM");

async function initAll() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8")))
  );

  const config = JSON.parse(fs.readFileSync("devnet-config.json", "utf-8"));
  const datAuthority = new PublicKey(config.datAuthority);

  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("coin-creator-vault-authority"), BONDING_CURVE.toBuffer()],
    PUMP_SWAP
  );

  const accounts = [
    { name: "Pool WSOL", mint: WSOL_MINT, owner: BONDING_CURVE },
    { name: "Pool ASDF", mint: TOKEN_MINT, owner: BONDING_CURVE },
    { name: "Protocol Fee WSOL", mint: WSOL_MINT, owner: PROTOCOL_FEE_RECIPIENT },
    { name: "DAT WSOL", mint: WSOL_MINT, owner: datAuthority },
    { name: "DAT ASDF", mint: TOKEN_MINT, owner: datAuthority },
    { name: "Creator Vault WSOL", mint: WSOL_MINT, owner: vaultAuthority },
  ];

  console.log("🔧 Initialisation de tous les comptes...\n");

  const tx = new Transaction();
  let count = 0;

  for (const acc of accounts) {
    const ata = await getAssociatedTokenAddress(acc.mint, acc.owner, true);
    const info = await connection.getAccountInfo(ata);
    
    if (!info) {
      console.log(`➕ ${acc.name}`);
      tx.add(createAssociatedTokenAccountInstruction(wallet.publicKey, ata, acc.owner, acc.mint));
      count++;
    } else {
      console.log(`✅ ${acc.name}`);
    }
  }

  if (count > 0) {
    console.log(`\n📤 Création de ${count} comptes...`);
    const sig = await connection.sendTransaction(tx, [wallet]);
    console.log(`✅ Signature: ${sig}`);
  } else {
    console.log(`\n✅ Tous les comptes existent`);
  }
}

initAll().catch(console.error);
