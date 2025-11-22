import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const MPL_TOKEN_METADATA = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const DAT_AUTHORITY = new PublicKey("6r5gW93qREotZ9gThTV7SAcekCRaBrua6e1YSxirfNDs");

// Mint généré pour le test
const mint = new PublicKey("8PXtTiMxGehD771Sq6Te6m4FiL2xo1HLuLU7WAFVWaWk");

console.log("\n=== DÉRIVATION DES PDAs POUR CREATE ===\n");

// 1. mint-authority PDA
const [mintAuthority1, bump1] = PublicKey.findProgramAddressSync(
  [Buffer.from("mint-authority")],
  PUMP_PROGRAM
);

console.log("1. mint-authority PDA:");
console.log("   Derivé:", mintAuthority1.toString());
console.log("   Seed: 'mint-authority'");
console.log("   Bump:", bump1);

// 2. bonding-curve PDA
const [bondingCurve, bump2] = PublicKey.findProgramAddressSync(
  [Buffer.from("bonding-curve"), mint.toBuffer()],
  PUMP_PROGRAM
);

console.log("\n2. bonding-curve PDA:");
console.log("   Derivé:", bondingCurve.toString());
console.log("   Seeds: ['bonding-curve', mint]");
console.log("   Bump:", bump2);

// 3. associated-bonding-curve (ATA)
const [associatedBondingCurve, bump3] = PublicKey.findProgramAddressSync(
  [
    bondingCurve.toBuffer(),
    TOKEN_PROGRAM_ID.toBuffer(),
    mint.toBuffer(),
  ],
  ASSOCIATED_TOKEN_PROGRAM_ID
);

console.log("\n3. associated-bonding-curve (ATA):");
console.log("   Derivé:", associatedBondingCurve.toString());
console.log("   Seeds: [bondingCurve, TOKEN_PROGRAM_ID, mint]");
console.log("   Program: ASSOCIATED_TOKEN_PROGRAM_ID");

// 4. global PDA
const [global, bump4] = PublicKey.findProgramAddressSync(
  [Buffer.from("global")],
  PUMP_PROGRAM
);

console.log("\n4. global PDA:");
console.log("   Derivé:", global.toString());
console.log("   Seed: 'global'");

// 5. metadata PDA
const [metadata, bump5] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("metadata"),
    MPL_TOKEN_METADATA.toBuffer(),
    mint.toBuffer(),
  ],
  MPL_TOKEN_METADATA
);

console.log("\n5. metadata PDA:");
console.log("   Derivé:", metadata.toString());
console.log("   Seeds: ['metadata', MPL_TOKEN_METADATA, mint]");
console.log("   Program: MPL_TOKEN_METADATA");

// 6. event-authority PDA
const [eventAuthority, bump6] = PublicKey.findProgramAddressSync(
  [Buffer.from("__event_authority")],
  PUMP_PROGRAM
);

console.log("\n6. event-authority PDA:");
console.log("   Derivé:", eventAuthority.toString());
console.log("   Seed: '__event_authority'");

console.log("\n=== ORDRE DES COMPTES (selon IDL) ===\n");
console.log("1.  mint (writable, signer)");
console.log("2.  mintAuthority (PDA)");
console.log("3.  bondingCurve (writable, PDA)");
console.log("4.  associatedBondingCurve (writable, PDA/ATA)");
console.log("5.  global (PDA)");
console.log("6.  mplTokenMetadata (program)");
console.log("7.  metadata (writable, PDA)");
console.log("8.  user (writable, signer) <-- DAT Authority dans notre cas");
console.log("9.  systemProgram");
console.log("10. tokenProgram");
console.log("11. associatedTokenProgram");
console.log("12. rent");
console.log("13. eventAuthority (PDA)");
console.log("14. program (self-reference)");

console.log("\n=== VÉRIFICATION ===\n");
console.log("Mint testé:", mint.toString());
console.log("DAT Authority (user):", DAT_AUTHORITY.toString());
console.log("mintAuthority dérivé:", mintAuthority1.toString());
console.log("\nAdresse 'unknown' dans l'erreur: AHAyHjZ8pwTFSuL1j2z1vKwS6G9NiX5JC2yHTPiisra9");
console.log("Match avec mintAuthority?", mintAuthority1.toString() === "AHAyHjZ8pwTFSuL1j2z1vKwS6G9NiX5JC2yHTPiisra9");
