import {
  Connection,
  PublicKey,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";

const PUMPSWAP_PROGRAM = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const DAT_AUTHORITY_SEED = "auth_v3";
const PROGRAM_ID = new PublicKey("ASDFznSwUWikqQMNE1Y7qqskDDkbE74GXZdUe6wu4UCz");

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const [datAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from(DAT_AUTHORITY_SEED)],
    PROGRAM_ID
  );

  console.log("DAT Authority:", datAuthority.toString());

  console.log("\n=== Testing Vault Derivations ===\n");

  const [vault1] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator_vault"), datAuthority.toBuffer()],
    PUMPSWAP_PROGRAM
  );
  console.log("1. creator_vault (PUMPSWAP):", vault1.toString());

  const [vault2] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), datAuthority.toBuffer()],
    PUMP_PROGRAM
  );
  console.log("2. creator-vault (PUMP):", vault2.toString());

  const ata1 = await getAssociatedTokenAddress(WSOL_MINT, vault1, true);
  const ata2 = await getAssociatedTokenAddress(WSOL_MINT, vault2, true);

  console.log("\n=== Checking Balances ===\n");

  try {
    const account1 = await getAccount(connection, ata1);
    const bal1 = Number(account1.amount) / 1e9;
    console.log("Vault 1 ATA exists:", bal1, "SOL");
  } catch {
    console.log("Vault 1 ATA doesn't exist");
  }

  try {
    const account2 = await getAccount(connection, ata2);
    const bal2 = Number(account2.amount) / 1e9;
    console.log("Vault 2 ATA exists:", bal2, "SOL");
  } catch {
    console.log("Vault 2 ATA doesn't exist");
  }

  const datBalance = await connection.getBalance(datAuthority);
  console.log("\nDAT Authority wallet:", datBalance / 1e9, "SOL");
}

main().catch(console.error);
