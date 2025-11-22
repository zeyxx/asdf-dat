/**
 * Fetch Fee Recipients from PumpFun Global Account
 *
 * This script fetches the global configuration on devnet to find
 * the authorized fee recipients.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { OnlinePumpSdk } from "@pump-fun/pump-sdk";

const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function log(emoji: string, message: string, color = colors.reset) {
  console.log(`${color}${emoji} ${message}${colors.reset}`);
}

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("🔍 FETCH FEE RECIPIENTS FROM PUMPFUN GLOBAL");
  console.log("=".repeat(60) + "\n");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const sdk = new OnlinePumpSdk(connection);

  try {
    log("📊", "Fetching global configuration...", colors.cyan);

    const global = await sdk.fetchGlobal();

    console.log("\n" + "=".repeat(60));
    console.log("📋 GLOBAL CONFIGURATION");
    console.log("=".repeat(60) + "\n");

    log("✅", `Initialized: ${global.initialized}`, colors.green);
    log("👤", `Authority: ${global.authority.toString()}`, colors.cyan);
    log("💰", `Main Fee Recipient: ${global.feeRecipient.toString()}`, colors.cyan);
    log("💵", `Reserved Fee Recipient: ${global.reservedFeeRecipient.toString()}`, colors.cyan);
    log("🔥", `Mayhem Mode Enabled: ${global.mayhemModeEnabled}`, colors.yellow);
    log("🆕", `Create V2 Enabled: ${global.createV2Enabled}`, colors.yellow);

    console.log("\n" + "=".repeat(60));
    console.log("💸 AUTHORIZED FEE RECIPIENTS");
    console.log("=".repeat(60) + "\n");

    if (global.feeRecipients && global.feeRecipients.length > 0) {
      log("📝", `Found ${global.feeRecipients.length} fee recipients:`, colors.green);
      global.feeRecipients.forEach((recipient, index) => {
        console.log(`   ${index + 1}. ${colors.cyan}${recipient.toString()}${colors.reset}`);
      });
    } else {
      log("⚠️", "No fee recipients in feeRecipients array", colors.yellow);
    }

    console.log("\n" + "=".repeat(60));
    console.log("🔒 RESERVED FEE RECIPIENTS");
    console.log("=".repeat(60) + "\n");

    if (global.reservedFeeRecipients && global.reservedFeeRecipients.length > 0) {
      log("📝", `Found ${global.reservedFeeRecipients.length} reserved fee recipients:`, colors.green);
      global.reservedFeeRecipients.forEach((recipient, index) => {
        console.log(`   ${index + 1}. ${colors.magenta}${recipient.toString()}${colors.reset}`);
      });
    } else {
      log("⚠️", "No reserved fee recipients", colors.yellow);
    }

    console.log("\n" + "=".repeat(60));
    console.log("💡 USAGE");
    console.log("=".repeat(60) + "\n");

    const validRecipient = global.feeRecipients?.[0] ||
                          global.reservedFeeRecipients?.[0] ||
                          global.feeRecipient;

    if (validRecipient) {
      log("✅", "Use one of these fee recipients in your buy script:", colors.green);
      console.log(`\n${colors.cyan}const FEE_RECIPIENT = new PublicKey("${validRecipient.toString()}");${colors.reset}\n`);
    } else {
      log("❌", "No valid fee recipient found!", colors.red);
    }

  } catch (error: any) {
    console.log("\n" + "=".repeat(60));
    console.log("❌ ERROR");
    console.log("=".repeat(60) + "\n");

    log("❌", `Failed to fetch global: ${error.message}`, colors.red);

    if (error.stack) {
      console.log("\n📋 Stack trace:");
      console.log(error.stack);
    }

    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`${colors.red}❌ Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
