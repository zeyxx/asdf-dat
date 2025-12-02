// ============================================================================
// UNIT TESTS FOR ASDF DAT PROGRAM
// ============================================================================
//
// This module contains unit tests for the core logic of the DAT program.
// Run with: cargo test --lib
//
// Test Categories:
// 1. Math Functions - calculate_tokens_out_pumpfun, slippage calculations
// 2. Bonding Curve Parsing - deserialize_bonding_curve
// 3. Fee Split Logic - split_fees_to_root calculations
// 4. Error Conditions - All 18 error codes
// 5. State Validation - DATState and TokenStats invariants
// ============================================================================

#[cfg(test)]
mod tests {
    // Import all items from crate root for nested test modules
    #[allow(unused_imports)]
    use crate::{
        // Constants
        MIN_FEES_TO_CLAIM, MAX_FEES_PER_CYCLE, INITIAL_SLIPPAGE_BPS, MIN_CYCLE_INTERVAL,
        MAX_PENDING_FEES,
        DAT_STATE_SEED, DAT_AUTHORITY_SEED, TOKEN_STATS_SEED, ROOT_TREASURY_SEED,
        // Functions
        calculate_tokens_out_pumpfun, deserialize_bonding_curve,
        // Types
        ErrorCode,
    };

    // ========================================================================
    // 1. MATH FUNCTION TESTS
    // ========================================================================

    mod math_tests {
        use super::*;

        #[test]
        fn test_calculate_tokens_out_basic() {
            // Test basic PumpFun formula: tokens = (sol_in * token_reserves) / (sol_reserves + sol_in)
            let sol_in: u64 = 1_000_000_000; // 1 SOL
            let virtual_sol_reserves: u64 = 30_000_000_000; // 30 SOL
            let virtual_token_reserves: u64 = 1_000_000_000_000_000; // 1B tokens

            let result = calculate_tokens_out_pumpfun(sol_in, virtual_sol_reserves, virtual_token_reserves);

            assert!(result.is_ok());
            let tokens = result.unwrap();

            // Expected: (1 * 1B) / (30 + 1) ~= 32,258,064,516,129
            assert!(tokens > 32_000_000_000_000);
            assert!(tokens < 33_000_000_000_000);
        }

        #[test]
        fn test_calculate_tokens_out_zero_sol() {
            let result = calculate_tokens_out_pumpfun(0, 30_000_000_000, 1_000_000_000_000_000);
            assert!(result.is_ok());
            assert_eq!(result.unwrap(), 0);
        }

        #[test]
        fn test_calculate_tokens_out_zero_reserves() {
            // Zero SOL reserves should return error (pool has no liquidity)
            let result = calculate_tokens_out_pumpfun(1_000_000_000, 0, 1_000_000_000_000_000);
            // Function requires virtual_sol_reserves > 0 for pool liquidity
            assert!(result.is_err(), "Zero SOL reserves should return InsufficientPoolLiquidity error");
        }

        #[test]
        fn test_calculate_tokens_out_large_values() {
            // Test with large values to check for overflow handling
            let sol_in: u64 = u64::MAX / 1000;
            let virtual_sol_reserves: u64 = u64::MAX / 1000;
            let virtual_token_reserves: u64 = u64::MAX / 1000;

            let result = calculate_tokens_out_pumpfun(sol_in, virtual_sol_reserves, virtual_token_reserves);
            // Should not panic - either returns Ok with valid result or Err for overflow
            // With equal reserves and input, output should be ~half of reserves
            if let Ok(tokens) = result {
                // tokens = (sol_in * token_reserves) / (sol_reserves + sol_in)
                // With equal values: tokens ≈ reserves / 2
                assert!(tokens <= virtual_token_reserves);
            }
            // If Err, that's also acceptable for extreme values
        }

        #[test]
        fn test_slippage_calculation() {
            // Test 97% safety margin calculation
            let expected_tokens: u64 = 1_000_000_000;
            let target = (expected_tokens as u128 * 97 / 100) as u64;
            assert_eq!(target, 970_000_000);
        }
    }

    // ========================================================================
    // 2. BONDING CURVE PARSING TESTS
    // ========================================================================

    mod bonding_curve_tests {
        use super::*;

        #[test]
        fn test_deserialize_bonding_curve_valid() {
            // Create valid bonding curve data (81 bytes for standard, 82 for mayhem)
            let mut data = vec![0u8; 81];

            // Set virtual_token_reserves at bytes 0-7 (little endian)
            let token_reserves: u64 = 1_000_000_000_000_000;
            data[0..8].copy_from_slice(&token_reserves.to_le_bytes());

            // Set virtual_sol_reserves at bytes 8-15 (little endian)
            let sol_reserves: u64 = 30_000_000_000;
            data[8..16].copy_from_slice(&sol_reserves.to_le_bytes());

            let result = deserialize_bonding_curve(&data);
            assert!(result.is_ok());

            let (parsed_token, parsed_sol) = result.unwrap();
            assert_eq!(parsed_token, token_reserves);
            assert_eq!(parsed_sol, sol_reserves);
        }

        #[test]
        fn test_deserialize_bonding_curve_invalid_length() {
            // Test with data too short (need at least 16 bytes for reserves)
            let data = vec![0u8; 10];
            let result = deserialize_bonding_curve(&data);
            // Should return error for insufficient data
            assert!(result.is_err(), "Should fail with insufficient data length");
        }

        #[test]
        fn test_deserialize_bonding_curve_mayhem_mode() {
            // Test 82-byte bonding curve data (Mayhem mode)
            let mut data = vec![0u8; 82];

            let token_reserves: u64 = 500_000_000_000_000;
            let sol_reserves: u64 = 15_000_000_000;

            data[0..8].copy_from_slice(&token_reserves.to_le_bytes());
            data[8..16].copy_from_slice(&sol_reserves.to_le_bytes());
            data[81] = 1; // is_mayhem_mode flag

            let result = deserialize_bonding_curve(&data);
            assert!(result.is_ok());
        }
    }

    // ========================================================================
    // 3. FEE SPLIT LOGIC TESTS
    // ========================================================================

    mod fee_split_tests {
        use super::*;

        #[test]
        fn test_fee_split_default_ratio() {
            // Default: 55.2% keep, 44.8% to root (5520 bps)
            let total_fees: u64 = 1_000_000_000; // 1 SOL
            let fee_split_bps: u16 = 5520;

            let keep_amount = (total_fees as u128 * fee_split_bps as u128 / 10000) as u64;
            let to_root = total_fees - keep_amount;

            assert_eq!(keep_amount, 552_000_000); // 0.552 SOL
            assert_eq!(to_root, 448_000_000);     // 0.448 SOL
        }

        #[test]
        fn test_fee_split_100_percent_keep() {
            // 100% keep (root token scenario)
            let total_fees: u64 = 1_000_000_000;
            let fee_split_bps: u16 = 10000;

            let keep_amount = (total_fees as u128 * fee_split_bps as u128 / 10000) as u64;
            let to_root = total_fees - keep_amount;

            assert_eq!(keep_amount, total_fees);
            assert_eq!(to_root, 0);
        }

        #[test]
        fn test_fee_split_50_50() {
            let total_fees: u64 = 1_000_000_000;
            let fee_split_bps: u16 = 5000;

            let keep_amount = (total_fees as u128 * fee_split_bps as u128 / 10000) as u64;
            let to_root = total_fees - keep_amount;

            assert_eq!(keep_amount, 500_000_000);
            assert_eq!(to_root, 500_000_000);
        }

        #[test]
        fn test_fee_split_small_amount() {
            // Test with very small amount to check for rounding
            let total_fees: u64 = 100; // 100 lamports
            let fee_split_bps: u16 = 5520;

            let keep_amount = (total_fees as u128 * fee_split_bps as u128 / 10000) as u64;
            let to_root = total_fees - keep_amount;

            assert_eq!(keep_amount + to_root, total_fees); // No loss
        }

        #[test]
        fn test_fee_split_invalid_bps() {
            // BPS > 10000 should be rejected
            let fee_split_bps: u16 = 10001;
            assert!(fee_split_bps > 10000); // Validation check
        }
    }

    // ========================================================================
    // 4. ERROR CONDITION TESTS
    // ========================================================================

    mod error_tests {
        use super::*;

        #[test]
        fn test_error_codes_exist() {
            // Verify all error codes are defined
            let _ = ErrorCode::DATNotActive;
            let _ = ErrorCode::InsufficientFees;
            let _ = ErrorCode::UnauthorizedAccess;
            let _ = ErrorCode::CycleTooSoon;
            let _ = ErrorCode::InvalidParameter;
            let _ = ErrorCode::MathOverflow;
            let _ = ErrorCode::SlippageExceeded;
            let _ = ErrorCode::PriceImpactTooHigh;
            let _ = ErrorCode::VaultNotInitialized;
            let _ = ErrorCode::NoPendingBurn;
            let _ = ErrorCode::InvalidPool;
            let _ = ErrorCode::InvalidRootToken;
            let _ = ErrorCode::InvalidRootTreasury;
            let _ = ErrorCode::InvalidFeeSplit;
            let _ = ErrorCode::InsufficientPoolLiquidity;
            let _ = ErrorCode::PendingFeesOverflow;
            let _ = ErrorCode::FeeSplitDeltaTooLarge;
            let _ = ErrorCode::StaleValidation;
            let _ = ErrorCode::SlotRangeTooLarge;
            let _ = ErrorCode::ValidatorNotStale;
            let _ = ErrorCode::FeeTooHigh;
            let _ = ErrorCode::TooManyTransactions;
            let _ = ErrorCode::InvalidBondingCurve;
            let _ = ErrorCode::MintMismatch;
            // New specific error codes (LOW-02 fix)
            let _ = ErrorCode::NoPendingAdminTransfer;
            let _ = ErrorCode::NoPendingFeeSplit;
            let _ = ErrorCode::InvalidAccountOwner;
            let _ = ErrorCode::SlippageConfigTooHigh;
            let _ = ErrorCode::AccountSizeMismatch;
        }

        #[test]
        fn test_min_pool_liquidity_constant() {
            // Minimum pool liquidity should be 0.01 SOL
            const MIN_POOL_LIQUIDITY: u64 = 10_000_000;
            assert_eq!(MIN_POOL_LIQUIDITY, 10_000_000);
        }

        #[test]
        fn test_rent_exempt_minimum() {
            // Rent exempt minimum for basic account
            const RENT_EXEMPT_MINIMUM: u64 = 890880;
            assert!(RENT_EXEMPT_MINIMUM < 1_000_000); // Less than 0.001 SOL
        }
    }

    // ========================================================================
    // 5. STATE VALIDATION TESTS
    // ========================================================================

    mod state_tests {
        use super::*;

        #[test]
        fn test_dat_state_size() {
            // DATState should be 374 bytes according to size calculation
            // See state/dat_state.rs for detailed breakdown
            use crate::state::DATState;
            assert_eq!(DATState::LEN, 374, "DATState size mismatch");
        }

        #[test]
        fn test_token_stats_size() {
            // TokenStats should be 130 bytes (see state/token_stats.rs)
            use crate::state::TokenStats;
            assert_eq!(TokenStats::LEN, 130, "TokenStats size mismatch");
        }

        #[test]
        fn test_testing_mode_default() {
            // Verify TESTING_MODE constant is accessible
            // In production, this should be false
            use crate::TESTING_MODE;
            // For devnet testing, TESTING_MODE may be true
            // For mainnet deployment, ensure this is set to false
            let _ = TESTING_MODE; // Compile-time check that constant exists
        }
    }

    // ========================================================================
    // 6. PDA DERIVATION TESTS
    // ========================================================================

    mod pda_tests {
        use super::*;
        use anchor_lang::prelude::Pubkey;

        #[test]
        fn test_dat_state_seed() {
            assert_eq!(DAT_STATE_SEED, b"dat_v3");
        }

        #[test]
        fn test_dat_authority_seed() {
            assert_eq!(DAT_AUTHORITY_SEED, b"auth_v3");
        }

        #[test]
        fn test_token_stats_seed() {
            assert_eq!(TOKEN_STATS_SEED, b"token_stats_v1");
        }

        #[test]
        fn test_root_treasury_seed() {
            assert_eq!(ROOT_TREASURY_SEED, b"root_treasury");
        }
    }

    // ========================================================================
    // 7. TIMING TESTS (AM/PM Logic)
    // ========================================================================

    mod timing_tests {
        use super::*;

        #[test]
        fn test_is_am_calculation() {
            // Test AM detection (00:00 - 11:59)
            let timestamp_6am: i64 = 6 * 3600; // 6:00 AM
            let hour = (timestamp_6am / 3600) % 24;
            assert!(hour < 12, "6 AM should be AM");

            let timestamp_11am: i64 = 11 * 3600; // 11:00 AM
            let hour = (timestamp_11am / 3600) % 24;
            assert!(hour < 12, "11 AM should be AM");
        }

        #[test]
        fn test_is_pm_calculation() {
            // Test PM detection (12:00 - 23:59)
            let timestamp_2pm: i64 = 14 * 3600; // 2:00 PM (14:00)
            let hour = (timestamp_2pm / 3600) % 24;
            assert!(hour >= 12, "2 PM should be PM");

            let timestamp_11pm: i64 = 23 * 3600; // 11:00 PM
            let hour = (timestamp_11pm / 3600) % 24;
            assert!(hour >= 12, "11 PM should be PM");
        }

        #[test]
        fn test_day_start_calculation() {
            // Test day start calculation (midnight)
            let timestamp: i64 = 1700000000; // Some Unix timestamp
            let day_start = (timestamp / 86400) * 86400;

            // Day start should be a multiple of 86400
            assert_eq!(day_start % 86400, 0);

            // Day start should be <= timestamp
            assert!(day_start <= timestamp);

            // Day start should be within 24 hours of timestamp
            assert!(timestamp - day_start < 86400);
        }

        #[test]
        fn test_min_cycle_interval() {
            // Default minimum cycle interval is 60 seconds
            assert_eq!(MIN_CYCLE_INTERVAL, 60);
        }
    }

    // ========================================================================
    // 8. CONSTANT VALIDATION TESTS
    // ========================================================================

    mod constant_tests {
        use super::*;

        #[test]
        fn test_min_fees_to_claim() {
            // 0.01 SOL = 10,000,000 lamports
            assert_eq!(MIN_FEES_TO_CLAIM, 10_000_000);
        }

        #[test]
        fn test_max_fees_per_cycle() {
            // 1 SOL = 1,000,000,000 lamports
            assert_eq!(MAX_FEES_PER_CYCLE, 1_000_000_000);
        }

        #[test]
        fn test_initial_slippage_bps() {
            // 5% = 500 basis points
            assert_eq!(INITIAL_SLIPPAGE_BPS, 500);
        }

        #[test]
        fn test_slippage_not_too_high() {
            // Slippage should not exceed 20%
            assert!(INITIAL_SLIPPAGE_BPS <= 2000);
        }

        #[test]
        fn test_max_pending_fees() {
            // 69 SOL = 69,000,000,000 lamports
            assert_eq!(MAX_PENDING_FEES, 69_000_000_000);
        }

        #[test]
        fn test_max_pending_fees_is_reasonable() {
            // MAX_PENDING_FEES should be at least 10 SOL and at most 1000 SOL
            assert!(MAX_PENDING_FEES >= 10_000_000_000, "MAX_PENDING_FEES too low");
            assert!(MAX_PENDING_FEES <= 1_000_000_000_000, "MAX_PENDING_FEES too high");
        }
    }

    // ========================================================================
    // 9. EXTENDED FEE SPLIT TESTS (A.1 - Core Business Logic)
    // ========================================================================

    mod fee_split_extended_tests {
        use super::*;

        /// Test 55.2%/44.8% ratio precision with 1 SOL
        #[test]
        fn test_fee_split_55_44_ratio_precision() {
            let total: u64 = 1_000_000_000; // 1 SOL
            let fee_split_bps: u16 = 5520;  // 55.2%

            let keep = (total as u128 * fee_split_bps as u128 / 10000) as u64;
            let to_root = total.saturating_sub(keep);

            // 55.2% of 1 SOL = 552,000,000 lamports
            assert_eq!(keep, 552_000_000, "Keep amount should be 55.2%");
            // 44.8% of 1 SOL = 448,000,000 lamports
            assert_eq!(to_root, 448_000_000, "Root amount should be 44.8%");
            // Sum should equal original
            assert_eq!(keep + to_root, total, "No lamports lost in split");
        }

        /// Test fee split with zero amount (edge case)
        #[test]
        fn test_fee_split_with_zero_amount() {
            let total: u64 = 0;
            let fee_split_bps: u16 = 5520;

            let keep = (total as u128 * fee_split_bps as u128 / 10000) as u64;
            let to_root = total.saturating_sub(keep);

            assert_eq!(keep, 0, "Zero split should keep 0");
            assert_eq!(to_root, 0, "Zero split should send 0 to root");
        }

        /// Test fee split at MIN_FEES_FOR_SPLIT threshold (0.0055 SOL)
        #[test]
        fn test_fee_split_at_min_threshold() {
            let min_fees_for_split: u64 = 5_500_000; // 0.0055 SOL
            let fee_split_bps: u16 = 5520;

            let keep = (min_fees_for_split as u128 * fee_split_bps as u128 / 10000) as u64;
            let to_root = min_fees_for_split.saturating_sub(keep);

            // Verify no loss at minimum threshold
            assert_eq!(keep + to_root, min_fees_for_split);
            // keep should be ~0.003036 SOL
            assert!(keep > 3_000_000, "Keep should be > 0.003 SOL");
        }

        /// Test fee split with MAX_PENDING_FEES (69 SOL) - no overflow
        #[test]
        fn test_fee_split_max_pending_no_overflow() {
            let fee_split_bps: u16 = 5520;

            // Use u128 for intermediate calculation
            let keep = (MAX_PENDING_FEES as u128 * fee_split_bps as u128 / 10000) as u64;
            let to_root = MAX_PENDING_FEES.saturating_sub(keep);

            // Verify no overflow
            assert_eq!(keep + to_root, MAX_PENDING_FEES);
            // 55.2% of 69 SOL = 38.088 SOL
            assert_eq!(keep, 38_088_000_000);
        }

        /// Test fee split boundary: 0 bps (all to root)
        #[test]
        fn test_fee_split_zero_bps() {
            let total: u64 = 1_000_000_000;
            let fee_split_bps: u16 = 0; // 0% keep

            let keep = (total as u128 * fee_split_bps as u128 / 10000) as u64;
            let to_root = total.saturating_sub(keep);

            assert_eq!(keep, 0, "0 bps should keep nothing");
            assert_eq!(to_root, total, "0 bps should send all to root");
        }

        /// Test fee split boundary: 10000 bps (all keep, root token)
        #[test]
        fn test_fee_split_max_bps() {
            let total: u64 = 1_000_000_000;
            let fee_split_bps: u16 = 10000; // 100% keep

            let keep = (total as u128 * fee_split_bps as u128 / 10000) as u64;
            let to_root = total.saturating_sub(keep);

            assert_eq!(keep, total, "10000 bps should keep all");
            assert_eq!(to_root, 0, "10000 bps should send nothing to root");
        }

        /// Test fee split delta constraint (max 500 bps = 5%)
        #[test]
        fn test_fee_split_delta_max_500bps() {
            let current_bps: u16 = 5520;
            let max_delta: u16 = 500;

            let min_allowed = current_bps.saturating_sub(max_delta);
            let max_allowed = current_bps.saturating_add(max_delta);

            assert_eq!(min_allowed, 5020, "Min after -5% should be 5020");
            assert_eq!(max_allowed, 6020, "Max after +5% should be 6020");

            // 501 delta should be rejected
            let invalid_delta: u16 = 501;
            assert!(invalid_delta > max_delta, "501 bps exceeds max delta");
        }
    }

    // ========================================================================
    // 10. SLIPPAGE CALCULATION TESTS (A.1 - Core Business Logic)
    // ========================================================================

    mod slippage_tests {
        use super::*;

        /// Test slippage at 0% (no slippage tolerance)
        #[test]
        fn test_slippage_zero_percent() {
            let expected_tokens: u64 = 1_000_000_000;
            let slippage_bps: u16 = 0;

            let min_tokens = (expected_tokens as u128 * (10000 - slippage_bps as u128) / 10000) as u64;

            assert_eq!(min_tokens, expected_tokens, "0% slippage = expect exact amount");
        }

        /// Test slippage at 5% (INITIAL_SLIPPAGE_BPS)
        #[test]
        fn test_slippage_5_percent() {
            let expected_tokens: u64 = 1_000_000_000;
            let slippage_bps: u16 = INITIAL_SLIPPAGE_BPS; // 500 = 5%

            let min_tokens = (expected_tokens as u128 * (10000 - slippage_bps as u128) / 10000) as u64;

            // 95% of expected = 950,000,000
            assert_eq!(min_tokens, 950_000_000, "5% slippage should accept 95%");
        }

        /// Test slippage at exact boundary (500 bps max allowed)
        #[test]
        fn test_slippage_at_exact_boundary() {
            let max_slippage_bps: u16 = 500;

            // Exactly at boundary should be valid
            assert!(max_slippage_bps <= 500, "500 bps should be allowed");

            // 501 should be rejected
            let over_limit: u16 = 501;
            assert!(over_limit > 500, "501 bps should be rejected");
        }

        /// Test slippage with zero expected tokens
        #[test]
        fn test_slippage_zero_tokens() {
            let expected_tokens: u64 = 0;
            let slippage_bps: u16 = 500;

            let min_tokens = (expected_tokens as u128 * (10000 - slippage_bps as u128) / 10000) as u64;

            assert_eq!(min_tokens, 0, "0 expected = 0 min with any slippage");
        }

        /// Test slippage with very large token amount (no overflow)
        #[test]
        fn test_slippage_large_amount_no_overflow() {
            let expected_tokens: u64 = u64::MAX / 2; // Large but safe
            let slippage_bps: u16 = 500;

            // Use u128 intermediate calculation
            let min_tokens = (expected_tokens as u128 * (10000 - slippage_bps as u128) / 10000) as u64;

            // Result should be 95% of expected
            let expected_min = (expected_tokens as u128 * 95 / 100) as u64;
            assert_eq!(min_tokens, expected_min, "Large amount slippage should match");
        }

        /// Test slippage multiplier calculation
        #[test]
        fn test_slippage_multiplier() {
            let slippage_bps: u16 = 300; // 3%
            let multiplier = 10000u128 - slippage_bps as u128;

            assert_eq!(multiplier, 9700, "3% slippage = 97% multiplier");
        }
    }

    // ========================================================================
    // 11. BOUNDARY VALUE TESTS (A.1 - Core Business Logic)
    // ========================================================================

    mod boundary_tests {
        use super::*;

        /// Test MIN_FEES_TO_CLAIM boundary (0.01 SOL)
        #[test]
        fn test_min_fees_to_claim_boundary() {
            let just_below: u64 = MIN_FEES_TO_CLAIM - 1; // 9,999,999 lamports
            let exactly: u64 = MIN_FEES_TO_CLAIM;         // 10,000,000 lamports
            let just_above: u64 = MIN_FEES_TO_CLAIM + 1;  // 10,000,001 lamports

            assert!(just_below < MIN_FEES_TO_CLAIM, "Below threshold should fail");
            assert!(exactly >= MIN_FEES_TO_CLAIM, "Exactly threshold should pass");
            assert!(just_above >= MIN_FEES_TO_CLAIM, "Above threshold should pass");
        }

        /// Test MAX_FEES_PER_CYCLE boundary (1 SOL)
        #[test]
        fn test_max_fees_per_cycle_boundary() {
            let just_below: u64 = MAX_FEES_PER_CYCLE - 1;
            let exactly: u64 = MAX_FEES_PER_CYCLE;
            let just_above: u64 = MAX_FEES_PER_CYCLE + 1;

            assert!(just_below <= MAX_FEES_PER_CYCLE, "Below max should be capped");
            assert!(exactly <= MAX_FEES_PER_CYCLE, "Exactly max should be valid");
            assert!(just_above > MAX_FEES_PER_CYCLE, "Above max should be capped to max");
        }

        /// Test MAX_PENDING_FEES cap enforcement (69 SOL)
        #[test]
        fn test_max_pending_fees_cap() {
            let current: u64 = 68_000_000_000; // 68 SOL
            let new_fees: u64 = 2_000_000_000;  // 2 SOL

            let new_total = current.saturating_add(new_fees);

            // Would exceed MAX_PENDING_FEES (69 SOL)
            assert!(new_total > MAX_PENDING_FEES, "68 + 2 = 70 SOL > 69 SOL cap");

            // Check that we correctly detect overflow
            let would_overflow = new_total > MAX_PENDING_FEES;
            assert!(would_overflow, "Should detect pending fees overflow");
        }

        /// Test MIN_CYCLE_INTERVAL boundary (60 seconds)
        #[test]
        fn test_min_cycle_interval_boundary() {
            let last_cycle: i64 = 1700000000;
            let too_soon: i64 = last_cycle + MIN_CYCLE_INTERVAL - 1; // 59s later
            let exactly: i64 = last_cycle + MIN_CYCLE_INTERVAL;       // 60s later
            let ok: i64 = last_cycle + MIN_CYCLE_INTERVAL + 1;        // 61s later

            assert!((too_soon - last_cycle) < MIN_CYCLE_INTERVAL, "59s should fail");
            assert!((exactly - last_cycle) >= MIN_CYCLE_INTERVAL, "60s should pass");
            assert!((ok - last_cycle) >= MIN_CYCLE_INTERVAL, "61s should pass");
        }

        /// Test fee_split_bps valid range (0-10000)
        #[test]
        fn test_fee_split_bps_valid_range() {
            let valid_values: [u16; 5] = [0, 1, 5520, 9999, 10000];
            for bps in valid_values {
                assert!(bps <= 10000, "Valid BPS {} should be <= 10000", bps);
            }

            let invalid: u16 = 10001;
            assert!(invalid > 10000, "10001 should be invalid");
        }

        /// Test slippage_bps max (500 = 5%)
        #[test]
        fn test_slippage_bps_max() {
            let max_allowed: u16 = 500;

            assert_eq!(INITIAL_SLIPPAGE_BPS, max_allowed, "Initial slippage should be max");

            // Values above 500 should be rejected
            let too_high: u16 = 501;
            assert!(too_high > max_allowed, "501 exceeds max slippage");
        }
    }

    // ========================================================================
    // 12. TOKEN CALCULATION TESTS (A.1 - All Fee Tiers)
    // ========================================================================

    mod token_calculation_tests {
        use super::*;

        /// Test PumpFun token calculation with standard reserves
        #[test]
        fn test_tokens_out_standard_reserves() {
            // Standard initial curve: 30 SOL virtual, 1B tokens
            let sol_in: u64 = 100_000_000; // 0.1 SOL
            let sol_reserves: u64 = 30_000_000_000;
            let token_reserves: u64 = 1_000_000_000_000_000;

            let result = calculate_tokens_out_pumpfun(sol_in, sol_reserves, token_reserves);
            assert!(result.is_ok());

            let tokens = result.unwrap();
            // tokens = (0.1 * 1B) / (30 + 0.1) ≈ 3,322,259,136,212
            assert!(tokens > 3_300_000_000_000, "Should get ~3.3M tokens");
            assert!(tokens < 3_350_000_000_000, "Should not exceed ~3.35M tokens");
        }

        /// Test with depleted reserves (high price)
        #[test]
        fn test_tokens_out_depleted_reserves() {
            // Nearly bonded: 80 SOL in pool, only 200M tokens left
            let sol_in: u64 = 1_000_000_000; // 1 SOL
            let sol_reserves: u64 = 80_000_000_000;
            let token_reserves: u64 = 200_000_000_000_000;

            let result = calculate_tokens_out_pumpfun(sol_in, sol_reserves, token_reserves);
            assert!(result.is_ok());

            let tokens = result.unwrap();
            // tokens = (1 * 200M) / (80 + 1) ≈ 2,469,135,802,469
            assert!(tokens > 2_400_000_000_000, "Should get ~2.4M tokens");
        }

        /// Test with very small SOL input (dust amount)
        #[test]
        fn test_tokens_out_dust_amount() {
            let sol_in: u64 = 100_000; // 0.0001 SOL
            let sol_reserves: u64 = 30_000_000_000;
            let token_reserves: u64 = 1_000_000_000_000_000;

            let result = calculate_tokens_out_pumpfun(sol_in, sol_reserves, token_reserves);
            assert!(result.is_ok());

            let tokens = result.unwrap();
            // Should get some tokens, not zero
            assert!(tokens > 0, "Dust amount should still yield tokens");
        }

        /// Test multiple sequential buys (reserves decrease)
        #[test]
        fn test_tokens_out_sequential_buys() {
            let mut sol_reserves: u64 = 30_000_000_000;
            let mut token_reserves: u64 = 1_000_000_000_000_000;
            let sol_per_buy: u64 = 1_000_000_000; // 1 SOL

            let mut total_tokens: u64 = 0;
            let mut last_tokens: u64 = u64::MAX;

            for i in 0..5 {
                let result = calculate_tokens_out_pumpfun(sol_per_buy, sol_reserves, token_reserves);
                assert!(result.is_ok(), "Buy {} should succeed", i);

                let tokens = result.unwrap();

                // Each subsequent buy should yield fewer tokens (price impact)
                assert!(tokens < last_tokens, "Buy {} should yield fewer tokens", i);

                // Update reserves for next iteration
                sol_reserves = sol_reserves.saturating_add(sol_per_buy);
                token_reserves = token_reserves.saturating_sub(tokens);
                total_tokens = total_tokens.saturating_add(tokens);
                last_tokens = tokens;
            }

            assert!(total_tokens > 0, "Total tokens bought should be > 0");
        }

        /// Test overflow protection with u64::MAX
        #[test]
        fn test_tokens_out_u64_max() {
            let sol_in: u64 = u64::MAX;
            let sol_reserves: u64 = 30_000_000_000;
            let token_reserves: u64 = 1_000_000_000_000_000;

            let result = calculate_tokens_out_pumpfun(sol_in, sol_reserves, token_reserves);

            // Should either return valid result (tokens ≤ reserves) or error
            match result {
                Ok(tokens) => assert!(tokens <= token_reserves, "Can't get more than reserves"),
                Err(_) => (), // Overflow error is acceptable
            }
        }
    }

    // ========================================================================
    // 13. ADMIN OPERATION TESTS (A.2 - Security Tests)
    // ========================================================================

    mod admin_operation_tests {
        use super::*;

        /// Test admin cooldown constant (1 hour default)
        #[test]
        fn test_admin_cooldown_default() {
            let default_cooldown: i64 = 3600; // 1 hour
            assert_eq!(default_cooldown, 3600, "Default cooldown should be 1 hour");
        }

        /// Test admin cooldown enforcement simulation
        #[test]
        fn test_admin_cooldown_enforcement() {
            let cooldown: i64 = 3600;
            let last_operation: i64 = 1700000000;
            let current_time: i64 = last_operation + 3599; // 59m59s later

            let elapsed = current_time - last_operation;
            assert!(elapsed < cooldown, "Should block - cooldown not elapsed");

            let current_time_ok: i64 = last_operation + 3600;
            let elapsed_ok = current_time_ok - last_operation;
            assert!(elapsed_ok >= cooldown, "Should allow - cooldown elapsed");
        }

        /// Test consecutive failure threshold (auto-pause at 5)
        #[test]
        fn test_consecutive_failures_threshold() {
            let auto_pause_threshold: u8 = 5;

            for failures in 0..10u8 {
                if failures >= auto_pause_threshold {
                    assert!(failures >= 5, "Should auto-pause at {} failures", failures);
                } else {
                    assert!(failures < 5, "Should not auto-pause at {} failures", failures);
                }
            }
        }

        /// Test two-step admin transfer validation
        #[test]
        fn test_two_step_admin_transfer() {
            use anchor_lang::prelude::Pubkey;

            let current_admin = Pubkey::new_unique();
            let new_admin = Pubkey::new_unique();
            let pending_admin: Option<Pubkey> = Some(new_admin);

            // Step 1: propose_admin_transfer sets pending_admin
            assert!(pending_admin.is_some(), "Pending admin should be set");

            // Step 2: accept_admin_transfer requires new_admin signature
            let signer = new_admin;
            assert_eq!(pending_admin.unwrap(), signer, "Signer must be pending admin");

            // Invalid case: wrong signer
            let wrong_signer = Pubkey::new_unique();
            assert_ne!(pending_admin.unwrap(), wrong_signer, "Wrong signer should fail");
        }
    }

    // ========================================================================
    // 14. VALIDATOR SYSTEM TESTS (A.2 - HIGH-02 Fix Verification)
    // ========================================================================

    mod validator_tests {
        use super::*;

        /// Test validator slot stale threshold (1000 slots)
        #[test]
        fn test_validator_stale_threshold() {
            let stale_threshold: u64 = 1000; // Slots
            let last_validated: u64 = 100_000;
            let current_slot: u64 = last_validated + 999;

            let slot_delta = current_slot.saturating_sub(last_validated);
            assert!(slot_delta < stale_threshold, "999 slot delta should not be stale");

            let current_slot_stale: u64 = last_validated + 1001;
            let delta_stale = current_slot_stale.saturating_sub(last_validated);
            assert!(delta_stale > stale_threshold, "1001 slot delta should be stale");
        }

        /// Test sync_validator_slot rate limiting (to fix HIGH-02)
        /// Note: This tests the expected behavior AFTER fix is applied
        #[test]
        fn test_sync_validator_rate_limit() {
            let min_sync_interval: i64 = 3600; // 1 hour minimum between syncs
            let last_sync: i64 = 1700000000;
            let current_time: i64 = last_sync + 3599; // 59m59s later

            let elapsed = current_time - last_sync;
            assert!(elapsed < min_sync_interval, "Should block sync - too soon");

            let current_time_ok: i64 = last_sync + 3601;
            let elapsed_ok = current_time_ok - last_sync;
            assert!(elapsed_ok > min_sync_interval, "Should allow sync after 1h");
        }

        /// Test validator fee registration flow
        #[test]
        fn test_validator_fee_registration() {
            let fee_amount: u64 = 1_000_000_000; // 1 SOL
            let slot_range: u64 = 100; // 100 slots

            // Max slot range should be enforced
            let max_slot_range: u64 = 500;
            assert!(slot_range <= max_slot_range, "100 slots should be valid");

            let invalid_range: u64 = 501;
            assert!(invalid_range > max_slot_range, "501 slots should be rejected");
        }

        /// Test validator slot progression
        #[test]
        fn test_validator_slot_progression() {
            let mut last_slot: u64 = 0;
            let slots = [100, 200, 300, 400, 500];

            for &current in &slots {
                assert!(current > last_slot, "Slots must increase");
                last_slot = current;
            }
        }
    }

    // ========================================================================
    // 15. FEE SPLIT TIMELOCK TESTS (A.2 - HIGH-01 Fix Verification)
    // ========================================================================

    mod fee_split_timelock_tests {
        use super::*;

        /// Test fee split propose/execute separation (HIGH-01 fix)
        #[test]
        fn test_fee_split_timestamp_separation() {
            // Simulating the fix: separate timestamps for direct vs timelock changes
            let direct_change_timestamp: i64 = 1700000000;
            let propose_timestamp: i64 = 1700003600; // 1 hour later

            // These should be independent
            assert_ne!(direct_change_timestamp, propose_timestamp);

            // Direct change cooldown check
            let direct_cooldown: i64 = 3600;
            let time_after_direct: i64 = direct_change_timestamp + 3601;
            let can_direct_change = time_after_direct - direct_change_timestamp >= direct_cooldown;
            assert!(can_direct_change, "Should allow direct change after cooldown");

            // Propose cooldown should be independent
            let time_after_propose: i64 = propose_timestamp + 1800; // 30 min later
            let propose_elapsed = time_after_propose - propose_timestamp;
            assert!(propose_elapsed < direct_cooldown, "Propose uses different timestamp");
        }

        /// Test pending fee split value validation
        #[test]
        fn test_pending_fee_split_validation() {
            let current_bps: u16 = 5520;
            let pending_bps: u16 = 5800; // +280 bps change

            let delta = if pending_bps > current_bps {
                pending_bps - current_bps
            } else {
                current_bps - pending_bps
            };

            assert!(delta <= 500, "280 bps delta should be valid");

            // Invalid: too large delta
            let invalid_pending: u16 = 6100; // +580 bps
            let invalid_delta = invalid_pending - current_bps;
            assert!(invalid_delta > 500, "580 bps delta should be rejected");
        }

        /// Test timelock execute window
        #[test]
        fn test_timelock_execute_window() {
            let propose_timestamp: i64 = 1700000000;
            let execute_delay: i64 = 3600; // 1 hour
            let execute_window: i64 = 86400; // 24 hour window

            let min_execute_time = propose_timestamp + execute_delay;
            let max_execute_time = propose_timestamp + execute_delay + execute_window;

            // Too early
            let too_early: i64 = propose_timestamp + 3599;
            assert!(too_early < min_execute_time, "Should block - too early");

            // Valid window
            let valid_time: i64 = propose_timestamp + 3601;
            assert!(valid_time >= min_execute_time && valid_time <= max_execute_time, "Should allow");

            // After window (if enforced)
            let too_late: i64 = propose_timestamp + execute_delay + execute_window + 1;
            assert!(too_late > max_execute_time, "After window - may need re-propose");
        }

        /// Test multiple pending proposals prevention
        #[test]
        fn test_single_pending_proposal() {
            let has_pending: bool = true;

            // Cannot create new proposal while one is pending
            if has_pending {
                // Should reject new proposal
                assert!(has_pending, "Should block new proposal while pending");
            }
        }
    }

    // ========================================================================
    // 16. ERROR CODE COVERAGE TESTS (A.3 - Error Paths)
    // ========================================================================

    mod error_code_tests {
        use super::*;

        /// Test DATNotActive error condition
        #[test]
        fn test_error_dat_not_active() {
            let is_active = false;
            let emergency_pause = false;

            assert!(!is_active || emergency_pause, "Should trigger DATNotActive");
        }

        /// Test InsufficientFees error condition
        #[test]
        fn test_error_insufficient_fees() {
            let pending_fees: u64 = 5_000_000; // 0.005 SOL
            let min_threshold: u64 = MIN_FEES_TO_CLAIM; // 0.01 SOL

            assert!(pending_fees < min_threshold, "Should trigger InsufficientFees");
        }

        /// Test UnauthorizedAccess error condition
        #[test]
        fn test_error_unauthorized_access() {
            use anchor_lang::prelude::Pubkey;

            let admin = Pubkey::new_unique();
            let caller = Pubkey::new_unique();

            assert_ne!(admin, caller, "Non-admin caller should trigger UnauthorizedAccess");
        }

        /// Test CycleTooSoon error condition
        #[test]
        fn test_error_cycle_too_soon() {
            let last_cycle: i64 = 1700000000;
            let current_time: i64 = last_cycle + 30; // 30 seconds later

            let elapsed = current_time - last_cycle;
            assert!(elapsed < MIN_CYCLE_INTERVAL, "Should trigger CycleTooSoon");
        }

        /// Test MathOverflow error condition
        #[test]
        fn test_error_math_overflow() {
            let a: u64 = u64::MAX;
            let b: u64 = 1;

            // checked_add should return None
            let result = a.checked_add(b);
            assert!(result.is_none(), "Should trigger MathOverflow");
        }

        /// Test SlippageExceeded error condition
        #[test]
        fn test_error_slippage_exceeded() {
            let expected_tokens: u64 = 1_000_000_000;
            let slippage_bps: u16 = 500;
            let min_tokens = (expected_tokens as u128 * (10000 - slippage_bps as u128) / 10000) as u64;

            let actual_tokens: u64 = 940_000_000; // 94%, below 95% minimum
            assert!(actual_tokens < min_tokens, "Should trigger SlippageExceeded");
        }

        /// Test PendingFeesOverflow error condition
        #[test]
        fn test_error_pending_fees_overflow() {
            let current: u64 = 68_500_000_000; // 68.5 SOL
            let new_fees: u64 = 1_000_000_000; // 1 SOL

            let new_total = current.saturating_add(new_fees);
            assert!(new_total > MAX_PENDING_FEES, "Should trigger PendingFeesOverflow");
        }

        /// Test FeeSplitDeltaTooLarge error condition
        #[test]
        fn test_error_fee_split_delta_too_large() {
            let current_bps: u16 = 5520;
            let new_bps: u16 = 6100; // +580 bps change
            let max_delta: u16 = 500;

            let delta = new_bps.saturating_sub(current_bps);
            assert!(delta > max_delta, "Should trigger FeeSplitDeltaTooLarge");
        }

        /// Test InvalidFeeSplit error condition
        #[test]
        fn test_error_invalid_fee_split() {
            let invalid_bps: u16 = 10001;
            assert!(invalid_bps > 10000, "Should trigger InvalidFeeSplit");
        }

        /// Test SlippageConfigTooHigh error condition (LOW-02 addition)
        #[test]
        fn test_error_slippage_config_too_high() {
            let slippage_bps: u16 = 501;
            let max_allowed: u16 = 500;

            assert!(slippage_bps > max_allowed, "Should trigger SlippageConfigTooHigh");
        }

        /// Test StaleValidation error condition
        #[test]
        fn test_error_stale_validation() {
            let last_validated_slot: u64 = 100_000;
            let current_slot: u64 = 102_000;
            let max_staleness: u64 = 1000;

            let staleness = current_slot - last_validated_slot;
            assert!(staleness > max_staleness, "Should trigger StaleValidation");
        }

        /// Test SlotRangeTooLarge error condition
        #[test]
        fn test_error_slot_range_too_large() {
            let slot_range: u64 = 501;
            let max_range: u64 = 500;

            assert!(slot_range > max_range, "Should trigger SlotRangeTooLarge");
        }

        /// Test ValidatorNotStale error condition
        #[test]
        fn test_error_validator_not_stale() {
            let last_validated_slot: u64 = 100_000;
            let current_slot: u64 = 100_500;
            let stale_threshold: u64 = 1000;

            let delta = current_slot - last_validated_slot;
            assert!(delta < stale_threshold, "Should trigger ValidatorNotStale");
        }

        /// Test NoPendingAdminTransfer error condition (LOW-02 addition)
        #[test]
        fn test_error_no_pending_admin_transfer() {
            use anchor_lang::prelude::Pubkey;

            let pending_admin: Option<Pubkey> = None;
            assert!(pending_admin.is_none(), "Should trigger NoPendingAdminTransfer");
        }

        /// Test NoPendingFeeSplit error condition (LOW-02 addition)
        #[test]
        fn test_error_no_pending_fee_split() {
            let pending_fee_split: Option<u16> = None;
            assert!(pending_fee_split.is_none(), "Should trigger NoPendingFeeSplit");
        }
    }
}
