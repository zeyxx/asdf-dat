#!/usr/bin/env ts-node
/**
 * Token Configuration Validator CLI
 *
 * Validates token configuration files against the Zod schema.
 * Can validate single files or entire directories.
 *
 * Usage:
 *   npx ts-node scripts/validate-tokens.ts [path] [options]
 *
 * Examples:
 *   npx ts-node scripts/validate-tokens.ts                    # Validate current network tokens
 *   npx ts-node scripts/validate-tokens.ts devnet-tokens/     # Validate devnet directory
 *   npx ts-node scripts/validate-tokens.ts mainnet-tokens/    # Validate mainnet directory
 *   npx ts-node scripts/validate-tokens.ts token.json         # Validate single file
 *   npx ts-node scripts/validate-tokens.ts --network devnet   # Use network config
 */

import * as path from 'path';
import {
  loadAndValidateTokenConfig,
  loadAndValidateTokenDirectory,
  validateEcosystemConsistency,
  getPoolAddress,
} from '../lib/config-validator';
import { getNetworkConfig } from '../lib/network-config';

function printUsage(): void {
  console.log(`
Token Configuration Validator

Usage:
  npx ts-node scripts/validate-tokens.ts [path] [options]

Options:
  --network <devnet|mainnet>  Use network configuration for token path
  --verbose                   Show detailed validation output
  --help                      Show this help message

Examples:
  npx ts-node scripts/validate-tokens.ts                    # Validate devnet-tokens/
  npx ts-node scripts/validate-tokens.ts devnet-tokens/     # Validate directory
  npx ts-node scripts/validate-tokens.ts token.json         # Validate single file
  npx ts-node scripts/validate-tokens.ts --network mainnet  # Validate mainnet tokens
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Help flag
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const verbose = args.includes('--verbose') || args.includes('-v');

  // Determine path to validate
  let targetPath: string;

  if (args.includes('--network')) {
    const networkConfig = getNetworkConfig(args);
    // Derive token directory from first token file path
    if (networkConfig.tokens.length > 0) {
      targetPath = path.dirname(networkConfig.tokens[0]);
    } else {
      targetPath = networkConfig.name.toLowerCase() + '-tokens';
    }
    console.log(`\n🌐 Using ${networkConfig.name} network configuration`);
  } else {
    // Find non-flag argument
    const pathArg = args.find((a) => !a.startsWith('--') && !a.startsWith('-'));
    targetPath = pathArg || 'devnet-tokens';
  }

  console.log(`\n📁 Validating: ${targetPath}\n`);
  console.log('═'.repeat(60));

  // Check if path is file or directory
  const isFile = targetPath.endsWith('.json');

  if (isFile) {
    // Validate single file
    const result = loadAndValidateTokenConfig(targetPath);

    if (result.valid && result.config) {
      console.log(`\n✅ ${path.basename(targetPath)} - VALID`);
      console.log(`   Symbol: ${result.config.symbol}`);
      console.log(`   Name: ${result.config.name}`);
      console.log(`   Mint: ${result.config.mint}`);
      console.log(`   Pool: ${getPoolAddress(result.config)}`);
      console.log(`   Type: ${result.config.poolType}`);
      console.log(`   Root: ${result.config.isRoot}`);
      console.log(`   Network: ${result.config.network}`);
    } else {
      console.log(`\n❌ ${path.basename(targetPath)} - INVALID`);
      result.errorMessages?.forEach((err) => {
        console.log(`   • ${err}`);
      });
      process.exit(1);
    }
  } else {
    // Validate directory
    const { configs, errors } = loadAndValidateTokenDirectory(targetPath);

    // Report valid configs
    console.log(`\n✅ Valid Configurations: ${configs.length}`);
    configs.forEach((config) => {
      console.log(`   • ${config.symbol.padEnd(10)} - ${config.name}`);
      if (verbose) {
        console.log(`     Mint: ${config.mint}`);
        console.log(`     Pool: ${getPoolAddress(config)}`);
        console.log(`     Type: ${config.poolType}`);
        console.log(`     Root: ${config.isRoot}`);
      }
    });

    // Report errors
    if (errors.length > 0) {
      console.log(`\n❌ Invalid Configurations: ${errors.length}`);
      errors.forEach(({ file, errors: errs }) => {
        console.log(`   • ${file}:`);
        errs.forEach((err) => console.log(`     - ${err}`));
      });
    }

    // Validate ecosystem consistency
    if (configs.length > 0) {
      console.log('\n' + '═'.repeat(60));
      console.log('📊 Ecosystem Consistency Check\n');

      const consistency = validateEcosystemConsistency(configs);

      if (consistency.valid) {
        console.log('✅ Ecosystem is consistent');

        // Show root token
        const root = configs.find((c) => c.isRoot);
        if (root) {
          console.log(`   Root Token: ${root.symbol} (${root.name})`);
        }

        // Show secondaries
        const secondaries = configs.filter((c) => !c.isRoot);
        console.log(`   Secondary Tokens: ${secondaries.length}`);
        secondaries.forEach((s) => {
          console.log(`     • ${s.symbol}`);
        });
      } else {
        console.log('❌ Ecosystem has consistency errors:');
        consistency.errors.forEach((err) => {
          console.log(`   • ${err}`);
        });
      }

      if (consistency.warnings.length > 0) {
        console.log('\n⚠️  Warnings:');
        consistency.warnings.forEach((warn) => {
          console.log(`   • ${warn}`);
        });
      }
    }

    // Exit with error if any validation failed
    if (errors.length > 0) {
      process.exit(1);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log('✅ Validation complete\n');
}

main().catch((error) => {
  console.error('\n❌ Validation failed:', error.message);
  process.exit(1);
});
