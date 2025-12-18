# ASDF Burn Engine - Formal Specification

Mathematical specification for formal verification and fuzzing.

---

## 1. Domain Definitions

### 1.1 Basic Types

```
Lamports    := ℕ                          -- Non-negative integers (u64)
BPS         := {x ∈ ℕ | 0 ≤ x ≤ 10000}    -- Basis points [0, 10000]
Timestamp   := ℤ                          -- Unix timestamp (i64)
Slot        := ℕ                          -- Solana slot number (u64)
Pubkey      := Bytes32                    -- 32-byte public key
```

### 1.2 Protocol Constants

```
FLUSH_THRESHOLD        := 100_000_000           -- 0.1 SOL in lamports
MIN_FEES_FOR_SPLIT     := 5_500_000             -- ~0.0055 SOL
MAX_PENDING_FEES       := 69_000_000_000        -- 69 SOL
MAX_FEES_PER_CYCLE     := 69_420_000_000_000    -- ~69,420 SOL
MIN_CYCLE_INTERVAL     := 60                    -- seconds
RENT_EXEMPT_MINIMUM    := 890_880               -- lamports
ATA_RENT_RESERVE       := 2_100_000             -- lamports
SAFETY_BUFFER          := 10_000                -- lamports

FEE_SPLIT_BPS_DEFAULT  := 5520                  -- 55.2%
FEE_SPLIT_BPS_MIN      := 1000                  -- 10%
FEE_SPLIT_BPS_MAX      := 9000                  -- 90%
FEE_SPLIT_MAX_DELTA    := 500                   -- 5% per change

DEV_FEE_BPS            := 100                   -- 1%
BURN_SHARE             := 99448                 -- 99.448%
REBATE_SHARE           := 552                   -- 0.552%
SHARE_DENOMINATOR      := 100000

SLIPPAGE_BPS_MIN       := 10                    -- 0.1%
SLIPPAGE_BPS_MAX       := 500                   -- 5%
```

---

## 2. State Definitions

### 2.1 Global State (DATState)

```
DATState := {
    admin                          : Pubkey,
    pending_admin                  : Option<Pubkey>,
    root_token_mint                : Option<Pubkey>,
    asdf_mint                      : Pubkey,
    dat_authority_bump             : u8,
    fee_split_bps                  : BPS,
    pending_fee_split              : Option<BPS>,
    pending_fee_split_timestamp    : Timestamp,
    last_direct_fee_split_timestamp: Timestamp,
    admin_operation_cooldown       : Timestamp,
    min_fees_threshold             : Lamports,
    max_fees_per_cycle             : Lamports,
    slippage_bps                   : BPS,
    min_cycle_interval             : Timestamp,
    last_cycle_timestamp           : Timestamp,
    last_cycle_sol                 : Lamports,
    last_cycle_burned              : Lamports,
    pending_burn_amount            : Lamports,
    last_sol_sent_to_root          : Lamports,
    is_active                      : Bool,
    emergency_pause                : Bool,
    failed_cycles                  : u32,
    consecutive_failures           : u32
}
```

### 2.2 Token State (TokenStats)

```
TokenStats := {
    mint                       : Pubkey,
    bump                       : u8,
    is_root_token              : Bool,
    total_burned               : Lamports,
    total_sol_used             : Lamports,
    total_sol_collected        : Lamports,
    total_sol_sent_to_root     : Lamports,
    total_sol_received_from_others : Lamports,
    total_buybacks             : u64,
    last_cycle_timestamp       : Timestamp,
    last_cycle_sol             : Lamports,
    last_cycle_burned          : Lamports,
    pending_fees_lamports      : Lamports,
    last_fee_update_timestamp  : Timestamp,
    cycles_participated        : u64
}
```

### 2.3 Validator State

```
ValidatorState := {
    mint                    : Pubkey,
    bonding_curve           : Pubkey,
    last_validated_slot     : Slot,
    total_validated_lamports: Lamports,
    total_validated_count   : u64,
    fee_rate_bps            : BPS,
    bump                    : u8
}
```

---

## 3. Core Invariants

### 3.1 Conservation of Value (INV-1)

For any token t in a cycle:

```
∀ cycle c:
    collected(c, t) = burned_value(c, t) + sent_to_root(c, t) + dev_fee(c, t) + remaining(c, t)

Where:
    collected(c, t)      := SOL collected from creator vault
    burned_value(c, t)   := SOL used for buyback (tokens then burned)
    sent_to_root(c, t)   := SOL sent to root treasury (if secondary)
    dev_fee(c, t)        := SOL sent to dev wallet (if secondary)
    remaining(c, t)      := SOL remaining in dat_authority (dust/rent)
```

### 3.2 Fee Split Correctness (INV-2)

For secondary tokens:

```
∀ secondary token t, available SOL a:

    keep_ratio      := fee_split_bps / 10000
    root_ratio      := 1 - keep_ratio

    sol_for_root    := a × root_ratio
    sol_for_burn    := a × keep_ratio - ATA_RENT_RESERVE
    dev_fee         := sol_for_burn × DEV_FEE_BPS / 10000
    actual_burn     := sol_for_burn - dev_fee

    ASSERT: sol_for_root + sol_for_burn ≤ a
    ASSERT: sol_for_root ≥ 0
    ASSERT: actual_burn ≥ 0
```

### 3.3 Root Token Independence (INV-3)

```
∀ root token r:
    sent_to_root(cycle, r) = 0
    dev_fee(cycle, r) = 0
    burned_value(cycle, r) = collected(cycle, r) + treasury_balance

Where:
    treasury_balance := balance of root_treasury PDA before cycle
```

### 3.4 Pending Fees Boundedness (INV-4)

```
∀ token t, ∀ time:
    0 ≤ t.pending_fees_lamports ≤ MAX_PENDING_FEES
```

### 3.5 Fee Split Bounds (INV-5)

```
∀ state s:
    FEE_SPLIT_BPS_MIN ≤ s.fee_split_bps ≤ FEE_SPLIT_BPS_MAX
```

---

## 4. State Transition Functions

### 4.1 Collect Fees Transition

```
collect_fees(state, token_stats, vault_balance, is_root, for_ecosystem) → Result:

    PRE:
        state.is_active = true
        state.emergency_pause = false
        now - state.last_cycle_timestamp ≥ state.min_cycle_interval  [if !TESTING_MODE]
        vault_balance ≥ state.min_fees_threshold                     [if !for_ecosystem]

    POST:
        state'.last_cycle_timestamp = now
        token_stats'.total_sol_collected += collected_amount

        IF is_root AND root_treasury.balance > 0:
            dat_authority.balance += root_treasury.balance
            token_stats'.total_sol_received_from_others += root_treasury.balance
            root_treasury'.balance = 0

        IF !for_ecosystem:
            token_stats'.pending_fees_lamports = 0
```

### 4.2 Execute Buy Secondary Transition

```
execute_buy_secondary(state, token_stats, allocated, root_treasury) → Result:

    PRE:
        state.is_active = true
        state.emergency_pause = false
        state.root_token_mint.is_some()
        allocated ≥ MIN_FEES_FOR_SPLIT
        root_treasury.is_some()                                    -- CRITICAL-03
        root_treasury.key = PDA(["root_treasury", root_mint])      -- CRITICAL-01

    COMPUTE:
        sol_for_root := allocated × (10000 - fee_split_bps) / 10000
        buy_amount   := (allocated × fee_split_bps / 10000) - ATA_RENT_RESERVE

    POST:
        root_treasury'.balance = root_treasury.balance + sol_for_root
        state'.last_sol_sent_to_root = sol_for_root

        -- CPI to Pump.fun buy
        tokens_received := pump_buy(buy_amount)
        state'.pending_burn_amount = tokens_received
        state'.last_cycle_sol = buy_amount
```

### 4.3 Execute Buy Root Transition

```
execute_buy(state, allocated) → Result:

    PRE:
        state.is_active = true
        state.emergency_pause = false

    COMPUTE:
        buy_amount := allocated - SAFETY_BUFFER
        buy_amount := min(buy_amount, dat_authority.balance - RENT_EXEMPT_MINIMUM - SAFETY_BUFFER)

    PRE (continued):
        buy_amount ≥ MINIMUM_BUY_AMOUNT

    POST:
        tokens_received := pump_buy(buy_amount)
        state'.pending_burn_amount = tokens_received
        state'.last_cycle_sol = buy_amount
```

### 4.4 Burn and Update Transition

```
burn_and_update(state, token_stats) → Result:

    PRE:
        state.pending_burn_amount > 0

    POST:
        -- Burn tokens
        burned := state.pending_burn_amount
        token_supply' = token_supply - burned

        -- Update stats
        token_stats'.total_burned += burned
        token_stats'.total_sol_used += state.last_cycle_sol
        token_stats'.total_buybacks += 1
        token_stats'.last_cycle_timestamp = now
        token_stats'.last_cycle_sol = state.last_cycle_sol
        token_stats'.last_cycle_burned = burned

        IF state.last_sol_sent_to_root > 0:
            token_stats'.total_sol_sent_to_root += state.last_sol_sent_to_root

        -- Reset state
        state'.pending_burn_amount = 0
        state'.last_sol_sent_to_root = 0
        state'.last_cycle_burned = burned
        state'.consecutive_failures = 0
```

### 4.5 Update Fee Split (Direct) Transition

```
update_fee_split(state, new_bps) → Result:

    PRE:
        FEE_SPLIT_BPS_MIN ≤ new_bps ≤ FEE_SPLIT_BPS_MAX
        |new_bps - state.fee_split_bps| ≤ FEE_SPLIT_MAX_DELTA
        now - state.last_direct_fee_split_timestamp ≥ state.admin_operation_cooldown

    POST:
        state'.fee_split_bps = new_bps
        state'.last_direct_fee_split_timestamp = now
```

### 4.6 Propose/Execute Fee Split (Timelocked) Transition

```
propose_fee_split(state, new_bps) → Result:

    PRE:
        0 < new_bps < 10000

    POST:
        state'.pending_fee_split = Some(new_bps)
        state'.pending_fee_split_timestamp = now


execute_fee_split(state) → Result:

    PRE:
        state.pending_fee_split.is_some()
        now - state.pending_fee_split_timestamp ≥ state.admin_operation_cooldown

    POST:
        state'.fee_split_bps = state.pending_fee_split.unwrap()
        state'.pending_fee_split = None
        state'.pending_fee_split_timestamp = 0
```

---

## 5. Security Properties

### 5.1 Access Control (SEC-1)

```
∀ admin-only instruction i:
    caller(i) = state.admin ∨ (i = accept_admin_transfer ∧ caller(i) = state.pending_admin)
```

### 5.2 No Arithmetic Overflow (SEC-2)

```
∀ arithmetic operation op on u64 values:
    op uses saturating_* OR checked_* with explicit error handling
```

### 5.3 PDA Integrity (SEC-3)

```
∀ PDA account a with seeds S:
    a.key = PDA(S, program_id)

Specific PDAs:
    dat_state     := PDA(["dat_v3"], program_id)
    dat_authority := PDA(["auth_v3"], program_id)
    token_stats   := PDA(["token_stats_v1", mint], program_id)
    root_treasury := PDA(["root_treasury", root_mint], program_id)
    validator     := PDA(["validator_v1", mint], program_id)
```

### 5.4 Reentrancy Safety (SEC-4)

```
∀ CPI call c:
    state_changes_before(c) are committed
    state_changes_after(c) use reloaded account data
```

### 5.5 Slippage Protection (SEC-5)

```
∀ buy operation with expected_tokens, actual_tokens:
    actual_tokens ≥ expected_tokens × (10000 - slippage_bps) / 10000
```

### 5.6 Emergency Pause (SEC-6)

```
∀ fund-moving instruction i:
    state.emergency_pause = true → i fails with DATNotActive

    consecutive_failures ≥ 5 → state'.emergency_pause = true
```

---

## 6. External App Integration Invariants

### 6.1 Deposit Split Exactness (EXT-1)

```
∀ deposit of amount a:
    burn_amount   := a × BURN_SHARE / SHARE_DENOMINATOR
    rebate_amount := a - burn_amount

    ASSERT: burn_amount + rebate_amount = a
    ASSERT: burn_amount / a ≈ 0.99448
    ASSERT: rebate_amount / a ≈ 0.00552
```

### 6.2 Rebate Eligibility (EXT-2)

```
∀ user u:
    eligible_for_rebate(u) ⟺ u.pending_contribution ≥ REBATE_THRESHOLD_SOL_EQUIV
```

### 6.3 Rebate Pool Solvency (EXT-3)

```
∀ time t:
    rebate_pool_ata.balance ≥ Σ(pending_rebates)

Where:
    pending_rebates := {u.pending_contribution × REBATE_SHARE / SHARE_DENOMINATOR | u ∈ eligible_users}
```

---

## 7. Pump.fun CPI Invariants

### 7.1 Creator Vault Derivation (CPI-1)

```
Bonding Curve:
    creator_vault := PDA(["creator-vault", dat_authority], PUMP_PROGRAM)

PumpSwap AMM:
    creator_vault_authority := PDA(["creator_vault", dat_authority], PUMPSWAP_PROGRAM)
    creator_vault_ata := ATA(creator_vault_authority, WSOL_MINT)
```

### 7.2 Buy Instruction Account Order (CPI-2)

```
Bonding Curve Buy (16 accounts):
    [0]  global_config           (readonly)
    [1]  fee_recipient           (writable)
    [2]  mint                    (writable)
    [3]  pool                    (writable)
    [4]  pool_token_account      (writable)
    [5]  user_token_account      (writable)
    [6]  user                    (signer, writable)
    [7]  system_program          (readonly)
    [8]  token_program           (readonly)      -- BEFORE creator_vault!
    [9]  creator_vault           (writable)      -- AFTER token_program!
    [10] event_authority         (readonly)
    [11] pump_program            (readonly)
    [12] global_volume_acc       (readonly)
    [13] user_volume_acc         (writable)
    [14] fee_config              (readonly)
    [15] fee_program             (readonly)
```

### 7.3 Collect Fee Instruction (CPI-3)

```
collect_creator_fee (5 accounts):
    [0] creator         (signer, writable)  -- dat_authority
    [1] creator_vault   (writable)
    [2] system_program  (readonly)
    [3] event_authority (readonly)
    [4] pump_program    (readonly)
```

---

## 8. Fuzzing Targets

### 8.1 Arithmetic Edge Cases

```fuzz
Target: calculate_tokens_out_pumpfun
Inputs:
    sol_in              ∈ [0, u64::MAX]
    virtual_sol_reserves ∈ [0, u64::MAX]
    virtual_token_reserves ∈ [0, u64::MAX]

Properties:
    - No panic
    - Result ≤ virtual_token_reserves
    - sol_in = 0 → result = 0
    - virtual_sol_reserves = 0 → Error(InsufficientPoolLiquidity)
```

### 8.2 Fee Split Boundaries

```fuzz
Target: split_fees_to_root
Inputs:
    total_lamports ∈ [0, MAX_PENDING_FEES]
    fee_split_bps  ∈ [FEE_SPLIT_BPS_MIN, FEE_SPLIT_BPS_MAX]

Properties:
    - sol_for_root + remaining ≤ total_lamports
    - sol_for_root ≥ 0
    - No overflow
```

### 8.3 Pending Fees Accumulation

```fuzz
Target: update_pending_fees / register_validated_fees
Inputs:
    current_pending ∈ [0, MAX_PENDING_FEES]
    new_amount      ∈ [0, MAX_PENDING_FEES]

Properties:
    - current_pending + new_amount > MAX_PENDING_FEES → Error(PendingFeesOverflow)
    - Result ≤ MAX_PENDING_FEES
```

### 8.4 Slippage Calculation

```fuzz
Target: calculate_buy_amount_and_slippage
Inputs:
    buy_amount         ∈ [0, MAX_FEES_PER_CYCLE]
    bonding_curve_data ∈ [valid BC structures]
    slippage_bps       ∈ [SLIPPAGE_BPS_MIN, SLIPPAGE_BPS_MAX]

Properties:
    - target_tokens ≤ expected_tokens
    - target_tokens ≥ expected_tokens × 0.95 (for 5% slippage)
    - No panic on edge case reserves
```

### 8.5 State Transitions

```fuzz
Target: Full cycle sequence
Sequence:
    1. update_pending_fees(random_amounts)
    2. collect_fees(random_token)
    3. execute_buy_secondary(random_allocation)
    4. burn_and_update()
    5. finalize_allocated_cycle()

Properties:
    - INV-1 (Conservation) holds
    - INV-4 (Pending bounded) holds
    - SEC-6 (Emergency pause) triggers after 5 failures
```

---

## 9. Verification Checklist

| Property | Type | Verified By |
|----------|------|-------------|
| INV-1 Conservation | Invariant | Formal proof |
| INV-2 Fee Split | Invariant | Unit tests + Formal |
| INV-3 Root Independence | Invariant | Unit tests |
| INV-4 Pending Bounded | Invariant | Fuzzing |
| INV-5 Fee Split Bounds | Invariant | Constraint checks |
| SEC-1 Access Control | Security | Anchor constraints |
| SEC-2 No Overflow | Security | Static analysis |
| SEC-3 PDA Integrity | Security | Anchor seeds |
| SEC-4 Reentrancy | Security | Code review |
| SEC-5 Slippage | Security | Runtime check |
| SEC-6 Emergency | Security | Integration tests |
| CPI-1 Vault Derivation | Correctness | Devnet tests |
| CPI-2 Account Order | Correctness | Devnet tests |

---

## 10. Formal Notation Reference

```
:=          Definition
→           Function mapping / Implication
∀           For all
∃           There exists
∈           Element of
⟺          If and only if
∧           Logical AND
∨           Logical OR
¬           Logical NOT
×           Multiplication
÷           Division
≤, ≥, <, >  Comparisons
|x|         Absolute value
Σ           Summation
Option<T>   T or None
Result      Ok(T) or Err(E)
PRE         Precondition
POST        Postcondition
'           Next state (e.g., state' = state after transition)
```

---

*Specification Version: 1.0*
*Protocol Version: Phase 1*
*Last Updated: 2025-12-18*
