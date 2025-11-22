import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, NATIVE_MINT } from "@solana/spl-token";

const PUMP_SWAP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const protocolFeeRecipient = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM");
const tokenCreator = new PublicKey("9UopfvYqxhzg7zLwe6YmTkZuGzVq98J2tNyenKfWeUjj");

async function main() {
  const [pumpGlobalConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    PUMP_SWAP_PROGRAM
  );
  console.log("pumpGlobalConfig:", pumpGlobalConfig.toString());

  const protocolFeeRecipientAta = await getAssociatedTokenAddress(NATIVE_MINT, protocolFeeRecipient, true);
  console.log("protocolFeeRecipientAta:", protocolFeeRecipientAta.toString());

  const [creatorVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), tokenCreator.toBuffer()],
    PUMP_SWAP_PROGRAM
  );
  console.log("creatorVault:", creatorVault.toString());

  const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_SWAP_PROGRAM
  );
  console.log("pumpEventAuthority:", pumpEventAuthority.toString());

  console.log("\nTarget unknown account: AHAyHjZ8pwTFSuL1j2z1vKwS6G9NiX5JC2yHTPiisra9");
}

main();
