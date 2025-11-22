import { PublicKey } from "@solana/web3.js";

const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const PUMPSWAP_PROGRAM = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
const UNKNOWN = "AHAyHjZ8pwTFSuL1j2z1vKwS6G9NiX5JC2yHTPiisra9";

console.log("=== CHECKING PDA DERIVATIONS ===\n");

// Check event_authority for PUMP_PROGRAM
const [eventAuth1] = PublicKey.findProgramAddressSync(
  [Buffer.from("__event_authority")],
  PUMP_PROGRAM
);
console.log("event_authority (PUMP_PROGRAM):", eventAuth1.toString());
console.log("Match?", eventAuth1.toString() === UNKNOWN);

// Check event_authority for PUMPSWAP_PROGRAM
const [eventAuth2] = PublicKey.findProgramAddressSync(
  [Buffer.from("__event_authority")],
  PUMPSWAP_PROGRAM
);
console.log("\nevent_authority (PUMPSWAP_PROGRAM):", eventAuth2.toString());
console.log("Match?", eventAuth2.toString() === UNKNOWN);
