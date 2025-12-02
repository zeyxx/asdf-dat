use anchor_lang::prelude::*;

// ══════════════════════════════════════════════════════════════════════════════
// MAINNET TOKEN ADDRESSES
// ══════════════════════════════════════════════════════════════════════════════

/// $ASDF token mint (mainnet)
pub const ASDF_MINT: Pubkey = Pubkey::new_from_array([
    140, 47, 4, 227, 97, 106, 121, 165, 182, 1, 57, 199, 219, 179, 84, 96,
    133, 60, 197, 80, 154, 74, 254, 48, 216, 94, 192, 158, 146, 118, 39, 244
]);

/// Wrapped SOL mint
pub const WSOL_MINT: Pubkey = Pubkey::new_from_array([
    6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172,
    28, 180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169
]);

/// PumpSwap pool for ASDF (mainnet): DuhRX5JTPtsWU5n44t8tcFEfmzy2Eu27p4y6z8Rhf2bb
pub const POOL_PUMPSWAP: Pubkey = Pubkey::new_from_array([
    191, 204, 38, 188, 201, 126, 120, 53, 102, 177, 245, 238, 71, 192, 66, 165,
    130, 17, 150, 235, 78, 240, 56, 247, 205, 54, 243, 244, 230, 203, 227, 170
]);

// ══════════════════════════════════════════════════════════════════════════════
// PROGRAM IDS
// ══════════════════════════════════════════════════════════════════════════════

/// PumpSwap AMM program: pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA
pub const PUMP_SWAP_PROGRAM: Pubkey = Pubkey::new_from_array([
    12, 20, 222, 252, 130, 94, 198, 118, 148, 37, 8, 24, 187, 101, 64, 101,
    244, 41, 141, 49, 86, 213, 113, 180, 212, 248, 9, 12, 24, 233, 168, 99
]);

/// Main Pump.fun program: 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
pub const PUMP_PROGRAM: Pubkey = Pubkey::new_from_array([
    1, 86, 224, 246, 147, 102, 90, 207, 68, 219, 21, 104, 191, 23, 91, 170,
    81, 137, 203, 151, 245, 210, 255, 59, 101, 93, 43, 182, 253, 109, 24, 176
]);

/// Token-2022 program: TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
pub const TOKEN_2022_PROGRAM: Pubkey = Pubkey::new_from_array([
    6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172,
    190, 192, 170, 33, 225, 195, 158, 240, 26, 96, 235, 152, 242, 210, 242, 92
]);

/// Fee Program: pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ
pub const PUMP_FEE_PROGRAM: Pubkey = Pubkey::new_from_array([
    12, 53, 255, 169, 5, 90, 142, 86, 141, 168, 247, 188, 7, 86, 21, 39,
    76, 241, 201, 44, 164, 31, 64, 0, 156, 81, 106, 164, 20, 194, 124, 112
]);

/// Mayhem Mode program: MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e
pub const MAYHEM_PROGRAM: Pubkey = Pubkey::new_from_array([
    5, 42, 229, 215, 167, 218, 167, 36, 166, 234, 176, 167, 41, 84, 145, 133,
    90, 212, 160, 103, 22, 96, 103, 76, 78, 3, 69, 89, 128, 61, 101, 163
]);

// ══════════════════════════════════════════════════════════════════════════════
// PUMPSWAP CONFIG ACCOUNTS
// ══════════════════════════════════════════════════════════════════════════════

/// PumpSwap Global Config PDA: 4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf
pub const PUMPSWAP_GLOBAL_CONFIG: Pubkey = Pubkey::new_from_array([
    58, 134, 94, 105, 238, 15, 84, 128, 202, 188, 246, 99, 87, 228, 220, 47,
    24, 213, 141, 69, 193, 234, 116, 137, 251, 55, 35, 217, 121, 60, 114, 166
]);

/// PumpSwap Event Authority PDA: Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1
pub const PUMPSWAP_EVENT_AUTHORITY: Pubkey = Pubkey::new_from_array([
    172, 241, 54, 235, 1, 252, 28, 78, 136, 61, 35, 200, 181, 132, 74, 181,
    154, 55, 246, 106, 221, 87, 197, 233, 172, 59, 83, 224, 89, 211, 92, 100
]);

/// Global Volume Accumulator PDA: Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y
pub const PUMPSWAP_GLOBAL_VOLUME_ACCUMULATOR: Pubkey = Pubkey::new_from_array([
    250, 9, 17, 165, 72, 99, 65, 45, 99, 31, 78, 7, 135, 3, 41, 108,
    3, 95, 13, 19, 51, 160, 217, 200, 131, 141, 115, 183, 16, 254, 110, 45
]);

// ══════════════════════════════════════════════════════════════════════════════
// FEE RECIPIENTS
// ══════════════════════════════════════════════════════════════════════════════

/// Protocol fee recipients (from PumpSwap GlobalConfig): 6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs
pub const PUMPSWAP_PROTOCOL_FEE_RECIPIENTS: [Pubkey; 1] = [
    Pubkey::new_from_array([
        80, 91, 86, 43, 240, 254, 69, 217, 123, 109, 178, 11, 165, 24, 224, 160,
        197, 204, 48, 77, 217, 105, 172, 23, 142, 107, 116, 145, 130, 79, 179, 164
    ])
];

/// SPL Protocol fee recipient: 6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs
pub const PROTOCOL_FEE_RECIPIENTS: [Pubkey; 1] = [
    Pubkey::new_from_array([
        80, 91, 86, 43, 240, 254, 69, 217, 123, 109, 178, 11, 165, 24, 224, 160,
        197, 204, 48, 77, 217, 105, 172, 23, 142, 107, 116, 145, 130, 79, 179, 164
    ]),
];

/// Mayhem Fee Recipient (Token2022): GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS
pub const MAYHEM_FEE_RECIPIENT: Pubkey = Pubkey::new_from_array([
    232, 147, 20, 31, 177, 142, 159, 21, 116, 216, 16, 225, 120, 225, 158, 48,
    96, 78, 49, 117, 170, 46, 74, 50, 223, 200, 96, 7, 39, 209, 7, 9
]);

/// Mayhem Agent Wallet: BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s
pub const MAYHEM_AGENT_WALLET: Pubkey = Pubkey::new_from_array([
    162, 139, 95, 210, 106, 180, 121, 166, 169, 204, 108, 191, 107, 11, 35, 235,
    97, 136, 90, 55, 30, 1, 32, 172, 169, 19, 190, 239, 61, 19, 138, 120
]);

// ══════════════════════════════════════════════════════════════════════════════
// PDA SEEDS
// ══════════════════════════════════════════════════════════════════════════════

/// DAT State PDA seed
pub const DAT_STATE_SEED: &[u8] = b"dat_v3";

/// DAT Authority PDA seed
pub const DAT_AUTHORITY_SEED: &[u8] = b"auth_v3";

/// Token Stats PDA seed (per-token statistics)
pub const TOKEN_STATS_SEED: &[u8] = b"token_stats_v1";

/// Root Treasury PDA seed (receives 44.8% from secondaries)
pub const ROOT_TREASURY_SEED: &[u8] = b"root_treasury";

/// Validator State PDA seed (trustless fee tracking)
pub const VALIDATOR_STATE_SEED: &[u8] = b"validator_v1";

/// PumpSwap Creator Vault seed (note: underscore, not hyphen)
pub const PUMPSWAP_CREATOR_VAULT_SEED: &[u8] = b"creator_vault";

// ══════════════════════════════════════════════════════════════════════════════
// INSTRUCTION DISCRIMINATORS (8-byte hashes)
// ══════════════════════════════════════════════════════════════════════════════

/// PumpFun buy instruction discriminator
pub const PUMPFUN_BUY_DISCRIMINATOR: [u8; 8] = [102, 6, 61, 18, 1, 218, 235, 234];

/// PumpFun create token instruction discriminator
pub const PUMPFUN_CREATE_DISCRIMINATOR: [u8; 8] = [24, 30, 200, 40, 5, 28, 7, 119];

/// PumpFun collect fee instruction discriminator
pub const PUMPFUN_COLLECT_FEE_DISCRIMINATOR: [u8; 8] = [20, 22, 86, 123, 198, 28, 219, 132];

/// PumpSwap AMM buy instruction discriminator (same as bonding curve buy)
pub const PUMPSWAP_BUY_DISCRIMINATOR: [u8; 8] = [102, 6, 61, 18, 1, 218, 235, 234];

/// PumpSwap collect_coin_creator_fee instruction discriminator
pub const PUMPSWAP_COLLECT_CREATOR_FEE_DISCRIMINATOR: [u8; 8] = [160, 57, 89, 42, 181, 139, 43, 66];

// ══════════════════════════════════════════════════════════════════════════════
// OPERATIONAL THRESHOLDS
// ══════════════════════════════════════════════════════════════════════════════

/// Minimum fees required to claim (0.01 SOL)
pub const MIN_FEES_TO_CLAIM: u64 = 10_000_000;

/// Maximum fees per cycle (69420 SOL - effectively unlimited, market decides via slippage)
pub const MAX_FEES_PER_CYCLE: u64 = 69_420_000_000_000;

/// Initial slippage tolerance (5%)
pub const INITIAL_SLIPPAGE_BPS: u16 = 500;

/// Minimum interval between cycles (60 seconds)
pub const MIN_CYCLE_INTERVAL: i64 = 60;

/// Maximum pending fees per token (69 SOL)
/// Rationale: 69 SOL represents ~6900 trades with 0.01 SOL fee each,
/// well beyond typical accumulation between daemon flushes.
/// This limit prevents excessive accumulation, potential overflow,
/// and ensures proportional distribution remains fair.
pub const MAX_PENDING_FEES: u64 = 69_000_000_000;

// ══════════════════════════════════════════════════════════════════════════════
// EXECUTE BUY CONSTANTS (module level to reduce stack usage)
// ══════════════════════════════════════════════════════════════════════════════

/// Rent exempt minimum for token accounts (~0.00089 SOL)
pub const RENT_EXEMPT_MINIMUM: u64 = 890_880;

/// Safety buffer for transactions (~0.00005 SOL)
pub const SAFETY_BUFFER: u64 = 50_000;

/// ATA rent reserve (~0.0021 SOL)
pub const ATA_RENT_RESERVE: u64 = 2_100_000;

/// Minimum fees required before split (~0.0055 SOL)
pub const MIN_FEES_FOR_SPLIT: u64 = 5_500_000;

/// Minimum buy amount (~0.0001 SOL)
pub const MINIMUM_BUY_AMOUNT: u64 = 100_000;

// ══════════════════════════════════════════════════════════════════════════════
// TESTING MODE CONFIGURATION
// ══════════════════════════════════════════════════════════════════════════════
// SECURITY: Use feature flag instead of runtime constant
// Build with: anchor build -- --features testing (for devnet)
// Build with: anchor build (for mainnet - testing disabled by default)
//
// When true (TESTING):
//   - Disables minimum cycle interval check (allows rapid testing)
//   - Disables minimum fees threshold (allows cycles with any amount)
// When false (PRODUCTION):
//   - Enforces minimum 60s between cycles
//   - Requires minimum fees threshold to be met
#[cfg(feature = "testing")]
pub const TESTING_MODE: bool = true;
#[cfg(not(feature = "testing"))]
pub const TESTING_MODE: bool = false;
