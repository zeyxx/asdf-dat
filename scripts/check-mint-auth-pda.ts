import { PublicKey } from "@solana/web3.js";

const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

const [mintAuthority, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("mint-authority")],
  PUMP_PROGRAM
);

console.log("Derived mint-authority PDA:", mintAuthority.toString());
console.log("Unknown program from error:", "AHAyHjZ8pwTFSuL1j2z1vKwS6G9NiX5JC2yHTPiisra9");
console.log("Match:", mintAuthority.toString() === "AHAyHjZ8pwTFSuL1j2z1vKwS6G9NiX5JC2yHTPiisra9");
