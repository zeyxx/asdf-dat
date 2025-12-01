# ASDF-DAT Ecosystem - Architectural Issues Audit

**Date:** 2025-11-25
**Status:** Issues Identified - Requires Resolution
**Network:** Devnet

---

## Executive Summary

This document presents a comprehensive audit of the ASDF-DAT ecosystem architecture, identifying critical issues preventing proper multi-token operation on devnet. The ecosystem consists of 3 tokens sharing a single PumpFun creator vault:

| Token | Type | Program |
|-------|------|---------|
| DATSPL | ROOT | SPL Token |
| DATS2 | Secondary | SPL Token |
| DATM | Secondary | Token2022 (Mayhem) |

**Core Finding:** The system is NOT viable for multi-token ecosystems with shared PumpFun vaults due to fundamental architectural conflicts.

---

## Issue #1: Shared PumpFun Creator Vault

### Severity: CRITICAL

### Description
PumpFun design creates ONE creator vault per wallet address. All tokens created by the same wallet share this single vault. The first `collectFees` call takes ALL accumulated fees, leaving nothing for subsequent tokens.

### Location
- PumpFun Program: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`
- Creator Vault PDA: `[Buffer.from("creator-vault"), creator.toBuffer()]`

### Impact
- Independent cycle execution fails for 2nd and 3rd tokens
- Fees cannot be attributed per-token
- `pending_fees` in `tokenStats` does NOT reflect actual vault balance

### Current Workaround Attempted
Orchestration pattern with single collect + proportional allocation. This partially works but introduces Issues #2-#4.

### Recommended Solution
**Option A (Complex):** Deploy separate creator wallets per token
**Option B (Medium):** Implement on-chain orchestrator that holds fees and distributes atomically
**Option C (Simple):** Accept single-token limitation

---

## Issue #2: Collect All, Distribute Later Pattern

### Severity: HIGH

### Description
The orchestration pattern collects ALL vault fees in step 1, but secondary tokens split 44.8% to root DURING their buy step (step 4-5). This creates a timing mismatch.

### Location
```
scripts/complete-ecosystem-test.ts:
  - collectAllVaultFees() at line ~197
  - executeCycleWithAllocation() at line ~543

programs/asdf-dat/src/lib.rs:
  - split_fees_to_root() called during execute_buy (line 716)
```

### Flow Diagram
```
Step 1: collectAllVaultFees() → 0.054 SOL to datAuthority
Step 2: calculateProportionalAllocations() → DATS2: 0.027, DATM: 0.027
Step 3: Execute DATS2 with 0.027 SOL
        ↳ split_fees_to_root: 44.8% (0.012 SOL) → root_treasury
        ↳ Remaining for buy: ~0.015 SOL
Step 4: Execute DATM with 0.027 SOL
        ↳ BUT datAuthority now has only ~0.015 SOL!
        ↳ InsufficientFees error
```

### Impact
- Pre-calculated allocations become invalid after first secondary cycle
- Second secondary always fails

### Recommended Solution
- Re-query datAuthority balance AFTER each secondary cycle
- OR implement on-chain atomic distribution

---

## Issue #3: Fee Split Before Buy Reduces Available Balance

### Severity: HIGH

### Description
For secondary tokens, `execute_buy` calls `split_fees_to_root()` BEFORE the buy operation. This transfers 44.8% of available balance to root_treasury, reducing what's available for the actual buy.

### Location
```rust
// programs/asdf-dat/src/lib.rs:702-738
if is_secondary_token {
    // Validates MIN_FEES_FOR_SPLIT (0.0055 SOL)
    if available_lamports < MIN_FEES_FOR_SPLIT {
        return err!(ErrorCode::InsufficientFees);
    }

    // Splits 44.8% BEFORE buy
    let sol_for_root = split_fees_to_root(..., available_lamports, state.fee_split_bps, ...)?;
}
```

### Constants
```rust
const MIN_FEES_FOR_SPLIT: u64 = 5_500_000;  // 0.0055 SOL minimum
const ATA_RENT_RESERVE: u64 = 2_100_000;    // ~0.0021 SOL
const RENT_EXEMPT_MINIMUM: u64 = 890_880;   // ~0.00089 SOL
const SAFETY_BUFFER: u64 = 50_000;          // 0.00005 SOL
```

### Impact
- Minimum viable allocation per secondary: ~0.0055 SOL
- After split: only ~55.2% remains for buy
- Two secondaries need: 2 × 0.0055 = 0.011 SOL minimum

### Recommended Solution
- Consider split AFTER buy (but complicates atomicity)
- OR increase minimum fee threshold dynamically based on token count

---

## Issue #4: root_treasury Not Re-collected Between Cycles

### Severity: MEDIUM

### Description
When DATS2 sends 44.8% to root_treasury, these funds sit there unused. DATSPL (root) runs last but doesn't re-collect from root_treasury - it only uses datAuthority balance.

### Location
```typescript
// scripts/complete-ecosystem-test.ts - runCompleteTest()
// PHASE 5: ROOT cycle LAST
report.cycleResults['DATSPL'] = await this.executeCycleWithAllocation('DATSPL', null);
// Uses remaining datAuthority balance, NOT root_treasury
```

### Impact
- Root token doesn't benefit from secondary splits within same orchestration run
- Funds accumulate in root_treasury but require separate cycle to use

### Recommended Solution
- Add root_treasury → datAuthority transfer before root buy
- OR modify root cycle to read from root_treasury

---

## Issue #5: `for_ecosystem` Parameter Misleading

### Severity: LOW

### Description
The `for_ecosystem=true` parameter on `collectFees` preserves `pending_fees` in tokenStats. However, this value represents HISTORICAL fees for that token, not ACTUAL vault balance.

### Location
```rust
// programs/asdf-dat/src/lib.rs - collect_fees instruction
if !for_ecosystem {
    token_stats.pending_fees = 0;  // Only reset if NOT ecosystem mode
}
```

### Impact
- `pending_fees` cannot be used for proportional allocation
- Creates false impression that per-token attribution exists

### Current State
Test code already handles this by distributing equally when pending_fees is 0:
```typescript
// calculateProportionalAllocations()
if (totalPendingFees === 0) {
    const equalShare = Math.floor(totalCollected / tokenKeys.length);
    // ...
}
```

### Recommended Solution
- Rename parameter to clarify purpose
- OR implement actual per-token fee tracking on-chain

---

## Issue #6: Preset Allocations Become Obsolete

### Severity: LOW

### Description
The `allocated_lamports` parameter in `execute_buy` allows passing a preset amount. However, after the first secondary cycle executes its split, the remaining balance changes, making preset allocations for subsequent tokens inaccurate.

### Location
```rust
// programs/asdf-dat/src/lib.rs:693-700
let available_lamports = match allocated_lamports {
    Some(allocated) => allocated,  // Uses preset (may be stale)
    None => {
        let total_balance = ctx.accounts.dat_authority.lamports();
        total_balance.saturating_sub(RENT_EXEMPT_MINIMUM + SAFETY_BUFFER)
    }
};
```

### Impact
- Orchestrator must re-query balance between each secondary cycle
- Cannot batch-call multiple secondaries atomically

### Recommended Solution
- Dynamic balance check even when `allocated_lamports` provided
- OR implement atomic multi-token instruction

---

## Issue #7: ATA_RENT_RESERVE Never Consumed

### Severity: INFO

### Description
The constant `ATA_RENT_RESERVE` (0.0021 SOL) is subtracted from available balance for secondary tokens, but observation shows ATA creation is handled by PumpFun CPI, not by datAuthority.

### Location
```rust
// programs/asdf-dat/src/lib.rs:745-748
let buy_amount = if is_secondary_token {
    remaining_balance.saturating_sub(RENT_EXEMPT_MINIMUM + SAFETY_BUFFER + ATA_RENT_RESERVE)
} else {
    remaining_balance.saturating_sub(RENT_EXEMPT_MINIMUM + SAFETY_BUFFER)
};
```

### Impact
- ~0.0021 SOL is unnecessarily withheld per secondary cycle
- Reduces actual buy amount

### Recommended Solution
- Verify if ATA creation is needed from datAuthority
- If not, remove ATA_RENT_RESERVE deduction

---

## Test Results Summary

### Test Run: 2025-11-25

| Token | Result | Error |
|-------|--------|-------|
| DATSPL | SUCCESS | - |
| DATS2 | SUCCESS | - |
| DATM | FAILED | InsufficientFees (6001) |

### Root Cause Analysis
1. Vault balance: 0.054 SOL
2. DATS2 allocation: 0.027 SOL
3. DATS2 split to root: ~0.012 SOL (44.8%)
4. Remaining in datAuthority: ~0.015 SOL
5. DATM requires: 0.0055 SOL minimum
6. DATM actual allocation: 0.027 SOL (preset, but stale)
7. DATM actual available: ~0.015 SOL (after DATS2 split)
8. Result: Allocation > Available → Program reads actual balance → Fails if < MIN_FEES

---

## Recommendations Priority

| Priority | Issue | Complexity | Effort |
|----------|-------|------------|--------|
| 1 | #1 Shared Vault | COMPLEX | High |
| 2 | #2 Collect/Distribute Timing | MEDIUM | Medium |
| 3 | #3 Split Before Buy | MEDIUM | Medium |
| 4 | #4 root_treasury Re-collection | MEDIUM | Low |
| 5 | #5 for_ecosystem Naming | SIMPLE | Low |
| 6 | #6 Stale Allocations | SIMPLE | Low |
| 7 | #7 ATA Reserve | SIMPLE | Low |

---

## Conclusion

The ASDF-DAT ecosystem faces fundamental architectural challenges when operating multiple tokens under a shared PumpFun creator vault. The current implementation works for single-token or ROOT-only scenarios, but multi-token secondary cycles fail due to:

1. **Shared vault** - Cannot attribute fees per token
2. **Sequential splits** - Each secondary reduces balance for next
3. **Stale allocations** - Pre-calculated values become invalid

### Viable Paths Forward

1. **Single-token mode**: Use only DATSPL (root), disable secondaries
2. **Separate creators**: Deploy each token from different wallets
3. **On-chain orchestrator**: Implement atomic multi-token distribution
4. **Sequential with re-query**: Accept slower execution, re-check balance after each cycle

---

*Generated by ASDF-DAT Audit - 2025-11-25*
