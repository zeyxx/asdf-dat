/**
 * Generate Volume - Buy/Sell Cycles
 *
 * Auto-discovery version - no manual JSON files needed!
 *
 * Usage:
 *   npx ts-node scripts/generate-volume.ts <mint-or-symbol> [cycles] [sol-per-cycle]
 *   npx ts-node scripts/generate-volume.ts DROOT 2 0.5
 *   npx ts-node scripts/generate-volume.ts FuBryC4gM3SvNLPXPsckH4zaMs6pktxUWLhCiG7aBavb 2 0.5
 *   npx ts-node scripts/generate-volume.ts --all 2 0.5   # All tokens
 *
 * Requires:
 *   - Daemon state file (.asdf-state.json) OR daemon running (API)
 *   - CREATOR env var or --creator flag
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { loadWallet, buyTokens, sellTokens, deriveCreatorVault } from "../src/pump/sdk";
import { loadTokenFromState, loadAllTokensFromState } from "../src/utils/token-loader";
import { TokenConfig } from "../src/core/types";

// Parse args
function parseArgs() {
  const args = process.argv.slice(2);
  let tokenId: string | undefined;
  let cycles = 2;
  let solPerCycle = 0.5;
  let all = false;
  let creator: string | undefined;
  let network: "devnet" | "mainnet" = "devnet";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--all") {
      all = true;
    } else if (arg === "--creator" || arg === "-c") {
      creator = args[++i];
    } else if (arg === "--network" || arg === "-n") {
      const n = args[++i];
      if (n === "devnet" || n === "mainnet") network = n;
    } else if (arg === "--help" || arg === "-h") {
      showHelp();
      process.exit(0);
    } else if (!tokenId) {
      tokenId = arg;
    } else if (!isNaN(parseInt(arg))) {
      if (cycles === 2) cycles = parseInt(arg);
      else solPerCycle = parseFloat(arg);
    }
  }

  // Try env
  if (!creator) creator = process.env.CREATOR;

  return { tokenId, cycles, solPerCycle, all, creator, network };
}

function showHelp() {
  console.log(`
Generate Volume - Buy/Sell Cycles

Usage:
  npx ts-node scripts/generate-volume.ts <mint-or-symbol> [cycles] [sol-per-cycle]
  npx ts-node scripts/generate-volume.ts --all [cycles] [sol-per-cycle]

Options:
  --all           Generate volume for ALL discovered tokens
  --creator, -c   Creator pubkey (or set CREATOR env var)
  --network, -n   Network: devnet or mainnet (default: devnet)
  --help, -h      Show this help

Examples:
  npx ts-node scripts/generate-volume.ts DROOT 2 0.5
  npx ts-node scripts/generate-volume.ts FuBryC4gM3SvNLPXPsckH4zaMs6pktxUWLhCiG7aBavb 3 0.3
  npx ts-node scripts/generate-volume.ts --all 2 0.5 -c 84ddDW8Vvuc9NMTQQFMtd2SAhR3xvGEJgJ9Xqe2VMi68
`);
}

async function generateVolumeForToken(
  connection: Connection,
  wallet: any,
  config: TokenConfig,
  cycles: number,
  solPerCycle: number
) {
  console.log(`\n--- ${config.symbol} (${config.mint.slice(0, 8)}...) ---`);

  for (let i = 1; i <= cycles; i++) {
    console.log(`  Cycle ${i}/${cycles}:`);

    // Buy
    const buyResult = await buyTokens(connection, wallet, config, solPerCycle);
    if (buyResult.success) {
      console.log(`    Buy: ${buyResult.tokensReceived?.toLocaleString()} tokens`);
    } else {
      console.log(`    Buy failed: ${buyResult.error}`);
      continue;
    }

    await new Promise(r => setTimeout(r, 2000));

    // Sell
    const sellResult = await sellTokens(connection, wallet, config);
    if (sellResult.success) {
      console.log(`    Sell: ~${sellResult.solReceived?.toFixed(4)} SOL`);
    } else {
      console.log(`    Sell failed: ${sellResult.error}`);
    }

    if (i < cycles) await new Promise(r => setTimeout(r, 2000));
  }
}

async function main() {
  const { tokenId, cycles, solPerCycle, all, creator, network } = parseArgs();

  if (!creator) {
    console.error("Error: Creator pubkey required. Use --creator or set CREATOR env var");
    process.exit(1);
  }

  if (!all && !tokenId) {
    console.error("Error: Specify token mint/symbol or use --all");
    showHelp();
    process.exit(1);
  }

  // Setup
  const rpcUrl = network === "devnet"
    ? "https://api.devnet.solana.com"
    : "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = loadWallet(`${network}-wallet.json`);
  const creatorPubkey = new PublicKey(creator);

  console.log(`\n Volume Generator`);
  console.log(`Network: ${network}`);
  console.log(`Creator: ${creator.slice(0, 8)}...`);
  console.log(`Cycles: ${cycles} x ${solPerCycle} SOL\n`);

  let tokens: TokenConfig[] = [];

  if (all) {
    // Load all tokens
    tokens = await loadAllTokensFromState(connection, creatorPubkey);
    if (tokens.length === 0) {
      console.error("No tokens found. Run daemon first to discover tokens.");
      process.exit(1);
    }
    console.log(`Found ${tokens.length} tokens`);
  } else {
    // Load specific token
    const config = await loadTokenFromState(tokenId!, connection, creatorPubkey);
    if (!config) {
      console.error(`Token not found: ${tokenId}`);
      console.error("Make sure daemon has discovered this token (check .asdf-state.json or API)");
      process.exit(1);
    }
    tokens = [config];
  }

  // Generate volume for each token
  for (const config of tokens) {
    await generateVolumeForToken(connection, wallet, config, cycles, solPerCycle);
  }

  // Show vault balance
  const vault = deriveCreatorVault(creatorPubkey);
  const vaultBalance = (await connection.getAccountInfo(vault))?.lamports || 0;
  console.log(`\n Creator Vault: ${(vaultBalance / 1e9).toFixed(6)} SOL`);
}

main().catch(e => {
  console.error("Error:", e.message);
  process.exit(1);
});
