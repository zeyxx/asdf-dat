#!/usr/bin/env npx ts-node
/**
 * Test script for "Don't trust, verify" architecture
 *
 * Verifies:
 * 1. PDA derivation matches config
 * 2. On-chain discovery works
 * 3. Token verification succeeds
 * 4. State V2 persistence works
 *
 * Usage:
 *   npx ts-node scripts/test-verify-architecture.ts --creator <pubkey>
 *   CREATOR=xxx npx ts-node scripts/test-verify-architecture.ts
 */

import { Connection, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import {
  deriveTokenAddresses,
  detectPoolType,
  detectTokenProgram,
  detectMayhemMode,
  extractCreator,
  verifyToken,
  discoverTokensByCreator,
} from "../src/core/token-verifier";
import { StoredToken } from "../src/types";
import { TokenLoader } from "../src/utils/token-loader";

// Use Helius RPC for better rate limits
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || "ac94987a-2acd-4778-8759-1bb4708e905b";
const DEVNET_RPC = `https://devnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

// Parse args
function parseArgs(): { creator: string | undefined } {
  const args = process.argv.slice(2);
  let creator: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--creator" || args[i] === "-c") {
      creator = args[++i];
    }
  }

  if (!creator) creator = process.env.CREATOR;
  return { creator };
}

interface TestResult {
  name: string;
  passed: boolean;
  details?: string;
  error?: string;
}

async function runTests(): Promise<void> {
  const { creator } = parseArgs();

  if (!creator) {
    console.error("Error: Creator pubkey required. Use --creator or set CREATOR env var");
    process.exit(1);
  }

  const results: TestResult[] = [];
  const connection = new Connection(DEVNET_RPC, "confirmed");

  // Load root token from state/API (auto-discovery)
  const creatorPubkey = new PublicKey(creator);
  const loader = new TokenLoader({ connection, creatorPubkey });
  const rootConfig = await loader.getRootToken();

  if (!rootConfig) {
    console.error("Error: Root token not found. Make sure daemon has discovered it.");
    process.exit(1);
  }

  const mint = new PublicKey(rootConfig.mint);
  const expectedCreator = new PublicKey(rootConfig.creator);
  const expectedBC = new PublicKey(rootConfig.bondingCurve);

  console.log("\n🔍 Testing 'Don't trust, verify' architecture\n");
  console.log(`Token: ${rootConfig.symbol} (${mint.toBase58().slice(0, 8)}...)`);
  console.log(`Expected Creator: ${expectedCreator.toBase58().slice(0, 8)}...`);
  console.log(`Expected BC: ${expectedBC.toBase58().slice(0, 8)}...`);
  console.log("");

  // Test 1: PDA Derivation
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Test 1: PDA Derivation");
  try {
    const derived = deriveTokenAddresses(mint);
    const bcMatches = derived.bondingCurve.equals(expectedBC);

    results.push({
      name: "PDA Derivation",
      passed: bcMatches,
      details: bcMatches
        ? `Derived BC matches config: ${derived.bondingCurve.toBase58().slice(0, 12)}...`
        : `Mismatch! Derived: ${derived.bondingCurve.toBase58()}, Expected: ${expectedBC.toBase58()}`,
    });

    console.log(`  Bonding Curve: ${derived.bondingCurve.toBase58().slice(0, 12)}... ${bcMatches ? "✓" : "✗"}`);
    console.log(`  AMM Pool:      ${derived.ammPool.toBase58().slice(0, 12)}...`);
    console.log(`  TokenStats:    ${derived.tokenStatsPda.toBase58().slice(0, 12)}...`);
  } catch (error) {
    results.push({
      name: "PDA Derivation",
      passed: false,
      error: (error as Error).message,
    });
    console.log(`  ✗ Error: ${(error as Error).message}`);
  }

  // Test 2: Pool Type Detection
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Test 2: Pool Type Detection");
  try {
    const derived = deriveTokenAddresses(mint);
    const poolType = await detectPoolType(connection, derived.bondingCurve);
    const expected = rootConfig.poolType;
    const matches = poolType === expected;

    results.push({
      name: "Pool Type Detection",
      passed: matches,
      details: `Detected: ${poolType}, Expected: ${expected}`,
    });

    console.log(`  Detected: ${poolType} ${matches ? "✓" : "✗"}`);
  } catch (error) {
    results.push({
      name: "Pool Type Detection",
      passed: false,
      error: (error as Error).message,
    });
    console.log(`  ✗ Error: ${(error as Error).message}`);
  }

  // Test 3: Token Program Detection
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Test 3: Token Program Detection");
  try {
    const tokenProgram = await detectTokenProgram(connection, mint);
    const expected = rootConfig.tokenProgram;
    const matches = tokenProgram === expected;

    results.push({
      name: "Token Program Detection",
      passed: matches,
      details: `Detected: ${tokenProgram}, Expected: ${expected}`,
    });

    console.log(`  Detected: ${tokenProgram} ${matches ? "✓" : "✗"}`);
  } catch (error) {
    results.push({
      name: "Token Program Detection",
      passed: false,
      error: (error as Error).message,
    });
    console.log(`  ✗ Error: ${(error as Error).message}`);
  }

  // Test 4: Creator Extraction
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Test 4: Creator Extraction (on-chain)");
  try {
    const derived = deriveTokenAddresses(mint);
    const poolType = await detectPoolType(connection, derived.bondingCurve);
    const activePool = poolType === "bonding_curve" ? derived.bondingCurve : derived.ammPool;

    const { creator, isCTO } = await extractCreator(connection, activePool, poolType);
    const matches = creator.equals(expectedCreator);

    results.push({
      name: "Creator Extraction",
      passed: matches,
      details: `Extracted: ${creator.toBase58().slice(0, 12)}..., isCTO: ${isCTO}`,
    });

    console.log(`  Creator: ${creator.toBase58().slice(0, 12)}... ${matches ? "✓" : "✗"}`);
    console.log(`  Is CTO:  ${isCTO}`);
  } catch (error) {
    results.push({
      name: "Creator Extraction",
      passed: false,
      error: (error as Error).message,
    });
    console.log(`  ✗ Error: ${(error as Error).message}`);
  }

  // Test 5: Mayhem Mode Detection
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Test 5: Mayhem Mode Detection");
  try {
    const derived = deriveTokenAddresses(mint);
    const poolType = await detectPoolType(connection, derived.bondingCurve);
    const activePool = poolType === "bonding_curve" ? derived.bondingCurve : derived.ammPool;

    const isMayhem = await detectMayhemMode(connection, activePool, poolType);
    const expected = rootConfig.mayhemMode || false;
    const matches = isMayhem === expected;

    results.push({
      name: "Mayhem Mode Detection",
      passed: matches,
      details: `Detected: ${isMayhem}, Expected: ${expected}`,
    });

    console.log(`  Mayhem Mode: ${isMayhem} ${matches ? "✓" : "✗"}`);
  } catch (error) {
    results.push({
      name: "Mayhem Mode Detection",
      passed: false,
      error: (error as Error).message,
    });
    console.log(`  ✗ Error: ${(error as Error).message}`);
  }

  // Test 6: Full Token Verification
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Test 6: Full Token Verification");
  try {
    const storedToken: StoredToken = {
      mint: mint.toBase58(),
      isRoot: true,
      symbol: rootConfig.symbol,
      name: rootConfig.name,
    };

    const verified = await verifyToken(connection, storedToken, expectedCreator);

    if (verified) {
      results.push({
        name: "Full Token Verification",
        passed: true,
        details: `Verified at slot ${verified.verificationSlot}`,
      });

      console.log(`  ✓ Token verified successfully`);
      console.log(`    Pool Type:    ${verified.poolType}`);
      console.log(`    Token Prog:   ${verified.tokenProgram}`);
      console.log(`    Has Stats:    ${verified.hasTokenStats}`);
      console.log(`    Mayhem:       ${verified.isMayhemMode}`);
      console.log(`    CTO:          ${verified.isCTO}`);
      console.log(`    Slot:         ${verified.verificationSlot}`);
    } else {
      results.push({
        name: "Full Token Verification",
        passed: false,
        error: "Verification returned null",
      });
      console.log(`  ✗ Verification failed`);
    }
  } catch (error) {
    results.push({
      name: "Full Token Verification",
      passed: false,
      error: (error as Error).message,
    });
    console.log(`  ✗ Error: ${(error as Error).message}`);
  }

  // Test 7: Token Discovery by Creator
  // Now supports BOTH old and new BC formats via resolveMintFromBC
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Test 7: Token Discovery by Creator");
  console.log("  (Supports old + new BC formats via getTokenAccountsByOwner)");
  try {
    const mints = await discoverTokensByCreator(connection, expectedCreator);

    const foundRoot = mints.some(m => m.equals(mint));

    results.push({
      name: "Token Discovery",
      passed: foundRoot,
      details: `Found ${mints.length} tokens, root ${foundRoot ? "included" : "NOT FOUND"}`,
    });

    console.log(`  Found ${mints.length} token(s) for creator`);
    if (mints.length > 0) {
      for (const m of mints.slice(0, 5)) {
        const isRoot = m.equals(mint);
        console.log(`    - ${m.toBase58().slice(0, 12)}... ${isRoot ? "(ROOT)" : ""}`);
      }
      if (mints.length > 5) {
        console.log(`    ... and ${mints.length - 5} more`);
      }
    }
    console.log(`  Root token found: ${foundRoot ? "✓" : "✗"}`);
  } catch (error) {
    results.push({
      name: "Token Discovery",
      passed: false,
      error: (error as Error).message,
    });
    console.log(`  ✗ Error: ${(error as Error).message}`);
  }

  // Summary
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("SUMMARY");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const passed = results.filter(r => r.passed).length;
  const total = results.length;

  for (const result of results) {
    const icon = result.passed ? "✓" : "✗";
    console.log(`  ${icon} ${result.name}`);
    if (!result.passed && result.error) {
      console.log(`      Error: ${result.error}`);
    }
  }

  console.log("");
  console.log(`  ${passed}/${total} tests passed`);

  if (passed === total) {
    console.log("\n🔥 All tests passed! 'Don't trust, verify' architecture working.\n");
    process.exit(0);
  } else {
    console.log("\n⚠️  Some tests failed.\n");
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
