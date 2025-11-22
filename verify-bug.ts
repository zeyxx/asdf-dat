import { PublicKey } from "@solana/web3.js";

console.log("=== ROOT CAUSE IDENTIFIED ===\n");

const RUST_PUMP_SWAP_BYTES = [137, 221, 191, 187, 100, 187, 237, 209, 53, 51, 235, 147, 50, 161, 103, 19, 141, 17, 201, 24, 105, 206, 44, 209, 166, 60, 161, 222, 94, 203, 251, 230];
const rustPumpSwap = new PublicKey(new Uint8Array(RUST_PUMP_SWAP_BYTES));

const CORRECT_PUMP_SWAP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const PUMPSWAP_PROGRAM_AMM = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");

console.log("Rust PUMP_SWAP_PROGRAM constant (lines 15-16):", rustPumpSwap.toString());
console.log("Mystery account from error:                   ", "AHAyHjZ8pwTFSuL1j2z1vKwS6G9NiX5JC2yHTPiisra9");
console.log("Match? ", rustPumpSwap.toString() === "AHAyHjZ8pwTFSuL1j2z1vKwS6G9NiX5JC2yHTPiisra9");

console.log("\n=== THE BUG ===");
console.log("✗ Rust PUMP_SWAP_PROGRAM (WRONG):", rustPumpSwap.toString());
console.log("✓ Correct PUMP_PROGRAM:          ", CORRECT_PUMP_SWAP.toString());
console.log("✓ Correct PUMPSWAP (AMM):        ", PUMPSWAP_PROGRAM_AMM.toString());

console.log("\n=== ANALYSIS ===");
console.log("The Rust code has PUMP_SWAP_PROGRAM and PUMP_PROGRAM");
console.log("using the SAME byte array (lines 15-16)!");
console.log("Both resolve to:", rustPumpSwap.toString());
console.log("\nThis address doesn't exist on devnet, causing the error:");
console.log("'Instruction references an unknown account'");

console.log("\n=== FIX REQUIRED ===");
console.log("Line 15 should use:", PUMPSWAP_PROGRAM_AMM.toString(), "(pAMMBay...)");
console.log("OR line 15 should use:", CORRECT_PUMP_SWAP.toString(), "(6EF8r...)");
console.log("\nThe correct bytes for pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA:");
console.log(Array.from(PUMPSWAP_PROGRAM_AMM.toBytes()));
