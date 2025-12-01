import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import fs from "fs";

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const tokenInfo = JSON.parse(fs.readFileSync("devnet-token-info.json", "utf-8"));
  const walletData = JSON.parse(fs.readFileSync("devnet-wallet.json", "utf-8"));

  const tokenMint = new PublicKey(tokenInfo.mint);
  const buyer = PublicKey.default; // We'll derive from wallet
  const buyerPubkey = new PublicKey(
    Buffer.from(
      // Get pubkey from secret key
      await import("@solana/web3.js").then(m => {
        const kp = m.Keypair.fromSecretKey(new Uint8Array(walletData));
        return kp.publicKey.toBuffer();
      })
    )
  );

  console.log("Token Mint:", tokenMint.toString());
  console.log("Buyer:", buyerPubkey.toString());

  const ata = await getAssociatedTokenAddress(tokenMint, buyerPubkey);

  console.log("Buyer Token ATA:", ata.toString());

  try {
    const account = await getAccount(connection, ata);
    console.log("✅ Token balance:", (Number(account.amount) / 1e6).toFixed(2), "tokens");
  } catch (e: any) {
    console.log("❌ ATA not found or error:", e.message);
  }
}

main();
