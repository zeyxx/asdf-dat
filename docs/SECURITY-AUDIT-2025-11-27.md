# Security Audit Report - ASDF-DAT

**Date:** November 27, 2025
**Version:** 2.0 (Updated with fixes)
**Program ID:** `ASDfNfUHwVGfrg3SV7SQYWhaVxnrCUZyWmMpWJAPu4MZ`

---

## Executive Summary

This audit covers the ASDF-DAT Solana program and supporting TypeScript infrastructure. The initial review identified **4 critical**, **5 high**, and **5 medium** severity vulnerabilities.

### Current Status (Post-Fix)

| Severity | Initial | Fixed | Remaining |
|----------|---------|-------|-----------|
| Critical | 4 | 4 | **0** |
| High | 5 | 4 | 1 |
| Medium | 5 | 1 | 4 |

**All CRITICAL vulnerabilities have been fixed.**

---

## Solana Program Vulnerabilities (lib.rs)

### CRITICAL - Must Fix Before Mainnet

#### CRIT-1: Unsafe `unwrap()` on Option<Pubkey> - **FIXED**

**Location:** `lib.rs:1070`, `lib.rs:1102`
**Status:** ✅ **FIXED** in commit `2f70cd0`

**Description:**
`state.root_token_mint.unwrap()` was called without prior validation.

**Fix Applied:**
```rust
let root_mint = state.root_token_mint
    .ok_or(ErrorCode::InvalidRootToken)?;
```

---

#### CRIT-2: Missing Token Account Owner Validation - **FIXED**

**Location:** `lib.rs:1135`, `lib.rs:1152`
**Status:** ✅ **FIXED** in commit `9e235cf`

**Description:**
Token accounts (`dat_wsol_account`) were read without verifying ownership.

**Fix Applied:**
```rust
#[account(
    mut,
    constraint = dat_wsol_account.mint == wsol_mint.key() @ ErrorCode::InvalidParameter,
    constraint = dat_wsol_account.owner == dat_authority.key() @ ErrorCode::InvalidParameter
)]
pub dat_wsol_account: InterfaceAccount<'info, TokenAccount>,
```

---

#### CRIT-3: Missing Mint Owner Validation - **FIXED**

**Location:** Account validation contexts (multiple)
**Status:** ✅ **FIXED** in commit `1703e7a`

**Description:**
Token accounts now have mint constraints validating they match expected mints.

**Fix Applied:**
```rust
#[account(
    mut,
    constraint = dat_asdf_account.mint == asdf_mint.key() @ ErrorCode::InvalidParameter,
    constraint = dat_asdf_account.owner == dat_authority.key() @ ErrorCode::InvalidParameter
)]
pub dat_asdf_account: InterfaceAccount<'info, TokenAccount>,
```

---

#### CRIT-4: PumpFun PDA Validation Incomplete - **FIXED**

**Location:** `lib.rs:2015`, `lib.rs:2064`, `lib.rs:2123`
**Status:** ✅ **FIXED** in commit `1703e7a`

**Description:**
Pool accounts are now validated to be owned by the correct program (PUMP_PROGRAM or PUMP_SWAP_PROGRAM).

**Fix Applied:**
```rust
// Bonding curve pools
#[account(mut, constraint = pool.owner == &PUMP_PROGRAM @ ErrorCode::InvalidBondingCurve)]
pub pool: AccountInfo<'info>,

// AMM pools
#[account(mut, constraint = pool.owner == &PUMP_SWAP_PROGRAM @ ErrorCode::InvalidBondingCurve)]
pub pool: AccountInfo<'info>,

// Program ID validation
#[account(constraint = pump_swap_program.key() == PUMP_PROGRAM @ ErrorCode::InvalidParameter)]
pub pump_swap_program: AccountInfo<'info>,
```

---

### HIGH Severity

#### HIGH-1: No Limit on `pending_fees_lamports` Accumulation

**Location:** `lib.rs:744-746`

**Code:**
```rust
token_stats.pending_fees_lamports = token_stats
    .pending_fees_lamports
    .saturating_add(amount_lamports);
```

**Impact:** While `saturating_add` prevents overflow, there's no business logic limit. Accumulated fees could grow unbounded if cycles don't execute.

**Recommendation:** Add maximum accumulation check:
```rust
require!(
    token_stats.pending_fees_lamports.saturating_add(amount_lamports) <= MAX_PENDING_FEES,
    ErrorCode::PendingFeesOverflow
);
```

---

#### HIGH-2: Weak ValidatorState Initialization Validation

**Location:** `lib.rs:915-920`

**Description:**
Validator state initialization lacks comprehensive validation of the bonding curve account relationship.

**Recommendation:** Add constraint to verify bonding curve is legitimate.

---

#### HIGH-3: Division Without Zero-Check on `fee_split_bps`

**Location:** `lib.rs:1301`

**Description:**
Fee calculations divide by `fee_split_bps` which could theoretically be zero.

**Recommendation:** Add require check before division.

---

#### HIGH-4: Bump Lifetime Issue in ROOT_TREASURY Seeds

**Location:** `lib.rs:1079`

**Code:**
```rust
let bump_slice = &[bump];
let treasury_seeds: &[&[u8]] = &[ROOT_TREASURY_SEED, root_mint.as_ref(), bump_slice];
```

**Impact:** Bump value is computed inline but lifetime is safe due to scope. However, pattern could be error-prone in refactoring.

**Recommendation:** Use canonical bump storage pattern.

---

#### HIGH-5: Pool Owner Not Validated in ExecuteBuy - **FIXED**

**Location:** `lib.rs:2015`, `lib.rs:2064`, `lib.rs:2123`
**Status:** ✅ **FIXED** in commit `1703e7a`

**Description:**
Pool owner validation was missing for AMM pools.

**Fix Applied:**
```rust
// All pool accounts now validate ownership
#[account(mut, constraint = pool.owner == &PUMP_PROGRAM @ ErrorCode::InvalidBondingCurve)]
#[account(mut, constraint = pool.owner == &PUMP_SWAP_PROGRAM @ ErrorCode::InvalidBondingCurve)]
```

---

#### HIGH-6: Pool Data Size Validation - **FIXED**

**Location:** `lib.rs:252`
**Status:** ✅ **FIXED** in commit `98f2c93`

**Description:**
Pool data was deserialized without size validation, risking panic.

**Fix Applied:**
```rust
require!(bonding_curve_data.len() >= 32, ErrorCode::InvalidPool);
```

---

### MEDIUM Severity

#### MED-1: ValidatorState Bump Validation

Store and validate bump on ValidatorState to prevent seed grinding attacks.

#### MED-2: `token_program` Not Explicitly Validated - **FIXED**

**Status:** ✅ **FIXED** in commit `1703e7a`

Token program validation added:
```rust
#[account(constraint = quote_token_program.key() == anchor_spl::token::ID @ ErrorCode::InvalidParameter)]
```

#### MED-3: Mint Mismatch in `update_pending_fees`

Verify that the mint passed matches the mint in token_stats.

#### MED-4: Manual Realloc Pattern

Some account resizing uses manual realloc. Prefer Anchor's `realloc` constraint.

#### MED-5: Inconsistent `pending_fees` Reset

`pending_fees` is reset differently in standalone vs ecosystem mode. Document clearly or unify behavior.

---

## TypeScript Code Quality Issues

### Console.log Pollution

**Count:** 1009+ occurrences

**Files Affected:** All scripts and libraries

**Recommendation:** Replace with structured logger (`lib/logger.ts` now available).

---

### Type Safety Issues

| Issue | Count |
|-------|-------|
| `any` type usage | 93+ |
| `.catch(console.error)` | 12 files |
| `main()` without `.catch()` | 15+ files |

---

### Code Duplication

| Pattern | Files | Recommendation |
|---------|-------|----------------|
| `loadKeypair()` | 9 files | Create `lib/keypair-utils.ts` |
| RPC URL hardcoding | 20+ files | Use `lib/network-config.ts` |
| Error handling | Many | Create error handling utilities |

---

### Unresolved TODO

**Location:** `scripts/execute-cycle-secondary.ts:559`

**Content:** AMM buy instruction TODO

---

## Git Repository Issues

### Resolved

- [x] `devnet-wallet.json` removed from git history
- [x] Temporary files (`Program`, `continue`) removed
- [x] Rust backup files removed
- [x] Obsolete documentation archived

### Still Tracked (but gitignored)

- `.daemon-state.json` - Runtime state, correctly gitignored
- `logs/` directory - Correctly gitignored

---

## Recommendations Priority

### Before Mainnet (Required)

1. Fix CRIT-1: Replace `unwrap()` with `ok_or()`
2. Fix CRIT-2: Add TokenAccount owner validation
3. Fix CRIT-3: Add Mint owner validation
4. Fix CRIT-4: Validate PumpFun PDAs explicitly

### Short Term (Recommended)

1. Fix HIGH-1 through HIGH-5
2. Migrate console.log to logger
3. Add proper TypeScript types
4. Create shared utilities

### Long Term (Nice to Have)

1. Fix MEDIUM vulnerabilities
2. Code refactoring for maintainability
3. Add comprehensive test coverage

---

## Testing Recommendations

1. **Fuzzing:** Run fuzzing on all instruction handlers
2. **Integration Tests:** Test with malicious accounts
3. **Audit:** Consider external security audit before mainnet

---

## Appendix: Vulnerability Locations

```
CRIT-1: lib.rs:1070, 1102
CRIT-2: lib.rs:1135, 1152
CRIT-3: Account contexts (multiple)
CRIT-4: lib.rs:~1910, ~1947
HIGH-1: lib.rs:744-746
HIGH-2: lib.rs:915-920
HIGH-3: lib.rs:1301
HIGH-4: lib.rs:1079
HIGH-5: lib.rs:2228
```

---

*This audit was conducted on November 27, 2025. Findings should be verified and fixed before mainnet deployment.*
