/**
 * Control Panel API - Real Script Execution
 *
 * Executes real scripts for E2E testing on devnet.
 * NOT for mainnet use - devnet only!
 */

import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { Connection, PublicKey } from "@solana/web3.js";

const DEVNET_TOKENS_DIR = "devnet-tokens";
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const PROGRAM_ID = new PublicKey("ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui");

export interface TokenConfig {
  mint: string;
  bondingCurve: string;
  creator: string;
  name: string;
  symbol: string;
  isRoot: boolean;
  tokenProgram: string;
  poolType: string;
  network: string;
}

export interface ScriptResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
}

/**
 * List available devnet tokens
 */
export function listDevnetTokens(): TokenConfig[] {
  const tokensDir = path.join(process.cwd(), DEVNET_TOKENS_DIR);

  if (!fs.existsSync(tokensDir)) {
    return [];
  }

  const files = fs.readdirSync(tokensDir).filter(f => f.endsWith(".json"));
  const tokens: TokenConfig[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(tokensDir, file), "utf-8");
      const token = JSON.parse(content) as TokenConfig;
      tokens.push({
        ...token,
        // Add filename for reference
        _file: file,
      } as TokenConfig & { _file: string });
    } catch (e) {
      console.error(`Error reading ${file}:`, e);
    }
  }

  // Sort: root tokens first, then by symbol
  return tokens.sort((a, b) => {
    if (a.isRoot && !b.isRoot) return -1;
    if (!a.isRoot && b.isRoot) return 1;
    return a.symbol.localeCompare(b.symbol);
  });
}

/**
 * Run a script and capture output
 */
export function runScript(
  scriptPath: string,
  args: string[],
  timeoutMs: number = 120000
): Promise<ScriptResult> {
  return new Promise((resolve) => {
    const output: string[] = [];
    const errors: string[] = [];

    const proc = spawn("npx", ["ts-node", scriptPath, ...args], {
      cwd: process.cwd(),
      env: { ...process.env },
    });

    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
      resolve({
        success: false,
        output: output.join("\n"),
        error: "Script timed out",
        exitCode: -1,
      });
    }, timeoutMs);

    proc.stdout.on("data", (data) => {
      const line = data.toString();
      output.push(line);
      // Log to console for debugging
      process.stdout.write(line);
    });

    proc.stderr.on("data", (data) => {
      const line = data.toString();
      errors.push(line);
      process.stderr.write(line);
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        success: code === 0,
        output: output.join(""),
        error: errors.length > 0 ? errors.join("") : undefined,
        exitCode: code ?? -1,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      resolve({
        success: false,
        output: output.join(""),
        error: err.message,
        exitCode: -1,
      });
    });
  });
}

/**
 * Generate volume on a token (buy transactions)
 */
export async function generateVolume(
  tokenFile: string,
  numBuys: number = 2,
  buyAmountSol: number = 0.5
): Promise<ScriptResult> {
  const scriptPath = "scripts/generate-volume.ts";
  const tokenPath = path.join(DEVNET_TOKENS_DIR, tokenFile);

  if (!fs.existsSync(tokenPath)) {
    return {
      success: false,
      output: "",
      error: `Token file not found: ${tokenFile}`,
      exitCode: 1,
    };
  }

  return runScript(scriptPath, [tokenPath, numBuys.toString(), buyAmountSol.toString()]);
}

/**
 * Sell tokens (generates fees on sell side too)
 */
export async function sellTokens(tokenFile: string): Promise<ScriptResult> {
  const scriptPath = "scripts/sell-spl-tokens-simple.ts";
  const tokenPath = path.join(DEVNET_TOKENS_DIR, tokenFile);

  if (!fs.existsSync(tokenPath)) {
    return {
      success: false,
      output: "",
      error: `Token file not found: ${tokenFile}`,
      exitCode: 1,
    };
  }

  return runScript(scriptPath, [tokenPath]);
}

/**
 * Execute ecosystem burn cycle
 */
export async function executeCycle(
  tokenFile: string,
  network: string = "devnet"
): Promise<ScriptResult> {
  const scriptPath = "scripts/execute-ecosystem-cycle.ts";
  const tokenPath = path.join(DEVNET_TOKENS_DIR, tokenFile);

  if (!fs.existsSync(tokenPath)) {
    return {
      success: false,
      output: "",
      error: `Token file not found: ${tokenFile}`,
      exitCode: 1,
    };
  }

  return runScript(scriptPath, [tokenPath, "--network", network], 180000);
}

/**
 * Check fees accumulated in creator vault
 */
export async function checkFees(
  creatorPubkey: string,
  rootMint?: string,
  rpcUrl: string = "https://api.devnet.solana.com"
): Promise<{
  creatorVault: { address: string; balance: number };
  rootTreasury?: { address: string; balance: number };
  total: number;
  available: number;
  status: "excellent" | "good" | "low" | "insufficient";
}> {
  const connection = new Connection(rpcUrl, "confirmed");
  const creator = new PublicKey(creatorPubkey);

  // Get creator vault PDA
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), creator.toBuffer()],
    PUMP_PROGRAM
  );

  const vaultBalance = await connection.getBalance(vault);

  let treasuryBalance = 0;
  let treasuryAddress: string | undefined;

  if (rootMint) {
    const rootMintPubkey = new PublicKey(rootMint);
    const [treasury] = PublicKey.findProgramAddressSync(
      [Buffer.from("root_treasury"), rootMintPubkey.toBuffer()],
      PROGRAM_ID
    );
    treasuryAddress = treasury.toBase58();
    treasuryBalance = await connection.getBalance(treasury);
  }

  const total = (vaultBalance + treasuryBalance) / 1e9;
  const rentExempt = 0.000891;
  const safetyBuffer = 0.00005;
  const available = Math.max(0, total - rentExempt - safetyBuffer);

  let status: "excellent" | "good" | "low" | "insufficient";
  if (available >= 0.01) status = "excellent";
  else if (available >= 0.005) status = "good";
  else if (available > 0) status = "low";
  else status = "insufficient";

  return {
    creatorVault: {
      address: vault.toBase58(),
      balance: vaultBalance / 1e9,
    },
    rootTreasury: treasuryAddress
      ? { address: treasuryAddress, balance: treasuryBalance / 1e9 }
      : undefined,
    total,
    available,
    status,
  };
}

/**
 * Get wallet balance
 */
export async function getWalletBalance(
  rpcUrl: string = "https://api.devnet.solana.com"
): Promise<{ address: string; balance: number }> {
  const walletPath = "devnet-wallet.json";

  if (!fs.existsSync(walletPath)) {
    throw new Error("devnet-wallet.json not found");
  }

  const connection = new Connection(rpcUrl, "confirmed");
  const keypairData = JSON.parse(fs.readFileSync(walletPath, "utf-8"));

  // Extract pubkey from keypair (first 32 bytes is private, pubkey is derived)
  const { Keypair } = require("@solana/web3.js");
  const keypair = Keypair.fromSecretKey(new Uint8Array(keypairData));

  const balance = await connection.getBalance(keypair.publicKey);

  return {
    address: keypair.publicKey.toBase58(),
    balance: balance / 1e9,
  };
}

/**
 * Full E2E workflow for a token
 * 1. Generate volume (buy+sell cycles)
 * 2. Wait for daemon to detect fees
 * 3. Execute burn cycle
 */
export async function runFullWorkflow(
  tokenFile: string,
  options: {
    cycles?: number;
    solPerCycle?: number;
    waitMs?: number;
    onProgress?: (step: string, status: string, details?: string) => void;
  } = {}
): Promise<{
  success: boolean;
  steps: Array<{ step: string; success: boolean; output?: string; error?: string }>;
}> {
  const {
    cycles = 2,
    solPerCycle = 0.5,
    waitMs = 5000,
    onProgress = () => {},
  } = options;

  const steps: Array<{ step: string; success: boolean; output?: string; error?: string }> = [];

  // Step 1: Generate volume (buy+sell cycles)
  onProgress("volume", "running", `${cycles} cycles x ${solPerCycle} SOL`);
  const volumeResult = await generateVolume(tokenFile, cycles, solPerCycle);
  steps.push({
    step: "volume",
    success: volumeResult.success,
    output: volumeResult.output,
    error: volumeResult.error,
  });

  if (!volumeResult.success) {
    onProgress("volume", "error", volumeResult.error);
    return { success: false, steps };
  }
  onProgress("volume", "done");

  // Step 2: Wait for daemon to sync
  onProgress("wait", "running", `Waiting ${waitMs / 1000}s for fee detection`);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  steps.push({ step: "wait", success: true });
  onProgress("wait", "done");

  // Step 3: Execute burn cycle
  onProgress("cycle", "running", "Executing burn cycle");
  const cycleResult = await executeCycle(tokenFile);
  steps.push({
    step: "cycle",
    success: cycleResult.success,
    output: cycleResult.output,
    error: cycleResult.error,
  });

  if (!cycleResult.success) {
    onProgress("cycle", "error", cycleResult.error);
    return { success: false, steps };
  }
  onProgress("cycle", "done");

  return { success: true, steps };
}

/**
 * Create a new token via create-token-v2.ts
 * @param name Token name
 * @param symbol Token symbol
 * @param isRoot Whether this is a root token
 * @param mayhemMode Use random short name (testing mode)
 * @returns Result with token info
 */
export async function createToken(
  name: string,
  symbol: string,
  isRoot: boolean = false,
  mayhemMode: boolean = false
): Promise<{
  success: boolean;
  token?: TokenConfig;
  output: string;
  error?: string;
}> {
  // Generate filename based on symbol
  const timestamp = Date.now();
  const safeSymbol = symbol.toLowerCase().replace(/[^a-z0-9]/g, "");
  const filename = `${safeSymbol}-${timestamp}.json`;
  const outputPath = `${DEVNET_TOKENS_DIR}/${filename}`;

  // Ensure devnet-tokens directory exists
  const tokensDir = path.join(process.cwd(), DEVNET_TOKENS_DIR);
  if (!fs.existsSync(tokensDir)) {
    fs.mkdirSync(tokensDir, { recursive: true });
  }

  // Build args
  const scriptPath = "scripts/create-token-v2.ts";
  const args = [name, symbol, outputPath, "--network", "devnet"];

  if (isRoot) {
    args.push("--root");
  }

  console.log(`[Control] Creating token: ${name} (${symbol})${isRoot ? " [ROOT]" : ""}`);

  const result = await runScript(scriptPath, args, 180000); // 3 min timeout

  if (!result.success) {
    return {
      success: false,
      output: result.output,
      error: result.error || "Token creation failed",
    };
  }

  // Read the created token config
  const fullPath = path.join(process.cwd(), outputPath);
  if (!fs.existsSync(fullPath)) {
    return {
      success: false,
      output: result.output,
      error: "Token config file not created",
    };
  }

  try {
    const tokenConfig = JSON.parse(fs.readFileSync(fullPath, "utf-8")) as TokenConfig;
    return {
      success: true,
      token: tokenConfig,
      output: result.output,
    };
  } catch (e) {
    return {
      success: false,
      output: result.output,
      error: `Failed to read token config: ${(e as Error).message}`,
    };
  }
}

/**
 * Initialize TokenStats for a token on-chain
 */
export async function initTokenStats(tokenFile: string): Promise<ScriptResult> {
  const scriptPath = "scripts/init-token-stats.ts";
  const tokenPath = path.join(DEVNET_TOKENS_DIR, tokenFile);

  if (!fs.existsSync(tokenPath)) {
    return {
      success: false,
      output: "",
      error: `Token file not found: ${tokenFile}`,
      exitCode: 1,
    };
  }

  return runScript(scriptPath, [tokenPath, "--network", "devnet"], 120000);
}

/**
 * Set a token as the root token
 */
export async function setRootToken(tokenFile: string): Promise<ScriptResult> {
  const scriptPath = "scripts/set-root-token.ts";
  const tokenPath = path.join(DEVNET_TOKENS_DIR, tokenFile);

  if (!fs.existsSync(tokenPath)) {
    return {
      success: false,
      output: "",
      error: `Token file not found: ${tokenFile}`,
      exitCode: 1,
    };
  }

  return runScript(scriptPath, [tokenPath, "--network", "devnet"], 120000);
}

/**
 * Sync fees - Force daemon to flush pending fees to on-chain TokenStats
 * This calls the daemon's /flush endpoint if running, or runs the update script
 */
export async function syncFees(
  tokenFile?: string,
  network: string = "devnet"
): Promise<ScriptResult> {
  // First try to hit the daemon flush endpoint
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch("http://localhost:3030/flush", {
      method: "POST",
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json();
      return {
        success: true,
        output: `Daemon flush triggered: ${JSON.stringify(data)}`,
        exitCode: 0,
      };
    }
  } catch (e) {
    // Daemon not running or flush failed, fall through to script
    console.log("[Control] Daemon not available, checking on-chain state directly");
  }

  // If daemon not available, run check-fees script to get current state
  if (tokenFile) {
    const scriptPath = "scripts/check-fees.ts";
    const tokenPath = path.join(DEVNET_TOKENS_DIR, tokenFile);

    if (!fs.existsSync(tokenPath)) {
      return {
        success: false,
        output: "",
        error: `Token file not found: ${tokenFile}`,
        exitCode: 1,
      };
    }

    return runScript(scriptPath, [tokenPath, "--network", network], 30000);
  }

  return {
    success: false,
    output: "",
    error: "No token specified and daemon not running",
    exitCode: 1,
  };
}
