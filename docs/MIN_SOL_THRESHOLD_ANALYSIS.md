# Minimum SOL Threshold Analysis for Cycles

## Executive Summary

The initial threshold of **0.19 SOL** was oversized for mainnet (root token only).

**Chosen values**:
- **Mainnet**: 0.019 SOL (root token only, PumpSwap AMM)
- **Devnet**: 0.006 SOL (MIN_FEES_FOR_SPLIT + margin for testing)

---

## On-Chain Constraints (lib.rs)

### Program Constants

| Constant | Value | SOL | Description |
|----------|-------|-----|-------------|
| `MIN_FEES_TO_CLAIM` | 10,000,000 | 0.01 | Minimum vault threshold (configurable via DATState) |
| `MIN_FEES_FOR_SPLIT` | 5,500,000 | 0.0055 | Minimum for `execute_buy_secondary` |
| `RENT_EXEMPT_MINIMUM` | 890,880 | 0.00089 | datAuthority account rent |
| `SAFETY_BUFFER` | 50,000 | 0.00005 | Safety margin |
| `ATA_RENT_RESERVE` | 2,100,000 | 0.0021 | Rent for ATA creation |
| `MINIMUM_BUY_AMOUNT` | 100,000 | 0.0001 | Minimum buyback amount |

### Validation Logic (execute_buy_secondary)

```rust
// Line 1275 - Main check
require!(available >= MIN_FEES_FOR_SPLIT, ErrorCode::InsufficientFees);
// available = allocated_lamports OR datAuthority.balance - RENT - SAFETY

// Line 1294 - Calculate buy_amount after split
buy_amount = (allocated * 0.552) - ATA_RENT_RESERVE;

// Line 1297 - Final check
require!(buy_amount >= MINIMUM_BUY_AMOUNT, ErrorCode::InsufficientFees);
```

---

## Real Minimum Calculations

### Scenario 1: Root Token Only (Current Mainnet Config)

**Configuration**: `mainnet-token-root.json` - PumpSwap AMM

```
Flow:
Creator Vault (WSOL) → collect_fees_amm → unwrap_wsol → execute_buy_amm → burn

Costs:
┌─────────────────────────────────────────────────────────────┐
│ Component                         │ Lamports    │ SOL       │
├───────────────────────────────────┼─────────────┼───────────┤
│ MIN_FEES_FOR_SPLIT (check)        │ 5,500,000   │ 0.0055    │
│ RENT_EXEMPT_MINIMUM (reserve)     │   890,880   │ 0.00089   │
│ SAFETY_BUFFER                     │    50,000   │ 0.00005   │
│ MINIMUM_BUY_AMOUNT                │   100,000   │ 0.0001    │
├───────────────────────────────────┼─────────────┼───────────┤
│ Subtotal required fees            │ 6,540,880   │ ~0.0065   │
├───────────────────────────────────┼─────────────┼───────────┤
│ TX fees (4 TX × ~5000 lamports)   │   ~50,000   │ ~0.0001   │
│ Compute budget (mainnet)          │  ~500,000   │ ~0.0005   │
│ Priority fees (estimated)         │  ~500,000   │ ~0.0005   │
├───────────────────────────────────┼─────────────┼───────────┤
│ Subtotal TX fees                  │ ~1,050,000  │ ~0.001    │
├───────────────────────────────────┼─────────────┼───────────┤
│ TOTAL MINIMUM (Root only)         │ ~7,600,000  │ ~0.0076   │
│ With safety margin (+50%)         │ ~11,400,000 │ ~0.0114   │
└───────────────────────────────────┴─────────────┴───────────┘
```

**Recommended minimum (root only)**: **0.012 SOL**

---

### Scenario 2: Root + 1 Secondary (Bonding Curve)

```
Secondary Flow:
1. collect_fees → datAuthority receives SOL
2. execute_buy_secondary:
   - 44.8% → root_treasury
   - 55.2% → secondary buyback
3. finalize_allocated_cycle
4. burn_and_update

Then Root:
5. root_treasury balance → root buyback
6. burn_and_update

Costs:
┌─────────────────────────────────────────────────────────────┐
│ Component                         │ Lamports    │ SOL       │
├───────────────────────────────────┼─────────────┼───────────┤
│ Secondary MIN_FEES_FOR_SPLIT      │ 5,500,000   │ 0.0055    │
│   → 44.8% to root                 │ 2,464,000   │ 0.00246   │
│   → 55.2% for secondary           │ 3,036,000   │ 0.00304   │
│   → minus ATA_RENT_RESERVE        │-2,100,000   │-0.0021    │
│   → buy_amount secondary          │   936,000   │ 0.00094   │
├───────────────────────────────────┼─────────────┼───────────┤
│ Root cycle (from treasury)        │ 2,464,000   │ 0.00246   │
│   → Check >= MIN_FEES_FOR_SPLIT   │   FAIL!     │           │
└───────────────────────────────────┴─────────────┴───────────┘

PROBLEM: 44.8% of 0.0055 = 0.00246 SOL < MIN_FEES_FOR_SPLIT (0.0055)
```

**Solution**: Secondary must generate enough so root has MIN_FEES_FOR_SPLIT:

```
root_treasury_needed = MIN_FEES_FOR_SPLIT = 0.0055 SOL
secondary_allocation = root_treasury_needed / 0.448 = 0.01228 SOL

Final calculation:
┌─────────────────────────────────────────────────────────────┐
│ Component                         │ Lamports    │ SOL       │
├───────────────────────────────────┼─────────────┼───────────┤
│ Secondary minimum allocation      │ 12,280,000  │ 0.01228   │
│   → 44.8% to root (= 0.0055)      │  5,500,000  │ 0.0055    │
│   → 55.2% for secondary           │  6,780,000  │ 0.00678   │
│   → minus ATA_RENT_RESERVE        │ -2,100,000  │-0.0021    │
│   → buy_amount secondary          │  4,680,000  │ 0.00468   │
├───────────────────────────────────┼─────────────┼───────────┤
│ Root cycle (MIN_FEES_FOR_SPLIT)   │  5,500,000  │ 0.0055    │
├───────────────────────────────────┼─────────────┼───────────┤
│ TX fees (6 TX + compute)          │  2,000,000  │ 0.002     │
├───────────────────────────────────┼─────────────┼───────────┤
│ TOTAL MINIMUM (1 secondary)       │ 14,280,000  │ ~0.0143   │
│ With safety margin (+50%)         │ 21,420,000  │ ~0.0214   │
└───────────────────────────────────┴─────────────┴───────────┘
```

**Recommended minimum (root + 1 secondary)**: **0.022 SOL**

---

### Scenario 3: Root + N Secondaries

General formula:

```
MIN_TOTAL = N × MIN_ALLOCATION_SECONDARY + TX_FEES

where:
  MIN_ALLOCATION_SECONDARY = 5,690,000 lamports (~0.00569 SOL)
  TX_FEES = (N + 1) × 1,000,000 lamports (~0.001 SOL/token)

Examples:
┌──────────────────────────────────────────────────────────────┐
│ N Secondaries │ Min Allocation  │ TX Fees   │ Total Min      │
├───────────────┼─────────────────┼───────────┼────────────────┤
│ 1             │ 0.00569 SOL     │ 0.002 SOL │ 0.008 SOL      │
│ 2             │ 0.01138 SOL     │ 0.003 SOL │ 0.015 SOL      │
│ 3             │ 0.01707 SOL     │ 0.004 SOL │ 0.021 SOL      │
│ 5             │ 0.02845 SOL     │ 0.006 SOL │ 0.035 SOL      │
│ 10            │ 0.0569 SOL      │ 0.011 SOL │ 0.068 SOL      │
└──────────────────────────────────────────────────────────────┘

With safety margin (+50%):
┌──────────────────────────────────────────────────────────────┐
│ N Secondaries │ Recommended Minimum                          │
├───────────────┼──────────────────────────────────────────────┤
│ 1             │ 0.012 SOL                                    │
│ 2             │ 0.023 SOL                                    │
│ 3             │ 0.032 SOL                                    │
│ 5             │ 0.053 SOL                                    │
│ 10            │ 0.102 SOL                                    │
└──────────────────────────────────────────────────────────────┘
```

---

## Why 0.19 SOL Was Too High

The old threshold of 0.19 SOL would correspond to:
- **~18 secondary tokens** with current minimums
- **Or** a safety margin of **~600%** for 3 tokens

### Probable Origin

The 0.19 SOL was likely calculated with conservative assumptions:
1. Buffer for mainnet TX fee volatility
2. Buffer for failed transactions + retries
3. Provision for multiple ATA creations
4. Large error margin

---

## Recommendations

### Dynamic Configuration

```typescript
// src/bot.ts - Suggested configuration
const CONFIG = {
  // Base minimums (from on-chain constants)
  MIN_FEES_FOR_SPLIT: 0.0055,  // Program constant

  // Per-token costs
  MIN_ALLOCATION_SECONDARY: 0.006,  // Rounded up from 0.00569
  TX_FEE_PER_TOKEN: 0.002,          // Conservative mainnet estimate

  // Calculate dynamic threshold
  getMinThreshold(secondaryCount: number): number {
    const baseMinimum = secondaryCount * this.MIN_ALLOCATION_SECONDARY;
    const txFees = (secondaryCount + 1) * this.TX_FEE_PER_TOKEN;
    const safetyMargin = 1.5; // 50% buffer
    return (baseMinimum + txFees) * safetyMargin;
  }
};

// Usage examples:
// Root only:        CONFIG.getMinThreshold(0) = 0.003 SOL (TX only)
// Root + 1 sec:     CONFIG.getMinThreshold(1) = 0.018 SOL
// Root + 3 sec:     CONFIG.getMinThreshold(3) = 0.039 SOL
```

### Recommended Values by Scenario

| Configuration | Strict Minimum | Recommended (50% margin) |
|---------------|----------------|--------------------------|
| Root only (AMM) | 0.008 SOL | **0.012 SOL** |
| Root + 1 secondary | 0.015 SOL | **0.023 SOL** |
| Root + 2 secondaries | 0.022 SOL | **0.033 SOL** |
| Root + 3 secondaries | 0.029 SOL | **0.044 SOL** |

### For Phase 1 ($asdfasdfa only)

If currently only the root token ($asdfasdfa) is configured:

**Chosen threshold: 0.019 SOL** (instead of 0.19 SOL)

This represents:
- MIN_FEES_FOR_SPLIT + rent reserves + TX fees
- Safety margin of ~150%
- **90% reduction** from the old threshold
- Parameter modifiable at any time (TypeScript config, not on-chain)

---

## Files Modified

1. **`src/bot.ts`** line 43:
   ```typescript
   MIN_FEES_TO_CLAIM: 0.019, // SOL (~0.015 minimum + safety margin)
   ```

2. **`src/dashboard.ts`** line 251:
   ```typescript
   <span class="font-medium">0.019 SOL</span>
   ```

**Note**: These parameters are purely TypeScript, modifiable at any time without on-chain redeployment.

---

## Validation Tests

Before mainnet deployment with the new threshold:

```bash
# 1. Check current state
npx ts-node scripts/check-dat-state.ts --network mainnet

# 2. Simulate a cycle with the new threshold
# Vault must have >= 0.019 SOL

# 3. Monitor real TX fees over several cycles
# Adjust if mainnet fees are higher than expected
```

---

## Conclusion

| Aspect | Old (0.19 SOL) | New |
|--------|----------------|-----|
| Mainnet (root only) | Overkill × 10 | **0.019 SOL** |
| Devnet (tests) | - | **0.006 SOL** |
| Efficiency | Unnecessarily delayed cycles | More frequent cycles |

---

## Mainnet Threshold Update Procedure

### Prerequisites

1. Mainnet admin wallet configured (`mainnet-wallet.json`)
2. Sufficient SOL for TX fees (~0.001 SOL)
3. Access to the wallet that initialized DATState

### Steps

#### 1. Check Current State

```bash
npx ts-node scripts/check-dat-state.ts --network mainnet
```

Expected output:
```
min_fees_threshold: 0.01 SOL (or current value)
```

#### 2. Modify Threshold (if custom value needed)

Edit `scripts/update-dat-config.ts` line 53:
```typescript
const newMinFees = isMainnet ? 19_000_000 : 6_000_000; // lamports
//                            ^^^^^^^^^^
//                            Modify this value (in lamports)
```

Conversion: `SOL × 1,000,000,000 = lamports`
- 0.019 SOL = 19,000,000 lamports
- 0.05 SOL = 50,000,000 lamports

#### 3. Execute Update

```bash
npx ts-node scripts/update-dat-config.ts --network mainnet
```

Expected output:
```
📝 Updating DAT configuration...

   Network: Mainnet
   New min_fees_threshold: 0.019 SOL (19,000,000 lamports)

✅ Configuration updated!
🔗 TX: https://explorer.solana.com/tx/...
```

#### 4. Verify Change

```bash
npx ts-node scripts/check-dat-state.ts --network mainnet
```

### Important Notes

- **Only the admin** of DATState can modify this parameter
- The change is **immediate** after TX confirmation
- **No program redeployment** required
- The bot (`src/bot.ts`) also has its own client-side threshold to synchronize

### When to Adjust the Threshold

| Situation | Action |
|-----------|--------|
| Adding secondary tokens | Increase proportionally |
| High mainnet TX fees | Increase margin |
| Cycles fail with "InsufficientFees" | Check and adjust |
| Optimization after stabilization | Reduce if margin excessive |
