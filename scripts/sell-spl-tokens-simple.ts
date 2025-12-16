/**
 * Sell Tokens on PumpFun
 *
 * Auto-discovery version - no manual JSON files needed!
 *
 * Usage:
 *   npx ts-node scripts/sell-spl-tokens-simple.ts <mint-or-symbol>
 *   npx ts-node scripts/sell-spl-tokens-simple.ts DROOT
 *   npx ts-node scripts/sell-spl-tokens-simple.ts FuBryC4gM3SvNLPXPsckH4zaMs6pktxUWLhCiG7aBavb
 *   npx ts-node scripts/sell-spl-tokens-simple.ts --all  # Sell all tokens
 *
 * Requires:
 *   - Daemon state file (.asdf-state.json) OR daemon running (API)
 *   - CREATOR env var or --creator flag
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { loadWallet, sellTokens, deriveCreatorVault } from "../src/pump/sdk";
import { loadTokenFromState, loadAllTokensFromState } from "../src/utils/token-loader";
import { TokenConfig } from "../src/core/types";

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

function log(emoji: string, message: string, color = colors.reset) {
  console.log(`${color}${emoji} ${message}${colors.reset}`);
}

// Parse args
function parseArgs() {
  const args = process.argv.slice(2);
  let tokenId: string | undefined;
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
    }
  }

  // Try env
  if (!creator) creator = process.env.CREATOR;

  return { tokenId, all, creator, network };
}

function showHelp() {
  console.log(`
${colors.bright}${colors.cyan}Sell Tokens on PumpFun${colors.reset}

Usage:
  npx ts-node scripts/sell-spl-tokens-simple.ts <mint-or-symbol>
  npx ts-node scripts/sell-spl-tokens-simple.ts --all

Options:
  --all           Sell ALL discovered tokens
  --creator, -c   Creator pubkey (or set CREATOR env var)
  --network, -n   Network: devnet or mainnet (default: devnet)
  --help, -h      Show this help

Examples:
  npx ts-node scripts/sell-spl-tokens-simple.ts DROOT
  npx ts-node scripts/sell-spl-tokens-simple.ts FuBryC4gM3SvNLPXPsckH4zaMs6pktxUWLhCiG7aBavb
  npx ts-node scripts/sell-spl-tokens-simple.ts --all -c 84ddDW8Vvuc9NMTQQFMtd2SAhR3xvGEJgJ9Xqe2VMi68
`);
}

async function sellTokenForConfig(
  connection: Connection,
  wallet: any,
  config: TokenConfig,
  network: "devnet" | "mainnet"
) {
  console.log("\n" + "-".repeat(60));
  log("📄", `Token: ${config.name} (${config.symbol})`, colors.cyan);
  log("🪙", `Mint: ${config.mint}`, colors.cyan);
  log("🔧", `Token Program: ${config.tokenProgram}`, colors.cyan);
  log("🎰", `Mayhem Mode: ${config.mayhemMode}`, config.mayhemMode ? colors.yellow : colors.cyan);

  // Sell tokens
  log("💰", "Selling all tokens...", colors.yellow);

  const result = await sellTokens(connection, wallet, config);

  if (result.success) {
    log("✅", "Sell successful!", colors.green);
    if (result.signature) {
      const cluster = network === "devnet" ? "?cluster=devnet" : "";
      log("🔗", `https://explorer.solana.com/tx/${result.signature}${cluster}`, colors.cyan);
    }
    if (result.solReceived !== undefined) {
      log("💎", `SOL received: ~${result.solReceived.toFixed(4)} SOL`, colors.green);
    }
    return true;
  } else {
    log("❌", `Sell failed: ${result.error}`, colors.red);
    return false;
  }
}

async function main() {
  const { tokenId, all, creator, network } = parseArgs();

  if (!creator) {
    console.error(`${colors.red}Error: Creator pubkey required. Use --creator or set CREATOR env var${colors.reset}`);
    process.exit(1);
  }

  if (!all && !tokenId) {
    console.error(`${colors.red}Error: Specify token mint/symbol or use --all${colors.reset}`);
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

  console.log("\n" + "=".repeat(60));
  console.log(`${colors.bright}${colors.yellow}SELL TOKENS${colors.reset}`);
  console.log("=".repeat(60));
  console.log(`Network: ${network}`);
  console.log(`Creator: ${creator.slice(0, 8)}...`);
  console.log(`Wallet: ${wallet.publicKey.toString().slice(0, 8)}...`);

  let tokens: TokenConfig[] = [];

  if (all) {
    // Load all tokens
    tokens = await loadAllTokensFromState(connection, creatorPubkey);
    if (tokens.length === 0) {
      console.error(`${colors.red}No tokens found. Run daemon first to discover tokens.${colors.reset}`);
      process.exit(1);
    }
    console.log(`Found ${tokens.length} tokens`);
  } else {
    // Load specific token
    const config = await loadTokenFromState(tokenId!, connection, creatorPubkey);
    if (!config) {
      console.error(`${colors.red}Token not found: ${tokenId}${colors.reset}`);
      console.error("Make sure daemon has discovered this token (check .asdf-state.json or API)");
      process.exit(1);
    }
    tokens = [config];
  }

  // Sell each token
  let successCount = 0;
  for (const config of tokens) {
    const success = await sellTokenForConfig(connection, wallet, config, network);
    if (success) successCount++;
    if (tokens.length > 1) await new Promise(r => setTimeout(r, 2000));
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log(`${colors.bright}${successCount === tokens.length ? colors.green : colors.yellow}RESULT${colors.reset}`);
  console.log("=".repeat(60));
  console.log(`Sold: ${successCount}/${tokens.length} tokens`);

  // Show wallet balance
  const balance = await connection.getBalance(wallet.publicKey);
  log("💰", `Wallet balance: ${(balance / 1e9).toFixed(4)} SOL`, colors.cyan);

  // Show vault balance
  const vault = deriveCreatorVault(creatorPubkey);
  const vaultBalance = (await connection.getAccountInfo(vault))?.lamports || 0;
  log("🏦", `Creator Vault: ${(vaultBalance / 1e9).toFixed(6)} SOL`, colors.cyan);
}

main().catch((error) => {
  console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
