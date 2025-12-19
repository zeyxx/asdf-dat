/**
 * Backfill Missed Fees using Helius
 *
 * Uses Helius Enhanced Transactions API to catch up on missed
 * fee events after daemon restart or crash recovery.
 *
 * Usage:
 *   npx ts-node scripts/backfill-fees.ts --network devnet [--max 500] [--since SIGNATURE]
 *
 * Requires: HELIUS_API_KEY environment variable
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { getNetworkConfig, printNetworkBanner } from "../src/network/config";
import { HeliusClient, getHeliusClient } from "../src/network/helius";
import { createLogger } from "../src/utils/logger";

const log = createLogger("backfill");

// Constants
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const CREATOR = new PublicKey(process.env.CREATOR || "4nS8cak3SUafTXsmaZVi1SEVoL67tNotsnmHG1RH7Jjd");

function parseArgs(): {
  maxTransactions: number;
  sinceSignature?: string;
  verbose: boolean;
} {
  const args = process.argv.slice(2);
  let maxTransactions = 500;
  let sinceSignature: string | undefined;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--max" && args[i + 1]) {
      maxTransactions = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--since" && args[i + 1]) {
      sinceSignature = args[i + 1];
      i++;
    } else if (args[i] === "--verbose" || args[i] === "-v") {
      verbose = true;
    }
  }

  return { maxTransactions, sinceSignature, verbose };
}

async function main() {
  const networkConfig = getNetworkConfig(process.argv.slice(2));
  const { maxTransactions, sinceSignature, verbose } = parseArgs();

  printNetworkBanner(networkConfig);

  // Check Helius API key
  if (!process.env.HELIUS_API_KEY) {
    console.error("\n❌ HELIUS_API_KEY not set");
    console.error("   Set it in your .env file or environment\n");
    process.exit(1);
  }

  // Initialize Helius client
  const network = networkConfig.name === "mainnet" ? "mainnet-beta" : "devnet";
  const helius = getHeliusClient({
    apiKey: process.env.HELIUS_API_KEY,
    network,
  });

  if (!helius) {
    console.error("\n❌ Failed to initialize Helius client\n");
    process.exit(1);
  }

  // Derive creator vault
  const [creatorVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), CREATOR.toBuffer()],
    PUMP_PROGRAM
  );

  console.log("\n🔄 HELIUS BACKFILL");
  console.log("═══════════════════════════════════════════════════════\n");
  console.log(`Creator:         ${CREATOR.toBase58()}`);
  console.log(`Vault:           ${creatorVault.toBase58()}`);
  console.log(`Max Transactions: ${maxTransactions}`);
  if (sinceSignature) {
    console.log(`Since Signature: ${sinceSignature.slice(0, 20)}...`);
  }
  console.log("");

  // Start backfill
  console.log("📥 Fetching transactions from Helius...\n");

  try {
    const startTime = Date.now();

    const transactions = await helius.backfillFromSignature(
      creatorVault,
      sinceSignature,
      { maxTransactions }
    );

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`\n✅ Backfill Complete`);
    console.log(`─────────────────────────────────────────────────────────`);
    console.log(`Transactions fetched: ${transactions.length}`);
    console.log(`Time elapsed:         ${elapsed}s`);

    // Summary statistics
    let totalFees = 0n;
    const tokenFeeCounts: Record<string, { count: number; total: bigint }> = {};

    for (const tx of transactions) {
      totalFees += BigInt(tx.fee);

      for (const transfer of tx.tokenTransfers) {
        if (!tokenFeeCounts[transfer.mint]) {
          tokenFeeCounts[transfer.mint] = { count: 0, total: 0n };
        }
        tokenFeeCounts[transfer.mint].count++;
        tokenFeeCounts[transfer.mint].total += BigInt(transfer.amount);
      }
    }

    console.log(`Total fees (tx):      ${(Number(totalFees) / 1e9).toFixed(6)} SOL`);
    console.log(`\nToken transfers detected:`);

    for (const [mint, data] of Object.entries(tokenFeeCounts)) {
      console.log(`  ${mint.slice(0, 8)}... : ${data.count} transfers`);
    }

    // Verbose output
    if (verbose && transactions.length > 0) {
      console.log(`\n📜 Transaction Details:`);
      console.log(`─────────────────────────────────────────────────────────`);

      for (const tx of transactions.slice(0, 10)) {
        console.log(`  ${tx.signature.slice(0, 20)}...`);
        console.log(`    Slot: ${tx.slot}, Fee: ${tx.fee} lamports`);
        if (tx.tokenTransfers.length > 0) {
          console.log(`    Transfers: ${tx.tokenTransfers.length}`);
        }
      }

      if (transactions.length > 10) {
        console.log(`  ... and ${transactions.length - 10} more`);
      }
    }

    // Last signature for next run
    if (transactions.length > 0) {
      console.log(`\n💡 Last signature (for next backfill):`);
      console.log(`   ${transactions[0].signature}`);
    }

    console.log("\nTHIS IS FINE 🔥\n");

  } catch (error) {
    console.error("\n❌ Backfill failed:", (error as Error).message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
