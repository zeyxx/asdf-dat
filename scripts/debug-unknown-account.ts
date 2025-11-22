import { PublicKey } from "@solana/web3.js";

const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const MAYHEM_PROGRAM = new PublicKey("MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e");

console.log("=== TRYING DIFFERENT PDA DERIVATIONS ===\n");

// Try mint-authority (our current derivation)
const [mintAuth1] = PublicKey.findProgramAddressSync(
  [Buffer.from("mint-authority")],
  PUMP_PROGRAM
);
console.log("1. mint-authority (PUMP):", mintAuth1.toString());

// Try global-params (mayhem)
const [globalParams] = PublicKey.findProgramAddressSync(
  [Buffer.from("global-params")],
  MAYHEM_PROGRAM
);
console.log("2. global-params (MAYHEM):", globalParams.toString());

// Maybe it's derived from MAYHEM not PUMP?
const [mintAuth2] = PublicKey.findProgramAddressSync(
  [Buffer.from("mint-authority")],
  MAYHEM_PROGRAM
);
console.log("3. mint-authority (MAYHEM):", mintAuth2.toString());

console.log("\nUnknown:", "AHAyHjZ8pwTFSuL1j2z1vKwS6G9NiX5JC2yHTPiisra9");
console.log("\nMatches:");
console.log("- mint-authority (PUMP)?", mintAuth1.toString() === "AHAyHjZ8pwTFSuL1j2z1vKwS6G9NiX5JC2yHTPiisra9");
console.log("- global-params (MAYHEM)?", globalParams.toString() === "AHAyHjZ8pwTFSuL1j2z1vKwS6G9NiX5JC2yHTPiisra9");
console.log("- mint-authority (MAYHEM)?", mintAuth2.toString() === "AHAyHjZ8pwTFSuL1j2z1vKwS6G9NiX5JC2yHTPiisra9");
