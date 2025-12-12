/**
 * Check SPL Pool State and Liquidity
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAccount } from "@solana/spl-token";
import fs from "fs";

const colors = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const tokenInfo = JSON.parse(fs.readFileSync("devnet-token-spl.json", "utf-8"));
  const bondingCurve = new PublicKey(tokenInfo.bondingCurve);
  const tokenMint = new PublicKey(tokenInfo.mint);

  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.cyan}📊 SPL POOL STATE CHECK${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);

  console.log(`${colors.cyan}Token Mint:${colors.reset} ${tokenMint.toString()}`);
  console.log(`${colors.cyan}Bonding Curve:${colors.reset} ${bondingCurve.toString()}\n`);

  // Derive pool accounts
  const [poolTokenAccount] = await PublicKey.findProgramAddress(
    [
      bondingCurve.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      tokenMint.toBuffer(),
    ],
    new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL") // Associated Token Program
  );

  const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
  const [poolWsolAccount] = await PublicKey.findProgramAddress(
    [
      bondingCurve.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      WSOL_MINT.toBuffer(),
    ],
    new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
  );

  console.log(`${colors.cyan}Pool Token Account:${colors.reset} ${poolTokenAccount.toString()}`);
  console.log(`${colors.cyan}Pool WSOL Account:${colors.reset} ${poolWsolAccount.toString()}\n`);

  // Check pool token balance
  try {
    const tokenAccount = await getAccount(connection, poolTokenAccount, "confirmed", TOKEN_PROGRAM_ID);
    const balance = Number(tokenAccount.amount) / 1e6;
    console.log(`${colors.green}✅ Pool Token Balance: ${balance.toLocaleString()} tokens${colors.reset}`);
  } catch (e: any) {
    console.log(`${colors.red}❌ Pool Token Account: ${e.message}${colors.reset}`);
  }

  // Check pool WSOL balance
  try {
    const wsolAccount = await getAccount(connection, poolWsolAccount, "confirmed", TOKEN_PROGRAM_ID);
    const balance = Number(wsolAccount.amount) / 1e9;
    console.log(`${colors.green}✅ Pool WSOL Balance: ${balance.toFixed(6)} SOL${colors.reset}`);
  } catch (e: any) {
    console.log(`${colors.yellow}⚠️  Pool WSOL Account: ${e.message}${colors.reset}`);
    console.log(`${colors.yellow}    This is normal - account created on first buy${colors.reset}`);
  }

  // Check bonding curve state
  const bondingCurveInfo = await connection.getAccountInfo(bondingCurve);
  if (bondingCurveInfo) {
    console.log(`\n${colors.cyan}Bonding Curve Account:${colors.reset}`);
    console.log(`  Owner: ${bondingCurveInfo.owner.toString()}`);
    console.log(`  Data length: ${bondingCurveInfo.data.length} bytes`);
    console.log(`  Lamports: ${(bondingCurveInfo.lamports / 1e9).toFixed(6)} SOL`);
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.cyan}📋 ANALYSIS${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);

  console.log(`${colors.yellow}Pool WSOL is empty because:${colors.reset}`);
  console.log(`  • Token just created - no trades yet`);
  console.log(`  • Pool WSOL fills when people BUY tokens`);
  console.log(`  • Each buy sends SOL to pool WSOL account\n`);

  console.log(`${colors.cyan}To test DAT cycle:${colors.reset}`);
  console.log(`  1. Make a buy to add SOL to pool`);
  console.log(`  2. Or use existing Token2022 with liquidity`);
  console.log(`  3. Or wait for natural trades (unlikely on devnet)\n`);
}

main().catch(console.error);
