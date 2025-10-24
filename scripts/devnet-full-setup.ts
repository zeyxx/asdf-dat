import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

/**
 * Script tout-en-un pour setup complet devnet
 * Automatise tout le processus de création et configuration
 */

interface SetupStep {
  name: string;
  description: string;
  command?: string;
  script?: string;
  check?: () => boolean;
  manual?: boolean;
}

const SETUP_STEPS: SetupStep[] = [
  {
    name: "Check Solana Configuration",
    description: "Verify Solana is configured for devnet",
    check: () => {
      try {
        const output = execSync("solana config get", { encoding: "utf-8" });
        return output.includes("devnet");
      } catch {
        return false;
      }
    },
  },
  {
    name: "Check SOL Balance",
    description: "Verify sufficient SOL balance for deployment",
    check: () => {
      try {
        const output = execSync("solana balance", { encoding: "utf-8" });
        const balance = parseFloat(output);
        return balance >= 2.0;
      } catch {
        return false;
      }
    },
  },
  {
    name: "Create Token on PumpFun",
    description: "Create test token using PumpFun program",
    script: "ts-node scripts/devnet-create-token.ts",
  },
  {
    name: "Apply Configuration",
    description: "Update lib.rs and Anchor.toml with token addresses",
    script: "ts-node scripts/devnet-apply-config.ts",
  },
  {
    name: "Build Program",
    description: "Build the Anchor program",
    command: "anchor build",
  },
  {
    name: "Get Program ID",
    description: "Retrieve the program ID",
    command: "solana address -k target/deploy/asdf_dat-keypair.json",
    manual: true, // Requires manual update of lib.rs and Anchor.toml
  },
  {
    name: "Update Program ID",
    description: "Update declare_id! in lib.rs and Anchor.toml",
    manual: true,
  },
  {
    name: "Rebuild Program",
    description: "Rebuild with updated program ID",
    command: "anchor build",
  },
  {
    name: "Deploy to Devnet",
    description: "Deploy the program to Solana devnet",
    command: "anchor deploy --provider.cluster devnet",
  },
  {
    name: "Setup Token Accounts",
    description: "Create ATAs for DAT Authority",
    script: "ts-node scripts/devnet-setup-accounts.ts",
  },
  {
    name: "Initialize Protocol",
    description: "Initialize the DAT protocol",
    script: "ts-node scripts/devnet-init.ts",
  },
  {
    name: "Transfer Creator Ownership",
    description: "Transfer coin_creator to DAT Authority on PumpFun",
    manual: true,
  },
  {
    name: "Verify Setup",
    description: "Check protocol status",
    script: "ts-node scripts/devnet-status.ts",
  },
];

/**
 * Execute a command and display output
 */
function executeCommand(command: string, description: string): boolean {
  console.log(`⏳ ${description}...`);
  console.log(`   Command: ${command}`);

  try {
    const output = execSync(command, {
      encoding: "utf-8",
      stdio: "pipe",
    });

    console.log(output);
    console.log("✅ Success\n");
    return true;
  } catch (error: any) {
    console.error("❌ Failed");
    console.error(error.stdout || error.message);
    console.log();
    return false;
  }
}

/**
 * Execute a script
 */
function executeScript(script: string, description: string): boolean {
  return executeCommand(script, description);
}

/**
 * Prompt for manual step
 */
function promptManualStep(step: SetupStep): Promise<boolean> {
  console.log(`\n🔧 MANUAL STEP REQUIRED`);
  console.log(`================================`);
  console.log(`Step: ${step.name}`);
  console.log(`Description: ${step.description}`);
  console.log();

  if (step.command) {
    console.log(`Command to run:`);
    console.log(`  ${step.command}`);
    console.log();
  }

  if (step.name === "Update Program ID") {
    console.log(`Instructions:`);
    console.log(`1. Copy the program ID from the previous step`);
    console.log(`2. Update declare_id! in programs/asdf-dat/src/lib.rs`);
    console.log(`3. Update program ID in Anchor.toml under [programs.devnet]`);
    console.log();
  }

  if (step.name === "Transfer Creator Ownership") {
    console.log(`Instructions:`);
    console.log(`1. Go to PumpFun devnet interface`);
    console.log(`2. Find your token`);
    console.log(`3. Transfer coin_creator to DAT Authority`);
    console.log(`4. DAT Authority address is shown in devnet-config.json`);
    console.log();
  }

  const readline = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    readline.question("Press Enter when completed (or 's' to skip): ", (answer: string) => {
      readline.close();
      const skip = answer.toLowerCase() === "s";
      if (skip) {
        console.log("⏭️  Skipped\n");
      } else {
        console.log("✅ Completed\n");
      }
      resolve(!skip);
    });
  });
}

/**
 * Run a single setup step
 */
async function runStep(step: SetupStep, index: number): Promise<boolean> {
  console.log(`\n[${ index + 1}/${SETUP_STEPS.length}] ${step.name}`);
  console.log("=".repeat(50));

  // Check if step can be skipped
  if (step.check && step.check()) {
    console.log("✅ Already satisfied, skipping\n");
    return true;
  }

  // Execute step
  if (step.manual) {
    return await promptManualStep(step);
  } else if (step.script) {
    return executeScript(step.script, step.description);
  } else if (step.command) {
    return executeCommand(step.command, step.description);
  }

  return true;
}

/**
 * Main setup flow
 */
async function main() {
  console.log("╔════════════════════════════════════════════╗");
  console.log("║  ASDF DAT - DEVNET FULL SETUP WIZARD       ║");
  console.log("╚════════════════════════════════════════════╝\n");

  console.log("This wizard will guide you through the complete devnet setup:\n");
  console.log("  • Create a test token on PumpFun devnet");
  console.log("  • Configure the program with devnet addresses");
  console.log("  • Build and deploy to devnet");
  console.log("  • Initialize the protocol");
  console.log("  • Prepare for testing\n");

  console.log("⚠️  Prerequisites:");
  console.log("  • Solana configured for devnet");
  console.log("  • At least 2 SOL devnet in wallet");
  console.log("  • Node.js and dependencies installed\n");

  const readline = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const proceed = await new Promise<boolean>((resolve) => {
    readline.question("Continue? (y/n): ", (answer: string) => {
      readline.close();
      resolve(answer.toLowerCase() === "y");
    });
  });

  if (!proceed) {
    console.log("\n❌ Setup cancelled");
    process.exit(0);
  }

  console.log("\n🚀 Starting setup...\n");

  let completedSteps = 0;
  let failedStep: string | null = null;

  for (let i = 0; i < SETUP_STEPS.length; i++) {
    const step = SETUP_STEPS[i];
    const success = await runStep(step, i);

    if (success) {
      completedSteps++;
    } else {
      failedStep = step.name;
      break;
    }
  }

  // Summary
  console.log("\n╔════════════════════════════════════════════╗");
  console.log("║  SETUP SUMMARY                             ║");
  console.log("╚════════════════════════════════════════════╝\n");

  console.log(`Completed Steps: ${completedSteps}/${SETUP_STEPS.length}`);

  if (failedStep) {
    console.log(`\n❌ Setup failed at: ${failedStep}`);
    console.log("\nYou can:");
    console.log("  • Fix the issue and run the wizard again");
    console.log("  • Or continue manually from this step");
    process.exit(1);
  } else {
    console.log("\n✅ Setup completed successfully!\n");

    console.log("🎯 Next Steps:");
    console.log("================================");
    console.log("1. Generate trading activity on your token");
    console.log("   (Make some buys/sells on PumpFun devnet)");
    console.log();
    console.log("2. Wait for fees to accumulate (min 0.01 SOL)");
    console.log();
    console.log("3. Check protocol status:");
    console.log("   ts-node scripts/devnet-status.ts");
    console.log();
    console.log("4. Execute a test cycle:");
    console.log("   ts-node scripts/devnet-execute-cycle.ts");
    console.log();
    console.log("5. Repeat cycles and monitor (5-10 cycles recommended)");
    console.log();
    console.log("6. Fill out MAINNET_READINESS.md checklist");
    console.log();
    console.log("7. Deploy to mainnet when ready!");
    console.log();

    console.log("📚 Documentation:");
    console.log("  • DEVNET_DEPLOYMENT.md - Detailed guide");
    console.log("  • scripts/README.md - Script documentation");
    console.log("  • MAINNET_READINESS.md - Pre-mainnet checklist");
    console.log();

    console.log("🎉 Happy testing!");
  }
}

// Execute
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Unexpected error:", error);
    process.exit(1);
  });
