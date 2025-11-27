/**
 * Ecosystem Fee Monitor Daemon
 *
 * Background service that continuously monitors all ecosystem tokens
 * and tracks their fee accumulation in real-time.
 *
 * Usage:
 *   npx ts-node scripts/monitor-ecosystem-fees.ts
 *
 * PM2 Usage:
 *   pm2 start scripts/monitor-ecosystem-fees.ts --name "fee-monitor"
 *
 * This script:
 * 1. Loads all ecosystem tokens from configuration
 * 2. Starts PumpFunFeeMonitor for each token
 * 3. Runs continuously, flushing fees every 30 seconds
 * 4. Handles graceful shutdown on SIGINT/SIGTERM
 */

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";
import http from "http";
import { PumpFunFeeMonitor, TokenConfig } from "../lib/fee-monitor";
import { getNetworkConfig, printNetworkBanner, NetworkConfig } from "../lib/network-config";
import { monitoring, MonitoringService } from "../lib/monitoring";
import { createLogger, Logger } from "../lib/logger";

// Program ID
const PROGRAM_ID = new PublicKey("ASDfNfUHwVGfrg3SV7SQYWhaVxnrCUZyWmMpWJAPu4MZ");

// Configuration (can be overridden by env vars)
const UPDATE_INTERVAL = parseInt(process.env.UPDATE_INTERVAL || "30000"); // 30 seconds
const VERBOSE = process.env.VERBOSE === "true";
const API_PORT = parseInt(process.env.API_PORT || "3030");

interface EcosystemConfig {
  root?: TokenConfig;
  secondaries: TokenConfig[];
}

/**
 * Load ecosystem configuration from network config
 */
function loadEcosystemConfig(networkConfig: NetworkConfig): EcosystemConfig {
  const config: EcosystemConfig = {
    secondaries: [],
  };

  // Load tokens from network config
  for (const file of networkConfig.tokens) {
    if (fs.existsSync(file)) {
      try {
        const data = JSON.parse(fs.readFileSync(file, "utf-8"));
        const tokenConfig: TokenConfig = {
          mint: new PublicKey(data.mint),
          bondingCurve: new PublicKey(data.bondingCurve || data.pool),
          pool: data.pool ? new PublicKey(data.pool) : undefined,
          creator: new PublicKey(data.creator),
          symbol: data.symbol || "TOKEN",
          name: data.name || "Token",
          poolType: data.poolType || 'bonding_curve',
        };

        if (data.isRoot) {
          config.root = tokenConfig;
        } else {
          config.secondaries.push(tokenConfig);
        }
      } catch (error: any) {
        console.warn(`⚠️  Failed to load ${file}:`, error.message);
      }
    }
  }

  return config;
}

/**
 * Load IDL
 */
function loadIdl(): any {
  const idlPath = path.join(__dirname, "../target/idl/asdf_dat.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  if (idl.metadata) {
    idl.metadata.address = PROGRAM_ID.toString();
  } else {
    idl.metadata = { address: PROGRAM_ID.toString() };
  }
  return idl;
}

/**
 * Display monitoring statistics
 */
function displayStats(monitor: PumpFunFeeMonitor, tokens: TokenConfig[]): void {
  console.log("\n" + "═".repeat(70));
  console.log("📊 ECOSYSTEM FEE MONITOR - STATISTICS");
  console.log("═".repeat(70));

  const totalPending = monitor.getTotalPendingFees();
  console.log(`\n💰 Total Pending: ${(totalPending / 1e9).toFixed(6)} SOL`);

  console.log("\n📈 Per Token:");
  for (const token of tokens) {
    const pending = monitor.getPendingFees(token.mint);
    console.log(
      `   ${token.symbol.padEnd(10)} ${(pending / 1e9).toFixed(6)} SOL`
    );
  }

  console.log("\n" + "═".repeat(70) + "\n");
}

/**
 * Start HTTP API server for external flush triggers and monitoring
 */
function startApiServer(monitor: PumpFunFeeMonitor, logger: Logger): http.Server {
  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    // POST /flush - Force flush pending fees
    if (req.method === "POST" && req.url === "/flush") {
      try {
        logger.info("Force flush triggered via API");
        await monitor.forceFlush();
        monitoring.daemonMetrics.flushCount++;
        res.setHeader("Content-Type", "application/json");
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, timestamp: Date.now() }));
      } catch (error: any) {
        logger.error("Flush failed", { error: error.message });
        monitoring.recordError();
        res.setHeader("Content-Type", "application/json");
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
      return;
    }

    // GET /status - Basic daemon status (legacy)
    if (req.method === "GET" && req.url === "/status") {
      const pending = monitor.getTotalPendingFees();
      res.setHeader("Content-Type", "application/json");
      res.writeHead(200);
      res.end(JSON.stringify({
        running: true,
        pendingFees: pending,
        pendingFeesSOL: pending / 1e9
      }));
      return;
    }

    // GET /metrics - Prometheus format metrics
    if (req.method === "GET" && req.url === "/metrics") {
      res.setHeader("Content-Type", "text/plain; version=0.0.4");
      res.writeHead(200);
      res.end(monitoring.toPrometheus());
      return;
    }

    // GET /stats - JSON format detailed stats
    if (req.method === "GET" && req.url === "/stats") {
      res.setHeader("Content-Type", "application/json");
      res.writeHead(200);
      res.end(JSON.stringify(monitoring.toJSON(), null, 2));
      return;
    }

    // GET /health - Health check endpoint
    if (req.method === "GET" && req.url === "/health") {
      const health = monitoring.getHealth();
      const statusCode = health.status === "healthy" ? 200 : 503;
      res.setHeader("Content-Type", "application/json");
      res.writeHead(statusCode);
      res.end(JSON.stringify(health, null, 2));
      return;
    }

    res.setHeader("Content-Type", "application/json");
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(API_PORT, () => {
    logger.info(`API server listening on port ${API_PORT}`);
    console.log(`🌐 API server listening on port ${API_PORT}`);
    console.log(`   POST /flush   - Force flush pending fees`);
    console.log(`   GET /status   - Basic daemon status`);
    console.log(`   GET /metrics  - Prometheus format metrics`);
    console.log(`   GET /stats    - JSON detailed statistics`);
    console.log(`   GET /health   - Health check endpoint`);
  });

  return server;
}

/**
 * Main monitoring function
 */
async function main() {
  // Parse network argument
  const args = process.argv.slice(2);
  const networkConfig = getNetworkConfig(args);
  const isVerbose = args.includes("--verbose") || VERBOSE;

  // Initialize logger
  const logger = createLogger("daemon", {
    level: isVerbose ? "debug" : "info",
    console: true,
    file: true,
    filePath: `./logs/asdf-daemon-${networkConfig.name.toLowerCase()}.log`,
  });

  console.clear();
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║         ASDF DAT - ECOSYSTEM FEE MONITOR DAEMON          ║");
  console.log("╚═══════════════════════════════════════════════════════════╝\n");

  printNetworkBanner(networkConfig);
  logger.info("Daemon starting", { network: networkConfig.name });

  // Load configuration
  console.log("⚙️  Loading configuration...");
  const ecosystem = loadEcosystemConfig(networkConfig);

  if (ecosystem.secondaries.length === 0 && !ecosystem.root) {
    console.error("❌ No tokens found in ecosystem configuration");
    console.error("   Please create token files (devnet-token-*.json)");
    process.exit(1);
  }

  const allTokens = [
    ...(ecosystem.root ? [ecosystem.root] : []),
    ...ecosystem.secondaries,
  ];

  console.log(`✅ Loaded ${allTokens.length} tokens:`);
  for (const token of allTokens) {
    console.log(`   • ${token.name} (${token.symbol})`);
    // Initialize monitoring for each token
    monitoring.initToken(token.mint.toBase58(), token.symbol);
  }
  logger.info("Tokens loaded", { count: allTokens.length });

  // Setup connection and program
  console.log("\n🔗 Connecting to Solana...");
  const connection = new Connection(networkConfig.rpcUrl, "confirmed");

  console.log("🔑 Loading wallet...");
  if (!fs.existsSync(networkConfig.wallet)) {
    console.error(`❌ Wallet not found: ${networkConfig.wallet}`);
    process.exit(1);
  }

  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(networkConfig.wallet, "utf-8")))
  );
  console.log(`   Admin: ${admin.publicKey.toString()}`);

  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
  });

  const idl = loadIdl();
  const program = new Program(idl, provider);

  // Initialize monitor
  console.log("\n🚀 Initializing fee monitor...");
  const monitor = new PumpFunFeeMonitor({
    connection,
    program,
    tokens: allTokens,
    updateInterval: UPDATE_INTERVAL,
    verbose: VERBOSE,
  });

  // Start monitoring
  await monitor.start();
  logger.success("Monitor started successfully");

  // Start API server for external flush triggers and monitoring
  const apiServer = startApiServer(monitor, logger);

  // Display stats every minute
  const statsInterval = setInterval(() => {
    displayStats(monitor, allTokens);
  }, 60000); // Every 60 seconds

  // Display initial stats
  setTimeout(() => displayStats(monitor, allTokens), 5000);

  // Graceful shutdown handlers
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`Received ${signal}, shutting down gracefully...`);
    console.log(`\n\n📌 Received ${signal}, shutting down gracefully...`);
    clearInterval(statsInterval);
    apiServer.close();

    try {
      await monitor.stop();
      logger.success("Monitor stopped successfully");
      console.log("✅ Monitor stopped successfully");
      logger.close();
      process.exit(0);
    } catch (error: any) {
      logger.error("Error during shutdown", { error: error.message });
      console.error("❌ Error during shutdown:", error.message);
      logger.close();
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Keep alive
  console.log("\n✅ Monitor is running...");
  console.log("   Press Ctrl+C to stop\n");

  // Prevent process from exiting
  await new Promise(() => {});
}

// Run with error handling
main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
