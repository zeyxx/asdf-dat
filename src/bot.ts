/**
 * ASDF DAT Bot - Production Ready with Random 2x Daily Execution
 * Handles automatic buyback and burn with robust error handling
 */

import * as anchor from '@coral-xyz/anchor';
import { Program, AnchorProvider, web3, BN, Idl } from '@coral-xyz/anchor';
import { 
    PublicKey, 
    Connection, 
    Keypair, 
    LAMPORTS_PER_SOL, 
    SystemProgram,
    Transaction,
    TransactionSignature,
    Commitment,
    VersionedTransaction,
    ComputeBudgetProgram
} from '@solana/web3.js';
import { 
    TOKEN_PROGRAM_ID, 
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress
} from '@solana/spl-token';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import * as cron from 'node-cron';
import axios from 'axios';

dotenv.config();

// ===========================
// CONFIGURATION
// ===========================

const CONFIG = {
    // Fixed addresses
    ASDF_MINT: '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump',
    WSOL_MINT: 'So11111111111111111111111111111111111111112',
    POOL_PUMPSWAP: 'DuhRX5JTPtsWU5n44t8tcFEfmzy2Eu27p4y6z8Rhf2bb',
    PUMP_SWAP_PROGRAM: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
    
    // Operating parameters
    MIN_FEES_TO_CLAIM: 0.19, // SOL
    MAX_FEES_PER_CYCLE: 10, // SOL
    MIN_CYCLE_INTERVAL: 3600, // 1 hour in seconds
    
    // Slippage settings
    INITIAL_SLIPPAGE_BPS: 100, // 1%
    MAX_SLIPPAGE_BPS: 300, // 3%
    
    // Retry settings
    MAX_RETRIES: 3,
    RETRY_DELAY: 2000, // ms
    
    // RPC endpoints (public fallbacks)
    RPC_ENDPOINTS: [
        process.env.RPC_URL || 'https://api.mainnet-beta.solana.com',
        'https://solana-mainnet.g.alchemy.com/v2/demo',
        'https://rpc.ankr.com/solana',
        'https://solana-api.projectserum.com'
    ],
    
    // Alert webhook
    WEBHOOK_URL: process.env.WEBHOOK_URL || '',
};

// ===========================
// RANDOM SCHEDULER
// ===========================

class RandomScheduler {
    private amExecuted: boolean = false;
    private pmExecuted: boolean = false;
    private lastResetDate: string;
    private scheduledAM: { hour: number; minute: number } | null = null;
    private scheduledPM: { hour: number; minute: number } | null = null;
    
    constructor() {
        this.lastResetDate = this.getCurrentDate();
        this.scheduleDaily();
    }
    
    /**
     * Schedule random times for AM and PM execution
     */
    scheduleDaily(): void {
        // Reset if new day
        const currentDate = this.getCurrentDate();
        if (currentDate !== this.lastResetDate) {
            this.amExecuted = false;
            this.pmExecuted = false;
            this.lastResetDate = currentDate;
        }
        
        // Generate random times if not already scheduled
        if (!this.amExecuted && !this.scheduledAM) {
            this.scheduledAM = this.getRandomTime(0, 12);
            console.log(`AM scheduled for ${this.scheduledAM.hour}:${this.scheduledAM.minute.toString().padStart(2, '0')} UTC`);
        }
        
        if (!this.pmExecuted && !this.scheduledPM) {
            this.scheduledPM = this.getRandomTime(12, 24);
            console.log(`PM scheduled for ${this.scheduledPM.hour}:${this.scheduledPM.minute.toString().padStart(2, '0')} UTC`);
        }
    }
    
    /**
     * Check if it's time to execute
     */
    shouldExecute(): { execute: boolean; period: 'AM' | 'PM' | null } {
        const now = new Date();
        const currentHour = now.getUTCHours();
        const currentMinute = now.getUTCMinutes();
        
        // Check AM
        if (!this.amExecuted && this.scheduledAM) {
            if (currentHour === this.scheduledAM.hour && 
                currentMinute >= this.scheduledAM.minute) {
                this.amExecuted = true;
                this.scheduledAM = null;
                return { execute: true, period: 'AM' };
            }
        }
        
        // Check PM
        if (!this.pmExecuted && this.scheduledPM) {
            if (currentHour === this.scheduledPM.hour && 
                currentMinute >= this.scheduledPM.minute) {
                this.pmExecuted = true;
                this.scheduledPM = null;
                return { execute: true, period: 'PM' };
            }
        }
        
        return { execute: false, period: null };
    }
    
    /**
     * Generate random time within hour range
     */
    private getRandomTime(startHour: number, endHour: number): { hour: number; minute: number } {
        const hour = Math.floor(Math.random() * (endHour - startHour)) + startHour;
        const minute = Math.floor(Math.random() * 60);
        return { hour, minute };
    }
    
    /**
     * Get current date string
     */
    private getCurrentDate(): string {
        return new Date().toISOString().split('T')[0];
    }
    
    /**
     * Get next scheduled execution info
     */
    getNextExecution(): string {
        if (this.scheduledAM) {
            return `AM at ${this.scheduledAM.hour}:${this.scheduledAM.minute.toString().padStart(2, '0')} UTC`;
        }
        if (this.scheduledPM) {
            return `PM at ${this.scheduledPM.hour}:${this.scheduledPM.minute.toString().padStart(2, '0')} UTC`;
        }
        return 'Tomorrow';
    }
}

// ===========================
// FAILURE HANDLER
// ===========================

class FailureHandler {
    private consecutiveFailures: number = 0;
    private lastFailureTime: number = 0;
    
    async handleFailure(error: any, context: any): Promise<boolean> {
        this.consecutiveFailures++;
        this.lastFailureTime = Date.now();
        
        console.error(`[FAILURE ${this.consecutiveFailures}]`, error);
        
        // Determine error type and strategy
        if (error.message?.includes('insufficient')) {
            console.log('Insufficient fees/liquidity - will retry next schedule');
            return false; // Don't retry
        }
        
        if (error.message?.includes('slippage')) {
            console.log('Slippage exceeded - increasing tolerance');
            context.slippageBps = Math.min(context.slippageBps + 50, CONFIG.MAX_SLIPPAGE_BPS);
            return true; // Retry with higher slippage
        }
        
        if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            console.log('RPC error - switching endpoint');
            context.rotateRPC();
            return true; // Retry with new RPC
        }
        
        if (error.message?.includes('blockhash')) {
            console.log('Blockhash expired - refreshing transaction');
            return true; // Retry with new blockhash
        }
        
        // Alert if too many consecutive failures
        if (this.consecutiveFailures >= 3) {
            await this.sendCriticalAlert(error);
        }
        
        return this.consecutiveFailures < CONFIG.MAX_RETRIES;
    }
    
    reset(): void {
        this.consecutiveFailures = 0;
    }
    
    private async sendCriticalAlert(error: any): Promise<void> {
        if (!CONFIG.WEBHOOK_URL) return;
        
        try {
            await axios.post(CONFIG.WEBHOOK_URL, {
                content: `🚨 **CRITICAL ALERT** - DAT Bot Failure\n` +
                        `Consecutive failures: ${this.consecutiveFailures}\n` +
                        `Error: ${error.message || error}\n` +
                        `Time: ${new Date().toISOString()}`
            });
        } catch (e) {
            console.error('Failed to send alert:', e);
        }
    }
}

// ===========================
// MAIN DAT BOT
// ===========================

export class AsdfDATBot {
    private connection: Connection;
    private provider: AnchorProvider;
    private program: Program;
    private wallet: Keypair;
    private scheduler: RandomScheduler;
    private failureHandler: FailureHandler;
    private currentRPCIndex: number = 0;
    private isRunning: boolean = false;
    private metrics: any = {
        cyclesCompleted: 0,
        totalTokensBurned: 0,
        totalSolUsed: 0,
        lastExecution: null,
        uptime: Date.now()
    };
    
    // PDAs
    private datStatePDA: PublicKey;
    private datAuthorityPDA: PublicKey;
    private creatorVaultAuthorityPDA: PublicKey;
    
    constructor() {
        console.log('🚀 Initializing ASDF DAT Bot...');
        
        // Load wallet
        const walletPath = process.env.WALLET_PATH || './wallet.json';
        if (!fs.existsSync(walletPath)) {
            throw new Error(`Wallet not found at ${walletPath}`);
        }
        const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
        this.wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
        
        // Setup connection
        this.setupConnection();
        
        // Setup provider
        this.provider = new AnchorProvider(
            this.connection,
            new anchor.Wallet(this.wallet),
            { commitment: 'confirmed' }
        );
        anchor.setProvider(this.provider);
        
        // Load program
        this.loadProgram();
        
        // Derive PDAs
        this.derivePDAs();
        
        // Initialize scheduler and failure handler
        this.scheduler = new RandomScheduler();
        this.failureHandler = new FailureHandler();
        
        console.log('✅ Bot initialized');
        console.log(`Wallet: ${this.wallet.publicKey.toString()}`);
        console.log(`Program: ${this.program.programId.toString()}`);
    }
    
    /**
     * Setup connection with fallback
     */
    private setupConnection(): void {
        this.connection = new Connection(
            CONFIG.RPC_ENDPOINTS[this.currentRPCIndex],
            {
                commitment: 'confirmed',
                confirmTransactionInitialTimeout: 60000
            }
        );
    }
    
    /**
     * Rotate to next RPC endpoint
     */
    private rotateRPC(): void {
        this.currentRPCIndex = (this.currentRPCIndex + 1) % CONFIG.RPC_ENDPOINTS.length;
        console.log(`Rotating to RPC: ${CONFIG.RPC_ENDPOINTS[this.currentRPCIndex]}`);
        this.setupConnection();
        
        // Update provider with new connection
        this.provider = new AnchorProvider(
            this.connection,
            new anchor.Wallet(this.wallet),
            { commitment: 'confirmed' }
        );
        anchor.setProvider(this.provider);
    }
    
    /**
     * Load program IDL and create program instance
     */
    private loadProgram(): void {
        const programId = new PublicKey(
            process.env.PROGRAM_ID || 'DATxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
        );
        
        // Load IDL
        const idlPath = './target/idl/asdf_dat.json';
        if (!fs.existsSync(idlPath)) {
            throw new Error('IDL not found. Run anchor build first.');
        }
        const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
        
        this.program = new Program(idl, programId, this.provider);
    }
    
    /**
     * Derive PDAs
     */
    private derivePDAs(): void {
        // DAT State PDA
        [this.datStatePDA] = PublicKey.findProgramAddressSync(
            [Buffer.from('dat-state')],
            this.program.programId
        );
        
        // DAT Authority PDA
        [this.datAuthorityPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from('dat-authority')],
            this.program.programId
        );
        
        // Creator Vault Authority PDA
        [this.creatorVaultAuthorityPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from('creator_vault'), this.datAuthorityPDA.toBuffer()],
            this.program.programId
        );
        
        console.log('PDAs derived:');
        console.log(`- State: ${this.datStatePDA}`);
        console.log(`- Authority: ${this.datAuthorityPDA}`);
        console.log(`- Vault: ${this.creatorVaultAuthorityPDA}`);
    }
    
    /**
     * Initialize DAT (one-time setup)
     */
    async initialize(): Promise<void> {
        try {
            console.log('Initializing DAT on-chain...');
            
            const tx = await this.program.methods
                .initialize()
                .accounts({
                    datState: this.datStatePDA,
                    datAuthority: this.datAuthorityPDA,
                    creatorVaultAuthority: this.creatorVaultAuthorityPDA,
                    admin: this.wallet.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();
            
            console.log(`✅ Initialized: ${tx}`);
            
        } catch (error) {
            console.error('Initialization failed:', error);
            throw error;
        }
    }
    
    /**
     * Execute buyback cycle
     */
    async executeBuyback(period: 'AM' | 'PM'): Promise<void> {
        console.log('═══════════════════════════════════════════');
        console.log(`EXECUTING ${period} BUYBACK CYCLE`);
        console.log(`Time: ${new Date().toISOString()}`);
        console.log('═══════════════════════════════════════════');
        
        let slippageBps = CONFIG.INITIAL_SLIPPAGE_BPS;
        let retryCount = 0;
        
        while (retryCount <= CONFIG.MAX_RETRIES) {
            try {
                // Get required accounts
                const accounts = await this.prepareAccounts();
                
                // Check balance
                const vaultBalance = await this.checkVaultBalance(accounts.creatorVaultAta);
                console.log(`Vault balance: ${vaultBalance} SOL`);
                
                if (vaultBalance < CONFIG.MIN_FEES_TO_CLAIM) {
                    console.log(`Insufficient fees (${vaultBalance} < ${CONFIG.MIN_FEES_TO_CLAIM})`);
                    return;
                }
                
                // Add priority fee for better inclusion
                const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
                    units: 400_000
                });
                const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
                    microLamports: 50_000 // Priority fee
                });
                
                // Build transaction
                const tx = await this.program.methods
                    .executeBuyback()
                    .accounts(accounts)
                    .preInstructions([modifyComputeUnits, addPriorityFee])
                    .transaction();
                
                // Send and confirm
                const signature = await this.provider.sendAndConfirm(tx, [], {
                    skipPreflight: false,
                    maxRetries: 3
                });
                
                console.log(`✅ Buyback successful: ${signature}`);
                
                // Update metrics
                this.metrics.cyclesCompleted++;
                this.metrics.lastExecution = new Date();
                
                // Reset failure handler on success
                this.failureHandler.reset();
                
                // Send success notification
                await this.sendNotification({
                    type: 'success',
                    period,
                    signature,
                    amount: vaultBalance
                });
                
                return;
                
            } catch (error: any) {
                console.error(`Attempt ${retryCount + 1} failed:`, error);
                
                // Handle failure
                const shouldRetry = await this.failureHandler.handleFailure(error, {
                    slippageBps,
                    rotateRPC: () => this.rotateRPC()
                });
                
                if (!shouldRetry) {
                    console.log('Not retrying');
                    break;
                }
                
                retryCount++;
                
                if (retryCount <= CONFIG.MAX_RETRIES) {
                    const delay = CONFIG.RETRY_DELAY * Math.pow(2, retryCount - 1);
                    console.log(`Retrying in ${delay}ms...`);
                    await this.sleep(delay);
                }
            }
        }
        
        // Record failure on-chain if possible
        try {
            await this.program.methods
                .recordFailure(retryCount)
                .accounts({
                    datState: this.datStatePDA
                })
                .rpc();
        } catch (e) {
            console.error('Failed to record failure on-chain:', e);
        }
    }
    
    /**
     * Prepare accounts for buyback
     */
    private async prepareAccounts(): Promise<any> {
        const asdfMint = new PublicKey(CONFIG.ASDF_MINT);
        const wsolMint = new PublicKey(CONFIG.WSOL_MINT);
        const pool = new PublicKey(CONFIG.POOL_PUMPSWAP);
        const pumpProgram = new PublicKey(CONFIG.PUMP_SWAP_PROGRAM);
        
        // Get associated token accounts
        const creatorVaultAta = await getAssociatedTokenAddress(
            wsolMint,
            this.creatorVaultAuthorityPDA,
            true
        );
        
        const datAsdfAccount = await getAssociatedTokenAddress(
            asdfMint,
            this.datAuthorityPDA,
            true
        );
        
        // Get pool token accounts (from PumpSwap)
        const poolAsdfAccount = await getAssociatedTokenAddress(
            asdfMint,
            pool,
            true
        );
        
        const poolWsolAccount = await getAssociatedTokenAddress(
            wsolMint,
            pool,
            true
        );
        
        // Get PumpSwap PDAs
        const [pumpGlobalConfig] = PublicKey.findProgramAddressSync(
            [Buffer.from('global_config')],
            pumpProgram
        );
        
        const [pumpEventAuthority] = PublicKey.findProgramAddressSync(
            [Buffer.from('__event_authority')],
            pumpProgram
        );
        
        // Protocol fee recipient (from global config)
        // This would need to be fetched from chain
        const protocolFeeRecipient = new PublicKey('8LWu7QM2dGR1G8nKDHthckea57bkCzXyBTAKPJUBDHo8');
        
        const protocolFeeRecipientAta = await getAssociatedTokenAddress(
            wsolMint,
            protocolFeeRecipient,
            true
        );
        
        return {
            datState: this.datStatePDA,
            datAuthority: this.datAuthorityPDA,
            creatorVaultAuthority: this.creatorVaultAuthorityPDA,
            creatorVaultAta,
            datAsdfAccount,
            asdfMint,
            wsolMint,
            pool,
            poolAsdfAccount,
            poolWsolAccount,
            pumpGlobalConfig,
            protocolFeeRecipient,
            protocolFeeRecipientAta,
            pumpEventAuthority,
            pumpSwapProgram: pumpProgram,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        };
    }
    
    /**
     * Check vault balance
     */
    private async checkVaultBalance(vaultAta: PublicKey): Promise<number> {
        try {
            const accountInfo = await this.connection.getTokenAccountBalance(vaultAta);
            return parseFloat(accountInfo.value.uiAmount || '0');
        } catch {
            return 0;
        }
    }
    
    /**
     * Send notification
     */
    private async sendNotification(data: any): Promise<void> {
        if (!CONFIG.WEBHOOK_URL) return;
        
        try {
            const message = data.type === 'success' ?
                `✅ **${data.period} Buyback Successful**\n` +
                `Amount: ${data.amount} SOL\n` +
                `TX: ${data.signature}\n` +
                `Time: ${new Date().toISOString()}` :
                `⚠️ **${data.period} Buyback Failed**\n` +
                `Error: ${data.error}\n` +
                `Time: ${new Date().toISOString()}`;
            
            await axios.post(CONFIG.WEBHOOK_URL, { content: message });
        } catch (e) {
            console.error('Failed to send notification:', e);
        }
    }
    
    /**
     * Start the bot
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            console.log('Bot already running');
            return;
        }
        
        this.isRunning = true;
        console.log('🤖 DAT Bot started');
        console.log('Schedule: 2 random executions per day (AM/PM)');
        console.log(`Minimum threshold: ${CONFIG.MIN_FEES_TO_CLAIM} SOL`);
        console.log(`Next execution: ${this.scheduler.getNextExecution()}`);
        
        // Main loop - check every minute
        const interval = setInterval(async () => {
            if (!this.isRunning) {
                clearInterval(interval);
                return;
            }
            
            // Check if it's time to execute
            const { execute, period } = this.scheduler.shouldExecute();
            
            if (execute && period) {
                await this.executeBuyback(period);
                
                // Schedule next day
                this.scheduler.scheduleDaily();
                console.log(`Next execution: ${this.scheduler.getNextExecution()}`);
            }
        }, 60000); // Check every minute
        
        // Handle shutdown
        process.on('SIGINT', () => this.stop());
        process.on('SIGTERM', () => this.stop());
    }
    
    /**
     * Stop the bot
     */
    stop(): void {
        console.log('Stopping bot...');
        this.isRunning = false;
        process.exit(0);
    }
    
    /**
     * Get stats
     */
    async getStats(): Promise<any> {
        try {
            const state = await this.program.account.datState.fetch(this.datStatePDA);
            
            return {
                onChain: {
                    totalBurned: state.totalBurned.toNumber(),
                    totalSolCollected: state.totalSolCollected.toNumber(),
                    totalBuybacks: state.totalBuybacks,
                    failedCycles: state.failedCycles,
                    isActive: state.isActive,
                    lastCycle: new Date(state.lastCycleTimestamp.toNumber() * 1000)
                },
                bot: {
                    uptime: Date.now() - this.metrics.uptime,
                    cyclesCompleted: this.metrics.cyclesCompleted,
                    lastExecution: this.metrics.lastExecution,
                    nextExecution: this.scheduler.getNextExecution()
                }
            };
        } catch (error) {
            console.error('Failed to get stats:', error);
            return null;
        }
    }
    
    /**
     * Helper: sleep
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// ===========================
// CLI INTERFACE
// ===========================

async function main() {
    const command = process.argv[2];
    const bot = new AsdfDATBot();
    
    try {
        switch (command) {
            case 'init':
                await bot.initialize();
                break;
                
            case 'start':
                await bot.start();
                // Keep process alive
                await new Promise(() => {});
                break;
                
            case 'stats':
                const stats = await bot.getStats();
                console.log(JSON.stringify(stats, null, 2));
                break;
                
            case 'test':
                // Force execution for testing
                await bot.executeBuyback('TEST' as any);
                break;
                
            default:
                console.log('Usage: npm run dat:[command]');
                console.log('Commands:');
                console.log('  init  - Initialize DAT on-chain');
                console.log('  start - Start the bot');
                console.log('  stats - Show statistics');
                console.log('  test  - Test execution');
        }
        
        if (command !== 'start') {
            process.exit(0);
        }
        
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

export default AsdfDATBot;