import { PublicKey, Connection } from "@solana/web3.js";

const MAYHEM_PROGRAM = new PublicKey("MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e");

const [globalParams] = PublicKey.findProgramAddressSync(
  [Buffer.from("global-params")],
  MAYHEM_PROGRAM
);

const [solVault] = PublicKey.findProgramAddressSync(
  [Buffer.from("sol-vault")],
  MAYHEM_PROGRAM
);

console.log("=== MAYHEM PROGRAM PDAs ===\n");
console.log("global-params PDA:", globalParams.toString());
console.log("sol-vault PDA:", solVault.toString());
console.log("\nUnknown account from error:", "AHAyHjZ8pwTFSuL1j2z1vKwS6G9NiX5JC2yHTPiisra9");
console.log("Match global-params?", globalParams.toString() === "AHAyHjZ8pwTFSuL1j2z1vKwS6G9NiX5JC2yHTPiisra9");
console.log("Match sol-vault?", solVault.toString() === "AHAyHjZ8pwTFSuL1j2z1vKwS6G9NiX5JC2yHTPiisra9");

async function checkAccounts() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  console.log("\n=== CHECKING ACCOUNTS ON DEVNET ===\n");

  try {
    const globalParamsInfo = await connection.getAccountInfo(globalParams);
    console.log("✅ global-params exists:", globalParamsInfo ? "YES" : "NO");
  } catch {
    console.log("❌ global-params: DOES NOT EXIST");
  }

  try {
    const solVaultInfo = await connection.getAccountInfo(solVault);
    console.log("✅ sol-vault exists:", solVaultInfo ? "YES" : "NO");
  } catch {
    console.log("❌ sol-vault: DOES NOT EXIST");
  }
}

checkAccounts();
