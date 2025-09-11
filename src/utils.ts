/**
 * Utility functions for ASDF DAT
 * Helper functions for formatting, calculations, and common operations
 */

import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { CONFIG } from './config';

/**
 * Format SOL amount for display
 */
export function formatSOL(lamports: number | bigint): string {
    const sol = Number(lamports) / LAMPORTS_PER_SOL;
    return sol.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
    });
}

/**
 * Format token amount for display
 */
export function formatTokens(amount: number | bigint, decimals: number = CONFIG.DECIMALS): string {
    const tokens = Number(amount) / Math.pow(10, decimals);
    return tokens.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    });
}

/**
 * Convert SOL to lamports
 */
export function solToLamports(sol: number): number {
    return Math.floor(sol * LAMPORTS_PER_SOL);
}

/**
 * Convert lamports to SOL
 */
export function lamportsToSol(lamports: number | bigint): number {
    return Number(lamports) / LAMPORTS_PER_SOL;
}

/**
 * Get current timestamp in readable format
 */
export function getCurrentTimestamp(): string {
    return new Date().toISOString();
}

/**
 * Get Unix timestamp in seconds
 */
export function getUnixTimestamp(): number {
    return Math.floor(Date.now() / 1000);
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate percentage
 */
export function calculatePercentage(value: number, total: number): number {
    if (total === 0) return 0;
    return (value / total) * 100;
}

/**
 * Calculate slippage amount
 */
export function calculateSlippage(amount: number, slippageBps: number): number {
    return Math.floor(amount * (10000 - slippageBps) / 10000);
}

/**
 * Format large numbers with abbreviations
 */
export function formatLargeNumber(num: number): string {
    if (num >= 1e9) {
        return (num / 1e9).toFixed(2) + 'B';
    } else if (num >= 1e6) {
        return (num / 1e6).toFixed(2) + 'M';
    } else if (num >= 1e3) {
        return (num / 1e3).toFixed(2) + 'K';
    }
    return num.toString();
}

/**
 * Calculate estimated tokens from SOL amount
 * Based on current price estimates
 */
export function estimateTokensFromSOL(solAmount: number, pricePerToken: number = 0.0003): number {
    const solPrice = 200; // Approximate SOL price in USD
    const usdValue = solAmount * solPrice;
    return Math.floor(usdValue / pricePerToken);
}

/**
 * Calculate burn impact on supply
 */
export function calculateBurnImpact(burnedAmount: number, totalSupply: number = CONFIG.TOTAL_SUPPLY): {
    percentage: number;
    newSupply: number;
} {
    const percentage = calculatePercentage(burnedAmount, totalSupply);
    const newSupply = totalSupply - burnedAmount;
    return { percentage, newSupply };
}

/**
 * Format duration in human-readable format
 */
export function formatDuration(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0) parts.push(`${secs}s`);

    return parts.join(' ') || '0s';
}

/**
 * Check if current time is within cycle hour
 */
export function isWithinCycleHour(cycleHours: number[] = CONFIG.CYCLE_HOURS): boolean {
    const currentHour = new Date().getUTCHours();
    return cycleHours.includes(currentHour);
}

/**
 * Get next cycle time
 */
export function getNextCycleTime(cycleHours: number[] = CONFIG.CYCLE_HOURS): Date {
    const now = new Date();
    const currentHour = now.getUTCHours();
    
    // Find next cycle hour
    let nextHour = cycleHours.find(hour => hour > currentHour);
    
    // If no cycle hour found today, use first hour of tomorrow
    if (nextHour === undefined) {
        nextHour = cycleHours[0];
        now.setUTCDate(now.getUTCDate() + 1);
    }
    
    now.setUTCHours(nextHour, 0, 0, 0);
    return now;
}

/**
 * Calculate gas efficiency
 */
export function calculateGasEfficiency(gasUsed: number, revenueGenerated: number): {
    efficiency: number;
    isOptimal: boolean;
} {
    const efficiency = calculatePercentage(gasUsed, revenueGenerated);
    const isOptimal = efficiency <= CONFIG.MAX_GAS_PERCENTAGE * 100;
    return { efficiency, isOptimal };
}

/**
 * Retry function with exponential backoff
 */
export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    initialDelay: number = 1000
): Promise<T> {
    let lastError: Error | undefined;
    
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error as Error;
            
            if (i < maxRetries - 1) {
                const delay = initialDelay * Math.pow(2, i);
                console.log(`Retry ${i + 1}/${maxRetries} after ${delay}ms...`);
                await sleep(delay);
            }
        }
    }
    
    throw lastError || new Error('Max retries exceeded');
}

/**
 * Validate Solana address
 */
export function isValidSolanaAddress(address: string): boolean {
    try {
        // Basic validation - 32-44 characters, base58
        const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
        return base58Regex.test(address);
    } catch {
        return false;
    }
}

/**
 * Create logger with timestamp
 */
export function log(level: 'info' | 'warn' | 'error' | 'debug', message: string, ...args: any[]): void {
    const timestamp = getCurrentTimestamp();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    
    switch (level) {
        case 'error':
            console.error(prefix, message, ...args);
            break;
        case 'warn':
            console.warn(prefix, message, ...args);
            break;
        case 'debug':
            if (process.env.DEBUG === 'true') {
                console.log(prefix, message, ...args);
            }
            break;
        case 'info':
        default:
            console.log(prefix, message, ...args);
            break;
    }
}

/**
 * Calculate daily projections
 */
export function calculateDailyProjections(
    currentBurned: number,
    cyclesCompleted: number,
    cyclesPerDay: number = 4
): {
    projectedDailyBurn: number;
    projectedMonthlyBurn: number;
    averageBurnPerCycle: number;
} {
    const averageBurnPerCycle = cyclesCompleted > 0 ? currentBurned / cyclesCompleted : 0;
    const projectedDailyBurn = averageBurnPerCycle * cyclesPerDay;
    const projectedMonthlyBurn = projectedDailyBurn * 30;
    
    return {
        projectedDailyBurn,
        projectedMonthlyBurn,
        averageBurnPerCycle,
    };
}

/**
 * Format transaction signature for display
 */
export function formatTransactionSignature(signature: string, length: number = 8): string {
    if (signature.length <= length * 2) return signature;
    return `${signature.slice(0, length)}...${signature.slice(-length)}`;
}

/**
 * Check if environment is production
 */
export function isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
}

/**
 * Get environment name
 */
export function getEnvironment(): string {
    return process.env.NODE_ENV || 'development';
}

/**
 * Export all utility functions
 */
export default {
    formatSOL,
    formatTokens,
    solToLamports,
    lamportsToSol,
    getCurrentTimestamp,
    getUnixTimestamp,
    sleep,
    calculatePercentage,
    calculateSlippage,
    formatLargeNumber,
    estimateTokensFromSOL,
    calculateBurnImpact,
    formatDuration,
    isWithinCycleHour,
    getNextCycleTime,
    calculateGasEfficiency,
    retryWithBackoff,
    isValidSolanaAddress,
    log,
    calculateDailyProjections,
    formatTransactionSignature,
    isProduction,
    getEnvironment,
};
