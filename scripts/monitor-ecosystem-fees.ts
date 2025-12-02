/**
 * Ecosystem Fee Monitor Daemon
 *
 * Background service that continuously monitors all ecosystem tokens
 * and tracks their fee accumulation in real-time.
 *
 * Usage:
 *   npx ts-node scripts/monitor-ecosystem-fees.ts [options]
 *
 * Options:
 *   --network <devnet|mainnet>  Select network (default: devnet)
 *   --verbose                   Enable verbose logging
 *   --auto-discover             Enable periodic token discovery
 *
 * Examples:
 *   npx ts-node scripts/monitor-ecosystem-fees.ts --network devnet
 *   npx ts-node scripts/monitor-ecosystem-fees.ts --network mainnet --auto-discover
 *
 * PM2 Usage:
 *   pm2 start scripts/monitor-ecosystem-fees.ts --name "fee-monitor" -- --network mainnet
 *
 * API Endpoints (port 3030):
 *   POST /flush           - Force flush pending fees
 *   POST /register-token  - Register new token (hot-reload)
 *   GET /tokens           - List registered tokens
 *   GET /status           - Basic daemon status
 *   GET /metrics          - Prometheus format metrics
 *   GET /health           - Health check
 *
 * This script:
 * 1. Loads all ecosystem tokens from configuration
 * 2. Starts PumpFunFeeMonitor for each token
 * 3. Runs continuously, flushing fees every 30 seconds
 * 4. Optionally discovers new tokens periodically (--auto-discover)
 * 5. Handles graceful shutdown on SIGINT/SIGTERM
 */

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";
import http from "http";
import { PumpFunFeeMonitor, TokenConfig } from "../lib/fee-monitor";
import { getNetworkConfig, printNetworkBanner, NetworkConfig, NetworkType } from "../lib/network-config";
import { monitoring, MonitoringService } from "../lib/monitoring";
import { createLogger, Logger } from "../lib/logger";
import { ExecutionLock } from "../lib/execution-lock";
import { initAlerting, getAlerting, AlertingService } from "../lib/alerting";
import { initMetricsPersistence, getMetricsPersistence, MetricsPersistence } from "../lib/metrics-persistence";
import { validateAlertingEnv, validateMetricsPersistenceEnv } from "../lib/env-validator";
import { discoverCreatorTokens, DiscoveredToken } from "../lib/token-discovery";

// Program ID
const PROGRAM_ID = new PublicKey("ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui");

// Configuration (can be overridden by env vars)
const UPDATE_INTERVAL = parseInt(process.env.UPDATE_INTERVAL || "30000"); // 30 seconds
const VERBOSE = process.env.VERBOSE === "true";
const API_PORT = parseInt(process.env.API_PORT || "3030");
const API_KEY = process.env.DAEMON_API_KEY || ""; // Optional API key for auth
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute window for rate limiting
const RATE_LIMIT_MAX_REQUESTS = 2; // Max 2 flush requests per minute
const AUTO_DISCOVER_INTERVAL = parseInt(process.env.AUTO_DISCOVER_INTERVAL || "300000"); // 5 minutes

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

// Rate limiting state
const rateLimitState = {
  requests: [] as number[], // Timestamps of recent requests
};

/**
 * Check if request should be rate limited
 * @returns true if request should be allowed, false if rate limited
 */
function checkRateLimit(): boolean {
  const now = Date.now();
  // Remove old requests outside the window
  rateLimitState.requests = rateLimitState.requests.filter(
    (ts) => now - ts < RATE_LIMIT_WINDOW_MS
  );
  // Check if under limit
  if (rateLimitState.requests.length >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  // Add this request
  rateLimitState.requests.push(now);
  return true;
}

/**
 * Validate API key if authentication is enabled
 * @returns true if valid (or auth disabled), false if invalid
 */
function validateApiKey(req: http.IncomingMessage): boolean {
  // If no API key configured, allow all requests
  if (!API_KEY) return true;

  // Check X-Daemon-Key header
  const providedKey = req.headers["x-daemon-key"];
  return providedKey === API_KEY;
}

/**
 * Start HTTP API server for external flush triggers and monitoring
 */
function startApiServer(monitor: PumpFunFeeMonitor, logger: Logger): http.Server {
  const server = http.createServer(async (req, res) => {
    // CORS headers (restrict to localhost if API key is set)
    res.setHeader("Access-Control-Allow-Origin", API_KEY ? "http://localhost" : "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Daemon-Key");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    // POST /flush - Force flush pending fees with detailed response
    if (req.method === "POST" && req.url === "/flush") {
      // Authentication check
      if (!validateApiKey(req)) {
        logger.warn("Unauthorized flush attempt", { ip: req.socket.remoteAddress });
        res.setHeader("Content-Type", "application/json");
        res.writeHead(401);
        res.end(JSON.stringify({
          success: false,
          error: "Unauthorized: Invalid or missing X-Daemon-Key header",
          timestamp: Date.now(),
        }));
        return;
      }

      // Rate limiting check
      if (!checkRateLimit()) {
        logger.warn("Rate limited flush attempt", { ip: req.socket.remoteAddress });
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Retry-After", "60");
        res.writeHead(429);
        res.end(JSON.stringify({
          success: false,
          error: `Rate limited: Max ${RATE_LIMIT_MAX_REQUESTS} requests per ${RATE_LIMIT_WINDOW_MS / 1000}s`,
          timestamp: Date.now(),
        }));
        return;
      }

      try {
        logger.info("Force flush triggered via API");
        const result = await monitor.forceFlush();
        monitoring.daemonMetrics.flushCount++;
        res.setHeader("Content-Type", "application/json");
        res.writeHead(result.success ? 200 : 207); // 207 = Multi-Status (partial success)
        res.end(JSON.stringify({
          ...result,
          timestamp: Date.now(),
        }));
      } catch (error: any) {
        logger.error("Flush failed", { error: error.message });
        monitoring.recordError();
        res.setHeader("Content-Type", "application/json");
        res.writeHead(500);
        res.end(JSON.stringify({
          success: false,
          error: error.message,
          tokensUpdated: 0,
          tokensFailed: 0,
          totalFlushed: 0,
          remainingPending: 0,
          details: [],
          timestamp: Date.now(),
        }));
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

    // GET /ready - Kubernetes readiness probe
    // Returns 200 if daemon is fully operational and can accept work
    if (req.method === "GET" && req.url === "/ready") {
      const metrics = monitor.getHealthMetrics();
      const isReady = metrics.isRunning &&
                      metrics.tokensMonitored > 0 &&
                      metrics.errorRate < 0.3 &&
                      metrics.timeSinceLastPoll < metrics.currentPollInterval * 3;

      res.setHeader("Content-Type", "application/json");
      res.writeHead(isReady ? 200 : 503);
      res.end(JSON.stringify({
        ready: isReady,
        checks: {
          running: metrics.isRunning,
          tokensMonitored: metrics.tokensMonitored,
          errorRate: metrics.errorRate.toFixed(3),
          lastPollAgoMs: metrics.timeSinceLastPoll,
        },
        timestamp: Date.now(),
      }));
      return;
    }

    // GET /live - Kubernetes liveness probe
    // Returns 200 if daemon process is alive (minimal check)
    if (req.method === "GET" && req.url === "/live") {
      res.setHeader("Content-Type", "application/json");
      res.writeHead(200);
      res.end(JSON.stringify({
        alive: true,
        uptime: process.uptime(),
        timestamp: Date.now(),
      }));
      return;
    }

    // GET /metrics/history/latest - Get most recent persisted snapshot
    if (req.method === "GET" && req.url === "/metrics/history/latest") {
      const persistence = getMetricsPersistence();
      if (!persistence) {
        res.setHeader("Content-Type", "application/json");
        res.writeHead(503);
        res.end(JSON.stringify({ error: "Metrics persistence not enabled" }));
        return;
      }

      try {
        const latest = await persistence.getLatest();
        if (!latest) {
          res.setHeader("Content-Type", "application/json");
          res.writeHead(404);
          res.end(JSON.stringify({ error: "No snapshots available" }));
          return;
        }

        res.setHeader("Content-Type", "application/json");
        res.writeHead(200);
        res.end(JSON.stringify(latest, null, 2));
      } catch (error: any) {
        res.setHeader("Content-Type", "application/json");
        res.writeHead(500);
        res.end(JSON.stringify({ error: error.message }));
      }
      return;
    }

    // GET /metrics/history/summary?days=7 - Get aggregated summary
    if (req.method === "GET" && req.url?.startsWith("/metrics/history/summary")) {
      const persistence = getMetricsPersistence();
      if (!persistence) {
        res.setHeader("Content-Type", "application/json");
        res.writeHead(503);
        res.end(JSON.stringify({ error: "Metrics persistence not enabled" }));
        return;
      }

      try {
        const urlParams = new URL(req.url, `http://${req.headers.host}`);
        const days = parseInt(urlParams.searchParams.get("days") || "7", 10);
        const summary = await persistence.getSummary(days);

        res.setHeader("Content-Type", "application/json");
        res.writeHead(200);
        res.end(JSON.stringify(summary, null, 2));
      } catch (error: any) {
        res.setHeader("Content-Type", "application/json");
        res.writeHead(500);
        res.end(JSON.stringify({ error: error.message }));
      }
      return;
    }

    // GET /metrics/history/manifest - Get snapshot manifest
    if (req.method === "GET" && req.url === "/metrics/history/manifest") {
      const persistence = getMetricsPersistence();
      if (!persistence) {
        res.setHeader("Content-Type", "application/json");
        res.writeHead(503);
        res.end(JSON.stringify({ error: "Metrics persistence not enabled" }));
        return;
      }

      res.setHeader("Content-Type", "application/json");
      res.writeHead(200);
      res.end(JSON.stringify(persistence.getManifest(), null, 2));
      return;
    }

    // GET /alerting/status - Get alerting service status
    if (req.method === "GET" && req.url === "/alerting/status") {
      const alerting = getAlerting();
      res.setHeader("Content-Type", "application/json");
      res.writeHead(200);
      res.end(JSON.stringify(alerting.getStatus(), null, 2));
      return;
    }

    // POST /alerting/test - Send test alert
    if (req.method === "POST" && req.url === "/alerting/test") {
      if (!validateApiKey(req)) {
        res.setHeader("Content-Type", "application/json");
        res.writeHead(401);
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      const alerting = getAlerting();
      const result = await alerting.testConnection();
      res.setHeader("Content-Type", "application/json");
      res.writeHead(result.success ? 200 : 500);
      res.end(JSON.stringify(result));
      return;
    }

    // POST /register-token - Register new token for monitoring
    if (req.method === "POST" && req.url === "/register-token") {
      if (!validateApiKey(req)) {
        logger.warn("Unauthorized register-token attempt", { ip: req.socket.remoteAddress });
        res.setHeader("Content-Type", "application/json");
        res.writeHead(401);
        res.end(JSON.stringify({ success: false, error: "Unauthorized" }));
        return;
      }

      // Parse request body with size limit and error handling (HIGH-04 FIX)
      const MAX_BODY_SIZE = 1024 * 1024; // 1MB limit
      let body = "";
      let bodySize = 0;

      req.on("error", (err) => {
        logger.error("Request stream error", { error: err.message });
        if (!res.headersSent) {
          res.setHeader("Content-Type", "application/json");
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: "Request error" }));
        }
      });

      req.on("data", (chunk) => {
        bodySize += chunk.length;
        if (bodySize > MAX_BODY_SIZE) {
          req.destroy();
          logger.warn("Request body too large", { size: bodySize, limit: MAX_BODY_SIZE });
          if (!res.headersSent) {
            res.setHeader("Content-Type", "application/json");
            res.writeHead(413); // Payload Too Large
            res.end(JSON.stringify({ success: false, error: "Request body too large" }));
          }
          return;
        }
        body += chunk;
      });

      req.on("end", async () => {
        try {
          const data = JSON.parse(body);
          if (!data.mint) {
            res.setHeader("Content-Type", "application/json");
            res.writeHead(400);
            res.end(JSON.stringify({ success: false, error: "Missing mint address" }));
            return;
          }

          // Create TokenConfig from mint
          const mintPubkey = new PublicKey(data.mint);
          const tokenConfig: TokenConfig = {
            mint: mintPubkey,
            bondingCurve: new PublicKey(data.bondingCurve || data.mint), // Will be updated by discovery
            pool: data.pool ? new PublicKey(data.pool) : undefined,
            creator: new PublicKey(data.creator || "11111111111111111111111111111111"),
            symbol: data.symbol || "TOKEN",
            name: data.name || "Token",
            poolType: data.poolType || "bonding_curve",
          };

          const registered = monitor.registerToken(tokenConfig);

          // Initialize monitoring for new token
          if (registered) {
            monitoring.initToken(mintPubkey.toBase58(), tokenConfig.symbol);
            logger.info("Token registered via API", { mint: data.mint, symbol: tokenConfig.symbol });
          }

          res.setHeader("Content-Type", "application/json");
          res.writeHead(registered ? 200 : 409); // 409 = Conflict (already exists)
          res.end(JSON.stringify({
            success: registered,
            token: registered ? {
              mint: mintPubkey.toBase58(),
              symbol: tokenConfig.symbol,
            } : undefined,
            error: registered ? undefined : "Token already registered",
          }));
        } catch (error: any) {
          logger.error("Failed to register token", { error: error.message });
          res.setHeader("Content-Type", "application/json");
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: error.message }));
        }
      });
      return;
    }

    // GET /tokens - List registered tokens
    if (req.method === "GET" && req.url === "/tokens") {
      const tokens = monitor.getRegisteredTokens();
      res.setHeader("Content-Type", "application/json");
      res.writeHead(200);
      res.end(JSON.stringify({ tokens, count: tokens.length }));
      return;
    }

    res.setHeader("Content-Type", "application/json");
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(API_PORT, () => {
    logger.info(`API server listening on port ${API_PORT}`);
    console.log(`🌐 API server listening on port ${API_PORT}`);
    console.log(`   POST /flush           - Force flush pending fees${API_KEY ? ' (requires X-Daemon-Key)' : ''}`);
    console.log(`   POST /register-token  - Register new token${API_KEY ? ' (requires X-Daemon-Key)' : ''}`);
    console.log(`   GET /tokens           - List registered tokens`);
    console.log(`   GET /status           - Basic daemon status`);
    console.log(`   GET /metrics          - Prometheus format metrics`);
    console.log(`   GET /stats            - JSON detailed statistics`);
    console.log(`   GET /health           - Health check endpoint`);
    console.log(`   GET /ready            - Kubernetes readiness probe`);
    console.log(`   GET /live             - Kubernetes liveness probe`);
    console.log(`   GET /metrics/history/latest   - Latest persisted snapshot`);
    console.log(`   GET /metrics/history/summary  - Historical summary`);
    console.log(`   GET /metrics/history/manifest - Snapshot manifest`);
    console.log(`   GET /alerting/status  - Alerting service status`);
    console.log(`   POST /alerting/test   - Send test alert${API_KEY ? ' (requires X-Daemon-Key)' : ''}`);
  });

  return server;
}

/**
 * Write discovered token to config file
 */
function writeTokenConfig(
  token: DiscoveredToken,
  network: NetworkType,
  isRoot: boolean = false
): string {
  const tokensDir = `${network}-tokens`;
  if (!fs.existsSync(tokensDir)) {
    fs.mkdirSync(tokensDir, { recursive: true });
  }

  // Find next available number
  const existingFiles = fs.readdirSync(tokensDir).filter(f => f.endsWith('.json'));
  const numbers = existingFiles.map(f => parseInt(f.split('-')[0], 10)).filter(n => !isNaN(n));
  const nextNum = Math.max(0, ...numbers) + 1;
  const filename = `${String(nextNum).padStart(2, '0')}-${token.symbol.toLowerCase()}.json`;

  const config = {
    mint: token.mint,
    bondingCurve: token.bondingCurve,
    pool: token.pool,
    creator: token.creator,
    isCTO: token.isCTO,
    name: token.name,
    symbol: token.symbol,
    uri: `https://pump.fun/coin/${token.mint}`,
    isRoot,
    mayhemMode: token.tokenProgram === 'Token2022',
    tokenProgram: token.tokenProgram,
    poolType: token.poolType,
    network,
    discoveredAt: token.discoveredAt,
  };

  const filepath = path.join(tokensDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(config, null, 2));
  return filepath;
}

/**
 * Run auto-discovery loop
 */
async function runAutoDiscovery(
  connection: Connection,
  monitor: PumpFunFeeMonitor,
  creatorAddress: string,
  network: NetworkType,
  logger: Logger
): Promise<void> {
  logger.info("Running auto-discovery scan...");

  try {
    // Get existing mints
    const existingMints = new Set(monitor.getRegisteredTokens());

    // Run discovery
    const result = await discoverCreatorTokens(connection, creatorAddress, existingMints, {
      verbose: false,
      maxTransactions: 100, // Limit for periodic scans
    });

    if (result.tokens.length === 0) {
      logger.debug("No new tokens discovered");
      return;
    }

    logger.info(`Discovered ${result.tokens.length} new token(s)`);

    // Register each new token
    for (const token of result.tokens) {
      const tokenConfig: TokenConfig = {
        mint: new PublicKey(token.mint),
        bondingCurve: new PublicKey(token.bondingCurve),
        pool: token.pool ? new PublicKey(token.pool) : undefined,
        creator: new PublicKey(token.creator),
        symbol: token.symbol,
        name: token.name,
        poolType: token.poolType,
      };

      const registered = monitor.registerToken(tokenConfig);
      if (registered) {
        // Write config file for persistence
        const filepath = writeTokenConfig(token, network);
        logger.info(`Registered and saved: ${token.symbol}`, { filepath });

        // Initialize monitoring
        monitoring.initToken(token.mint, token.symbol);
      }
    }

    if (result.errors.length > 0) {
      logger.warn(`Discovery had ${result.errors.length} error(s)`, { errors: result.errors });
    }
  } catch (error: any) {
    logger.error("Auto-discovery failed", { error: error.message });
  }
}

/**
 * Main monitoring function
 */
async function main() {
  // Parse network argument
  const args = process.argv.slice(2);
  const networkConfig = getNetworkConfig(args);
  const isVerbose = args.includes("--verbose") || VERBOSE;
  const autoDiscover = args.includes("--auto-discover");

  // Initialize logger
  const logger = createLogger("daemon", {
    level: isVerbose ? "debug" : "info",
    console: true,
    file: true,
    filePath: `./logs/asdf-daemon-${networkConfig.name.toLowerCase()}.log`,
  });

  // Acquire daemon lock to prevent multiple instances
  const daemonLock = new ExecutionLock({ lockFile: '.daemon-lock.json' });
  if (!daemonLock.acquire('fee-monitor-daemon')) {
    const status = daemonLock.getStatus();
    console.error("❌ Cannot start: Another daemon instance is already running");
    console.error(`   PID: ${status.lockInfo?.pid}`);
    console.error(`   Started: ${new Date(status.lockInfo?.timestamp || 0).toISOString()}`);
    console.error("\n   To force start, delete .daemon-lock.json");
    process.exit(1);
  }
  logger.info("Daemon lock acquired");

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

  // Initialize alerting service
  console.log("\n📢 Initializing alerting service...");
  const alertingEnv = validateAlertingEnv();
  const alerting = initAlerting({
    webhookUrl: alertingEnv.WEBHOOK_URL || '',
    webhookType: alertingEnv.WEBHOOK_TYPE,
    enabled: alertingEnv.ALERT_ENABLED,
    rateLimitWindowMs: alertingEnv.ALERT_RATE_LIMIT_WINDOW,
    rateLimitMaxAlerts: alertingEnv.ALERT_RATE_LIMIT_MAX,
    minAlertIntervalMs: alertingEnv.ALERT_COOLDOWN_MS,
  }, {
    errorRatePercent: alertingEnv.ALERT_ERROR_RATE_THRESHOLD,
    pollLagMultiplier: alertingEnv.ALERT_POLL_LAG_MULTIPLIER,
    pendingFeesStuckMinutes: alertingEnv.ALERT_PENDING_STUCK_MINUTES,
    failedCyclesConsecutive: alertingEnv.ALERT_FAILED_CYCLES_MAX,
  });

  if (alertingEnv.WEBHOOK_URL) {
    console.log(`   ✅ Webhook configured (${alertingEnv.WEBHOOK_TYPE})`);
    logger.info("Alerting initialized", { webhookType: alertingEnv.WEBHOOK_TYPE });
  } else {
    console.log(`   ⚠️  No webhook configured - alerts disabled`);
    logger.warn("No webhook URL configured, alerts disabled");
  }

  // Initialize metrics persistence
  console.log("\n💾 Initializing metrics persistence...");
  const persistenceEnv = validateMetricsPersistenceEnv();
  let persistence: MetricsPersistence | null = null;

  if (persistenceEnv.METRICS_ENABLED) {
    persistence = initMetricsPersistence(monitoring, {
      dataDir: persistenceEnv.METRICS_DATA_DIR,
      snapshotIntervalMs: persistenceEnv.METRICS_SNAPSHOT_INTERVAL,
      retentionDays: persistenceEnv.METRICS_RETENTION_DAYS,
      enabled: true,
    });
    persistence.start();
    console.log(`   ✅ Persistence enabled (dir: ${persistenceEnv.METRICS_DATA_DIR})`);
    logger.info("Metrics persistence initialized", {
      dataDir: persistenceEnv.METRICS_DATA_DIR,
      interval: persistenceEnv.METRICS_SNAPSHOT_INTERVAL,
    });
  } else {
    console.log(`   ⚠️  Persistence disabled`);
    logger.info("Metrics persistence disabled");
  }

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

  // Send daemon restart alert
  alerting.sendDaemonRestart().catch((err) => {
    logger.debug("Failed to send restart alert", { error: err.message });
  });

  // Start API server for external flush triggers and monitoring
  const apiServer = startApiServer(monitor, logger);

  // Display stats every minute
  const statsInterval = setInterval(() => {
    displayStats(monitor, allTokens);
  }, 60000); // Every 60 seconds

  // Auto-discovery loop (if enabled)
  let discoveryInterval: NodeJS.Timeout | null = null;
  if (autoDiscover && ecosystem.root) {
    const creatorAddress = ecosystem.root.creator.toBase58();
    console.log(`\n🔍 Auto-discovery enabled (interval: ${AUTO_DISCOVER_INTERVAL / 1000}s)`);
    console.log(`   Creator: ${creatorAddress.slice(0, 8)}...`);
    logger.info("Auto-discovery enabled", { creator: creatorAddress, interval: AUTO_DISCOVER_INTERVAL });

    // Run initial discovery after 30s delay
    setTimeout(async () => {
      await runAutoDiscovery(connection, monitor, creatorAddress, networkConfig.name as NetworkType, logger);
    }, 30000);

    // Then run periodically
    discoveryInterval = setInterval(async () => {
      await runAutoDiscovery(connection, monitor, creatorAddress, networkConfig.name as NetworkType, logger);
    }, AUTO_DISCOVER_INTERVAL);
  } else if (autoDiscover && !ecosystem.root) {
    console.log(`\n⚠️  Auto-discovery disabled: No root token configured (need creator address)`);
    logger.warn("Auto-discovery disabled - no root token configured");
  }

  // Periodic alert checking (every 30 seconds)
  const alertCheckInterval = setInterval(() => {
    monitoring.checkAlertConditions(5000);  // Expected poll interval: 5s
  }, 30000);

  // Display initial stats
  setTimeout(() => displayStats(monitor, allTokens), 5000);

  // Graceful shutdown handlers
  let shuttingDown = false;
  const SHUTDOWN_TIMEOUT_MS = 30000; // 30 seconds hard timeout

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`Received ${signal}, shutting down gracefully...`);
    console.log(`\n\n📌 Received ${signal}, shutting down gracefully...`);

    // Hard timeout to prevent zombie process
    const hardTimeout = setTimeout(() => {
      console.error("⚠️ Shutdown timeout exceeded, forcing exit...");
      logger.error("Shutdown timeout - forcing exit");
      daemonLock.release();
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    clearInterval(statsInterval);
    clearInterval(alertCheckInterval);
    if (discoveryInterval) clearInterval(discoveryInterval);

    // Stop metrics persistence
    if (persistence) {
      try {
        await persistence.stop();
        logger.info("Metrics persistence stopped");
      } catch (err: any) {
        logger.warn("Error stopping persistence", { error: err.message });
      }
    }

    // Properly close HTTP server with promise wrapper
    await new Promise<void>((resolve) => {
      apiServer.close(() => {
        logger.info("HTTP API server closed");
        resolve();
      });
      // Timeout in case server doesn't close gracefully
      setTimeout(() => resolve(), 5000);
    });

    try {
      await monitor.stop();
      logger.success("Monitor stopped successfully");
      console.log("✅ Monitor stopped successfully");

      // Release daemon lock
      daemonLock.release();
      logger.info("Daemon lock released");

      clearTimeout(hardTimeout);
      logger.close();
      process.exit(0);
    } catch (error: any) {
      logger.error("Error during shutdown", { error: error.message });
      console.error("❌ Error during shutdown:", error.message);

      // Always release lock even on error
      daemonLock.release();

      clearTimeout(hardTimeout);
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

// MEDIUM-06 FIX: Global exception handlers to prevent silent crashes
process.on("uncaughtException", (error) => {
  console.error("\n💥 Uncaught Exception:", error.message);
  console.error(error.stack);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("\n⚠️ Unhandled Rejection:", reason);
  // Don't exit for unhandled rejections, just log them
});

// Run with error handling
main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
