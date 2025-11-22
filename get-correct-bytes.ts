import { PublicKey } from "@solana/web3.js";

console.log("=== CORRECT BYTE ARRAYS FOR RUST ===\n");

const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const PUMPSWAP_PROGRAM = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");

console.log("PUMP_PROGRAM (6EF8r...):");
console.log("pub const PUMP_PROGRAM: Pubkey = Pubkey::new_from_array([");
const pumpBytes = Array.from(PUMP_PROGRAM.toBytes());
for (let i = 0; i < pumpBytes.length; i += 8) {
  const chunk = pumpBytes.slice(i, i + 8).join(', ');
  console.log(`    ${chunk},`);
}
console.log("]);");

console.log("\nPUMPSWAP_PROGRAM (pAMMBay...):");
console.log("pub const PUMPSWAP_PROGRAM: Pubkey = Pubkey::new_from_array([");
const swapBytes = Array.from(PUMPSWAP_PROGRAM.toBytes());
for (let i = 0; i < swapBytes.length; i += 8) {
  const chunk = swapBytes.slice(i, i + 8).join(', ');
  console.log(`    ${chunk},`);
}
console.log("]);");

console.log("\n=== WHERE THEY ARE USED ===");
console.log("PUMP_PROGRAM (6EF8r...):");
console.log("  - create_pumpfun_token (line 374)");
console.log("  - create_pumpfun_token_mayhem (line 474)");
console.log("\nPUMPSWAP_PROGRAM (pAMMBay...):");
console.log("  - execute_buy (lines 179, 183) - for the swap/buy instruction");
console.log("  - collect_fees (line 528) - for fee collection CPI");
