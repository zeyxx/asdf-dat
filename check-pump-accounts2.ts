import { PublicKey } from "@solana/web3.js";

const PUMP_SWAP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const UNKNOWN = new PublicKey("AHAyHjZ8pwTFSuL1j2z1vKwS6G9NiX5JC2yHTPiisra9");

console.log("=== IDENTIFYING THE MYSTERY ACCOUNT ===\n");

console.log("Is it PUMP_SWAP_PROGRAM itself?");
console.log("PUMP_SWAP_PROGRAM:", PUMP_SWAP_PROGRAM.toString());
console.log("UNKNOWN:", UNKNOWN.toString());
console.log("Match?", PUMP_SWAP_PROGRAM.equals(UNKNOWN));

// Check if the address is a number that could be a different program
console.log("\nChecking if it could be a program constant...");
console.log("Decoded bytes:", UNKNOWN.toBytes());
