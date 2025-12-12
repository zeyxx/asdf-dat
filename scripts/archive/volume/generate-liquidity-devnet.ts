/**
 * GÉNÉRATION LIQUIDITÉ DEVNET
 *
 * Effectue plusieurs achats sur un token PumpFun pour créer
 * de la liquidité artificielle dans le bonding curve.
 *
 * Objectif: Permettre au système DAT de faire des swaps sans erreur
 * "TooMuchSolRequired" en augmentant les real reserves du pool.
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { OnlinePumpSdk } from '@pump-fun/pump-sdk';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import fs from 'fs';

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const sdk = new OnlinePumpSdk(connection);

interface LiquidityConfig {
  buyAmountSol: number;    // Montant par achat (SOL)
  numBuys: number;         // Nombre d'achats
  slippageBps: number;     // Slippage tolerance (basis points)
  delayMs: number;         // Délai entre achats (ms)
}

const DEFAULT_CONFIG: LiquidityConfig = {
  buyAmountSol: 0.05,      // 0.05 SOL par achat
  numBuys: 10,             // 10 achats = 0.5 SOL total
  slippageBps: 1000,       // 10% slippage (devnet volatile)
  delayMs: 2000,           // 2 secondes entre achats
};

async function generateLiquidity(
  tokenFile: string,
  config: LiquidityConfig = DEFAULT_CONFIG
) {
  console.log('🌊 GÉNÉRATION LIQUIDITÉ DEVNET');
  console.log('═'.repeat(70));

  // Load wallet
  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync('devnet-wallet.json', 'utf-8')))
  );

  // Load token info
  const tokenInfo = JSON.parse(fs.readFileSync(tokenFile, 'utf-8'));
  const mint = new PublicKey(tokenInfo.mint);

  console.log('\n📋 Configuration:');
  console.log('Token:', tokenInfo.symbol, `(${tokenInfo.name})`);
  console.log('Mint:', mint.toString());
  console.log('Wallet:', wallet.publicKey.toString());
  console.log('Buy Amount:', config.buyAmountSol, 'SOL per buy');
  console.log('Number of Buys:', config.numBuys);
  console.log('Total SOL:', (config.buyAmountSol * config.numBuys).toFixed(2), 'SOL');
  console.log('Slippage:', (config.slippageBps / 100).toFixed(1), '%');

  // Check wallet balance
  const walletBalance = await connection.getBalance(wallet.publicKey);
  const requiredBalance = config.buyAmountSol * config.numBuys * 1e9;

  console.log('\n💰 Wallet Balance:', (walletBalance / 1e9).toFixed(4), 'SOL');

  if (walletBalance < requiredBalance) {
    throw new Error(
      `Insufficient balance. Required: ${(requiredBalance / 1e9).toFixed(2)} SOL, ` +
      `Available: ${(walletBalance / 1e9).toFixed(4)} SOL`
    );
  }

  // Fetch initial bonding curve state
  console.log('\n📊 Fetching initial bonding curve state...');
  const { bondingCurve: initialCurve } = await sdk.fetchBuyState(
    mint,
    wallet.publicKey,
    TOKEN_PROGRAM_ID
  );

  console.log('\n═'.repeat(70));
  console.log('📊 ÉTAT INITIAL DU BONDING CURVE');
  console.log('═'.repeat(70));
  console.log('Virtual Token Reserves:', Number(initialCurve.virtualTokenReserves).toLocaleString());
  console.log('Virtual SOL Reserves:  ', (Number(initialCurve.virtualSolReserves) / 1e9).toFixed(4), 'SOL');
  console.log('Real Token Reserves:   ', Number(initialCurve.realTokenReserves).toLocaleString());
  console.log('Real SOL Reserves:     ', (Number(initialCurve.realSolReserves) / 1e9).toFixed(4), 'SOL');
  console.log('Total Supply:          ', Number(initialCurve.tokenTotalSupply).toLocaleString());
  console.log('Complete:              ', initialCurve.complete ? '✅ Yes' : '❌ No');

  // Perform multiple buys
  console.log('\n═'.repeat(70));
  console.log(`🔄 EXÉCUTION DE ${config.numBuys} ACHATS`);
  console.log('═'.repeat(70));

  const buyResults: Array<{
    index: number;
    success: boolean;
    signature?: string;
    error?: string;
    tokensReceived?: number;
  }> = [];

  for (let i = 1; i <= config.numBuys; i++) {
    try {
      console.log(`\n[${i}/${config.numBuys}] 💵 Buying ${config.buyAmountSol} SOL worth of tokens...`);

      const buyAmountLamports = BigInt(Math.floor(config.buyAmountSol * 1e9));

      const buyResult = await sdk.buy(
        wallet,
        mint,
        buyAmountLamports,
        config.slippageBps,
        {
          commitment: 'confirmed',
          skipPreflight: false,
        }
      );

      console.log(`   ✅ Buy ${i} successful`);
      console.log(`   📝 Signature: ${buyResult.signature}`);

      buyResults.push({
        index: i,
        success: true,
        signature: buyResult.signature,
      });

      // Wait before next buy
      if (i < config.numBuys) {
        console.log(`   ⏳ Waiting ${config.delayMs}ms before next buy...`);
        await new Promise(resolve => setTimeout(resolve, config.delayMs));
      }

    } catch (error: any) {
      console.error(`   ❌ Buy ${i} FAILED:`, error.message);

      buyResults.push({
        index: i,
        success: false,
        error: error.message,
      });

      // Continue with next buy (don't stop on error)
      if (i < config.numBuys) {
        console.log(`   ⏳ Waiting ${config.delayMs}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, config.delayMs));
      }
    }
  }

  // Fetch final bonding curve state
  console.log('\n📊 Fetching final bonding curve state...');
  const { bondingCurve: finalCurve } = await sdk.fetchBuyState(
    mint,
    wallet.publicKey,
    TOKEN_PROGRAM_ID
  );

  console.log('\n═'.repeat(70));
  console.log('📊 ÉTAT FINAL DU BONDING CURVE');
  console.log('═'.repeat(70));
  console.log('Virtual Token Reserves:', Number(finalCurve.virtualTokenReserves).toLocaleString());
  console.log('Virtual SOL Reserves:  ', (Number(finalCurve.virtualSolReserves) / 1e9).toFixed(4), 'SOL');
  console.log('Real Token Reserves:   ', Number(finalCurve.realTokenReserves).toLocaleString());
  console.log('Real SOL Reserves:     ', (Number(finalCurve.realSolReserves) / 1e9).toFixed(4), 'SOL');
  console.log('Total Supply:          ', Number(finalCurve.tokenTotalSupply).toLocaleString());
  console.log('Complete:              ', finalCurve.complete ? '✅ Yes' : '❌ No');

  // Calculate deltas
  const virtualSolDelta = Number(finalCurve.virtualSolReserves) - Number(initialCurve.virtualSolReserves);
  const realSolDelta = Number(finalCurve.realSolReserves) - Number(initialCurve.realSolReserves);
  const virtualTokenDelta = Number(initialCurve.virtualTokenReserves) - Number(finalCurve.virtualTokenReserves);
  const realTokenDelta = Number(initialCurve.realTokenReserves) - Number(finalCurve.realTokenReserves);

  console.log('\n═'.repeat(70));
  console.log('📈 CHANGEMENTS (DELTA)');
  console.log('═'.repeat(70));
  console.log('Virtual SOL:   ', virtualSolDelta > 0 ? '+' : '', (virtualSolDelta / 1e9).toFixed(4), 'SOL');
  console.log('Real SOL:      ', realSolDelta > 0 ? '+' : '', (realSolDelta / 1e9).toFixed(4), 'SOL');
  console.log('Virtual Tokens:', virtualTokenDelta > 0 ? '-' : '+', Math.abs(virtualTokenDelta).toLocaleString());
  console.log('Real Tokens:   ', realTokenDelta > 0 ? '-' : '+', Math.abs(realTokenDelta).toLocaleString());

  // Summary
  const successfulBuys = buyResults.filter(r => r.success).length;
  const failedBuys = buyResults.filter(r => !r.success).length;

  console.log('\n═'.repeat(70));
  console.log('📊 RÉSUMÉ');
  console.log('═'.repeat(70));
  console.log('Total Buys Attempted:', config.numBuys);
  console.log('Successful:          ', successfulBuys, '✅');
  console.log('Failed:              ', failedBuys, failedBuys > 0 ? '❌' : '');
  console.log('Success Rate:        ', ((successfulBuys / config.numBuys) * 100).toFixed(1), '%');
  console.log('Liquidity Added:     ', (realSolDelta / 1e9).toFixed(4), 'SOL');

  // Save detailed results
  const results = {
    timestamp: new Date().toISOString(),
    token: {
      symbol: tokenInfo.symbol,
      name: tokenInfo.name,
      mint: mint.toString(),
    },
    config: {
      buyAmountSol: config.buyAmountSol,
      numBuys: config.numBuys,
      slippageBps: config.slippageBps,
      totalSolBudget: config.buyAmountSol * config.numBuys,
    },
    initialState: {
      virtualSolReserves: Number(initialCurve.virtualSolReserves),
      realSolReserves: Number(initialCurve.realSolReserves),
      virtualTokenReserves: Number(initialCurve.virtualTokenReserves),
      realTokenReserves: Number(initialCurve.realTokenReserves),
      totalSupply: Number(initialCurve.tokenTotalSupply),
    },
    finalState: {
      virtualSolReserves: Number(finalCurve.virtualSolReserves),
      realSolReserves: Number(finalCurve.realSolReserves),
      virtualTokenReserves: Number(finalCurve.virtualTokenReserves),
      realTokenReserves: Number(finalCurve.realTokenReserves),
      totalSupply: Number(finalCurve.tokenTotalSupply),
    },
    deltas: {
      virtualSol: virtualSolDelta,
      realSol: realSolDelta,
      virtualTokens: virtualTokenDelta,
      realTokens: realTokenDelta,
    },
    buys: buyResults,
    summary: {
      totalAttempted: config.numBuys,
      successful: successfulBuys,
      failed: failedBuys,
      successRate: (successfulBuys / config.numBuys) * 100,
      liquidityAddedSol: realSolDelta / 1e9,
    },
  };

  const resultsFile = `liquidity-generation-${tokenInfo.symbol}-${Date.now()}.json`;
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));

  console.log('\n💾 Résultats détaillés sauvegardés:', resultsFile);

  // Validation checks
  console.log('\n═'.repeat(70));
  console.log('✅ VALIDATION');
  console.log('═'.repeat(70));

  const checks = {
    'At least 80% buys successful': successfulBuys >= config.numBuys * 0.8,
    'Real SOL reserves increased': realSolDelta > 0,
    'Liquidity added > 0.1 SOL': (realSolDelta / 1e9) > 0.1,
    'No bonding curve completion': !finalCurve.complete,
  };

  Object.entries(checks).forEach(([check, passed]) => {
    console.log(passed ? '✅' : '❌', check);
  });

  const allChecksPassed = Object.values(checks).every(v => v);

  if (allChecksPassed) {
    console.log('\n🎉 SUCCÈS! Liquidité générée avec succès.');
    console.log('Le système DAT peut maintenant exécuter des swaps sur ce token.');
  } else {
    console.log('\n⚠️  ATTENTION: Certaines validations ont échoué.');
    console.log('Vous pouvez réexécuter ce script pour ajouter plus de liquidité.');
  }

  return results;
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('❌ Usage: npx ts-node scripts/generate-liquidity-devnet.ts <token-file>');
    console.error('Example: npx ts-node scripts/generate-liquidity-devnet.ts devnet-token-secondary.json');
    process.exit(1);
  }

  const tokenFile = args[0];

  if (!fs.existsSync(tokenFile)) {
    console.error(`❌ Token file not found: ${tokenFile}`);
    process.exit(1);
  }

  // Optional custom config via CLI
  const customConfig: Partial<LiquidityConfig> = {};

  args.forEach((arg, i) => {
    if (arg === '--buy-amount' && args[i + 1]) {
      customConfig.buyAmountSol = parseFloat(args[i + 1]);
    }
    if (arg === '--num-buys' && args[i + 1]) {
      customConfig.numBuys = parseInt(args[i + 1]);
    }
    if (arg === '--slippage' && args[i + 1]) {
      customConfig.slippageBps = parseInt(args[i + 1]);
    }
  });

  const config = { ...DEFAULT_CONFIG, ...customConfig };

  generateLiquidity(tokenFile, config)
    .then(() => {
      console.log('\n✅ Script terminé avec succès.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Erreur fatale:', error.message);
      console.error(error.stack);
      process.exit(1);
    });
}

export { generateLiquidity, LiquidityConfig };
