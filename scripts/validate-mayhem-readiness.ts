/**
 * Mayhem Mode Readiness Validator
 *
 * Checks all prerequisites before launching a Mayhem Mode token
 * Run this before: npx ts-node scripts/launch-mayhem-token.ts
 */

import fs from "fs";
import path from "path";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

interface ValidationResult {
  passed: boolean;
  message: string;
  critical: boolean;
}

const results: ValidationResult[] = [];

function check(name: string, passed: boolean, message: string, critical = false) {
  results.push({ passed, message: `${name}: ${message}`, critical });
  const icon = passed ? "✅" : (critical ? "🔴" : "⚠️");
  const color = passed ? colors.green : (critical ? colors.red : colors.yellow);
  console.log(`${color}${icon} ${name}: ${message}${colors.reset}`);
}

async function main() {
  console.clear();
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.bright}${colors.cyan}🔍 MAYHEM MODE READINESS VALIDATION${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);

  // 1. Check TESTING_MODE flag
  console.log(`${colors.bright}1. Checking TESTING_MODE flag...${colors.reset}`);
  const libRsPath = path.join(__dirname, "../programs/asdf-dat/src/lib.rs");

  if (fs.existsSync(libRsPath)) {
    const libRs = fs.readFileSync(libRsPath, "utf-8");
    const testingModeMatch = libRs.match(/pub const TESTING_MODE:\s*bool\s*=\s*(true|false)/);

    if (testingModeMatch) {
      const isTestMode = testingModeMatch[1] === "true";
      check(
        "TESTING_MODE",
        !isTestMode,
        isTestMode
          ? "Set to TRUE - MUST BE FALSE FOR MAINNET!"
          : "Correctly set to FALSE",
        isTestMode
      );
    } else {
      check("TESTING_MODE", false, "Could not parse TESTING_MODE value", true);
    }
  } else {
    check("TESTING_MODE", false, "lib.rs not found", true);
  }

  // 2. Check NFT.Storage API key
  console.log(`\n${colors.bright}2. Checking NFT.Storage configuration...${colors.reset}`);
  const apiKey = process.env.NFT_STORAGE_API_KEY;
  check(
    "NFT_STORAGE_API_KEY",
    !!apiKey,
    apiKey
      ? `Set (${apiKey.substring(0, 8)}...)`
      : "Not set - metadata will use placeholder",
    false
  );

  // 3. Check token image
  console.log(`\n${colors.bright}3. Checking token image...${colors.reset}`);
  const imagePath = "./token-image.png";
  const imageExists = fs.existsSync(imagePath);
  check(
    "Token Image",
    imageExists,
    imageExists ? "Found" : "Not found - create token-image.png",
    false
  );

  if (imageExists) {
    const stats = fs.statSync(imagePath);
    const sizeMB = stats.size / (1024 * 1024);
    check(
      "Image Size",
      sizeMB < 10,
      `${sizeMB.toFixed(2)} MB ${sizeMB < 10 ? "(OK)" : "(Too large!)"}`,
      sizeMB >= 10
    );
  }

  // 4. Check wallet
  console.log(`\n${colors.bright}4. Checking mainnet wallet...${colors.reset}`);
  const walletPath = "mainnet-wallet.json";
  const walletExists = fs.existsSync(walletPath);

  check(
    "Wallet File",
    walletExists,
    walletExists ? "Found" : "Not found - create with: solana-keygen new -o mainnet-wallet.json",
    true
  );

  if (walletExists) {
    try {
      const walletData = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
      const keypair = Keypair.fromSecretKey(new Uint8Array(walletData));
      check("Wallet Valid", true, `Address: ${keypair.publicKey.toString()}`, false);

      // Check balance
      const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
      const balance = await connection.getBalance(keypair.publicKey);
      const solBalance = balance / 1e9;

      check(
        "SOL Balance",
        solBalance >= 0.5,
        `${solBalance.toFixed(4)} SOL ${solBalance >= 0.5 ? "(Sufficient)" : "(Need 0.5+ SOL)"}`,
        solBalance < 0.2
      );
    } catch (error: any) {
      check("Wallet Valid", false, `Error: ${error.message}`, true);
    }
  }

  // 5. Check DAT configuration
  console.log(`\n${colors.bright}5. Checking DAT configuration...${colors.reset}`);
  const configPath = "config/mainnet-dat-deployment.json";
  const configExists = fs.existsSync(configPath);

  check(
    "DAT Config",
    configExists,
    configExists ? "Found" : "Not found - run: NETWORK=mainnet npm run init",
    true
  );

  if (configExists) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      check("DAT State", !!config.datState, config.datState || "Missing", false);
      check("DAT Authority", !!config.datAuthority, config.datAuthority || "Missing", false);
    } catch (error: any) {
      check("DAT Config Valid", false, `Error: ${error.message}`, true);
    }
  }

  // 6. Check program build
  console.log(`\n${colors.bright}6. Checking program build...${colors.reset}`);
  const idlPath = "target/idl/asdf_dat.json";
  const idlExists = fs.existsSync(idlPath);

  check(
    "Program IDL",
    idlExists,
    idlExists ? "Found" : "Not found - run: anchor build",
    true
  );

  if (idlExists) {
    const programSoPath = "target/deploy/asdf_dat.so";
    check(
      "Program Binary",
      fs.existsSync(programSoPath),
      fs.existsSync(programSoPath) ? "Found" : "Missing - run: anchor build",
      true
    );
  }

  // 7. Check dependencies
  console.log(`\n${colors.bright}7. Checking dependencies...${colors.reset}`);
  const nodeModulesExists = fs.existsSync("node_modules");
  check(
    "Node Modules",
    nodeModulesExists,
    nodeModulesExists ? "Installed" : "Not installed - run: npm install",
    true
  );

  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf-8"));
  check(
    "nft.storage",
    !!packageJson.dependencies["nft.storage"],
    packageJson.dependencies["nft.storage"] || "Not installed",
    false
  );

  // Summary
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${colors.bright}📊 VALIDATION SUMMARY${colors.reset}`);
  console.log(`${"=".repeat(70)}\n`);

  const criticalFailures = results.filter(r => !r.passed && r.critical);
  const warnings = results.filter(r => !r.passed && !r.critical);
  const passed = results.filter(r => r.passed).length;

  console.log(`✅ Passed: ${colors.green}${passed}/${results.length}${colors.reset}`);
  console.log(`🔴 Critical Failures: ${colors.red}${criticalFailures.length}${colors.reset}`);
  console.log(`⚠️  Warnings: ${colors.yellow}${warnings.length}${colors.reset}`);

  if (criticalFailures.length > 0) {
    console.log(`\n${colors.red}${colors.bright}❌ NOT READY FOR LAUNCH${colors.reset}`);
    console.log(`\n${colors.red}Critical issues must be fixed:${colors.reset}`);
    criticalFailures.forEach(f => console.log(`  ${colors.red}• ${f.message}${colors.reset}`));
  } else if (warnings.length > 0) {
    console.log(`\n${colors.yellow}${colors.bright}⚠️  READY WITH WARNINGS${colors.reset}`);
    console.log(`\n${colors.yellow}Consider fixing:${colors.reset}`);
    warnings.forEach(w => console.log(`  ${colors.yellow}• ${w.message}${colors.reset}`));
  } else {
    console.log(`\n${colors.green}${colors.bright}✅ ALL CHECKS PASSED - READY TO LAUNCH!${colors.reset}`);
  }

  console.log(`\n${colors.cyan}Next step:${colors.reset}`);
  console.log(`  npx ts-node scripts/launch-mayhem-token.ts\n`);

  process.exit(criticalFailures.length > 0 ? 1 : 0);
}

main().catch(error => {
  console.error(`${colors.red}Validation error:${colors.reset}`, error);
  process.exit(1);
});
