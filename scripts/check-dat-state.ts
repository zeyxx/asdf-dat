import { Connection, PublicKey } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui");

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const [datState] = PublicKey.findProgramAddressSync(
    [Buffer.from("dat_v3")],
    PROGRAM_ID
  );

  console.log("Program ID:", PROGRAM_ID.toString());
  console.log("DAT State PDA:", datState.toString());

  const accountInfo = await connection.getAccountInfo(datState);
  if (accountInfo) {
    console.log("Account exists, data length:", accountInfo.data.length);
    const adminBytes = accountInfo.data.slice(8, 40);
    const admin = new PublicKey(adminBytes);
    console.log("Admin:", admin.toString());
  } else {
    console.log("DAT State not initialized");
  }
}

main().catch(console.error);
