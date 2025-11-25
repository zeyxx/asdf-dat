/**
 * COMPLETE ECOSYSTEM TEST - Full Cycle Validation
 *
 * This script performs a comprehensive test of the entire DAT system:
 * 1. Captures initial state of all 3 tokens (DATSPL, DATS2, DATM)
 * 2. Executes full cycle on each token
 * 3. Captures final state
 * 4. Generates detailed comparison report
 *
 * Run: npx ts-node scripts/complete-ecosystem-test.ts
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet, Idl } from '@coral-xyz/anchor';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';
import fs from 'fs';
import path from 'path';

const PROGRAM_ID = new PublicKey('ASDfNfUHwVGfrg3SV7SQYWhaVxnrCUZyWmMpWJAPu4MZ');

function loadIdl(): Idl {
  const idlPath = path.join(__dirname, '../target/idl/asdf_dat.json');
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8')) as Idl;
  if (idl.metadata) {
    (idl.metadata as any).address = PROGRAM_ID.toString();
  } else {
    (idl as any).metadata = { address: PROGRAM_ID.toString() };
  }
  return idl;
}
const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMP_GLOBAL = new PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf');

interface TokenInfo {
  name: string;
  symbol: string;
  mint: string;
  creator: string;
  bondingCurve: string;
  isRoot: boolean;
  tokenProgram: string;
}

interface TokenState {
  timestamp: string;
  token: string;

  // On-chain accounts balances (SOL)
  creatorVaultBalance: number;
  datAuthorityBalance: number;
  rootTreasuryBalance: number;

  // Token stats (from program state)
  totalSolCollected: number;
  totalTokensBurned: number;
  totalSolSentToRoot?: number;
  totalSolReceivedFromOthers?: number;
  lastSolSentToRoot?: number;

  // Transaction info
  transactions?: string[];
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
}

interface TestReport {
  testDate: string;
  initialStates: { [key: string]: TokenState };
  cycleResults: { [key: string]: CycleResult };
  finalStates: { [key: string]: TokenState };
  summary: {
    totalSolProcessed: number;
    totalTokensBurned: number;
    totalFeesToRoot: number;
    allCyclesSuccessful: boolean;
  };
}

class EcosystemTester {
  private connection: Connection;
  private program: Program;
  private admin: Keypair;
  private tokens: { [key: string]: TokenInfo };

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

    const idl = loadIdl();
    this.program = new Program(idl, provider);

    // Load all token configs
    this.tokens = {
      DATSPL: JSON.parse(fs.readFileSync('devnet-token-spl.json', 'utf-8')),
      DATS2: JSON.parse(fs.readFileSync('devnet-token-secondary.json', 'utf-8')),
      DATM: JSON.parse(fs.readFileSync('devnet-token-mayhem.json', 'utf-8')),
    };
  }

  /**
   * Capture the current state of a token
   */
  async captureTokenState(tokenKey: string): Promise<TokenState> {
    const token = this.tokens[tokenKey];
    const mint = new PublicKey(token.mint);
    const creator = new PublicKey(token.creator);

    console.log(`\n📸 Capturing state: ${token.symbol}...`);

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

    // Get root mint from DATSPL config for root_treasury derivation
    const rootMint = new PublicKey(this.tokens['DATSPL'].mint);
    const [rootTreasury] = PublicKey.findProgramAddressSync(
      [Buffer.from('root_treasury'), rootMint.toBuffer()],
      PROGRAM_ID
    );

    // Fetch balances
    const [vaultBalance, authBalance, treasuryBalance] = await Promise.all([
      this.connection.getBalance(creatorVault),
      this.connection.getBalance(datAuthority),
      this.connection.getBalance(rootTreasury),
    ]);

    // Fetch token stats
    let stats: any = null;
    try {
      stats = await (this.program.account as any).tokenStats.fetch(tokenStats);
    } catch (err) {
      console.log(`   ⚠️  Token stats not initialized for ${token.symbol}`);
    }

    const state: TokenState = {
      timestamp: new Date().toISOString(),
      token: token.symbol,
      creatorVaultBalance: vaultBalance / 1e9,
      datAuthorityBalance: authBalance / 1e9,
      rootTreasuryBalance: treasuryBalance / 1e9,
      totalSolCollected: stats ? Number(stats.totalSolCollected) / 1e9 : 0,
      totalTokensBurned: stats ? Number(stats.totalTokensBurned) : 0,
    };

    if (stats && stats.totalSolSentToRoot !== undefined) {
      state.totalSolSentToRoot = Number(stats.totalSolSentToRoot) / 1e9;
    }
    if (stats && stats.totalSolReceivedFromOthers !== undefined) {
      state.totalSolReceivedFromOthers = Number(stats.totalSolReceivedFromOthers) / 1e9;
    }
    if (stats && stats.lastSolSentToRoot !== undefined) {
      state.lastSolSentToRoot = Number(stats.lastSolSentToRoot) / 1e9;
    }

    console.log(`   ✅ State captured`);
    console.log(`      Creator Vault: ${state.creatorVaultBalance.toFixed(6)} SOL`);
    console.log(`      DAT Authority: ${state.datAuthorityBalance.toFixed(6)} SOL`);
    console.log(`      Root Treasury: ${state.rootTreasuryBalance.toFixed(6)} SOL`);
    console.log(`      Total Collected: ${state.totalSolCollected.toFixed(6)} SOL`);
    console.log(`      Total Burned: ${state.totalTokensBurned.toLocaleString()} tokens`);

    return state;
  }

  /**
   * Collect ALL fees from the shared creator vault (single collection for ecosystem)
   * Uses for_ecosystem=true to preserve pending_fees for proportional distribution
   */
  async collectAllVaultFees(): Promise<{ totalCollected: number; signature: string }> {
    // Use any token - they all share the same creator vault
    const token = this.tokens['DATSPL'];
    const mint = new PublicKey(token.mint);
    const creator = new PublicKey(token.creator);

    console.log('\n📥 Collecting ALL vault fees (single collect for ecosystem)...');

    // Derive PDAs
    const [datState] = PublicKey.findProgramAddressSync(
      [Buffer.from('dat_v3')],
      PROGRAM_ID
    );

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

    const [pumpEventAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from('__event_authority')],
      PUMP_PROGRAM
    );

    const rootMint = new PublicKey(this.tokens['DATSPL'].mint);
    const [rootTreasury] = PublicKey.findProgramAddressSync(
      [Buffer.from('root_treasury'), rootMint.toBuffer()],
      PROGRAM_ID
    );

    // Get vault balance before collect
    const vaultBalanceBefore = await this.connection.getBalance(creatorVault);
    console.log(`   💰 Creator Vault balance: ${(vaultBalanceBefore / 1e9).toFixed(6)} SOL`);

    // Collect with for_ecosystem=true
    const collectTx = await (this.program.methods as any)
      .collectFees(false, true) // is_root_token=false, for_ecosystem=true
      .accounts({
        datState,
        tokenStats,
        tokenMint: mint,
        datAuthority,
        creatorVault,
        pumpEventAuthority: pumpEventAuth,
        pumpSwapProgram: PUMP_PROGRAM,
        rootTreasury,
        systemProgram: PublicKey.default,
      })
      .rpc();

    await this.connection.confirmTransaction(collectTx, 'confirmed');

    // Get total collected in datAuthority
    const authBalance = await this.connection.getBalance(datAuthority);
    console.log(`   ✅ Collected: ${(authBalance / 1e9).toFixed(6)} SOL`);
    console.log(`   🔗 TX: ${collectTx}`);

    return { totalCollected: authBalance, signature: collectTx };
  }

  /**
   * Calculate proportional allocations based on pending_fees
   */
  async calculateProportionalAllocations(
    totalCollected: number,
    tokenKeys: string[]
  ): Promise<Map<string, number>> {
    console.log('\n📊 Calculating proportional allocations...');

    const allocations = new Map<string, number>();
    const pendingFees = new Map<string, number>();
    let totalPendingFees = 0;

    // Fetch pending_fees from each token's stats
    for (const tokenKey of tokenKeys) {
      const token = this.tokens[tokenKey];
      const mint = new PublicKey(token.mint);

      const [tokenStats] = PublicKey.findProgramAddressSync(
        [Buffer.from('token_stats_v1'), mint.toBuffer()],
        PROGRAM_ID
      );

      try {
        const stats = await (this.program.account as any).tokenStats.fetch(tokenStats);
        const pending = Number(stats.pendingFees || 0);
        pendingFees.set(tokenKey, pending);
        totalPendingFees += pending;
        console.log(`   ${token.symbol}: pending_fees = ${(pending / 1e9).toFixed(6)} SOL`);
      } catch {
        // If no pending fees, allocate equally
        pendingFees.set(tokenKey, 0);
        console.log(`   ${token.symbol}: pending_fees = 0 (not initialized)`);
      }
    }

    // If no pending fees tracked, distribute equally
    if (totalPendingFees === 0) {
      const equalShare = Math.floor(totalCollected / tokenKeys.length);
      for (const tokenKey of tokenKeys) {
        allocations.set(tokenKey, equalShare);
      }
      console.log(`   ⚠️ No pending_fees - using equal distribution: ${(equalShare / 1e9).toFixed(6)} SOL each`);
    } else {
      // Proportional distribution
      for (const [tokenKey, pending] of pendingFees) {
        const ratio = pending / totalPendingFees;
        const allocation = Math.floor(totalCollected * ratio);
        allocations.set(tokenKey, allocation);
        console.log(`   ${tokenKey}: ${(ratio * 100).toFixed(1)}% = ${(allocation / 1e9).toFixed(6)} SOL`);
      }
    }

    return allocations;
  }

  /**
   * Execute a full cycle on a token (original method - kept for reference)
   */
  async executeCycle(tokenKey: string): Promise<CycleResult> {
    const token = this.tokens[tokenKey];
    const mint = new PublicKey(token.mint);
    const creator = new PublicKey(token.creator);
    const isRoot = token.isRoot;
    const tokenProgram = token.tokenProgram === 'Token2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

    console.log(`\n🔄 Executing cycle: ${token.symbol} (${isRoot ? 'ROOT' : 'SECONDARY'})...`);

    const result: CycleResult = {
      token: token.symbol,
      success: false,
    };

    try {
      // Derive all PDAs
      const [datState] = PublicKey.findProgramAddressSync(
        [Buffer.from('dat_v3')],
        PROGRAM_ID
      );

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

      const [pumpEventAuth] = PublicKey.findProgramAddressSync(
        [Buffer.from('__event_authority')],
        PUMP_PROGRAM
      );

      // Use bondingCurve from token config instead of deriving (more reliable)
      const bondingCurve = new PublicKey(token.bondingCurve || token.mint);

      const [assocBondingCurve] = PublicKey.findProgramAddressSync(
        [
          bondingCurve.toBuffer(),
          tokenProgram.toBuffer(),
          mint.toBuffer(),
        ],
        new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
      );

      // Get DAT state to find root token mint
      const datStateData = await (this.program.account as any).datState.fetch(datState);
      const rootMint = datStateData.rootTokenMint || this.tokens['DATSPL']?.mint;

      // Derive rootTreasury with root_mint as second seed
      const [rootTreasury] = PublicKey.findProgramAddressSync(
        [Buffer.from('root_treasury'), new PublicKey(rootMint).toBuffer()],
        PROGRAM_ID
      );

      // Protocol fee recipient (different for Mayhem vs SPL)
      const MAYHEM_FEE_RECIPIENT = new PublicKey('GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS');
      const SPL_FEE_RECIPIENT = new PublicKey('6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs');
      const protocolFeeRecipient = token.tokenProgram === 'Token2022' ? MAYHEM_FEE_RECIPIENT : SPL_FEE_RECIPIENT;

      const [protocolFeeRecipientAta] = PublicKey.findProgramAddressSync(
        [
          protocolFeeRecipient.toBuffer(),
          tokenProgram.toBuffer(),
          mint.toBuffer(),
        ],
        new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
      );

      // Get DAT ATA for tokens
      const [datTokenAccount] = PublicKey.findProgramAddressSync(
        [
          datAuthority.toBuffer(),
          tokenProgram.toBuffer(),
          mint.toBuffer(),
        ],
        new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
      );

      // STEP 1: Collect fees
      console.log('   [1/3] Collecting fees...');
      const collectTx = await (this.program.methods as any)
        .collectFees(isRoot, false) // is_root_token, for_ecosystem
        .accounts({
          datState,
          tokenStats,
          tokenMint: mint,
          datAuthority,
          creatorVault,
          pumpEventAuthority: pumpEventAuth,
          pumpSwapProgram: PUMP_PROGRAM,
          rootTreasury,
          systemProgram: PublicKey.default,
        })
        .rpc();

      await this.connection.confirmTransaction(collectTx, 'confirmed');
      result.collectTx = collectTx;
      console.log(`   ✅ Fees collected: ${collectTx}`);

      // Get collected amount
      const authBalanceAfterCollect = await this.connection.getBalance(datAuthority);
      result.solCollected = authBalanceAfterCollect / 1e9;

      // STEP 2: Execute buy
      console.log('   [2/3] Executing buy...');

      // Derive additional required accounts for execute_buy
      const wsolMint = new PublicKey('So11111111111111111111111111111111111111112');
      const [poolWsolAccount] = PublicKey.findProgramAddressSync(
        [
          bondingCurve.toBuffer(),
          TOKEN_PROGRAM_ID.toBuffer(),
          wsolMint.toBuffer(),
        ],
        new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
      );

      const FEE_PROGRAM = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');

      const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
        [Buffer.from('global_volume_accumulator')],
        PUMP_PROGRAM
      );

      const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
        [Buffer.from('user_volume_accumulator'), datAuthority.toBuffer()],
        PUMP_PROGRAM
      );

      const [feeConfig] = PublicKey.findProgramAddressSync(
        [Buffer.from('fee_config'), PUMP_PROGRAM.toBuffer()],
        FEE_PROGRAM
      );

      const buyTx = await (this.program.methods as any)
        .executeBuy(!isRoot, null) // is_secondary_token (inverse of isRoot), allocated_lamports (null = use balance)
        .accounts({
          datState,
          datAuthority,
          datAsdfAccount: datTokenAccount,
          pool: bondingCurve,
          asdfMint: mint,
          poolAsdfAccount: assocBondingCurve,
          poolWsolAccount,
          pumpGlobalConfig: PUMP_GLOBAL,
          protocolFeeRecipient,
          protocolFeeRecipientAta,
          creatorVault,
          pumpEventAuthority: pumpEventAuth,
          pumpSwapProgram: PUMP_PROGRAM,
          globalVolumeAccumulator,
          userVolumeAccumulator,
          feeConfig,
          feeProgram: FEE_PROGRAM,
          rootTreasury,
          tokenProgram,
          systemProgram: PublicKey.default,
          rent: new PublicKey('SysvarRent111111111111111111111111111111111'),
        })
        .rpc();

      await this.connection.confirmTransaction(buyTx, 'confirmed');
      result.buyTx = buyTx;
      console.log(`   ✅ Buy executed: ${buyTx}`);

      // Get token balance
      const tokenAccount = await this.connection.getTokenAccountBalance(datTokenAccount);
      result.tokensAcquired = Number(tokenAccount.value.amount);

      // STEP 3: Burn and update
      console.log('   [3/3] Burning tokens...');
      const burnTx = await (this.program.methods as any)
        .burnAndUpdate() // No arguments per IDL
        .accounts({
          datState,
          tokenStats,
          datAuthority,
          datAsdfAccount: datTokenAccount,
          asdfMint: mint,
          tokenProgram,
        })
        .rpc();

      await this.connection.confirmTransaction(burnTx, 'confirmed');
      result.burnTx = burnTx;
      result.tokensBurned = result.tokensAcquired;
      console.log(`   ✅ Tokens burned: ${burnTx}`);

      result.success = true;
      console.log(`\n✅ Cycle completed successfully for ${token.symbol}`);

    } catch (error: any) {
      result.success = false;
      result.error = error.message;
      console.error(`\n❌ Cycle failed for ${token.symbol}:`, error.message);
      if (error.logs) {
        console.error('Program logs:', error.logs.slice(-10).join('\n'));
      }
    }

    return result;
  }

  /**
   * Execute a cycle with pre-allocated SOL (for orchestrated ecosystem cycles)
   * Skips collectFees since it's already done by collectAllVaultFees()
   */
  async executeCycleWithAllocation(
    tokenKey: string,
    allocatedLamports: number | null
  ): Promise<CycleResult> {
    const token = this.tokens[tokenKey];
    const mint = new PublicKey(token.mint);
    const creator = new PublicKey(token.creator);
    const isRoot = token.isRoot;
    const tokenProgram = token.tokenProgram === 'Token2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

    console.log(`\n🔄 Executing orchestrated cycle: ${token.symbol} (${isRoot ? 'ROOT' : 'SECONDARY'})...`);
    if (allocatedLamports) {
      console.log(`   💵 Allocated: ${(allocatedLamports / 1e9).toFixed(6)} SOL`);
    } else {
      console.log(`   💵 Using remaining balance (ROOT mode)`);
    }

    const result: CycleResult = {
      token: token.symbol,
      success: false,
    };

    try {
      // Derive all PDAs
      const [datState] = PublicKey.findProgramAddressSync(
        [Buffer.from('dat_v3')],
        PROGRAM_ID
      );

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

      const [pumpEventAuth] = PublicKey.findProgramAddressSync(
        [Buffer.from('__event_authority')],
        PUMP_PROGRAM
      );

      // Use bondingCurve from token config
      const bondingCurve = new PublicKey(token.bondingCurve || token.mint);

      const [assocBondingCurve] = PublicKey.findProgramAddressSync(
        [
          bondingCurve.toBuffer(),
          tokenProgram.toBuffer(),
          mint.toBuffer(),
        ],
        new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
      );

      // Get DAT state to find root token mint
      const datStateData = await (this.program.account as any).datState.fetch(datState);
      const rootMint = datStateData.rootTokenMint || this.tokens['DATSPL']?.mint;

      // Derive rootTreasury with root_mint as second seed
      const [rootTreasury] = PublicKey.findProgramAddressSync(
        [Buffer.from('root_treasury'), new PublicKey(rootMint).toBuffer()],
        PROGRAM_ID
      );

      // Protocol fee recipient (different for Mayhem vs SPL)
      const MAYHEM_FEE_RECIPIENT = new PublicKey('GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS');
      const SPL_FEE_RECIPIENT = new PublicKey('6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs');
      const protocolFeeRecipient = token.tokenProgram === 'Token2022' ? MAYHEM_FEE_RECIPIENT : SPL_FEE_RECIPIENT;

      const [protocolFeeRecipientAta] = PublicKey.findProgramAddressSync(
        [
          protocolFeeRecipient.toBuffer(),
          tokenProgram.toBuffer(),
          mint.toBuffer(),
        ],
        new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
      );

      // Get DAT ATA for tokens
      const [datTokenAccount] = PublicKey.findProgramAddressSync(
        [
          datAuthority.toBuffer(),
          tokenProgram.toBuffer(),
          mint.toBuffer(),
        ],
        new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
      );

      // NOTE: Skip collectFees - already done by collectAllVaultFees()
      result.collectTx = 'SKIPPED (orchestrated)';

      // Get current balance for reference
      const authBalance = await this.connection.getBalance(datAuthority);
      result.solCollected = allocatedLamports ? allocatedLamports / 1e9 : authBalance / 1e9;

      // STEP 1: Execute buy with allocation
      console.log('   [1/3] Executing buy...');

      // Derive additional required accounts for execute_buy
      const wsolMint = new PublicKey('So11111111111111111111111111111111111111112');
      const [poolWsolAccount] = PublicKey.findProgramAddressSync(
        [
          bondingCurve.toBuffer(),
          TOKEN_PROGRAM_ID.toBuffer(),
          wsolMint.toBuffer(),
        ],
        new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
      );

      const FEE_PROGRAM = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');

      const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
        [Buffer.from('global_volume_accumulator')],
        PUMP_PROGRAM
      );

      const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
        [Buffer.from('user_volume_accumulator'), datAuthority.toBuffer()],
        PUMP_PROGRAM
      );

      const [feeConfig] = PublicKey.findProgramAddressSync(
        [Buffer.from('fee_config'), PUMP_PROGRAM.toBuffer()],
        FEE_PROGRAM
      );

      // Convert allocation to BN or null
      const allocationBN = allocatedLamports ? new BN(allocatedLamports) : null;

      const buyTx = await (this.program.methods as any)
        .executeBuy(!isRoot, allocationBN) // is_secondary_token, allocated_lamports
        .accounts({
          datState,
          datAuthority,
          datAsdfAccount: datTokenAccount,
          pool: bondingCurve,
          asdfMint: mint,
          poolAsdfAccount: assocBondingCurve,
          poolWsolAccount,
          pumpGlobalConfig: PUMP_GLOBAL,
          protocolFeeRecipient,
          protocolFeeRecipientAta,
          creatorVault,
          pumpEventAuthority: pumpEventAuth,
          pumpSwapProgram: PUMP_PROGRAM,
          globalVolumeAccumulator,
          userVolumeAccumulator,
          feeConfig,
          feeProgram: FEE_PROGRAM,
          rootTreasury,
          tokenProgram,
          systemProgram: PublicKey.default,
          rent: new PublicKey('SysvarRent111111111111111111111111111111111'),
        })
        .rpc();

      await this.connection.confirmTransaction(buyTx, 'confirmed');
      result.buyTx = buyTx;
      console.log(`   ✅ Buy executed: ${buyTx}`);

      // Get token balance
      const tokenAccount = await this.connection.getTokenAccountBalance(datTokenAccount);
      result.tokensAcquired = Number(tokenAccount.value.amount);

      // STEP 2: For SECONDARY tokens - finalize allocated cycle
      if (!isRoot) {
        console.log('   [2/3] Finalizing allocated cycle...');
        const finalizeTx = await (this.program.methods as any)
          .finalizeAllocatedCycle()
          .accounts({
            datState,
            tokenStats,
            datAuthority,
          })
          .rpc();

        await this.connection.confirmTransaction(finalizeTx, 'confirmed');
        console.log(`   ✅ Finalized: ${finalizeTx}`);
      } else {
        console.log('   [2/3] Skipping finalize (ROOT token)');
      }

      // STEP 3: Burn and update
      console.log('   [3/3] Burning tokens...');
      const burnTx = await (this.program.methods as any)
        .burnAndUpdate()
        .accounts({
          datState,
          tokenStats,
          datAuthority,
          datAsdfAccount: datTokenAccount,
          asdfMint: mint,
          tokenProgram,
        })
        .rpc();

      await this.connection.confirmTransaction(burnTx, 'confirmed');
      result.burnTx = burnTx;
      result.tokensBurned = result.tokensAcquired;
      console.log(`   ✅ Tokens burned: ${burnTx}`);

      result.success = true;
      console.log(`\n✅ Orchestrated cycle completed for ${token.symbol}`);

    } catch (error: any) {
      result.success = false;
      result.error = error.message;
      console.error(`\n❌ Cycle failed for ${token.symbol}:`, error.message);
      if (error.logs) {
        console.error('Program logs:', error.logs.slice(-10).join('\n'));
      }
    }

    return result;
  }

  /**
   * Run the complete ecosystem test
   */
  async runCompleteTest(): Promise<TestReport> {
    console.log('\n🚀 STARTING COMPLETE ECOSYSTEM TEST');
    console.log('═══════════════════════════════════════════════════════\n');

    const report: TestReport = {
      testDate: new Date().toISOString(),
      initialStates: {},
      cycleResults: {},
      finalStates: {},
      summary: {
        totalSolProcessed: 0,
        totalTokensBurned: 0,
        totalFeesToRoot: 0,
        allCyclesSuccessful: true,
      },
    };

    // PHASE 1: Capture initial states
    console.log('\n═══ PHASE 1: INITIAL STATE CAPTURE ═══');
    for (const tokenKey of ['DATSPL', 'DATS2', 'DATM']) {
      report.initialStates[tokenKey] = await this.captureTokenState(tokenKey);
    }

    // PHASE 2: ORCHESTRATED COLLECTION (single collect for all tokens)
    console.log('\n\n═══ PHASE 2: ORCHESTRATED COLLECTION ═══');

    let collectResult: { totalCollected: number; signature: string };
    try {
      collectResult = await this.collectAllVaultFees();
    } catch (error: any) {
      console.error('❌ Failed to collect vault fees:', error.message);
      // Mark all as failed
      for (const tokenKey of ['DATSPL', 'DATS2', 'DATM']) {
        report.cycleResults[tokenKey] = {
          token: tokenKey,
          success: false,
          error: `Collection failed: ${error.message}`,
        };
      }
      this.generateSummary(report);
      return report;
    }

    // PHASE 3: Calculate allocations for SECONDARY tokens
    // CRITICAL: The smart contract's split_fees_to_root ACTUALLY transfers SOL
    // So after each secondary cycle, the datAuthority balance decreases
    // We must query the REAL balance before each cycle, not use pre-calculated allocations
    console.log('\n\n═══ PHASE 3: ALLOCATION STRATEGY ═══');

    const [datAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('auth_v3')],
      PROGRAM_ID
    );

    const totalAvailable = await this.connection.getBalance(datAuthority);
    console.log(`   Total in datAuthority: ${(totalAvailable / 1e9).toFixed(6)} SOL`);

    // For 2 secondary tokens + 1 root:
    // Each secondary needs MIN 0.0055 SOL
    // After secondary split (44.8% to root), ~55.2% goes to buyback
    // We need at least 0.011 SOL for 2 secondaries + buffer for root
    const MIN_FEES_PER_SECONDARY = 5_500_000;
    const numSecondaries = 2;
    const minRequired = MIN_FEES_PER_SECONDARY * numSecondaries + 500_000; // + root reserve

    if (totalAvailable < minRequired) {
      console.log(`   ⚠️ WARNING: Only ${(totalAvailable / 1e9).toFixed(6)} SOL available`);
      console.log(`   Need at least ${(minRequired / 1e9).toFixed(6)} SOL for all cycles`);
    }

    // Strategy: Use half the available balance for first secondary
    // This leaves enough for second secondary after the split to root
    const firstSecondaryAllocation = Math.floor(totalAvailable / 2);
    console.log(`   DATS2 allocation: ${(firstSecondaryAllocation / 1e9).toFixed(6)} SOL`);
    console.log(`   DATM will use remaining balance after DATS2 cycle`);

    // PHASE 4: Execute SECONDARY cycles FIRST
    console.log('\n\n═══ PHASE 4: SECONDARY TOKEN CYCLES ═══');

    // Execute DATS2 with half the balance
    console.log('\n--- Executing DATS2 (Secondary Token) ---');
    report.cycleResults['DATS2'] = await this.executeCycleWithAllocation('DATS2', firstSecondaryAllocation);
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get remaining balance for DATM
    const remainingForDatm = await this.connection.getBalance(datAuthority);
    console.log(`\n   Balance remaining for DATM: ${(remainingForDatm / 1e9).toFixed(6)} SOL`);

    // Execute DATM with remaining balance (pass null to use full remaining)
    console.log('\n--- Executing DATM (Mayhem Token) ---');
    // For DATM, we need to check if there's enough, otherwise skip
    if (remainingForDatm >= MIN_FEES_PER_SECONDARY) {
      report.cycleResults['DATM'] = await this.executeCycleWithAllocation('DATM', remainingForDatm - 500_000);
    } else {
      console.log(`   ⚠️ Insufficient balance for DATM (${(remainingForDatm / 1e9).toFixed(6)} < 0.0055 SOL)`);
      report.cycleResults['DATM'] = {
        token: 'DATM',
        success: false,
        error: `Insufficient balance: ${remainingForDatm} lamports < ${MIN_FEES_PER_SECONDARY} required`,
      };
    }
    await new Promise(resolve => setTimeout(resolve, 2000));

    // PHASE 5: Execute ROOT cycle LAST (uses remaining balance)
    console.log('\n\n═══ PHASE 5: ROOT TOKEN CYCLE ═══');
    console.log('\n--- Executing DATSPL (Root Token) - LAST ---');
    // Root uses remaining balance (null allocation)
    report.cycleResults['DATSPL'] = await this.executeCycleWithAllocation('DATSPL', null);
    await new Promise(resolve => setTimeout(resolve, 2000));

    // PHASE 6: Capture final states
    console.log('\n\n═══ PHASE 6: FINAL STATE CAPTURE ═══');
    for (const tokenKey of ['DATSPL', 'DATS2', 'DATM']) {
      report.finalStates[tokenKey] = await this.captureTokenState(tokenKey);
    }

    // PHASE 7: Generate summary
    console.log('\n\n═══ PHASE 7: GENERATING SUMMARY ═══');
    this.generateSummary(report);

    return report;
  }

  /**
   * Generate and display summary
   */
  private generateSummary(report: TestReport) {
    let totalSol = 0;
    let totalBurned = 0;
    let allSuccess = true;

    for (const tokenKey of ['DATSPL', 'DATS2', 'DATM']) {
      const initial = report.initialStates[tokenKey];
      const final = report.finalStates[tokenKey];
      const result = report.cycleResults[tokenKey];

      if (!result.success) {
        allSuccess = false;
      }

      const solDelta = final.totalSolCollected - initial.totalSolCollected;
      const burnedDelta = final.totalTokensBurned - initial.totalTokensBurned;

      totalSol += solDelta;
      totalBurned += burnedDelta;
    }

    report.summary.totalSolProcessed = totalSol;
    report.summary.totalTokensBurned = totalBurned;
    report.summary.allCyclesSuccessful = allSuccess;

    // Calculate root fees
    const dats2Final = report.finalStates['DATS2'];
    if (dats2Final.totalSolSentToRoot) {
      report.summary.totalFeesToRoot = dats2Final.totalSolSentToRoot;
    }

    console.log('\n📊 TEST SUMMARY');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`Test Date: ${report.testDate}`);
    console.log(`All Cycles Successful: ${allSuccess ? '✅ YES' : '❌ NO'}`);
    console.log(`Total SOL Processed: ${totalSol.toFixed(6)} SOL`);
    console.log(`Total Tokens Burned: ${totalBurned.toLocaleString()}`);
    console.log(`Total Fees to Root: ${report.summary.totalFeesToRoot.toFixed(6)} SOL`);
    console.log('═══════════════════════════════════════════════════════\n');
  }

  /**
   * Save report to file
   */
  saveReport(report: TestReport) {
    const filename = `ecosystem-test-report-${Date.now()}.json`;
    fs.writeFileSync(filename, JSON.stringify(report, null, 2));
    console.log(`\n💾 Full report saved: ${filename}`);

    // Also save a human-readable version
    const readableFilename = `ecosystem-test-report-${Date.now()}.md`;
    const markdown = this.generateMarkdownReport(report);
    fs.writeFileSync(readableFilename, markdown);
    console.log(`📄 Readable report saved: ${readableFilename}`);
  }

  /**
   * Generate markdown report
   */
  private generateMarkdownReport(report: TestReport): string {
    let md = `# 🧪 COMPLETE ECOSYSTEM TEST REPORT\n\n`;
    md += `**Date:** ${report.testDate}\n`;
    md += `**Status:** ${report.summary.allCyclesSuccessful ? '✅ SUCCESS' : '❌ FAILED'}\n\n`;
    md += `---\n\n`;

    md += `## 📊 Summary\n\n`;
    md += `- **Total SOL Processed:** ${report.summary.totalSolProcessed.toFixed(6)} SOL\n`;
    md += `- **Total Tokens Burned:** ${report.summary.totalTokensBurned.toLocaleString()}\n`;
    md += `- **Total Fees to Root:** ${report.summary.totalFeesToRoot.toFixed(6)} SOL\n`;
    md += `- **All Cycles Successful:** ${report.summary.allCyclesSuccessful ? 'Yes ✅' : 'No ❌'}\n\n`;

    for (const tokenKey of ['DATSPL', 'DATS2', 'DATM']) {
      const initial = report.initialStates[tokenKey];
      const final = report.finalStates[tokenKey];
      const result = report.cycleResults[tokenKey];

      md += `---\n\n## ${tokenKey} (${initial.token})\n\n`;
      md += `### Cycle Result: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}\n\n`;

      if (result.success) {
        md += `**Transactions:**\n`;
        md += `- Collect: \`${result.collectTx}\`\n`;
        md += `- Buy: \`${result.buyTx}\`\n`;
        md += `- Burn: \`${result.burnTx}\`\n\n`;

        md += `**Metrics:**\n`;
        md += `- SOL Collected: ${result.solCollected?.toFixed(6)} SOL\n`;
        md += `- Tokens Acquired: ${result.tokensAcquired?.toLocaleString()}\n`;
        md += `- Tokens Burned: ${result.tokensBurned?.toLocaleString()}\n\n`;
      } else {
        md += `**Error:** ${result.error}\n\n`;
      }

      md += `### State Comparison\n\n`;
      md += `| Metric | Initial | Final | Delta |\n`;
      md += `|--------|---------|-------|-------|\n`;
      md += `| Creator Vault | ${initial.creatorVaultBalance.toFixed(6)} SOL | ${final.creatorVaultBalance.toFixed(6)} SOL | ${(final.creatorVaultBalance - initial.creatorVaultBalance).toFixed(6)} SOL |\n`;
      md += `| Root Treasury | ${initial.rootTreasuryBalance.toFixed(6)} SOL | ${final.rootTreasuryBalance.toFixed(6)} SOL | ${(final.rootTreasuryBalance - initial.rootTreasuryBalance).toFixed(6)} SOL |\n`;
      md += `| Total SOL Collected | ${initial.totalSolCollected.toFixed(6)} SOL | ${final.totalSolCollected.toFixed(6)} SOL | ${(final.totalSolCollected - initial.totalSolCollected).toFixed(6)} SOL |\n`;
      md += `| Total Tokens Burned | ${initial.totalTokensBurned.toLocaleString()} | ${final.totalTokensBurned.toLocaleString()} | ${(final.totalTokensBurned - initial.totalTokensBurned).toLocaleString()} |\n\n`;

      if (final.totalSolSentToRoot !== undefined) {
        md += `- **Total SOL Sent to Root:** ${initial.totalSolSentToRoot?.toFixed(6) || 0} SOL → ${final.totalSolSentToRoot.toFixed(6)} SOL (Δ ${(final.totalSolSentToRoot - (initial.totalSolSentToRoot || 0)).toFixed(6)} SOL)\n`;
      }
      if (final.totalSolReceivedFromOthers !== undefined) {
        md += `- **Total SOL Received from Others:** ${initial.totalSolReceivedFromOthers?.toFixed(6) || 0} SOL → ${final.totalSolReceivedFromOthers.toFixed(6)} SOL (Δ ${(final.totalSolReceivedFromOthers - (initial.totalSolReceivedFromOthers || 0)).toFixed(6)} SOL)\n`;
      }

      md += `\n`;
    }

    md += `---\n\n`;
    md += `*Generated by complete-ecosystem-test.ts on devnet*\n`;

    return md;
  }
}

// Main execution
async function main() {
  const tester = new EcosystemTester();

  try {
    const report = await tester.runCompleteTest();
    tester.saveReport(report);

    console.log('\n✅ COMPLETE ECOSYSTEM TEST FINISHED');
    console.log('Check the generated reports for full details.\n');

    if (!report.summary.allCyclesSuccessful) {
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
    process.exit(1);
  }
}

main().catch(console.error);
