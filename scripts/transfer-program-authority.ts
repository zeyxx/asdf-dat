import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import fs from "fs";

const PROGRAM_ID = new PublicKey("ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui");
const BPF_LOADER_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("TRANSFERT D'AUTORITÉ DU PROGRAMME");
  console.log("=".repeat(70) + "\n");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Load wallets
  const oldWalletPath = "./devnet-wallet-old.json";
  const newWalletPath = "./devnet-wallet.json";

  if (!fs.existsSync(oldWalletPath) || !fs.existsSync(newWalletPath)) {
    console.log("Wallets not found!");
    process.exit(1);
  }

  const oldAuthority = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(oldWalletPath, "utf-8")))
  );
  const newAuthority = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(newWalletPath, "utf-8")))
  );

  console.log(`Old Authority: ${oldAuthority.publicKey.toString()}`);
  console.log(`New Authority: ${newAuthority.publicKey.toString()}`);

  // Get program data address
  const [programDataAddress] = PublicKey.findProgramAddressSync(
    [PROGRAM_ID.toBuffer()],
    BPF_LOADER_UPGRADEABLE
  );

  console.log(`\nProgram: ${PROGRAM_ID.toString()}`);
  console.log(`Program Data: ${programDataAddress.toString()}`);

  // Build SetUpgradeAuthority instruction data
  const instructionData = Buffer.alloc(37);
  instructionData.writeUInt32LE(4, 0); // SetAuthority = 4
  instructionData.writeUInt8(1, 4); // Option::Some
  newAuthority.publicKey.toBuffer().copy(instructionData, 5);

  const setAuthorityIx = {
    programId: BPF_LOADER_UPGRADEABLE,
    keys: [
      { pubkey: programDataAddress, isSigner: false, isWritable: true },
      { pubkey: oldAuthority.publicKey, isSigner: true, isWritable: false },
      { pubkey: newAuthority.publicKey, isSigner: true, isWritable: false },
    ],
    data: instructionData,
  };

  const tx = new Transaction().add(setAuthorityIx);
  tx.feePayer = oldAuthority.publicKey;

  console.log("\nSending transaction...");

  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      tx,
      [oldAuthority, newAuthority],
      { commitment: "confirmed" }
    );

    console.log("\n" + "=".repeat(70));
    console.log("TRANSFERT RÉUSSI!");
    console.log("=".repeat(70));
    console.log(`\nSignature: ${signature}`);
    console.log(`Explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
    console.log(`\nNouvelle autorité: ${newAuthority.publicKey.toString()}`);
  } catch (error: any) {
    console.error("\nErreur:", error.message);
    if (error.logs) {
      console.log("\nLogs:");
      error.logs.forEach((l: string) => console.log(`  ${l}`));
    }
    process.exit(1);
  }
}

main().catch(console.error);
