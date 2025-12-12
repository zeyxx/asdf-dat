#!/usr/bin/env npx ts-node

/**
 * E2E CYCLE VALIDATION - Production-Grade Test Suite
 *
 * Comprehensive end-to-end validation of the ASDF-DAT ecosystem.
 *
 * Phases:
 *   1. PRE-FLIGHT    - Verify wallet, program, configs
 *   2. STATE BEFORE  - Capture complete ecosystem state
 *   3. VOLUME GEN    - Generate trading volume (buy + sell)
 *   4. DAEMON SYNC   - Wait for fee detection
 *   5. CYCLE EXEC    - Execute orchestrator
 *   6. STATE AFTER   - Capture final state
 *   7. VERIFICATION  - Run all checks
 *   8. REPORT        - Generate markdown report
 *
 * Usage:
 *   npx ts-node scripts/e2e-cycle-validation.ts --network devnet
 *   npx ts-node scripts/e2e-cycle-validation.ts --network devnet --skip-volume
 *   npx ts-node scripts/e2e-cycle-validation.ts --network devnet --dry-run
 *
 * Philosophy: "Flush. Burn. Verify. This is fine."
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, Idl } from "@coral-xyz/anchor";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

import { getNetworkConfig, printNetworkBanner } from "../lib/network-config";
import {
  loadIdl,
  loadAllTokenConfigs,
  sleep,
  log,
  formatSol,
  captureE2EState,
  compareE2EStates,
  runE2EVerifications,
  generateE2EReport,
  parseTxSignatures,
  generateVolume,
  executeEcosystemCycle,
  E2EStateSnapshot,
  E2EStateDiff,
  VerificationResult,
  PROGRAM_ID,
} from "../lib/test-utils";
import { TokenConfig } from "../lib/types";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Minimum wallet balance to run tests
  minWalletBalance: 0.5 * LAMPORTS_PER_SOL,

  // Volume per token (SOL)
  volumePerToken: 0.5,

  // Minimum fees per token to proceed with cycle (lamports)
  minFeesPerToken: 6_000_000, // 0.006 SOL

  // Daemon sync timeout (ms)
  daemonSyncTimeout: 60_000,

  // Daemon poll interval (ms)
  daemonPollInterval: 5_000,

  // Cycle execution timeout (ms)
  cycleTimeout: 300_000, // 5 minutes

  // Reports directory
  reportsDir: "reports",
};

// ═══════════════════════════════════════════════════════════════════════════
// CLI COLORS
// ═══════════════════════════════════════════════════════════════════════════

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

function section(title: string): void {
  console.log("\n" + "═".repeat(70));
  console.log(`  ${colors.bright}${colors.cyan}${title}${colors.reset}`);
  console.log("═".repeat(70) + "\n");
}

function success(msg: string): void {
  console.log(`${colors.green}✓${colors.reset} ${msg}`);
}

function warn(msg: string): void {
  console.log(`${colors.yellow}⚠${colors.reset} ${msg}`);
}

function error(msg: string): void {
  console.log(`${colors.red}✗${colors.reset} ${msg}`);
}

function info(msg: string): void {
  console.log(`${colors.blue}ℹ${colors.reset} ${msg}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN E2E VALIDATOR
// ═══════════════════════════════════════════════════════════════════════════

interface E2EOptions {
  network: "devnet" | "mainnet";
  skipVolume: boolean;
  dryRun: boolean;
}

class E2ECycleValidator {
  private connection: Connection;
  private program: Program;
  private wallet: Keypair;
  private tokens: TokenConfig[];
  private network: "devnet" | "mainnet";
  private options: E2EOptions;

  private txSignatures: Array<{ phase: string; token: string; signature: string }> = [];
  private executionLogs: string[] = [];

  constructor(options: E2EOptions) {
    this.options = options;
    this.network = options.network;

    // Setup connection and wallet
    const networkConfig = getNetworkConfig(["--network", options.network]);
    this.connection = new Connection(networkConfig.rpcUrl, "confirmed");

    this.wallet = Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(fs.readFileSync(networkConfig.wallet, "utf-8")))
    );

    // Setup program
    const provider = new AnchorProvider(this.connection, new Wallet(this.wallet), {
      commitment: "confirmed",
    });
    const idl = loadIdl();
    this.program = new Program(idl, provider);

    // Load token configs
    const tokensDir = options.network === "devnet" ? "devnet-tokens" : "mainnet-tokens";
    this.tokens = loadAllTokenConfigs(tokensDir);
  }

  /**
   * Phase 1: Pre-flight checks
   */
  async runPreflightChecks(): Promise<boolean> {
    section("PHASE 1: PRE-FLIGHT CHECKS");

    let allPassed = true;

    // 1.1 Wallet balance
    const balance = await this.connection.getBalance(this.wallet.publicKey);
    if (balance >= CONFIG.minWalletBalance) {
      success(`Wallet balance: ${formatSol(balance)} SOL (min: ${formatSol(CONFIG.minWalletBalance)} SOL)`);
    } else {
      error(`Wallet balance: ${formatSol(balance)} SOL (need: ${formatSol(CONFIG.minWalletBalance)} SOL)`);
      allPassed = false;
    }

    // 1.2 Token configs
    if (this.tokens.length > 0) {
      success(`Token configs loaded: ${this.tokens.length} tokens`);
      for (const token of this.tokens) {
        info(`  - ${token.symbol} ${token.isRoot ? "(ROOT)" : "(SECONDARY)"}`);
      }
    } else {
      error("No token configs found");
      allPassed = false;
    }

    // 1.3 Root token exists
    const rootToken = this.tokens.find((t) => t.isRoot);
    if (rootToken) {
      success(`Root token: ${rootToken.symbol} (${rootToken.mint.slice(0, 8)}...)`);
    } else {
      error("No root token configured");
      allPassed = false;
    }

    // 1.4 Program deployed
    try {
      const programInfo = await this.connection.getAccountInfo(PROGRAM_ID);
      if (programInfo) {
        success(`Program deployed: ${PROGRAM_ID.toString().slice(0, 12)}...`);
      } else {
        error("Program not found on-chain");
        allPassed = false;
      }
    } catch (e) {
      error(`Failed to check program: ${e}`);
      allPassed = false;
    }

    // 1.5 Check TokenStats exist
    for (const token of this.tokens) {
      const [tokenStatsPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_stats_v1"), new PublicKey(token.mint).toBuffer()],
        PROGRAM_ID
      );
      try {
        const info = await this.connection.getAccountInfo(tokenStatsPda);
        if (info) {
          success(`TokenStats initialized: ${token.symbol}`);
        } else {
          warn(`TokenStats NOT initialized: ${token.symbol} (will skip)`);
        }
      } catch {
        warn(`TokenStats check failed: ${token.symbol}`);
      }
    }

    return allPassed;
  }

  /**
   * Phase 2: Capture initial state
   */
  async captureStateBefore(): Promise<E2EStateSnapshot> {
    section("PHASE 2: CAPTURING INITIAL STATE");

    const state = await captureE2EState(
      this.connection,
      this.program,
      this.tokens,
      this.wallet.publicKey,
      this.network
    );

    info(`Captured at: ${state.capturedAt}`);
    info(`Wallet balance: ${formatSol(state.walletBalance)} SOL`);
    info(`Root treasury: ${formatSol(state.rootTreasuryBalance)} SOL`);

    for (const token of state.tokens) {
      info(`${token.symbol}: pending=${formatSol(token.pendingFeesLamports)} SOL, burned=${token.totalBurned.toLocaleString()}`);
    }

    return state;
  }

  /**
   * Phase 3: Generate trading volume
   */
  async generateVolume(): Promise<void> {
    section("PHASE 3: GENERATING TRADING VOLUME");

    if (this.options.skipVolume) {
      warn("Skipping volume generation (--skip-volume)");
      return;
    }

    if (this.options.dryRun) {
      warn("Dry run - simulating volume generation");
      return;
    }

    for (const token of this.tokens) {
      info(`\nGenerating ${CONFIG.volumePerToken} SOL volume on ${token.symbol}...`);

      const configPath = path.join(
        this.network === "devnet" ? "devnet-tokens" : "mainnet-tokens",
        `${token.symbol.toLowerCase()}.json`
      );

      // Find actual config file
      const tokensDir = this.network === "devnet" ? "devnet-tokens" : "mainnet-tokens";
      const files = fs.readdirSync(tokensDir);
      const configFile = files.find((f) =>
        f.toLowerCase().includes(token.symbol.toLowerCase()) ||
        JSON.parse(fs.readFileSync(path.join(tokensDir, f), "utf-8")).symbol === token.symbol
      );

      if (!configFile) {
        warn(`Config file not found for ${token.symbol}, skipping`);
        continue;
      }

      const fullPath = path.join(tokensDir, configFile);

      try {
        const { buyTx, sellTx } = await generateVolume(fullPath, CONFIG.volumePerToken, this.network);

        if (buyTx) {
          success(`Buy TX: ${buyTx.slice(0, 20)}...`);
          this.txSignatures.push({ phase: "Volume-Buy", token: token.symbol, signature: buyTx });
        }
        if (sellTx) {
          success(`Sell TX: ${sellTx.slice(0, 20)}...`);
          this.txSignatures.push({ phase: "Volume-Sell", token: token.symbol, signature: sellTx });
        }
      } catch (e: any) {
        warn(`Volume generation failed for ${token.symbol}: ${e.message?.slice(0, 50)}`);
      }

      // Wait between tokens
      await sleep(2000);
    }
  }

  /**
   * Phase 4: Wait for daemon sync
   */
  async waitForDaemonSync(): Promise<boolean> {
    section("PHASE 4: WAITING FOR DAEMON SYNC");

    if (this.options.dryRun) {
      warn("Dry run - skipping daemon sync");
      return true;
    }

    info(`Waiting up to ${CONFIG.daemonSyncTimeout / 1000}s for fees to be detected...`);

    const startTime = Date.now();
    let lastPendingTotal = 0;

    while (Date.now() - startTime < CONFIG.daemonSyncTimeout) {
      // Check pending fees
      const state = await captureE2EState(
        this.connection,
        this.program,
        this.tokens,
        this.wallet.publicKey,
        this.network
      );

      const totalPending = state.tokens.reduce((sum, t) => sum + t.pendingFeesLamports, 0);

      if (totalPending !== lastPendingTotal) {
        info(`Pending fees: ${formatSol(totalPending)} SOL`);
        lastPendingTotal = totalPending;
      }

      // Check if all tokens have minimum fees
      const tokensWithFees = state.tokens.filter(
        (t) => t.pendingFeesLamports >= CONFIG.minFeesPerToken
      );

      if (tokensWithFees.length === this.tokens.length) {
        success(`All ${this.tokens.length} tokens have sufficient fees`);
        return true;
      }

      if (tokensWithFees.length > 0) {
        info(`${tokensWithFees.length}/${this.tokens.length} tokens ready`);
      }

      await sleep(CONFIG.daemonPollInterval);
    }

    warn("Daemon sync timeout - proceeding with available fees");
    return false;
  }

  /**
   * Phase 5: Execute ecosystem cycle
   */
  async executeCycle(): Promise<{ success: boolean; output: string }> {
    section("PHASE 5: EXECUTING ECOSYSTEM CYCLE");

    if (this.options.dryRun) {
      warn("Dry run - simulating cycle execution");
      return { success: true, output: "DRY RUN" };
    }

    // Find root token config file
    const rootToken = this.tokens.find((t) => t.isRoot);
    if (!rootToken) {
      error("No root token found");
      return { success: false, output: "No root token" };
    }

    const tokensDir = this.network === "devnet" ? "devnet-tokens" : "mainnet-tokens";
    const files = fs.readdirSync(tokensDir);
    const rootFile = files.find((f) => {
      try {
        const config = JSON.parse(fs.readFileSync(path.join(tokensDir, f), "utf-8"));
        return config.isRoot === true;
      } catch {
        return false;
      }
    });

    if (!rootFile) {
      error("Root token config file not found");
      return { success: false, output: "Root config not found" };
    }

    const rootPath = path.join(tokensDir, rootFile);
    info(`Executing cycle with root: ${rootPath}`);

    const result = await executeEcosystemCycle(rootPath, this.network);

    if (result.success) {
      success("Cycle executed successfully");

      // Parse TX signatures from output
      const signatures = parseTxSignatures(result.output);
      this.txSignatures.push(...signatures);
    } else {
      error("Cycle execution failed");
    }

    // Store logs
    this.executionLogs = result.output.split("\n");

    return result;
  }

  /**
   * Phase 6: Capture final state
   */
  async captureStateAfter(): Promise<E2EStateSnapshot> {
    section("PHASE 6: CAPTURING FINAL STATE");

    const state = await captureE2EState(
      this.connection,
      this.program,
      this.tokens,
      this.wallet.publicKey,
      this.network
    );

    info(`Captured at: ${state.capturedAt}`);
    info(`Wallet balance: ${formatSol(state.walletBalance)} SOL`);
    info(`Root treasury: ${formatSol(state.rootTreasuryBalance)} SOL`);

    for (const token of state.tokens) {
      info(`${token.symbol}: pending=${formatSol(token.pendingFeesLamports)} SOL, burned=${token.totalBurned.toLocaleString()}`);
    }

    return state;
  }

  /**
   * Phase 7: Run verifications
   */
  runVerifications(
    before: E2EStateSnapshot,
    after: E2EStateSnapshot,
    diff: E2EStateDiff
  ): VerificationResult[] {
    section("PHASE 7: RUNNING VERIFICATIONS");

    const results = runE2EVerifications(before, after, diff);

    for (const result of results) {
      if (result.passed) {
        success(`${result.name}`);
        info(`  Expected: ${result.expected}`);
        info(`  Actual: ${result.actual}`);
      } else {
        error(`${result.name}`);
        info(`  Expected: ${result.expected}`);
        error(`  Actual: ${result.actual}`);
      }
    }

    return results;
  }

  /**
   * Phase 8: Generate report
   */
  generateReport(
    before: E2EStateSnapshot,
    after: E2EStateSnapshot,
    diff: E2EStateDiff,
    verifications: VerificationResult[]
  ): string {
    section("PHASE 8: GENERATING REPORT");

    // Ensure reports directory exists
    if (!fs.existsSync(CONFIG.reportsDir)) {
      fs.mkdirSync(CONFIG.reportsDir, { recursive: true });
    }

    // Generate report content
    const report = generateE2EReport(
      before,
      after,
      diff,
      verifications,
      this.txSignatures,
      this.executionLogs
    );

    // Write report
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `e2e-${this.network}-${timestamp}.md`;
    const filepath = path.join(CONFIG.reportsDir, filename);

    fs.writeFileSync(filepath, report);
    success(`Report saved: ${filepath}`);

    // Also save JSON state for debugging
    const jsonPath = filepath.replace(".md", ".json");
    fs.writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          before,
          after,
          diff,
          verifications,
          txSignatures: this.txSignatures,
        },
        null,
        2
      )
    );
    success(`JSON data saved: ${jsonPath}`);

    return filepath;
  }

  /**
   * Run complete E2E validation
   */
  async run(): Promise<number> {
    console.clear();
    console.log("\n" + "═".repeat(70));
    console.log(`  ${colors.bright}${colors.magenta}E2E CYCLE VALIDATION${colors.reset}`);
    console.log(`  ${colors.dim}"Flush. Burn. Verify. This is fine."${colors.reset}`);
    console.log("═".repeat(70));

    printNetworkBanner(getNetworkConfig(["--network", this.network]));

    const startTime = Date.now();

    try {
      // Phase 1: Pre-flight
      const preflightPassed = await this.runPreflightChecks();
      if (!preflightPassed && !this.options.dryRun) {
        error("\nPre-flight checks failed. Aborting.");
        return 1;
      }

      // Phase 2: State before
      const stateBefore = await this.captureStateBefore();

      // Phase 3: Volume generation
      await this.generateVolume();

      // Phase 4: Daemon sync
      await this.waitForDaemonSync();

      // Phase 5: Execute cycle
      const cycleResult = await this.executeCycle();

      // Phase 6: State after
      const stateAfter = await this.captureStateAfter();

      // Compare states
      const diff = compareE2EStates(stateBefore, stateAfter);

      // Phase 7: Verifications
      const verifications = this.runVerifications(stateBefore, stateAfter, diff);

      // Phase 8: Report
      const reportPath = this.generateReport(stateBefore, stateAfter, diff, verifications);

      // Final summary
      const duration = Date.now() - startTime;
      const passedCount = verifications.filter((v) => v.passed).length;
      const totalCount = verifications.length;
      const allPassed = passedCount === totalCount;

      section("FINAL SUMMARY");

      console.log(`Duration:      ${Math.floor(duration / 60000)}m ${Math.floor((duration % 60000) / 1000)}s`);
      console.log(`Network:       ${this.network}`);
      console.log(`Tokens:        ${this.tokens.length}`);
      console.log(`Transactions:  ${this.txSignatures.length}`);
      console.log(`Verifications: ${passedCount}/${totalCount}`);
      console.log(`Report:        ${reportPath}`);
      console.log();

      if (allPassed) {
        console.log(`${colors.green}${colors.bright}ALL TESTS PASSED${colors.reset}`);
        return 0;
      } else {
        console.log(`${colors.red}${colors.bright}SOME TESTS FAILED${colors.reset}`);
        return 1;
      }
    } catch (e: any) {
      error(`\nFatal error: ${e.message}`);
      console.error(e);
      return 1;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  const networkArg = args.find((a) => a.startsWith("--network="))?.split("=")[1] ||
    (args.includes("--network") ? args[args.indexOf("--network") + 1] : "devnet");
  const skipVolume = args.includes("--skip-volume");
  const dryRun = args.includes("--dry-run");

  if (!["devnet", "mainnet"].includes(networkArg)) {
    console.error("Usage: npx ts-node scripts/e2e-cycle-validation.ts --network [devnet|mainnet]");
    console.error("Options:");
    console.error("  --skip-volume  Skip volume generation");
    console.error("  --dry-run      Run without executing transactions");
    process.exit(1);
  }

  const options: E2EOptions = {
    network: networkArg as "devnet" | "mainnet",
    skipVolume,
    dryRun,
  };

  const validator = new E2ECycleValidator(options);
  const exitCode = await validator.run();
  process.exit(exitCode);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
