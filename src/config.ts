/**
 * Configuration file for ASDF DAT
 * Contains all constants and settings for the bot
 */

export const CONFIG = {
    // Fixed on-chain addresses - DO NOT MODIFY
    CTO_WALLET: 'vcGYZbvDid6cRUkCCqcWpBxow73TLpmY6ipmDUtrTF8',
    ASDF_MINT: '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump',
    POOL_PUMPSWAP: 'DuhRX5JTPtsWU5n44t8tcFEfmzy2Eu27p4y6z8Rhf2bb',
    LP_TOKEN: 'GjfJvEY1Yw4bjt15r1q8ek4ZxjR5cC7bMTZZdrCWoGtA',
    PUMP_SWAP_PROGRAM: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEa',
    
    // Program ID (will be updated after deployment)
    PROGRAM_ID: 'ASDFdatBuybackBurnXXXXXXXXXXXXXXXXXXXXXXXXX',
    
    // Operating parameters
    MIN_FEES_TO_CLAIM: 0.05,                    // Minimum SOL required to trigger cycle
    CHECK_INTERVAL: 6 * 60 * 60 * 1000,         // 6 hours in milliseconds
    CYCLE_HOURS: [0, 6, 12, 18],                // UTC hours for cycle execution
    
    // Token parameters
    TOTAL_SUPPLY: 333_333_333,                  // Total ASDF supply
    DECIMALS: 6,                                 // Token decimals
    
    // Swap parameters
    SLIPPAGE_BPS: 100,                          // 1% slippage (100 basis points)
    
    // Expected performance metrics
    EXPECTED_DAILY_VOLUME: 40646,               // Expected daily volume in USD
    CREATOR_FEE_RATE: 0.005,                    // 0.5% creator fee
    EXPECTED_DAILY_FEES: 203,                   // Expected daily fees in USD
    
    // Gas optimization
    MAX_GAS_PERCENTAGE: 0.045,                  // Maximum 4.5% of revenue for gas
    ESTIMATED_GAS_PER_CYCLE: 0.01,              // Estimated SOL per cycle
};

/**
 * Network configuration
 */
export const NETWORK_CONFIG = {
    MAINNET: {
        url: 'https://api.mainnet-beta.solana.com',
        commitment: 'confirmed' as const,
    },
    DEVNET: {
        url: 'https://api.devnet.solana.com',
        commitment: 'confirmed' as const,
    },
    TESTNET: {
        url: 'https://api.testnet.solana.com',
        commitment: 'confirmed' as const,
    },
};

/**
 * Logging configuration
 */
export const LOG_CONFIG = {
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    LOG_FILE: process.env.LOG_FILE || './logs/dat-bot.log',
    LOG_MAX_SIZE: '10m',
    LOG_MAX_FILES: 30,
    LOG_DATE_PATTERN: 'YYYY-MM-DD',
};

/**
 * Monitoring endpoints
 */
export const MONITORING_CONFIG = {
    METRICS_PORT: process.env.METRICS_PORT || 3000,
    HEALTH_CHECK_ENDPOINT: '/health',
    METRICS_ENDPOINT: '/metrics',
    STATS_ENDPOINT: '/stats',
};

/**
 * Alert thresholds
 */
export const ALERT_THRESHOLDS = {
    MIN_WALLET_BALANCE: 0.1,                    // Minimum SOL in wallet for gas
    MAX_FAILED_CYCLES: 3,                       // Max consecutive failed cycles before alert
    MIN_BURN_RATE: 100000,                      // Minimum tokens burned per day
    MAX_SLIPPAGE_EXCEEDED: 5,                   // Max slippage exceeded events
};

/**
 * Protocol fee recipients (rotate for distribution)
 */
export const PROTOCOL_FEE_RECIPIENTS = [
    'FeeRecipient1XXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    'FeeRecipient2XXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    'FeeRecipient3XXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
];

/**
 * Get current configuration based on environment
 */
export function getNetworkConfig() {
    const network = process.env.NETWORK || 'mainnet';
    switch (network.toLowerCase()) {
        case 'devnet':
            return NETWORK_CONFIG.DEVNET;
        case 'testnet':
            return NETWORK_CONFIG.TESTNET;
        case 'mainnet':
        default:
            return NETWORK_CONFIG.MAINNET;
    }
}

/**
 * Validate configuration
 */
export function validateConfig(): boolean {
    // Check required addresses
    if (!CONFIG.CTO_WALLET || !CONFIG.ASDF_MINT || !CONFIG.POOL_PUMPSWAP) {
        console.error('Missing required on-chain addresses');
        return false;
    }
    
    // Check operating parameters
    if (CONFIG.MIN_FEES_TO_CLAIM <= 0) {
        console.error('Invalid minimum fees threshold');
        return false;
    }
    
    if (CONFIG.CHECK_INTERVAL < 60000) { // Minimum 1 minute
        console.error('Check interval too short');
        return false;
    }
    
    if (CONFIG.CYCLE_HOURS.length === 0) {
        console.error('No cycle hours configured');
        return false;
    }
    
    return true;
}

/**
 * Export all configurations
 */
export default {
    CONFIG,
    NETWORK_CONFIG,
    LOG_CONFIG,
    MONITORING_CONFIG,
    ALERT_THRESHOLDS,
    PROTOCOL_FEE_RECIPIENTS,
    getNetworkConfig,
    validateConfig,
};
