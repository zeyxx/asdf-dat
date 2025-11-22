import * as fs from "fs";
import * as path from "path";

/**
 * Script pour appliquer la configuration devnet au code source
 * Met à jour automatiquement lib.rs avec les adresses du token créé
 */

interface DevnetConfig {
  token: {
    mint: string;
    creator: string;
  };
  bondingCurve?: string;  // Added by bonding curve finder
  bondingCurveATA?: string;
  pumpfun?: {
    bondingCurve: string;
  };
  pump?: {
    bondingCurve: string;
  };
  programs: {
    pumpProgram: string;
  };
}

/**
 * Lit la configuration devnet
 */
function readDevnetConfig(): DevnetConfig {
  const configPath = path.join(__dirname, "..", "devnet-config.json");

  console.log("📖 Reading devnet configuration...");
  console.log("  Path:", configPath);

  if (!fs.existsSync(configPath)) {
    console.error("❌ Configuration file not found!");
    console.log("\n💡 Run this first:");
    console.log("   ts-node scripts/devnet-create-token.ts");
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  console.log("✅ Configuration loaded");
  console.log();

  return config;
}

/**
 * Backup du fichier lib.rs original
 */
function backupLibRs(libPath: string) {
  const backupPath = libPath + ".mainnet.backup";

  console.log("💾 Creating backup of lib.rs...");

  if (fs.existsSync(backupPath)) {
    console.log("  ⚠️  Backup already exists, skipping");
  } else {
    fs.copyFileSync(libPath, backupPath);
    console.log("  ✅ Backup created:", backupPath);
  }
  console.log();
}

/**
 * Met à jour lib.rs avec les adresses devnet
 */
function updateLibRs(config: DevnetConfig) {
  const libPath = path.join(
    __dirname,
    "..",
    "programs",
    "asdf-dat",
    "src",
    "lib.rs"
  );

  console.log("✏️  Updating lib.rs with devnet addresses...");
  console.log("  Path:", libPath);

  if (!fs.existsSync(libPath)) {
    console.error("❌ lib.rs not found at:", libPath);
    process.exit(1);
  }

  // Backup first
  backupLibRs(libPath);

  // Read current file
  let content = fs.readFileSync(libPath, "utf-8");

  // Les adresses de programme PUMP sont identiques sur devnet et mainnet
  // On ne change que le token mint et la pool (bonding curve)

  console.log("\n📝 Applying changes:");

  // 1. Update ASDF_MINT
  const oldMintMatch = content.match(
    /pub const ASDF_MINT: Pubkey = solana_program::pubkey!\("([^"]+)"\);/
  );
  if (oldMintMatch) {
    const oldMint = oldMintMatch[1];
    content = content.replace(
      /pub const ASDF_MINT: Pubkey = solana_program::pubkey!\("([^"]+)"\);/,
      `pub const ASDF_MINT: Pubkey = solana_program::pubkey!("${config.token.mint}");`
    );
    console.log("  ✅ ASDF_MINT updated");
    console.log("     Old:", oldMint);
    console.log("     New:", config.token.mint);
  }

  // 2. Update POOL_PUMPSWAP (utilise le bonding curve comme pool)
  // Check multiple possible locations for bonding curve
  const bondingCurve = config.bondingCurve ||
                       config.pump?.bondingCurve ||
                       config.pumpfun?.bondingCurve;

  if (bondingCurve && bondingCurve !== "Check transaction for bonding curve address") {
    const oldPoolMatch = content.match(
      /pub const POOL_PUMPSWAP: Pubkey = solana_program::pubkey!\("([^"]+)"\);/
    );
    if (oldPoolMatch) {
      const oldPool = oldPoolMatch[1];
      content = content.replace(
        /pub const POOL_PUMPSWAP: Pubkey = solana_program::pubkey!\("([^"]+)"\);/,
        `pub const POOL_PUMPSWAP: Pubkey = solana_program::pubkey!("${bondingCurve}");`
      );
      console.log("  ✅ POOL_PUMPSWAP updated (bonding curve)");
      console.log("     Old:", oldPool);
      console.log("     New:", bondingCurve);
    }
  } else {
    console.log("  ⚠️  No bonding curve address found in config");
    console.log("     Run: npm run devnet:find-bonding-curve");
  }

  // 3. Ajuster les paramètres pour devnet (plus faciles à tester)
  const devnetParams = {
    MIN_FEES_TO_CLAIM: "10_000_000", // 0.01 SOL (vs 0.19 mainnet)
    MAX_FEES_PER_CYCLE: "1_000_000_000", // 1 SOL (vs 10 mainnet)
    MIN_CYCLE_INTERVAL: "60", // 1 minute (vs 1 heure mainnet)
  };

  for (const [param, value] of Object.entries(devnetParams)) {
    const regex = new RegExp(
      `pub const ${param}: (?:u64|i64) = [^;]+;`
    );
    const match = content.match(regex);
    if (match) {
      const oldValue = match[0];
      const newLine = `pub const ${param}: ${
        param.includes("INTERVAL") ? "i64" : "u64"
      } = ${value}; // DEVNET: Adjusted for testing`;

      content = content.replace(regex, newLine);
      console.log(`  ✅ ${param} adjusted for devnet`);
    }
  }

  // 4. Ajouter un commentaire en haut pour indiquer mode devnet
  if (!content.includes("// DEVNET CONFIGURATION")) {
    const headerComment = `// ====================================
// DEVNET CONFIGURATION - AUTO-GENERATED
// ====================================
// This file has been automatically configured for devnet testing.
// Original mainnet version backed up to: lib.rs.mainnet.backup
//
// To restore mainnet config:
//   cp programs/asdf-dat/src/lib.rs.mainnet.backup programs/asdf-dat/src/lib.rs
// ====================================

`;
    // Insérer après les imports mais avant declare_id!
    content = content.replace(
      /(use solana_program::program::invoke_signed;)/,
      `$1\n\n${headerComment}`
    );
    console.log("  ✅ Added devnet configuration header");
  }

  // Écrire le fichier modifié
  fs.writeFileSync(libPath, content);

  console.log("\n✅ lib.rs updated successfully!");
  console.log();
}

/**
 * Met à jour Anchor.toml pour devnet
 */
function updateAnchorToml() {
  const tomlPath = path.join(__dirname, "..", "Anchor.toml");

  console.log("✏️  Updating Anchor.toml for devnet...");

  if (!fs.existsSync(tomlPath)) {
    console.log("  ⚠️  Anchor.toml not found, skipping");
    return;
  }

  let content = fs.readFileSync(tomlPath, "utf-8");

  // Backup
  const backupPath = tomlPath + ".mainnet.backup";
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(tomlPath, backupPath);
    console.log("  💾 Backup created:", backupPath);
  }

  // Update cluster
  content = content.replace(
    /cluster = "mainnet"/g,
    'cluster = "devnet"'
  );

  // Update wallet path (optionnel)
  content = content.replace(
    /wallet = "\.\/wallet\.json"/g,
    'wallet = "./devnet-wallet.json"'
  );

  fs.writeFileSync(tomlPath, content);

  console.log("  ✅ Anchor.toml configured for devnet");
  console.log();
}

/**
 * Affiche les prochaines étapes
 */
function displayNextSteps(config: DevnetConfig) {
  console.log("================================");
  console.log("CONFIGURATION APPLIED");
  console.log("================================\n");

  const bondingCurve = config.bondingCurve ||
                       config.pump?.bondingCurve ||
                       config.pumpfun?.bondingCurve ||
                       "Not set";

  console.log("📍 Devnet Addresses Configured:");
  console.log("  Token Mint:", config.token.mint);
  console.log("  Pool (Bonding Curve):", bondingCurve);
  console.log("  Pump Program:", config.programs.pumpProgram);
  console.log();

  console.log("📝 Files Modified:");
  console.log("  ✅ programs/asdf-dat/src/lib.rs");
  console.log("  ✅ Anchor.toml");
  console.log();

  console.log("📦 Backups Created:");
  console.log("  💾 programs/asdf-dat/src/lib.rs.mainnet.backup");
  console.log("  💾 Anchor.toml.mainnet.backup");
  console.log();

  console.log("🎯 Next Steps:");
  console.log("================================");
  console.log("1. Verify the changes in lib.rs:");
  console.log("   grep -A2 'ASDF_MINT\\|POOL_PUMPSWAP' programs/asdf-dat/src/lib.rs");
  console.log();
  console.log("2. Build the program:");
  console.log("   anchor build");
  console.log();
  console.log("3. Get the program ID:");
  console.log("   solana address -k target/deploy/asdf_dat-keypair.json");
  console.log();
  console.log("4. Update the program ID in lib.rs and Anchor.toml");
  console.log();
  console.log("5. Rebuild:");
  console.log("   anchor build");
  console.log();
  console.log("6. Deploy to devnet:");
  console.log("   anchor deploy --provider.cluster devnet");
  console.log();
  console.log("7. Initialize the protocol:");
  console.log("   ts-node scripts/devnet-init.ts");
  console.log();

  console.log("⚠️  IMPORTANT - Restore for Mainnet:");
  console.log("================================");
  console.log("Before deploying to mainnet, restore the original files:");
  console.log("  cp programs/asdf-dat/src/lib.rs.mainnet.backup programs/asdf-dat/src/lib.rs");
  console.log("  cp Anchor.toml.mainnet.backup Anchor.toml");
  console.log();
}

/**
 * Main execution
 */
async function main() {
  console.log("================================");
  console.log("DEVNET CONFIGURATION APPLIER");
  console.log("================================\n");

  try {
    // Read devnet config
    const config = readDevnetConfig();

    // Update lib.rs
    updateLibRs(config);

    // Update Anchor.toml
    updateAnchorToml();

    // Display next steps
    displayNextSteps(config);

  } catch (error) {
    console.error("\n❌ Failed to apply configuration:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Execute
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
