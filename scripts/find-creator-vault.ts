import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";

const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const TOKEN_MINT = new PublicKey("3Xai2JhK9spvyTAbDbVBpXTDNdY13VJwmRh2Bs8PExQx");
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");

async function findCreatorVault() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), TOKEN_MINT.toBuffer()],
    PUMP_PROGRAM
  );

  const bondingCurveData = await connection.getAccountInfo(bondingCurve);
  if (!bondingCurveData) throw new Error("Bonding curve not found");
  
  const creator = new PublicKey(bondingCurveData.data.slice(41, 73));

  const [creatorVaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), creator.toBuffer()],
    PUMP_PROGRAM
  );

  const creatorVault = await getAssociatedTokenAddress(WSOL, creatorVaultAuthority, true);

  console.log("📍 Adresses:\n");
  console.log("Bonding Curve:", bondingCurve.toString());
  console.log("Creator:", creator.toString());
  console.log("Creator Vault Authority:", creatorVaultAuthority.toString());
  console.log("\n💰 Creator Vault (WSOL ATA):", creatorVault.toString());

  const balance = await connection.getTokenAccountBalance(creatorVault).catch(() => null);
  if (balance) {
    console.log("\n📊 Solde actuel:", balance.value.uiAmount, "SOL");
  } else {
    console.log("\n⚠️  Vault pas encore initialisé");
  }

  console.log("\n🔧 Pour envoyer du SOL:");
  console.log(`solana transfer ${creatorVault} 0.5 --url devnet`);
}

findCreatorVault().catch(console.error);
