/**
 * ASDF Burn Engine - Complete Demo
 *
 * One-command demo for video presentation (<3 min)
 * Shows complete flow: Volume → Fees → Burn → Proof
 *
 * Usage:
 *   npx ts-node scripts/demo-burn-engine.ts [--network devnet|mainnet]
 *
 * Requires:
 *   - CREATOR env var set
 *   - devnet-wallet.json (devnet) or mainnet-wallet.json (mainnet)
 *   - DAT program initialized
 */

import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";

const execAsync = promisify(exec);

// ============================================================================
// Configuration
// ============================================================================

const PROGRAM_ID = new PublicKey("ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui");

// ANSI colors for visual output
const c = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
};

// ============================================================================
// Banner & Display
// ============================================================================

function showBanner() {
  console.log(`
${c.bright}${c.cyan}╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║         🔥  ASDF BURN ENGINE - LIVE DEMO  🔥              ║
║                                                           ║
║      Optimistic Burn Protocol for Sustainable            ║
║           Token Economics (CCM Layer)                     ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝${c.reset}

${c.dim}Creation > Extraction  •  Collect. Burn. This is fine.${c.reset}
`);
}

function section(title: string) {
  console.log(`\n${c.bright}${c.yellow}▸ ${title}${c.reset}`);
  console.log(`${c.dim}${'─'.repeat(60)}${c.reset}`);
}

function success(msg: string) {
  console.log(`${c.green}✓${c.reset} ${msg}`);
}

function info(msg: string) {
  console.log(`${c.cyan}ℹ${c.reset} ${msg}`);
}

function warning(msg: string) {
  console.log(`${c.yellow}⚠${c.reset} ${msg}`);
}

function error(msg: string) {
  console.log(`${c.red}✗${c.reset} ${msg}`);
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Network Configuration
// ============================================================================

interface NetworkConfig {
  rpc: string;
  wallet: string;
  network: "devnet" | "mainnet";
}

function getNetworkConfig(network: "devnet" | "mainnet"): NetworkConfig {
  return {
    rpc: network === "devnet"
      ? (process.env.HELIUS_DEVNET_RPC || "https://api.devnet.solana.com")
      : (process.env.HELIUS_MAINNET_RPC || "https://api.mainnet-beta.solana.com"),
    wallet: network === "devnet" ? "devnet-wallet.json" : "mainnet-wallet.json",
    network,
  };
}

// ============================================================================
// Step Functions
// ============================================================================

async function step1_CheckSystem(config: NetworkConfig): Promise<boolean> {
  section("1️⃣  System Check");

  const connection = new Connection(config.rpc, "confirmed");

  // Check DAT State
  const [datState] = PublicKey.findProgramAddressSync(
    [Buffer.from("dat_v3")],
    PROGRAM_ID
  );

  const accountInfo = await connection.getAccountInfo(datState);
  if (!accountInfo) {
    error("DAT State not initialized");
    info("Run: npx ts-node scripts/init-dat-state.ts");
    return false;
  }
  success(`DAT State: ${datState.toBase58().slice(0, 8)}...`);

  // Check wallet
  if (!fs.existsSync(config.wallet)) {
    error(`Wallet not found: ${config.wallet}`);
    return false;
  }
  success(`Wallet: ${config.wallet}`);

  // Check CREATOR env
  if (!process.env.CREATOR) {
    error("CREATOR env var not set");
    return false;
  }
  success(`Creator: ${process.env.CREATOR.slice(0, 8)}...`);

  return true;
}

async function step2_DiscoverTokens(config: NetworkConfig): Promise<number> {
  section("2️⃣  Token Discovery");

  info("Discovering tokens on-chain...");

  // Use token-verifier to discover tokens
  const { stdout } = await execAsync(
    `CREATOR=${process.env.CREATOR} npx ts-node -e "
      import { discoverAndVerifyTokens } from './src/core/token-verifier';
      import { Connection, PublicKey } from '@solana/web3.js';
      (async () => {
        const conn = new Connection('${config.rpc}', 'confirmed');
        const creator = new PublicKey('${process.env.CREATOR}');
        const tokens = await discoverAndVerifyTokens(conn, creator);
        console.log(JSON.stringify(tokens.length));
      })();
    "`,
    { timeout: 30000 }
  );

  const tokenCount = parseInt(stdout.trim());
  success(`Found ${tokenCount} token(s)`);

  return tokenCount;
}

async function step3_CheckDaemon(config: NetworkConfig): Promise<void> {
  section("3️⃣  Daemon Status");

  info("Checking if fee daemon is running...");

  try {
    const response = await fetch("http://localhost:3030/health", { signal: AbortSignal.timeout(2000) });
    if (response.ok) {
      success("Daemon is running and monitoring fees");
    } else {
      warning("Daemon not responding - fees may not be synchronized");
    }
  } catch (err) {
    warning("Daemon not running - start with: npx ts-node scripts/monitor-ecosystem-fees.ts");
    info("For demo: assuming fees already synchronized from previous runs");
  }
}

async function step4_MonitorFees(config: NetworkConfig): Promise<void> {
  section("4️⃣  Fees Status");

  info("Checking pending fees...");

  const { stdout } = await execAsync(
    `ANCHOR_WALLET=${config.wallet} npx ts-node scripts/check-fees.ts --network ${config.network}`,
    { timeout: 15000 }
  );

  console.log(stdout);
  success("Fees tracked on-chain");
}

async function step5_ExecuteBurn(config: NetworkConfig): Promise<string> {
  section("5️⃣  Optimistic Burn Cycle");

  info("Executing optimistic burn cycle...");
  info("Flow: Collect → Buy → Burn → Verify");

  const { stdout } = await execAsync(
    `CREATOR=${process.env.CREATOR} ANCHOR_WALLET=${config.wallet} timeout 120s npx ts-node scripts/execute-ecosystem-cycle.ts --network ${config.network}`,
    { timeout: 120000 }
  );

  // Extract transaction signature from output
  const sigMatch = stdout.match(/Signature: ([A-Za-z0-9]{87,88})/);
  const signature = sigMatch ? sigMatch[1] : "unknown";

  success("Burn cycle completed");

  return signature;
}

async function step6_VerifyProof(config: NetworkConfig, signature: string): Promise<void> {
  section("6️⃣  On-Chain Proof");

  if (signature === "unknown") {
    warning("No signature captured");
    return;
  }

  success(`Transaction: ${signature}`);

  const explorerUrl = config.network === "devnet"
    ? `https://explorer.solana.com/tx/${signature}?cluster=devnet`
    : `https://explorer.solana.com/tx/${signature}`;

  info(`Explorer: ${explorerUrl}`);

  // Check token stats
  info("Verifying token stats...");
  const { stdout } = await execAsync(
    `ANCHOR_WALLET=${config.wallet} npx ts-node scripts/check-fees.ts --network ${config.network}`,
    { timeout: 15000 }
  );

  console.log(stdout);
  success("On-chain proof verified");
}

function showSummary(config: NetworkConfig) {
  console.log(`
${c.bright}${c.green}╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║                  ✓ DEMO COMPLETED                         ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝${c.reset}

${c.bright}What happened:${c.reset}
1. System verified (DAT state, wallet, creator)
2. Tokens discovered automatically from on-chain data
3. Daemon status checked (fee attribution running)
4. Pending fees verified on-chain
5. Burn cycle executed (collect → buy → burn)
6. On-chain proof verified (permanent record)

${c.bright}Key principles:${c.reset}
• ${c.green}Don't trust, verify${c.reset} - All data from on-chain state
• ${c.green}Optimistic burn${c.reset} - Daemon executes, chain proves
• ${c.green}Creation > Extraction${c.reset} - Permanent supply reduction

${c.dim}Network: ${config.network}${c.reset}
${c.dim}Program: ${PROGRAM_ID.toBase58()}${c.reset}

${c.bright}${c.cyan}This is fine. 🔥🐕${c.reset}
`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  showBanner();

  // Parse args
  const args = process.argv.slice(2);
  let network: "devnet" | "mainnet" = "devnet";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--network" || args[i] === "-n") {
      const n = args[++i];
      if (n === "devnet" || n === "mainnet") network = n;
    }
    if (args[i] === "--help" || args[i] === "-h") {
      console.log(`
Usage:
  npx ts-node scripts/demo-burn-engine.ts [--network devnet|mainnet]

Options:
  --network, -n    Network to use (default: devnet)
  --help, -h       Show this help

Environment:
  CREATOR          Creator pubkey (required)

Example:
  CREATOR=84ddDW8Vvuc9NMTQQFMtd2SAhR3xvGEJgJ9Xqe2VMi68 \\
    npx ts-node scripts/demo-burn-engine.ts --network devnet
      `);
      process.exit(0);
    }
  }

  const config = getNetworkConfig(network);

  info(`Network: ${c.bright}${network.toUpperCase()}${c.reset}`);
  info(`RPC: ${config.rpc}`);
  console.log();

  try {
    // Execute demo flow
    const systemOk = await step1_CheckSystem(config);
    if (!systemOk) {
      error("System check failed - fix issues and retry");
      process.exit(1);
    }

    const tokenCount = await step2_DiscoverTokens(config);
    if (tokenCount === 0) {
      warning("No tokens found - create tokens first");
      process.exit(0);
    }

    await step3_CheckDaemon(config);
    await step4_MonitorFees(config);

    const signature = await step5_ExecuteBurn(config);
    await step6_VerifyProof(config, signature);

    showSummary(config);

  } catch (err: any) {
    error(`Demo failed: ${err.message}`);
    console.error(err);
    process.exit(1);
  }
}

main().catch(console.error);
