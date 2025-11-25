/**
 * Sync Validator Slots to Current Slot (Permissionless)
 *
 * This script syncs all stale ValidatorState accounts to the current slot.
 * Use this when the daemon has been offline and validators are > 1000 slots behind.
 *
 * Usage: npx ts-node scripts/sync-validator-slots.ts [token-file1.json] [token-file2.json] ...
 *        npx ts-node scripts/sync-validator-slots.ts (syncs all known tokens)
 */

import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, Idl } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";

const PROGRAM_ID = new PublicKey("ASDfNfUHwVGfrg3SV7SQYWhaVxnrCUZyWmMpWJAPu4MZ");
const VALIDATOR_STATE_SEED = Buffer.from("validator_v1");
const MAX_SLOT_RANGE = 1000;

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function log(emoji: string, message: string, color = colors.reset) {
  console.log(`${color}${emoji} ${message}${colors.reset}`);
}

function loadIdl(): Idl {
  const idlPath = path.join(__dirname, "../target/idl/asdf_dat.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8")) as Idl;
  if (idl.metadata) {
    (idl.metadata as any).address = PROGRAM_ID.toString();
  } else {
    (idl as any).metadata = { address: PROGRAM_ID.toString() };
  }
  return idl;
}

interface TokenConfig {
  mint: string;
  symbol: string;
  bondingCurve: string;
}

/**
 * Sync a single token's validator state if stale
 * @returns true if synced, false if not needed or error
 */
export async function syncValidatorIfNeeded(
  connection: Connection,
  program: Program<Idl>,
  tokenMint: PublicKey,
  symbol: string,
  verbose = true
): Promise<boolean> {
  const currentSlot = await connection.getSlot();

  // Derive ValidatorState PDA
  const [validatorState] = PublicKey.findProgramAddressSync(
    [VALIDATOR_STATE_SEED, tokenMint.toBuffer()],
    PROGRAM_ID
  );

  // Check if ValidatorState exists
  const accountInfo = await connection.getAccountInfo(validatorState);
  if (!accountInfo) {
    if (verbose) log("⚠️", `No ValidatorState for ${symbol}`, colors.yellow);
    return false;
  }

  // Read last_validated_slot (offset 72: discriminator(8) + mint(32) + bonding_curve(32))
  const lastValidatedSlot = Number(accountInfo.data.readBigUInt64LE(72));
  const slotDelta = currentSlot - lastValidatedSlot;

  // Check if sync is needed
  if (slotDelta <= MAX_SLOT_RANGE) {
    if (verbose) log("✅", `${symbol}: Not stale (delta ${slotDelta} <= ${MAX_SLOT_RANGE})`, colors.green);
    return false;
  }

  // Sync is needed
  if (verbose) log("⏳", `${symbol}: Syncing validator (delta ${slotDelta} > ${MAX_SLOT_RANGE})...`, colors.yellow);

  try {
    const tx = await (program.methods as any)
      .syncValidatorSlot()
      .accounts({
        validatorState,
      })
      .rpc();

    if (verbose) log("✅", `${symbol}: Synced! TX: ${tx.slice(0, 20)}...`, colors.green);
    return true;
  } catch (error: any) {
    if (error.message?.includes("ValidatorNotStale")) {
      if (verbose) log("ℹ️", `${symbol}: Validator not stale (already synced)`, colors.cyan);
      return false;
    } else {
      if (verbose) log("❌", `${symbol}: Error: ${error.message?.slice(0, 100) || error}`, colors.red);
      return false;
    }
  }
}

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log(`${colors.bright}${colors.magenta}SYNC VALIDATOR SLOTS${colors.reset}`);
  console.log("=".repeat(70) + "\n");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Load wallet (any wallet works since this is permissionless)
  const walletPath = fs.existsSync("devnet-wallet.json") ? "devnet-wallet.json" : "wallet.json";
  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  log("👤", `Caller: ${admin.publicKey.toString()}`, colors.cyan);

  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
  });

  const idl = loadIdl();
  const program: Program<Idl> = new Program(idl, provider);

  // Get token files from args or use defaults
  let tokenFiles: string[] = process.argv.slice(2);
  if (tokenFiles.length === 0) {
    tokenFiles = [
      "devnet-token-spl.json",
      "devnet-token-secondary.json",
      "devnet-token-mayhem.json",
    ].filter(f => fs.existsSync(f));
  }

  if (tokenFiles.length === 0) {
    log("❌", "No token files found!", colors.red);
    process.exit(1);
  }

  log("📁", `Processing ${tokenFiles.length} token file(s)`, colors.cyan);

  const currentSlot = await connection.getSlot();
  log("🔢", `Current slot: ${currentSlot}`, colors.cyan);

  let synced = 0;
  let skipped = 0;
  let errors = 0;

  for (const tokenFile of tokenFiles) {
    if (!fs.existsSync(tokenFile)) {
      log("⚠️", `File not found: ${tokenFile}`, colors.yellow);
      continue;
    }

    const tokenInfo: TokenConfig = JSON.parse(fs.readFileSync(tokenFile, "utf-8"));
    const tokenMint = new PublicKey(tokenInfo.mint);

    console.log(`\n--- ${tokenInfo.symbol} ---`);

    // Derive ValidatorState PDA
    const [validatorState] = PublicKey.findProgramAddressSync(
      [VALIDATOR_STATE_SEED, tokenMint.toBuffer()],
      PROGRAM_ID
    );

    // Check if ValidatorState exists
    const accountInfo = await connection.getAccountInfo(validatorState);
    if (!accountInfo) {
      log("⚠️", `No ValidatorState for ${tokenInfo.symbol}`, colors.yellow);
      skipped++;
      continue;
    }

    // Read last_validated_slot (offset 72: discriminator(8) + mint(32) + bonding_curve(32))
    const lastValidatedSlot = Number(accountInfo.data.readBigUInt64LE(72));
    const slotDelta = currentSlot - lastValidatedSlot;

    log("📊", `Last validated slot: ${lastValidatedSlot}`, colors.cyan);
    log("📊", `Slot delta: ${slotDelta}`, colors.cyan);

    // Check if sync is needed
    if (slotDelta <= MAX_SLOT_RANGE) {
      log("✅", `Not stale (delta ${slotDelta} <= ${MAX_SLOT_RANGE})`, colors.green);
      skipped++;
      continue;
    }

    // Sync is needed
    log("⏳", `Syncing validator (delta ${slotDelta} > ${MAX_SLOT_RANGE})...`, colors.yellow);

    try {
      const tx = await (program.methods as any)
        .syncValidatorSlot()
        .accounts({
          validatorState,
        })
        .rpc();

      log("✅", `Synced! TX: ${tx.slice(0, 20)}...`, colors.green);
      synced++;
    } catch (error: any) {
      if (error.message?.includes("ValidatorNotStale")) {
        log("ℹ️", "Validator not stale (already synced)", colors.cyan);
        skipped++;
      } else {
        log("❌", `Error: ${error.message?.slice(0, 100) || error}`, colors.red);
        errors++;
      }
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log(`${colors.bright}${colors.magenta}SUMMARY${colors.reset}`);
  console.log("=".repeat(70));
  log("✅", `Synced: ${synced}`, colors.green);
  log("⏭️", `Skipped (not stale): ${skipped}`, colors.cyan);
  log("❌", `Errors: ${errors}`, colors.red);
}

main().catch((error) => {
  console.error(`${colors.red}❌ Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
