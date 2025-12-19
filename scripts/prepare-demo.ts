#!/usr/bin/env npx ts-node
/**
 * ASDF Burn Engine - Demo Preparation Script
 *
 * This script prepares a clean demo environment by:
 * 1. Validating tokens on-chain (TokenStats, pool type, Token2022)
 * 2. Cleaning state file to only include valid tokens
 * 3. Generating fresh volume on specified tokens
 * 4. Executing a complete burn cycle
 *
 * Supports:
 * - Bonding Curve (pre-migration) tokens
 * - PumpSwap AMM (post-migration) tokens
 * - Token2022 program
 * - Mayhem mode tokens
 *
 * Usage:
 *   npx ts-node scripts/prepare-demo.ts [--network devnet|mainnet] [--dry-run]
 */

import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { NETWORK_CONFIGS, NetworkType } from "../src/network/config";

// ============================================================================
// Configuration
// ============================================================================

const PROGRAM_ID = new PublicKey("ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui");
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const PUMPSWAP_PROGRAM = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
const TOKEN_2022_PROGRAM = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

const DEMO_TOKENS = {
  devnet: [
    {
      file: "devnet-tokens/troot.json",
      symbol: "TROOT",
      isRoot: true,
    },
    {
      file: "devnet-tokens/burn.json",
      symbol: "BURN",
      isRoot: false,
    },
  ],
  mainnet: [] as { file: string; symbol: string; isRoot: boolean }[],
};

const VOLUME_CONFIG = {
  cycles: 2,
  solPerCycle: 0.5,
  minFeesRequired: 0.006, // SOL
};

// ============================================================================
// Types
// ============================================================================

interface TokenConfig {
  mint: string;
  bondingCurve: string;
  symbol: string;
  name: string;
  creator?: string;
}

interface ValidatedToken {
  mint: PublicKey;
  bondingCurve: PublicKey;
  symbol: string;
  name: string;
  isRoot: boolean;
  poolType: "bonding_curve" | "pumpswap_amm";
  isToken2022: boolean;
  isMayhemMode: boolean;
  hasTokenStats: boolean;
  tokenStatsPda: PublicKey;
  pendingFees: number;
}

interface DemoReport {
  network: string;
  timestamp: string;
  tokens: ValidatedToken[];
  volumeGenerated: number;
  feesAccumulated: number;
  cycleExecuted: boolean;
  cycleSignature?: string;
  errors: string[];
}

// ============================================================================
// PDA Derivation
// ============================================================================

function deriveDATState(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("dat_v3")],
    PROGRAM_ID
  )[0];
}

function deriveTokenStats(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("token_stats_v1"), mint.toBuffer()],
    PROGRAM_ID
  )[0];
}

function deriveBondingCurve(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint.toBuffer()],
    PUMP_PROGRAM
  )[0];
}

function deriveAMMPool(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), mint.toBuffer()],
    PUMPSWAP_PROGRAM
  )[0];
}

// ============================================================================
// Validation Functions
// ============================================================================

async function detectPoolType(
  connection: Connection,
  mint: PublicKey
): Promise<"bonding_curve" | "pumpswap_amm"> {
  const bondingCurve = deriveBondingCurve(mint);
  const accountInfo = await connection.getAccountInfo(bondingCurve);

  if (accountInfo && accountInfo.data.length >= 81) {
    return "bonding_curve";
  }
  return "pumpswap_amm";
}

async function detectTokenProgram(
  connection: Connection,
  mint: PublicKey
): Promise<boolean> {
  const accountInfo = await connection.getAccountInfo(mint);
  if (!accountInfo) return false;
  return accountInfo.owner.equals(TOKEN_2022_PROGRAM);
}

async function detectMayhemMode(
  connection: Connection,
  bondingCurve: PublicKey
): Promise<boolean> {
  const accountInfo = await connection.getAccountInfo(bondingCurve);
  if (!accountInfo) return false;
  // Old format: 81 bytes normal, 82 bytes mayhem
  // New format: 151 bytes (Token2022)
  return accountInfo.data.length === 82 || accountInfo.data.length === 152;
}

async function checkTokenStats(
  connection: Connection,
  mint: PublicKey
): Promise<{ exists: boolean; pendingFees: number }> {
  const tokenStatsPda = deriveTokenStats(mint);
  const accountInfo = await connection.getAccountInfo(tokenStatsPda);

  if (!accountInfo || accountInfo.data.length < 100) {
    return { exists: false, pendingFees: 0 };
  }

  // Read pending_fees_lamports from TokenStats account (offset 40, u64)
  try {
    const pendingFeesLamports = accountInfo.data.readBigUInt64LE(40);
    return {
      exists: true,
      pendingFees: Number(pendingFeesLamports) / LAMPORTS_PER_SOL,
    };
  } catch {
    return { exists: true, pendingFees: 0 };
  }
}

async function validateToken(
  connection: Connection,
  tokenConfig: TokenConfig,
  isRoot: boolean
): Promise<ValidatedToken | null> {
  const mint = new PublicKey(tokenConfig.mint);
  const bondingCurve = new PublicKey(tokenConfig.bondingCurve);

  console.log(`\n  Validating ${tokenConfig.symbol}...`);

  // 1. Detect pool type
  const poolType = await detectPoolType(connection, mint);
  console.log(`    Pool type: ${poolType}`);

  // 2. Detect Token2022
  const isToken2022 = await detectTokenProgram(connection, mint);
  console.log(`    Token2022: ${isToken2022 ? "Yes" : "No"}`);

  // 3. Detect Mayhem mode
  const isMayhemMode = await detectMayhemMode(connection, bondingCurve);
  console.log(`    Mayhem mode: ${isMayhemMode ? "Yes" : "No"}`);

  // 4. Check TokenStats
  const tokenStatsResult = await checkTokenStats(connection, mint);
  console.log(`    TokenStats: ${tokenStatsResult.exists ? "Exists" : "MISSING"}`);
  if (tokenStatsResult.exists) {
    console.log(`    Pending fees: ${tokenStatsResult.pendingFees.toFixed(6)} SOL`);
  }

  if (!tokenStatsResult.exists) {
    console.log(`    ❌ INVALID: TokenStats not initialized`);
    return null;
  }

  return {
    mint,
    bondingCurve,
    symbol: tokenConfig.symbol,
    name: tokenConfig.name,
    isRoot,
    poolType,
    isToken2022,
    isMayhemMode,
    hasTokenStats: tokenStatsResult.exists,
    tokenStatsPda: deriveTokenStats(mint),
    pendingFees: tokenStatsResult.pendingFees,
  };
}

// ============================================================================
// State Management
// ============================================================================

function cleanStateFile(validTokens: ValidatedToken[], stateFile: string): void {
  const state = {
    tokens: validTokens.map((t) => ({
      mint: t.mint.toBase58(),
      bondingCurve: t.bondingCurve.toBase58(),
      symbol: t.symbol,
      name: t.name,
      isRoot: t.isRoot,
      poolType: t.poolType,
      isToken2022: t.isToken2022,
      pendingFeesLamports: Math.floor(t.pendingFees * LAMPORTS_PER_SOL).toString(),
    })),
    lastUpdate: new Date().toISOString(),
    version: 1,
  };

  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  console.log(`\n✅ State file updated: ${stateFile}`);
}

// ============================================================================
// Volume Generation
// ============================================================================

async function generateVolume(
  token: ValidatedToken,
  network: string
): Promise<number> {
  const { execSync } = require("child_process");

  console.log(`\n  Generating volume on ${token.symbol}...`);
  console.log(`    Cycles: ${VOLUME_CONFIG.cycles}`);
  console.log(`    SOL per cycle: ${VOLUME_CONFIG.solPerCycle}`);

  try {
    const cmd = `CREATOR=84ddDW8Vvuc9NMTQQFMtd2SAhR3xvGEJgJ9Xqe2VMi68 ANCHOR_WALLET=devnet-wallet.json npx ts-node scripts/generate-volume.ts ${token.symbol} ${VOLUME_CONFIG.cycles} ${VOLUME_CONFIG.solPerCycle}`;
    const output = execSync(cmd, {
      encoding: "utf-8",
      timeout: 120000,
      cwd: process.cwd(),
    });

    // Extract fees from output
    const feesMatch = output.match(/Creator Vault:\s*([\d.]+)\s*SOL/);
    const fees = feesMatch ? parseFloat(feesMatch[1]) : 0;

    console.log(`    ✅ Volume generated, vault balance: ${fees.toFixed(6)} SOL`);
    return fees;
  } catch (error: any) {
    console.log(`    ❌ Failed: ${error.message}`);
    return 0;
  }
}

// ============================================================================
// Cycle Execution
// ============================================================================

async function executeCycle(network: string): Promise<string | null> {
  const { execSync } = require("child_process");

  console.log(`\n🔥 Executing burn cycle...`);

  try {
    const cmd = `CREATOR=84ddDW8Vvuc9NMTQQFMtd2SAhR3xvGEJgJ9Xqe2VMi68 ANCHOR_WALLET=devnet-wallet.json timeout 180s npx ts-node scripts/execute-ecosystem-cycle.ts --network ${network}`;
    const output = execSync(cmd, {
      encoding: "utf-8",
      timeout: 200000,
      cwd: process.cwd(),
    });

    // Extract signature from output
    const sigMatch = output.match(/BATCH TX confirmed:\s*(\w+)/);
    const signature = sigMatch ? sigMatch[1] : null;

    if (signature) {
      console.log(`✅ Cycle executed: ${signature}`);
      return signature;
    } else {
      console.log(`⚠️ Cycle completed but no signature found`);
      return "completed";
    }
  } catch (error: any) {
    console.log(`❌ Cycle failed: ${error.message}`);
    return null;
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const network = args.includes("--network")
    ? args[args.indexOf("--network") + 1]
    : "devnet";
  const dryRun = args.includes("--dry-run");

  console.log(`
╔════════════════════════════════════════════════════════════════════════════════╗
║                     ASDF BURN ENGINE - DEMO PREPARATION                        ║
╚════════════════════════════════════════════════════════════════════════════════╝
`);

  console.log(`Network: ${network.toUpperCase()}`);
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);

  // Connect to RPC using network config
  const networkConfig = NETWORK_CONFIGS[network as NetworkType];
  if (!networkConfig) {
    console.log(`❌ Invalid network: ${network}`);
    process.exit(1);
  }

  console.log(`RPC: ${networkConfig.rpcUrl.slice(0, 50)}...`);
  const connection = new Connection(networkConfig.rpcUrl, "confirmed");

  const report: DemoReport = {
    network,
    timestamp: new Date().toISOString(),
    tokens: [],
    volumeGenerated: 0,
    feesAccumulated: 0,
    cycleExecuted: false,
    errors: [],
  };

  // ============================================================================
  // STEP 1: Load and Validate Tokens
  // ============================================================================

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  STEP 1: VALIDATE TOKENS`);
  console.log(`${"═".repeat(60)}`);

  const demoTokens = DEMO_TOKENS[network as keyof typeof DEMO_TOKENS];
  if (!demoTokens || demoTokens.length === 0) {
    console.log(`❌ No demo tokens configured for ${network}`);
    process.exit(1);
  }

  const validTokens: ValidatedToken[] = [];

  for (const tokenDef of demoTokens) {
    const tokenPath = path.join(process.cwd(), tokenDef.file);

    if (!fs.existsSync(tokenPath)) {
      console.log(`\n  ❌ Token file not found: ${tokenDef.file}`);
      report.errors.push(`Token file not found: ${tokenDef.file}`);
      continue;
    }

    const tokenConfig: TokenConfig = JSON.parse(fs.readFileSync(tokenPath, "utf-8"));
    const validated = await validateToken(connection, tokenConfig, tokenDef.isRoot);

    if (validated) {
      validTokens.push(validated);
      report.tokens.push(validated);
    } else {
      report.errors.push(`Token validation failed: ${tokenDef.symbol}`);
    }
  }

  console.log(`\n📊 Validated: ${validTokens.length}/${demoTokens.length} tokens`);

  if (validTokens.length === 0) {
    console.log(`\n❌ No valid tokens. Run init-token-stats.ts first.`);
    process.exit(1);
  }

  // Check for root token
  const rootToken = validTokens.find((t) => t.isRoot);
  if (!rootToken) {
    console.log(`\n❌ No root token validated. Cannot proceed.`);
    process.exit(1);
  }

  console.log(`\n✅ Root token: ${rootToken.symbol} (${rootToken.mint.toBase58().slice(0, 8)}...)`);

  // ============================================================================
  // STEP 2: Clean State File
  // ============================================================================

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  STEP 2: CLEAN STATE FILE`);
  console.log(`${"═".repeat(60)}`);

  if (!dryRun) {
    cleanStateFile(validTokens, ".asdf-state.json");
  } else {
    console.log(`  [DRY RUN] Would clean state file`);
  }

  // ============================================================================
  // STEP 3: Generate Volume
  // ============================================================================

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  STEP 3: GENERATE VOLUME`);
  console.log(`${"═".repeat(60)}`);

  if (!dryRun) {
    for (const token of validTokens) {
      const fees = await generateVolume(token, network);
      report.volumeGenerated += VOLUME_CONFIG.cycles * VOLUME_CONFIG.solPerCycle * 2;
      report.feesAccumulated += fees - token.pendingFees; // Delta
    }
  } else {
    console.log(`  [DRY RUN] Would generate volume on ${validTokens.length} tokens`);
  }

  // ============================================================================
  // STEP 4: Execute Cycle
  // ============================================================================

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  STEP 4: EXECUTE BURN CYCLE`);
  console.log(`${"═".repeat(60)}`);

  if (!dryRun) {
    const signature = await executeCycle(network);
    report.cycleExecuted = !!signature;
    report.cycleSignature = signature || undefined;
  } else {
    console.log(`  [DRY RUN] Would execute burn cycle`);
  }

  // ============================================================================
  // REPORT
  // ============================================================================

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  DEMO PREPARATION REPORT`);
  console.log(`${"═".repeat(60)}`);

  console.log(`
  Network:          ${report.network}
  Tokens validated: ${report.tokens.length}
  Volume generated: ~${report.volumeGenerated.toFixed(2)} SOL
  Cycle executed:   ${report.cycleExecuted ? "✅" : "❌"}
  ${report.cycleSignature ? `Signature:        ${report.cycleSignature}` : ""}
  Errors:           ${report.errors.length}
  `);

  if (report.errors.length > 0) {
    console.log(`  Errors:`);
    report.errors.forEach((e) => console.log(`    - ${e}`));
  }

  // Save report
  const reportPath = `reports/demo-${Date.now()}.json`;
  fs.mkdirSync("reports", { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 Report saved: ${reportPath}`);

  if (report.cycleExecuted) {
    console.log(`\n🎬 DEMO READY! You can now record your video.`);
  } else {
    console.log(`\n⚠️ Demo preparation incomplete. Check errors above.`);
  }
}

main().catch((error) => {
  console.error(`\n❌ Fatal error:`, error.message);
  process.exit(1);
});
