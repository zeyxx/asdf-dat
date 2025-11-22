import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import fs from "fs";

const PROGRAM_ID = new PublicKey("ASDFznSwUWikqQMNE1Y7qqskDDkbE74GXZdUe6wu4UCz");
const WSOL_AMOUNT = 0.2; // SOL to wrap

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

function log(emoji: string, message: string, color = colors.reset) {
  console.log(`${color}${emoji} ${message}${colors.reset}`);
}

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log(`${colors.bright}${colors.cyan}💰 FINANCEMENT DU DAT AUTHORITY${colors.reset}`);
  console.log("=".repeat(60) + "\n");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Load admin wallet
  const admin = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync("./devnet-wallet.json", "utf-8")))
  );

  log("👤", `Admin: ${admin.publicKey.toString()}`, colors.cyan);

  const balance = await connection.getBalance(admin.publicKey);
  log("💰", `Balance: ${(balance / 1e9).toFixed(4)} SOL`, colors.cyan);

  // Derive DAT Authority
  const [datAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("auth_v3")],
    PROGRAM_ID
  );

  log("🔑", `DAT Authority: ${datAuthority.toString()}`, colors.cyan);

  // Get WSOL ATA for DAT Authority
  const datWsolAccount = getAssociatedTokenAddressSync(
    NATIVE_MINT,
    datAuthority,
    true // allowOwnerOffCurve for PDA
  );

  log("💎", `DAT WSOL Account: ${datWsolAccount.toString()}`, colors.cyan);

  // Get admin WSOL ATA
  const adminWsolAccount = getAssociatedTokenAddressSync(
    NATIVE_MINT,
    admin.publicKey
  );

  log("💳", `Admin WSOL Account: ${adminWsolAccount.toString()}`, colors.cyan);

  console.log("\n" + "=".repeat(60));
  console.log(`${colors.bright}${colors.yellow}⏳ Création et transfert...${colors.reset}`);
  console.log("=".repeat(60) + "\n");

  const amountLamports = WSOL_AMOUNT * 1e9;

  try {
    const tx = new Transaction();

    // 1. Create admin WSOL ATA if needed
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        admin.publicKey,
        adminWsolAccount,
        admin.publicKey,
        NATIVE_MINT
      )
    );

    // 2. Create DAT Authority WSOL ATA if needed
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        admin.publicKey,
        datWsolAccount,
        datAuthority,
        NATIVE_MINT
      )
    );

    // 3. Transfer SOL to admin WSOL account
    tx.add(
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: adminWsolAccount,
        lamports: amountLamports,
      })
    );

    // 4. Sync to wrap SOL
    tx.add(createSyncNativeInstruction(adminWsolAccount));

    log("📤", `Wrapping ${WSOL_AMOUNT} SOL...`, colors.yellow);

    const sig1 = await sendAndConfirmTransaction(connection, tx, [admin], {
      commitment: "confirmed",
    });

    log("✅", `WSOL wrappé!`, colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${sig1}?cluster=devnet`, colors.cyan);

    // 5. Transfer WSOL from admin to DAT Authority
    log("📤", `Transferring ${WSOL_AMOUNT} WSOL to DAT Authority...`, colors.yellow);

    const tx2 = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        admin.publicKey,
        datWsolAccount,
        datAuthority,
        NATIVE_MINT
      )
    );

    // Use spl-token transfer (need to import from @solana/spl-token)
    const { createTransferInstruction } = await import("@solana/spl-token");

    tx2.add(
      createTransferInstruction(
        adminWsolAccount,
        datWsolAccount,
        admin.publicKey,
        amountLamports,
        [],
        TOKEN_PROGRAM_ID
      )
    );

    const sig2 = await sendAndConfirmTransaction(connection, tx2, [admin], {
      commitment: "confirmed",
    });

    console.log("\n" + "=".repeat(60));
    console.log(`${colors.bright}${colors.green}✅ FINANCEMENT RÉUSSI!${colors.reset}`);
    console.log("=".repeat(60) + "\n");

    log("💰", `${WSOL_AMOUNT} WSOL transféré au DAT Authority`, colors.green);
    log("🔗", `TX: https://explorer.solana.com/tx/${sig2}?cluster=devnet`, colors.cyan);

    // Verify balance
    const { getAccount } = await import("@solana/spl-token");
    const datWsolInfo = await getAccount(connection, datWsolAccount);
    const datWsolBalance = Number(datWsolInfo.amount) / 1e9;

    log("💎", `Balance DAT WSOL: ${datWsolBalance} WSOL`, colors.green);

    console.log("\n" + "=".repeat(60));
    console.log(`${colors.bright}${colors.cyan}📋 PROCHAINE ÉTAPE${colors.reset}`);
    console.log("=".repeat(60) + "\n");

    log("🚀", "Tester le cycle DAT complet:", colors.cyan);
    log("📝", "npx ts-node tests/scripts/test-dat-cycle.ts", colors.yellow);

  } catch (error: any) {
    console.log("\n" + "=".repeat(60));
    console.log(`${colors.bright}${colors.red}❌ ERREUR${colors.reset}`);
    console.log("=".repeat(60) + "\n");

    log("❌", `Erreur: ${error.message}`, colors.red);

    if (error.logs) {
      console.log("\n📋 Logs:");
      error.logs.forEach((l: string) => console.log(`   ${l}`));
    }

    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`${colors.red}❌ Erreur fatale: ${error.message}${colors.reset}`);
  process.exit(1);
});
