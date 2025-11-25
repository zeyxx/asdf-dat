/**
 * COMPLETE ECOSYSTEM VALIDATION TEST
 *
 * Orchestrates a comprehensive test of the DAT ecosystem:
 * 1. Captures detailed initial state (all tokens)
 * 2. Generates liquidity via purchases
 * 3. Executes cycles in proper order (secondary → root)
 * 4. Captures detailed final state
 * 5. Generates comprehensive report with fee distribution analysis
 *
 * Usage: npx ts-node scripts/complete-ecosystem-validation.ts
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet, Idl } from '@coral-xyz/anchor';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

const PROGRAM_ID = new PublicKey('ASDfNfUHwVGfrg3SV7SQYWhaVxnrCUZyWmMpWJAPu4MZ');
const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

interface TokenConfig {
  name: string;
  symbol: string;
  mint: string;
  creator: string;
  bondingCurve: string;
  isRoot: boolean;
  tokenProgram: string;
  file: string;
}

interface TokenState {
  // Balances (SOL)
  creatorVaultBalance: number;
  datAuthorityBalance: number;
  rootTreasuryBalance: number;

  // Token Stats (from on-chain account)
  totalSolCollected: number;
  totalTokensBurned: number;
  totalSolSentToRoot?: number;
  totalSolReceivedFromOthers?: number;
  lastSolSentToRoot?: number;

  // Bonding Curve State
  virtualSolReserves?: number;
  realSolReserves?: number;
  virtualTokenReserves?: number;

  // Metadata
  timestamp: string;
}

interface EcosystemState {
  DATSPL: TokenState;
  DATS2: TokenState;
  DATM: TokenState;
}

interface CycleResult {
  token: string;
  success: boolean;
  collectTx?: string;
  buyTx?: string;
  burnTx?: string;
  solCollected?: number;
  tokensAcquired?: number;
  tokensBurned?: number;
  feeSplitToRoot?: number;
  error?: string;
  logs?: string[];
}

interface TestReport {
  timestamp: string;
  initialState: EcosystemState;
  liquidityGeneration: {
    DATSPL: { purchases: number; totalSpent: number; success: boolean };
    DATS2: { purchases: number; totalSpent: number; success: boolean };
    DATM: { purchases: number; totalSpent: number; success: boolean };
  };
  cycleResults: {
    DATS2: CycleResult;
    DATM: CycleResult;
    DATSPL: CycleResult;
  };
  finalState: EcosystemState;
  analysis: {
    totalFeesGenerated: number;
    dats2FeeSplit: { toRoot: number; toSelf: number; percentage: string };
    datmFeeSplit: { toRoot: number; toSelf: number; percentage: string };
    datsplTotal: { fromVault: number; fromTreasury: number; total: number };
    totalTokensBurned: number;
    feeDistributionCorrect: boolean;
  };
}

class EcosystemValidator {
  private connection: Connection;
  private program: Program;
  private admin: Keypair;
  private tokens: { [key: string]: TokenConfig };

  constructor() {
    this.connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    this.admin = Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(fs.readFileSync('devnet-wallet.json', 'utf-8')))
    );

    const provider = new AnchorProvider(
      this.connection,
      new Wallet(this.admin),
      { commitment: 'confirmed' }
    );

    const idl = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../target/idl/asdf_dat.json'), 'utf-8')
    ) as Idl;

    if (idl.metadata) {
      (idl.metadata as any).address = PROGRAM_ID.toString();
    } else {
      (idl as any).metadata = { address: PROGRAM_ID.toString() };
    }

    this.program = new Program(idl, provider);

    // Load token configs
    this.tokens = {
      DATSPL: { ...JSON.parse(fs.readFileSync('devnet-token-spl.json', 'utf-8')), file: 'devnet-token-spl.json' },
      DATS2: { ...JSON.parse(fs.readFileSync('devnet-token-secondary.json', 'utf-8')), file: 'devnet-token-secondary.json' },
      DATM: { ...JSON.parse(fs.readFileSync('devnet-token-mayhem.json', 'utf-8')), file: 'devnet-token-mayhem.json' },
    };
  }

  private log(emoji: string, message: string, data?: any) {
    console.log(`${emoji} ${message}`);
    if (data) {
      console.log(JSON.stringify(data, null, 2));
    }
  }

  private section(title: string) {
    console.log('\n' + '═'.repeat(80));
    console.log(`  ${title}`);
    console.log('═'.repeat(80) + '\n');
  }

  /**
   * Capture comprehensive state for a token
   */
  async captureTokenState(tokenKey: string): Promise<TokenState> {
    const token = this.tokens[tokenKey];
    const mint = new PublicKey(token.mint);
    const creator = new PublicKey(token.creator);

    this.log('📸', `Capturing ${token.symbol} state...`);

    // Derive PDAs
    const [datAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('auth_v3')],
      PROGRAM_ID
    );

    const [tokenStats] = PublicKey.findProgramAddressSync(
      [Buffer.from('token_stats_v1'), mint.toBuffer()],
      PROGRAM_ID
    );

    const [creatorVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('creator-vault'), creator.toBuffer()],
      PUMP_PROGRAM
    );

    const rootMint = new PublicKey(this.tokens.DATSPL.mint);
    const [rootTreasury] = PublicKey.findProgramAddressSync(
      [Buffer.from('root_treasury'), rootMint.toBuffer()],
      PROGRAM_ID
    );

    const [bondingCurve] = PublicKey.findProgramAddressSync(
      [Buffer.from('bonding-curve'), mint.toBuffer()],
      PUMP_PROGRAM
    );

    // Fetch all data in parallel
    const [vaultInfo, authInfo, treasuryInfo, statsData, curveData] = await Promise.all([
      this.connection.getAccountInfo(creatorVault),
      this.connection.getAccountInfo(datAuthority),
      this.connection.getAccountInfo(rootTreasury),
      (this.program.account as any).tokenStats.fetch(tokenStats).catch(() => null),
      this.connection.getAccountInfo(bondingCurve).catch(() => null),
    ]);

    const state: TokenState = {
      creatorVaultBalance: vaultInfo ? vaultInfo.lamports / LAMPORTS_PER_SOL : 0,
      datAuthorityBalance: authInfo ? authInfo.lamports / LAMPORTS_PER_SOL : 0,
      rootTreasuryBalance: treasuryInfo ? treasuryInfo.lamports / LAMPORTS_PER_SOL : 0,
      totalSolCollected: statsData ? Number(statsData.totalSolCollected) / LAMPORTS_PER_SOL : 0,
      totalTokensBurned: statsData ? Number(statsData.totalTokensBurned) : 0,
      timestamp: new Date().toISOString(),
    };

    // Add optional stats for secondary tokens
    if (statsData) {
      if (statsData.totalSolSentToRoot !== undefined) {
        state.totalSolSentToRoot = Number(statsData.totalSolSentToRoot) / LAMPORTS_PER_SOL;
      }
      if (statsData.totalSolReceivedFromOthers !== undefined) {
        state.totalSolReceivedFromOthers = Number(statsData.totalSolReceivedFromOthers) / LAMPORTS_PER_SOL;
      }
      if (statsData.lastSolSentToRoot !== undefined) {
        state.lastSolSentToRoot = Number(statsData.lastSolSentToRoot) / LAMPORTS_PER_SOL;
      }
    }

    // Parse bonding curve if available
    if (curveData && curveData.data.length >= 40) {
      try {
        const virtualSolReserves = curveData.data.readBigUInt64LE(8);
        const virtualTokenReserves = curveData.data.readBigUInt64LE(16);
        const realSolReserves = curveData.data.readBigUInt64LE(24);

        state.virtualSolReserves = Number(virtualSolReserves) / LAMPORTS_PER_SOL;
        state.realSolReserves = Number(realSolReserves) / LAMPORTS_PER_SOL;
        state.virtualTokenReserves = Number(virtualTokenReserves);
      } catch (err) {
        this.log('⚠️', `Could not parse bonding curve for ${token.symbol}`);
      }
    }

    this.log('  ✓', `${token.symbol} state captured`, {
      vault: `${state.creatorVaultBalance.toFixed(6)} SOL`,
      treasury: `${state.rootTreasuryBalance.toFixed(6)} SOL`,
      totalCollected: `${state.totalSolCollected.toFixed(6)} SOL`,
      totalBurned: state.totalTokensBurned.toLocaleString(),
    });

    return state;
  }

  /**
   * Capture state for all tokens
   */
  async captureEcosystemState(): Promise<EcosystemState> {
    this.section('CAPTURING ECOSYSTEM STATE');

    const [datspl, dats2, datm] = await Promise.all([
      this.captureTokenState('DATSPL'),
      this.captureTokenState('DATS2'),
      this.captureTokenState('DATM'),
    ]);

    return { DATSPL: datspl, DATS2: dats2, DATM: datm };
  }

  /**
   * Generate liquidity by making purchases on a token
   */
  async generateLiquidity(tokenKey: string, numPurchases: number, amountPerPurchase: number): Promise<{ purchases: number; totalSpent: number; success: boolean }> {
    const token = this.tokens[tokenKey];
    this.log('💰', `Generating liquidity on ${token.symbol}: ${numPurchases}x ${amountPerPurchase} SOL`);

    let successfulPurchases = 0;
    const scriptPath = 'scripts/buy-single-token.ts';

    for (let i = 1; i <= numPurchases; i++) {
      try {
        this.log('  →', `Purchase ${i}/${numPurchases}...`);

        const { stdout, stderr } = await execAsync(
          `npx ts-node ${scriptPath} ${token.file} ${amountPerPurchase}`,
          { timeout: 60000 }
        );

        if (stdout.includes('✅') || stdout.includes('success')) {
          successfulPurchases++;
          this.log('  ✓', `Purchase ${i} successful`);
        } else {
          this.log('  ⚠️', `Purchase ${i} may have issues`);
        }

        // Wait between purchases
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error: any) {
        this.log('  ✗', `Purchase ${i} failed: ${error.message}`);
      }
    }

    const result = {
      purchases: successfulPurchases,
      totalSpent: successfulPurchases * amountPerPurchase,
      success: successfulPurchases > 0,
    };

    this.log('✅', `Liquidity generation complete: ${successfulPurchases}/${numPurchases} successful`);
    return result;
  }

  /**
   * Execute cycle on a token using appropriate script
   */
  async executeCycle(tokenKey: string, isRoot: boolean): Promise<CycleResult> {
    const token = this.tokens[tokenKey];
    const scriptPath = isRoot
      ? 'scripts/execute-cycle-root.ts'
      : 'scripts/execute-cycle-secondary.ts';

    this.log('🔄', `Executing cycle on ${token.symbol} (${isRoot ? 'ROOT' : 'SECONDARY'})...`);

    const result: CycleResult = {
      token: token.symbol,
      success: false,
    };

    try {
      const { stdout, stderr } = await execAsync(
        `npx ts-node ${scriptPath} ${token.file}`,
        { timeout: 120000 }
      );

      // Parse output for transaction signatures
      const collectMatch = stdout.match(/STEP 1.*?TX.*?([A-Za-z0-9]{87,88})/s);
      const buyMatch = stdout.match(/STEP 2.*?TX.*?([A-Za-z0-9]{87,88})/s);
      const burnMatch = stdout.match(/STEP 3.*?TX.*?([A-Za-z0-9]{87,88})/s);

      if (collectMatch) result.collectTx = collectMatch[1];
      if (buyMatch) result.buyTx = buyMatch[1];
      if (burnMatch) result.burnTx = burnMatch[1];

      // Check for success indicators
      if (stdout.includes('✅') && stdout.includes('COMPLETED')) {
        result.success = true;
        this.log('✅', `${token.symbol} cycle completed successfully`);
      } else {
        this.log('⚠️', `${token.symbol} cycle may have issues`);
      }

      result.logs = stdout.split('\n').slice(-20); // Keep last 20 lines

    } catch (error: any) {
      result.success = false;
      result.error = error.message;
      result.logs = error.stdout ? error.stdout.split('\n').slice(-20) : [];
      this.log('❌', `${token.symbol} cycle failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Analyze fee distribution and validate correctness
   */
  analyzeResults(initial: EcosystemState, final: EcosystemState, cycles: any): any {
    this.section('ANALYZING RESULTS');

    // DATS2 Analysis
    const dats2SolDelta = final.DATS2.totalSolCollected - initial.DATS2.totalSolCollected;
    const dats2ToRoot = (final.DATS2.totalSolSentToRoot || 0) - (initial.DATS2.totalSolSentToRoot || 0);
    const dats2ToSelf = dats2SolDelta - dats2ToRoot;
    const dats2Percentage = dats2SolDelta > 0
      ? `${((dats2ToRoot / dats2SolDelta) * 100).toFixed(1)}% to root, ${((dats2ToSelf / dats2SolDelta) * 100).toFixed(1)}% to self`
      : 'N/A';

    // DATM Analysis
    const datmSolDelta = final.DATM.totalSolCollected - initial.DATM.totalSolCollected;
    const datmToRoot = (final.DATM.totalSolSentToRoot || 0) - (initial.DATM.totalSolSentToRoot || 0);
    const datmToSelf = datmSolDelta - datmToRoot;
    const datmPercentage = datmSolDelta > 0
      ? `${((datmToRoot / datmSolDelta) * 100).toFixed(1)}% to root, ${((datmToSelf / datmSolDelta) * 100).toFixed(1)}% to self`
      : 'N/A';

    // DATSPL Analysis
    const datsplVaultDelta = initial.DATSPL.creatorVaultBalance - final.DATSPL.creatorVaultBalance;
    const datsplTreasuryDelta = initial.DATSPL.rootTreasuryBalance - final.DATSPL.rootTreasuryBalance;
    const datsplSolDelta = final.DATSPL.totalSolCollected - initial.DATSPL.totalSolCollected;

    // Total tokens burned
    const totalBurned =
      (final.DATSPL.totalTokensBurned - initial.DATSPL.totalTokensBurned) +
      (final.DATS2.totalTokensBurned - initial.DATS2.totalTokensBurned) +
      (final.DATM.totalTokensBurned - initial.DATM.totalTokensBurned);

    // Validate fee distribution (should be ~44.8% to root for secondary tokens)
    const dats2Correct = dats2SolDelta === 0 || Math.abs((dats2ToRoot / dats2SolDelta) - 0.448) < 0.1;
    const datmCorrect = datmSolDelta === 0 || Math.abs((datmToRoot / datmSolDelta) - 0.448) < 0.1;
    const feeDistributionCorrect = dats2Correct && datmCorrect;

    const analysis = {
      totalFeesGenerated: dats2SolDelta + datmSolDelta + datsplSolDelta,
      dats2FeeSplit: {
        toRoot: dats2ToRoot,
        toSelf: dats2ToSelf,
        percentage: dats2Percentage,
      },
      datmFeeSplit: {
        toRoot: datmToRoot,
        toSelf: datmToSelf,
        percentage: datmPercentage,
      },
      datsplTotal: {
        fromVault: datsplVaultDelta,
        fromTreasury: datsplTreasuryDelta,
        total: datsplSolDelta,
      },
      totalTokensBurned: totalBurned,
      feeDistributionCorrect,
    };

    this.log('📊', 'Analysis Complete', analysis);
    return analysis;
  }

  /**
   * Generate comprehensive markdown report
   */
  generateReport(report: TestReport): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `ecosystem-validation-report-${timestamp}.md`;

    let md = `# 🧪 COMPLETE ECOSYSTEM VALIDATION REPORT\n\n`;
    md += `**Date:** ${report.timestamp}\n`;
    md += `**Network:** Solana Devnet\n`;
    md += `**Program:** ASDfNfUHwVGfrg3SV7SQYWhaVxnrCUZyWmMpWJAPu4MZ\n\n`;
    md += `---\n\n`;

    // Initial State
    md += `## 📸 Initial State\n\n`;
    md += `| Token | Creator Vault | Root Treasury | Total Collected | Total Burned |\n`;
    md += `|-------|---------------|---------------|-----------------|-------------|\n`;
    for (const [key, state] of Object.entries(report.initialState)) {
      md += `| ${key} | ${state.creatorVaultBalance.toFixed(6)} SOL | ${state.rootTreasuryBalance.toFixed(6)} SOL | ${state.totalSolCollected.toFixed(6)} SOL | ${state.totalTokensBurned.toLocaleString()} |\n`;
    }
    md += `\n`;

    // Liquidity Generation
    md += `## 💰 Liquidity Generation\n\n`;
    for (const [key, result] of Object.entries(report.liquidityGeneration)) {
      md += `### ${key}\n`;
      md += `- Purchases: ${result.purchases}\n`;
      md += `- Total Spent: ${result.totalSpent} SOL\n`;
      md += `- Status: ${result.success ? '✅ Success' : '❌ Failed'}\n\n`;
    }

    // Cycle Executions
    md += `## 🔄 Cycle Executions\n\n`;
    for (const [key, result] of Object.entries(report.cycleResults)) {
      md += `### ${key} - ${result.success ? '✅ SUCCESS' : '❌ FAILED'}\n\n`;
      if (result.success) {
        md += `**Transactions:**\n`;
        md += `- Collect: [\`${result.collectTx}\`](https://explorer.solana.com/tx/${result.collectTx}?cluster=devnet)\n`;
        md += `- Buy: [\`${result.buyTx}\`](https://explorer.solana.com/tx/${result.buyTx}?cluster=devnet)\n`;
        md += `- Burn: [\`${result.burnTx}\`](https://explorer.solana.com/tx/${result.burnTx}?cluster=devnet)\n\n`;
      } else {
        md += `**Error:** ${result.error}\n\n`;
      }
    }

    // Final State
    md += `## 📸 Final State\n\n`;
    md += `| Token | Creator Vault | Root Treasury | Total Collected | Total Burned |\n`;
    md += `|-------|---------------|---------------|-----------------|-------------|\n`;
    for (const [key, state] of Object.entries(report.finalState)) {
      md += `| ${key} | ${state.creatorVaultBalance.toFixed(6)} SOL | ${state.rootTreasuryBalance.toFixed(6)} SOL | ${state.totalSolCollected.toFixed(6)} SOL | ${state.totalTokensBurned.toLocaleString()} |\n`;
    }
    md += `\n`;

    // Analysis
    md += `## 📊 Fee Distribution Analysis\n\n`;
    md += `### DATS2 (Secondary Token)\n`;
    md += `- To Root Treasury: ${report.analysis.dats2FeeSplit.toRoot.toFixed(6)} SOL\n`;
    md += `- To Self (Buyback): ${report.analysis.dats2FeeSplit.toSelf.toFixed(6)} SOL\n`;
    md += `- Split: ${report.analysis.dats2FeeSplit.percentage}\n\n`;

    md += `### DATM (Secondary Token)\n`;
    md += `- To Root Treasury: ${report.analysis.datmFeeSplit.toRoot.toFixed(6)} SOL\n`;
    md += `- To Self (Buyback): ${report.analysis.datmFeeSplit.toSelf.toFixed(6)} SOL\n`;
    md += `- Split: ${report.analysis.datmFeeSplit.percentage}\n\n`;

    md += `### DATSPL (Root Token)\n`;
    md += `- From Creator Vault: ${report.analysis.datsplTotal.fromVault.toFixed(6)} SOL\n`;
    md += `- From Root Treasury: ${report.analysis.datsplTotal.fromTreasury.toFixed(6)} SOL\n`;
    md += `- Total (100% Buyback): ${report.analysis.datsplTotal.total.toFixed(6)} SOL\n\n`;

    md += `### Summary\n`;
    md += `- Total Fees Generated: ${report.analysis.totalFeesGenerated.toFixed(6)} SOL\n`;
    md += `- Total Tokens Burned: ${report.analysis.totalTokensBurned.toLocaleString()}\n`;
    md += `- Fee Distribution Correct: ${report.analysis.feeDistributionCorrect ? '✅ YES' : '❌ NO'}\n\n`;

    md += `---\n\n`;
    md += `*Generated by complete-ecosystem-validation.ts*\n`;

    fs.writeFileSync(filename, md);
    this.log('💾', `Report saved: ${filename}`);

    return filename;
  }

  /**
   * Run the complete validation test
   */
  async runCompleteValidation(): Promise<void> {
    console.clear();
    this.section('🚀 COMPLETE ECOSYSTEM VALIDATION TEST');
    this.log('🕐', `Started at: ${new Date().toISOString()}`);

    const report: TestReport = {
      timestamp: new Date().toISOString(),
      initialState: {} as EcosystemState,
      liquidityGeneration: {} as any,
      cycleResults: {} as any,
      finalState: {} as EcosystemState,
      analysis: {} as any,
    };

    try {
      // PHASE 1: Capture initial state
      report.initialState = await this.captureEcosystemState();

      // PHASE 2: Generate liquidity
      this.section('PHASE 2: GENERATING LIQUIDITY');
      const [datspl, dats2, datm] = await Promise.all([
        this.generateLiquidity('DATSPL', 3, 0.05),
        this.generateLiquidity('DATS2', 3, 0.05),
        this.generateLiquidity('DATM', 3, 0.05),
      ]);
      report.liquidityGeneration = { DATSPL: datspl, DATS2: dats2, DATM: datm };

      // Wait for fees to settle
      this.log('⏳', 'Waiting for fees to settle...');
      await new Promise(resolve => setTimeout(resolve, 5000));

      // PHASE 3: Execute cycles
      this.section('PHASE 3: EXECUTING CYCLES');

      // Execute DATS2 (secondary)
      report.cycleResults.DATS2 = await this.executeCycle('DATS2', false);
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Execute DATM (secondary)
      report.cycleResults.DATM = await this.executeCycle('DATM', false);
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Execute DATSPL (root)
      report.cycleResults.DATSPL = await this.executeCycle('DATSPL', true);
      await new Promise(resolve => setTimeout(resolve, 3000));

      // PHASE 4: Capture final state
      report.finalState = await this.captureEcosystemState();

      // PHASE 5: Analyze results
      report.analysis = this.analyzeResults(
        report.initialState,
        report.finalState,
        report.cycleResults
      );

      // PHASE 6: Generate report
      this.section('GENERATING REPORT');
      const reportFile = this.generateReport(report);

      // Save JSON version too
      const jsonFile = reportFile.replace('.md', '.json');
      fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2));
      this.log('💾', `JSON report saved: ${jsonFile}`);

      // Final summary
      this.section('✅ TEST COMPLETE');
      this.log('📊', 'Summary:', {
        allCyclesSuccessful: Object.values(report.cycleResults).every(r => r.success),
        feeDistributionCorrect: report.analysis.feeDistributionCorrect,
        totalTokensBurned: report.analysis.totalTokensBurned,
        reportFile,
      });

    } catch (error: any) {
      this.log('❌', `Test failed: ${error.message}`);
      console.error(error);
      process.exit(1);
    }
  }
}

// Main execution
async function main() {
  const validator = new EcosystemValidator();
  await validator.runCompleteValidation();
}

main().catch(console.error);
