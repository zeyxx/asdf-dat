/**
 * ASDF DAT Bot - Automated buyback and burn system
 * This bot manages the automated execution of claim, buyback, and burn cycles
 */

import * as anchor from '@project-serum/anchor';
import { Program, AnchorProvider, web3, BN } from '@project-serum/anchor';
import { PublicKey, Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { CONFIG } from './config';
import { formatSOL, formatTokens, getCurrentTimestamp, sleep } from './utils';
import { AsdfDat } from '../target/types/asdf_dat';

dotenv.config();

/**
 * Main bot class for managing DAT operations
 */
export class AsdfDATBot {
    private connection: Connection;
    private provider: AnchorProvider;
    private program: Program<AsdfDat>;
    private wallet: Keypair;
    private datStatePDA: PublicKey;
    private datStateBump: number;

    constructor() {
        // Initialize connection and wallet
        const rpcUrl = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
        this.connection = new Connection(rpcUrl, 'confirmed');
        
        // Load wallet from file
        const walletPath = process.env.WALLET_PATH || './wallet.json';
        const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
        this.wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
        
        // Setup Anchor provider
        this.provider = new AnchorProvider(
            this.connection,
            new anchor.Wallet(this.wallet),
            { commitment: 'confirmed' }
        );
        
        // Load program
        const programId = new PublicKey(process.env.PROGRAM_ID || CONFIG.PROGRAM_ID);
        const idl = JSON.parse(fs.readFileSync('./target/idl/asdf_dat.json', 'utf-8'));
        this.program = new Program<AsdfDat>(idl, programId, this.provider);
        
        // Derive PDA for DAT state
        [this.datStatePDA, this.datStateBump] = PublicKey.findProgramAddressSync(
            [Buffer.from('dat-state')],
            this.program.programId
        );
        
        console.log('DAT Bot initialized');
        console.log('Wallet:', this.wallet.publicKey.toString());
        console.log('Program ID:', this.program.programId.toString());
        console.log('DAT State PDA:', this.datStatePDA.toString());
    }

    /**
     * Initialize the DAT state (one-time setup)
     */
    async initialize(): Promise<void> {
        try {
            console.log('Initializing DAT state...');
            
            const tx = await this.program.methods
                .initialize()
                .accounts({
                    datState: this.datStatePDA,
                    authority: this.wallet.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([this.wallet])
                .rpc();
            
            console.log('DAT initialized successfully');
            console.log('Transaction:', tx);
            
            // Verify initialization
            const state = await this.getState();
            console.log('Initial state:', {
                authority: state.authority.toString(),
                ctoWallet: state.ctoWallet.toString(),
                isActive: state.isActive,
            });
        } catch (error) {
            console.error('Failed to initialize DAT:', error);
            throw error;
        }
    }

    /**
     * Check available fees in the creator vault
     */
    async checkAvailableFees(): Promise<number> {
        try {
            // Get creator vault address (this would be derived from PumpSwap)
            const creatorVault = await this.getCreatorVaultAddress();
            
            // Check balance
            const balance = await this.connection.getBalance(creatorVault);
            const solBalance = balance / LAMPORTS_PER_SOL;
            
            console.log(`Available fees in creator vault: ${formatSOL(solBalance)} SOL`);
            
            // Check if meets minimum threshold
            if (solBalance >= CONFIG.MIN_FEES_TO_CLAIM) {
                console.log('✅ Sufficient fees available for cycle execution');
            } else {
                console.log(`⏳ Waiting for fees to reach minimum (${CONFIG.MIN_FEES_TO_CLAIM} SOL)`);
            }
            
            return solBalance;
        } catch (error) {
            console.error('Failed to check fees:', error);
            return 0;
        }
    }

    /**
     * Execute a complete cycle: Claim → Buyback → Burn
     */
    async executeCycle(): Promise<void> {
        try {
            console.log('\n' + '='.repeat(50));
            console.log('EXECUTING DAT CYCLE');
            console.log('='.repeat(50));
            console.log('Timestamp:', getCurrentTimestamp());
            
            // Check if DAT is active
            const state = await this.getState();
            if (!state.isActive) {
                console.log('❌ DAT is paused. Skipping cycle.');
                return;
            }
            
            // Check available fees
            const availableFees = await this.checkAvailableFees();
            if (availableFees < CONFIG.MIN_FEES_TO_CLAIM) {
                console.log('❌ Insufficient fees. Skipping cycle.');
                return;
            }
            
            // Get required accounts
            const creatorVault = await this.getCreatorVaultAddress();
            const datWallet = this.wallet.publicKey;
            const datTokenAccount = await getAssociatedTokenAddress(
                new PublicKey(CONFIG.ASDF_MINT),
                datWallet
            );
            
            console.log('\nExecuting atomic transaction...');
            console.log('Step 1: Claiming fees from creator vault');
            console.log('Step 2: Buying back ASDF tokens');
            console.log('Step 3: Burning all tokens');
            
            // Execute the cycle
            const tx = await this.program.methods
                .executeCycle()
                .accounts({
                    datState: this.datStatePDA,
                    creatorVault: creatorVault,
                    datWallet: datWallet,
                    datTokenAccount: datTokenAccount,
                    poolAccount: new PublicKey(CONFIG.POOL_PUMPSWAP),
                    asdfMint: new PublicKey(CONFIG.ASDF_MINT),
                    pumpSwapProgram: new PublicKey(CONFIG.PUMP_SWAP_PROGRAM),
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([this.wallet])
                .rpc();
            
            console.log('\n✅ Cycle executed successfully!');
            console.log('Transaction:', tx);
            
            // Display updated statistics
            await this.displayStats();
            
        } catch (error) {
            console.error('❌ Failed to execute cycle:', error);
            
            // Log error details for debugging
            if (error instanceof Error) {
                console.error('Error details:', error.message);
                if ('logs' in error) {
                    console.error('Program logs:', (error as any).logs);
                }
            }
        }
    }

    /**
     * Display current DAT statistics
     */
    async displayStats(): Promise<void> {
        try {
            const state = await this.getState();
            
            console.log('\n' + '='.repeat(50));
            console.log('DAT STATISTICS');
            console.log('='.repeat(50));
            console.log(`Status: ${state.isActive ? '🟢 ACTIVE' : '🔴 PAUSED'}`);
            console.log(`Total Burned: ${formatTokens(state.totalBurned)} ASDF`);
            console.log(`Total Buybacks: ${state.totalBuybacks}`);
            console.log(`Last Cycle: ${new Date(state.lastCycleTimestamp * 1000).toLocaleString()}`);
            console.log(`Authority: ${state.authority.toString()}`);
            
            // Calculate impact metrics
            const dailyBurnRate = state.totalBuybacks > 0 
                ? (state.totalBurned / state.totalBuybacks) * 4 // 4 cycles per day
                : 0;
            
            console.log('\nProjected Impact:');
            console.log(`Daily Burn Rate: ${formatTokens(dailyBurnRate)} ASDF/day`);
            console.log(`Monthly Supply Reduction: ~${(dailyBurnRate * 30 / CONFIG.TOTAL_SUPPLY * 100).toFixed(2)}%`);
            
        } catch (error) {
            console.error('Failed to display stats:', error);
        }
    }

    /**
     * Pause DAT operations (emergency control)
     */
    async pause(): Promise<void> {
        try {
            console.log('Pausing DAT operations...');
            
            const tx = await this.program.methods
                .pause()
                .accounts({
                    datState: this.datStatePDA,
                    authority: this.wallet.publicKey,
                })
                .signers([this.wallet])
                .rpc();
            
            console.log('✅ DAT paused successfully');
            console.log('Transaction:', tx);
        } catch (error) {
            console.error('Failed to pause DAT:', error);
            throw error;
        }
    }

    /**
     * Resume DAT operations
     */
    async resume(): Promise<void> {
        try {
            console.log('Resuming DAT operations...');
            
            const tx = await this.program.methods
                .resume()
                .accounts({
                    datState: this.datStatePDA,
                    authority: this.wallet.publicKey,
                })
                .signers([this.wallet])
                .rpc();
            
            console.log('✅ DAT resumed successfully');
            console.log('Transaction:', tx);
        } catch (error) {
            console.error('Failed to resume DAT:', error);
            throw error;
        }
    }

    /**
     * Run the bot in automated mode
     */
    async runBot(): Promise<void> {
        console.log('\n' + '='.repeat(50));
        console.log('ASDF DAT BOT - AUTOMATED MODE');
        console.log('='.repeat(50));
        console.log('Configuration:');
        console.log(`- Check Interval: ${CONFIG.CHECK_INTERVAL / 3600000} hours`);
        console.log(`- Minimum Fees: ${CONFIG.MIN_FEES_TO_CLAIM} SOL`);
        console.log(`- Cycle Times: ${CONFIG.CYCLE_HOURS.join(':00, ')}:00 UTC`);
        console.log('\nBot started. Press Ctrl+C to stop.\n');

        // Initial check
        await this.executeCycle();

        // Set up interval for automated execution
        setInterval(async () => {
            const currentHour = new Date().getUTCHours();
            
            // Check if it's time for a cycle
            if (CONFIG.CYCLE_HOURS.includes(currentHour)) {
                console.log(`\n⏰ Scheduled cycle time: ${currentHour}:00 UTC`);
                await this.executeCycle();
            }
        }, CONFIG.CHECK_INTERVAL);

        // Keep the process running
        process.on('SIGINT', () => {
            console.log('\n\nBot stopped by user');
            process.exit(0);
        });
    }

    /**
     * Get the current DAT state
     */
    private async getState(): Promise<any> {
        return await this.program.account.datState.fetch(this.datStatePDA);
    }

    /**
     * Get the creator vault address from PumpSwap
     * Note: This is a simplified version - actual implementation would derive from PumpSwap
     */
    private async getCreatorVaultAddress(): Promise<PublicKey> {
        // In production, this would derive the actual creator vault PDA from PumpSwap
        // For now, returning a placeholder that would be replaced with actual logic
        return new PublicKey(CONFIG.CTO_WALLET);
    }
}

/**
 * CLI command handlers
 */
async function main() {
    const bot = new AsdfDATBot();
    const command = process.argv[2];

    try {
        switch (command) {
            case 'init':
                await bot.initialize();
                break;
            
            case 'check':
                await bot.checkAvailableFees();
                break;
            
            case 'cycle':
                await bot.executeCycle();
                break;
            
            case 'stats':
                await bot.displayStats();
                break;
            
            case 'pause':
                await bot.pause();
                break;
            
            case 'resume':
                await bot.resume();
                break;
            
            case 'bot':
                await bot.runBot();
                break;
            
            default:
                console.log('Usage: npm run dat:[command]');
                console.log('Commands: init, check, cycle, stats, pause, resume, bot');
                process.exit(1);
        }
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

export default AsdfDATBot;
