/**
 * TypeScript type definitions for ASDF DAT
 * Interfaces and types for the entire project
 */

import { PublicKey } from '@solana/web3.js';
import { BN } from '@project-serum/anchor';

/**
 * DAT State account structure
 */
export interface DATState {
    authority: PublicKey;
    ctoWallet: PublicKey;
    totalBurned: BN;
    totalBuybacks: number;
    isActive: boolean;
    lastCycleTimestamp: BN;
}

/**
 * Cycle execution result
 */
export interface CycleResult {
    success: boolean;
    transactionSignature?: string;
    tokensBurned?: number;
    solUsed?: number;
    error?: string;
    timestamp: number;
}

/**
 * Statistics data
 */
export interface DATStatistics {
    totalBurned: number;
    totalBuybacks: number;
    isActive: boolean;
    lastCycleTimestamp: Date;
    authority: string;
    dailyBurnRate?: number;
    monthlySupplyReduction?: number;
    averageBurnPerCycle?: number;
}

/**
 * Fee check result
 */
export interface FeeCheckResult {
    available: number;
    meetsMinimum: boolean;
    nextCheckTime?: Date;
}

/**
 * Bot configuration
 */
export interface BotConfig {
    rpcUrl: string;
    walletPath: string;
    programId: string;
    checkInterval: number;
    minFeesToClaim: number;
    cycleHours: number[];
}

/**
 * Transaction metadata
 */
export interface TransactionMetadata {
    signature: string;
    slot: number;
    timestamp: number;
    success: boolean;
    logs?: string[];
}

/**
 * Swap parameters
 */
export interface SwapParams {
    amountIn: number;
    minimumAmountOut: number;
    slippageBps: number;
}

/**
 * Pool information
 */
export interface PoolInfo {
    address: PublicKey;
    tokenAMint: PublicKey;
    tokenBMint: PublicKey;
    tokenAReserve: number;
    tokenBReserve: number;
    lpTokenSupply: number;
    fee: number;
}

/**
 * Burn event data
 */
export interface BurnEvent {
    tokensBurned: number;
    solUsed: number;
    totalBurned: number;
    timestamp: number;
    transactionSignature: string;
}

/**
 * Alert notification
 */
export interface Alert {
    type: 'warning' | 'error' | 'info';
    message: string;
    timestamp: Date;
    details?: any;
}

/**
 * Health check status
 */
export interface HealthStatus {
    status: 'healthy' | 'degraded' | 'unhealthy';
    uptime: number;
    lastCycle?: Date;
    walletBalance: number;
    programActive: boolean;
    errors: string[];
}

/**
 * Metrics data for monitoring
 */
export interface Metrics {
    cyclesCompleted: number;
    totalTokensBurned: number;
    totalSolUsed: number;
    averageCycleTime: number;
    successRate: number;
    lastError?: string;
    gasEfficiency: number;
}

/**
 * Command line arguments
 */
export interface CLIArgs {
    command: 'init' | 'check' | 'cycle' | 'stats' | 'pause' | 'resume' | 'bot';
    network?: 'mainnet' | 'devnet' | 'testnet';
    verbose?: boolean;
    debug?: boolean;
}

/**
 * Logger options
 */
export interface LoggerOptions {
    level: 'debug' | 'info' | 'warn' | 'error';
    file?: string;
    console?: boolean;
    timestamp?: boolean;
}

/**
 * Creator vault information
 */
export interface CreatorVault {
    address: PublicKey;
    balance: number;
    lastClaimed?: Date;
    pendingFees: number;
}

/**
 * Price data
 */
export interface PriceData {
    token: string;
    priceUSD: number;
    priceSOL: number;
    volume24h: number;
    marketCap: number;
    timestamp: Date;
}

/**
 * Projection data
 */
export interface Projections {
    dailyBurn: number;
    weeklyBurn: number;
    monthlyBurn: number;
    yearlyBurn: number;
    supplyReductionPercentage: number;
    estimatedDeflationRate: number;
}

/**
 * Error types
 */
export enum ErrorType {
    INSUFFICIENT_FEES = 'INSUFFICIENT_FEES',
    DAT_NOT_ACTIVE = 'DAT_NOT_ACTIVE',
    UNAUTHORIZED = 'UNAUTHORIZED',
    SWAP_FAILED = 'SWAP_FAILED',
    BURN_FAILED = 'BURN_FAILED',
    NETWORK_ERROR = 'NETWORK_ERROR',
    UNKNOWN = 'UNKNOWN',
}

/**
 * Custom error class
 */
export class DATError extends Error {
    constructor(
        public type: ErrorType,
        message: string,
        public details?: any
    ) {
        super(message);
        this.name = 'DATError';
    }
}

/**
 * Event types for monitoring
 */
export enum EventType {
    CYCLE_STARTED = 'CYCLE_STARTED',
    CYCLE_COMPLETED = 'CYCLE_COMPLETED',
    CYCLE_FAILED = 'CYCLE_FAILED',
    FEES_CLAIMED = 'FEES_CLAIMED',
    TOKENS_BOUGHT = 'TOKENS_BOUGHT',
    TOKENS_BURNED = 'TOKENS_BURNED',
    DAT_PAUSED = 'DAT_PAUSED',
    DAT_RESUMED = 'DAT_RESUMED',
    AUTHORITY_UPDATED = 'AUTHORITY_UPDATED',
}

/**
 * Event data structure
 */
export interface EventData {
    type: EventType;
    timestamp: Date;
    data: any;
    transactionSignature?: string;
}

/**
 * Wallet information
 */
export interface WalletInfo {
    address: PublicKey;
    balance: number;
    tokenAccounts: TokenAccountInfo[];
}

/**
 * Token account information
 */
export interface TokenAccountInfo {
    mint: PublicKey;
    balance: number;
    decimals: number;
}

/**
 * Configuration validation result
 */
export interface ConfigValidation {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

/**
 * Type guards
 */
export function isDATState(obj: any): obj is DATState {
    return obj &&
        obj.authority instanceof PublicKey &&
        obj.ctoWallet instanceof PublicKey &&
        typeof obj.totalBurned !== 'undefined' &&
        typeof obj.totalBuybacks === 'number' &&
        typeof obj.isActive === 'boolean';
}

export function isCycleResult(obj: any): obj is CycleResult {
    return obj &&
        typeof obj.success === 'boolean' &&
        typeof obj.timestamp === 'number';
}

export function isHealthStatus(obj: any): obj is HealthStatus {
    return obj &&
        ['healthy', 'degraded', 'unhealthy'].includes(obj.status) &&
        typeof obj.uptime === 'number' &&
        Array.isArray(obj.errors);
}

/**
 * Export all types
 */
export default {
    DATError,
    ErrorType,
    EventType,
    isDATState,
    isCycleResult,
    isHealthStatus,
};
