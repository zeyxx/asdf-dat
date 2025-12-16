#!/usr/bin/env node
/**
 * ASDF Burn Engine CLI
 *
 * Single entry point for the daemon.
 * Usage: npx asdf-dat --creator <PUBKEY> --network devnet
 */

// Load .env file first
import * as dotenv from "dotenv";
dotenv.config();

import { createDaemon } from "./daemon";
import { setGlobalLogLevel } from "./utils/logger";

// Parse command line arguments
function parseArgs(): {
  creator?: string;
  network: "devnet" | "mainnet";
  rootToken?: string;
  apiPort: number;
  wsPort: number;
  stateFile: string;
  heliusApiKey?: string;
  rpcEndpoint?: string;
  verbose: boolean;
  help: boolean;
} {
  const args = process.argv.slice(2);
  const result = {
    network: "devnet" as "devnet" | "mainnet",
    apiPort: 3030,
    wsPort: 3031,
    stateFile: ".asdf-state.json",
    verbose: false,
    help: false,
  } as ReturnType<typeof parseArgs>;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case "--creator":
      case "-c":
        result.creator = next;
        i++;
        break;
      case "--network":
      case "-n":
        if (next === "devnet" || next === "mainnet") {
          result.network = next;
        }
        i++;
        break;
      case "--root-token":
      case "-r":
        result.rootToken = next;
        i++;
        break;
      case "--port":
        result.apiPort = parseInt(next, 10);
        i++;
        break;
      case "--ws-port":
        result.wsPort = parseInt(next, 10);
        i++;
        break;
      case "--state-file":
        result.stateFile = next;
        i++;
        break;
      case "--helius-key":
        result.heliusApiKey = next;
        i++;
        break;
      case "--rpc":
        result.rpcEndpoint = next;
        i++;
        break;
      case "--verbose":
      case "-v":
        result.verbose = true;
        break;
      case "--help":
      case "-h":
        result.help = true;
        break;
    }
  }

  // Try environment variables
  if (!result.heliusApiKey) {
    result.heliusApiKey = process.env.HELIUS_API_KEY;
  }
  if (!result.rpcEndpoint) {
    result.rpcEndpoint = process.env.DEVNET_RPC_URL || process.env.MAINNET_RPC_URL;
  }

  return result;
}

function printHelp(): void {
  console.log(`
ASDF Burn Engine - Optimistic Burn Protocol

Usage: npx asdf-dat --creator <PUBKEY> [options]

Required:
  --creator, -c     Creator wallet pubkey (token owner)

Options:
  --network, -n     Network: devnet | mainnet (default: devnet)
  --root-token, -r  Root token mint (optional, auto-detected)
  --port            HTTP API port (default: 3030)
  --ws-port         WebSocket port (default: 3031)
  --state-file      State persistence file (default: .asdf-state.json)
  --helius-key      Helius API key (or set HELIUS_API_KEY env var)
  --rpc             Custom RPC endpoint
  --verbose, -v     Enable verbose logging
  --help, -h        Show this help message

Examples:
  # Start on devnet with auto-discovery
  npx asdf-dat -c 6E8vNJEFGXCcMYXULwwrHGHQemf1Hbd1mKTFNKMG62vB -n devnet

  # Start on mainnet with Helius
  npx asdf-dat -c 6E8vNJEFGXCcMYXULwwrHGHQemf1Hbd1mKTFNKMG62vB -n mainnet --helius-key YOUR_KEY

  # Start with custom ports
  npx asdf-dat -c CREATOR_PUBKEY --port 8080 --ws-port 8081

Environment Variables:
  HELIUS_API_KEY    Helius RPC API key
  DEVNET_RPC_URL    Custom devnet RPC endpoint
  MAINNET_RPC_URL   Custom mainnet RPC endpoint
`);
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.creator) {
    console.error("Error: --creator is required");
    console.error("Run with --help for usage information");
    process.exit(1);
  }

  // Validate creator pubkey format
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(args.creator)) {
    console.error("Error: Invalid creator pubkey format");
    process.exit(1);
  }

  if (args.verbose) {
    setGlobalLogLevel("debug");
  }

  console.log(`
╔════════════════════════════════════════════════════════════╗
║                   ASDF Burn Engine                         ║
║              Optimistic Burn Protocol                      ║
╚════════════════════════════════════════════════════════════╝
`);

  console.log(`Network:  ${args.network}`);
  console.log(`Creator:  ${args.creator.slice(0, 8)}...${args.creator.slice(-8)}`);
  console.log(`API:      http://localhost:${args.apiPort}`);
  console.log(`WS:       ws://localhost:${args.wsPort}`);
  console.log("");

  // Create daemon
  const daemon = createDaemon({
    creator: args.creator,
    network: args.network,
    rootToken: args.rootToken,
    apiPort: args.apiPort,
    wsPort: args.wsPort,
    stateFile: args.stateFile,
    heliusApiKey: args.heliusApiKey,
    rpcEndpoint: args.rpcEndpoint,
    verbose: args.verbose,
  });

  // Handle shutdown signals
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    await daemon.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Start daemon
  try {
    await daemon.start();
    console.log("\nDaemon is running. Press Ctrl+C to stop.\n");
  } catch (error) {
    console.error("Failed to start daemon:", (error as Error).message);
    process.exit(1);
  }
}

// Run
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
