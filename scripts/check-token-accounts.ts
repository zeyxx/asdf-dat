import { Connection, PublicKey } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const accounts = {
    datWsolAccount: "4cfeYuFsTATuek3o47ZEXD3xpLzWcJGC6e1tiKBnySxw",
    datTokenAccount: "5vy7PiZFap9uqtynDXsfp5MPUJHpHnQcyYDVvnhuZm96",
    poolTokenAccount: "Cg8LQRqxh6eF1k4nPQe6P137vAvDu851AKSHn9UNYMH3",
    poolWsolAccount: "EKoRdwiHej4cx3H6ruUAV1vKW9YVwWs1KawGtHsUGodf",
    protocolFeeRecipientAta: "CGEWR6pxwgQvYKeX4pZDqpZtWYPvyTjiAsw86SNzJtGy",
  };

  for (const [name, address] of Object.entries(accounts)) {
    try {
      const info = await getAccount(connection, new PublicKey(address));
      console.log(`\n${name}:`);
      console.log(`  Address: ${address}`);
      console.log(`  Mint: ${info.mint.toString()}`);
      console.log(`  Owner: ${info.owner.toString()}`);
      console.log(`  Amount: ${info.amount.toString()}`);
    } catch (e: any) {
      console.log(`\n${name}: ERROR - ${e.message}`);
    }
  }

  console.log("\n\nTarget unknown: AHAyHjZ8pwTFSuL1j2z1vKwS6G9NiX5JC2yHTPiisra9");
}

main();
