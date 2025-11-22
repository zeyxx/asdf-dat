import { PublicKey } from "@solana/web3.js";

const mysteryBytes = new Uint8Array([
  137, 221, 191, 187, 100, 187, 237,
  209, 53, 51, 235, 147, 50, 161,
  103, 19, 141, 17, 201, 24, 105,
  206, 44, 209, 166, 60, 161, 222,
  94, 203, 251, 230
]);

const PUMP_SWAP_PROGRAM_FROM_RUST = new PublicKey(mysteryBytes);
console.log("Public key from mystery bytes:", PUMP_SWAP_PROGRAM_FROM_RUST.toString());

const expectedPumpSwap = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
console.log("Expected PUMP_SWAP_PROGRAM:", expectedPumpSwap.toString());

console.log("\nMatch?", PUMP_SWAP_PROGRAM_FROM_RUST.equals(expectedPumpSwap));

// Also check the one from the rust code at line 15
const rustConstantBytes = new Uint8Array([137, 221, 191, 187, 100, 187, 237, 209, 53, 51, 235, 147, 50, 161, 103, 19, 141, 17, 201, 24, 105, 206, 44, 209, 166, 60, 161, 222, 94, 203, 251, 230]);
const rustConstant = new PublicKey(rustConstantBytes);
console.log("\nRust PUMP_SWAP_PROGRAM constant:", rustConstant.toString());
