# ASDF-DAT API Reference

Complete instruction reference for the ASDF-DAT smart contract.

**Program ID:** `ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui`

---

## Table of Contents

1. [Initialization](#initialization)
2. [Configuration](#configuration)
3. [Fee Collection](#fee-collection)
4. [Buyback & Burn](#buyback--burn)
5. [Validator System](#validator-system)
6. [Admin Operations](#admin-operations)
7. [Error Codes](#error-codes)
8. [Constants](#constants)

---

## Initialization

### `initialize`

Initialize the global DAT state. Called once per deployment.

**Access:** Admin only (initial signer becomes admin)

**Accounts:**

| Name | Type | Description |
|------|------|-------------|
| `dat_state` | PDA | Global state account (created) |
| `dat_authority` | PDA | Program signer (created) |
| `admin` | Signer | Initial administrator |
| `system_program` | Program | System program |

**Example:**
```typescript
await program.methods.initialize()
  .accounts({
    datState,
    datAuthority,
    admin: wallet.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

---

### `initializeTokenStats`

Initialize tracking for a new token. Required before token can participate.

**Access:** Admin only

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `mint` | Pubkey | Token mint to track |

**Accounts:**

| Name | Type | Description |
|------|------|-------------|
| `dat_state` | PDA | Global state |
| `token_stats` | PDA | Per-token stats (created) |
| `mint` | Account | Token mint |
| `admin` | Signer | Administrator |
| `system_program` | Program | System program |

**Example:**
```typescript
await program.methods.initializeTokenStats()
  .accounts({
    datState,
    tokenStats,
    mint: tokenMint,
    admin: wallet.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

---

## Configuration

### `setRootToken`

Designate which token receives 44.8% of secondary fees.

**Access:** Admin only

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `root_mint` | Pubkey | Root token mint |

**Accounts:**

| Name | Type | Description |
|------|------|-------------|
| `dat_state` | PDA | Global state |
| `token_stats` | PDA | Root token's stats |
| `admin` | Signer | Administrator |

**Example:**
```typescript
await program.methods.setRootToken(rootMint)
  .accounts({
    datState,
    tokenStats: rootTokenStats,
    admin: wallet.publicKey,
  })
  .rpc();
```

---

### `updateFeeSplit`

Adjust the fee distribution ratio. Max 5% change per call.

**Access:** Admin only

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `new_fee_split_bps` | u16 | New ratio (1000-9000) |

**Constraints:**
- Bounded: 10%-90% (1000-9000 bps)
- Max delta: 500 bps per call
- Use `proposeFeeSplit` for larger changes

**Example:**
```typescript
// Change from 55.2% to 57.2% (+2%)
await program.methods.updateFeeSplit(5720)
  .accounts({
    datState,
    admin: wallet.publicKey,
  })
  .rpc();
```

---

### `updateParameters`

Adjust operational thresholds.

**Access:** Admin only

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `min_fees` | Option<u64> | Minimum fees to claim |
| `max_fees` | Option<u64> | Maximum fees per cycle |
| `slippage_bps` | Option<u16> | Slippage tolerance (max 500) |
| `min_interval` | Option<i64> | Minimum cycle interval |

**Example:**
```typescript
await program.methods.updateParameters(
  new BN(5_000_000),  // min_fees: 0.005 SOL
  new BN(500_000_000), // max_fees: 0.5 SOL
  300,                 // slippage: 3%
  120                  // interval: 2 minutes
)
.accounts({
  datState,
  admin: wallet.publicKey,
})
.rpc();
```

---

### `updatePendingFees`

Update a token's pending fee balance. Called by daemon.

**Access:** Permissionless

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `amount_lamports` | u64 | Fees to add |

**Constraints:**
- Total pending capped at 69 SOL per token

**Example:**
```typescript
await program.methods.updatePendingFees(new BN(1_000_000))
  .accounts({
    datState,
    tokenStats,
  })
  .rpc();
```

---

## Fee Collection

### `collectFees`

Collect creator fees from Pump.fun bonding curve vault.

**Access:** Permissionless

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `is_root_token` | bool | Root token flag |
| `for_ecosystem` | bool | Skip threshold check |

**Accounts:**

| Name | Type | Description |
|------|------|-------------|
| `dat_state` | PDA | Global state |
| `dat_authority` | PDA | Program signer |
| `token_stats` | PDA | Token's stats |
| `mint` | Account | Token mint |
| `bonding_curve` | Account | Pump.fun BC |
| `creator_vault` | Account | Fee vault |
| `root_treasury` | PDA | Root fee account (if root) |
| `pump_program` | Program | Pump.fun program |
| `system_program` | Program | System program |

**Example:**
```typescript
await program.methods.collectFees(false, true)
  .accounts({
    datState,
    datAuthority,
    tokenStats,
    mint: tokenMint,
    bondingCurve,
    creatorVault,
    rootTreasury: null, // null for secondary
    pumpProgram: PUMP_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

---

### `collectFeesAmm`

Collect fees from PumpSwap AMM (post-migration tokens).

**Access:** Permissionless

**Accounts:**

| Name | Type | Description |
|------|------|-------------|
| `dat_state` | PDA | Global state |
| `dat_authority` | PDA | Program signer |
| `token_stats` | PDA | Token's stats |
| `pool` | Account | PumpSwap pool |
| `creator_vault` | Account | WSOL vault |
| `pumpswap_program` | Program | PumpSwap program |
| `token_program` | Program | Token program |

---

### `unwrapWsol`

Convert collected WSOL to native SOL (after AMM collection).

**Access:** Permissionless

**Accounts:**

| Name | Type | Description |
|------|------|-------------|
| `dat_authority` | PDA | Program signer |
| `wsol_account` | Account | WSOL token account |
| `token_program` | Program | Token program |

---

## Buyback & Burn

### `executeBuy`

Buy root tokens using collected fees.

**Access:** Permissionless (when active)

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `allocated_lamports` | Option<u64> | Specific amount (optional) |

**Accounts (16 total):**

| Name | Type | Description |
|------|------|-------------|
| `dat_state` | PDA | Global state |
| `dat_authority` | PDA | Program signer |
| `token_stats` | PDA | Token's stats |
| `mint` | Account | Token mint |
| `bonding_curve` | Account | Pump.fun BC |
| `associated_bonding_curve` | Account | BC token account |
| `buyer_token_account` | Account | DAT's token account |
| `pump_global` | Account | Pump global config |
| `pump_event_authority` | Account | Event authority |
| `pump_fee_recipient` | Account | Protocol fee recipient |
| `pump_program` | Program | Pump.fun program |
| `system_program` | Program | System program |
| `token_program` | Program | Token program |
| `rent` | Sysvar | Rent sysvar |
| `associated_token_program` | Program | ATA program |

**Example:**
```typescript
await program.methods.executeBuy(null) // Use all available
  .accounts({
    datState,
    datAuthority,
    tokenStats,
    mint: rootMint,
    bondingCurve,
    associatedBondingCurve,
    buyerTokenAccount,
    pumpGlobal,
    pumpEventAuthority,
    pumpFeeRecipient,
    pumpProgram: PUMP_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    rent: SYSVAR_RENT_PUBKEY,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  })
  .rpc();
```

---

### `executeBuySecondary`

Buy secondary tokens with automatic 44.8% split to root treasury.

**Access:** Permissionless (when active)

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `allocated_lamports` | Option<u64> | Allocated amount |

**Accounts (17 total):** Same as `executeBuy` plus:

| Name | Type | Description |
|------|------|-------------|
| `root_treasury` | PDA | Receives 44.8% |

**Flow:**
1. Split allocated amount: 44.8% → root_treasury
2. Buy tokens with remaining 55.2%
3. Update pending_burn_amount

---

### `finalizeAllocatedCycle`

Finalize token's participation in current cycle.

**Access:** Permissionless

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `actually_participated` | bool | Did token participate? |

**Effects:**
- If participated: Reset pending_fees, increment cycles_participated
- If not: Preserve pending_fees for next cycle

---

### `burnAndUpdate`

Burn purchased tokens and update statistics.

**Access:** Permissionless

**Accounts:**

| Name | Type | Description |
|------|------|-------------|
| `dat_state` | PDA | Global state |
| `dat_authority` | PDA | Program signer |
| `token_stats` | PDA | Token's stats |
| `mint` | Account | Token mint |
| `burn_account` | Account | DAT's token account |
| `token_program` | Program | Token program |

**Effects:**
- Burns pending_burn_amount tokens
- Updates total_burned
- Updates total_sol_used
- Increments total_buybacks
- Resets consecutive_failures
- Emits CycleCompleted event

---

## Validator System

### `initializeValidator`

Set up trustless fee validation for a token.

**Access:** Admin only

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `bonding_curve` | Pubkey | Associated BC |

**Accounts:**

| Name | Type | Description |
|------|------|-------------|
| `validator_state` | PDA | Created |
| `token_stats` | PDA | Token's stats |
| `admin` | Signer | Administrator |
| `system_program` | Program | System program |

---

### `registerValidatedFees`

Submit validated fees from external validator.

**Access:** Permissionless

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `fee_amount` | u64 | Validated fees |
| `end_slot` | u64 | Slot range end |
| `tx_count` | u32 | Transaction count |

**Constraints:**
- Slot must progress (no double-counting)
- Max slot range: 1000
- Max fee per slot: 0.01 SOL
- Max TX per slot: 100

---

### `syncValidatorSlot`

Reset stale validator to current slot.

**Access:** Permissionless

**Constraints:**
- Only if > 1000 slots behind

---

## Admin Operations

### `emergencyPause`

Halt all operations immediately.

**Access:** Admin only

**Effects:**
- Sets is_active = false
- Sets emergency_pause = true

---

### `resume`

Resume operations after pause.

**Access:** Admin only

**Effects:**
- Sets is_active = true
- Sets emergency_pause = false
- Resets consecutive_failures

---

### `proposeAdminTransfer`

Propose new administrator.

**Access:** Admin only

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `new_admin` | Pubkey | Proposed admin |

---

### `acceptAdminTransfer`

Accept pending admin transfer.

**Access:** Proposed admin only

---

### `cancelAdminTransfer`

Cancel pending admin transfer.

**Access:** Admin only

---

### `proposeFeeSplit`

Propose major fee split change (timelocked).

**Access:** Admin only

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `new_fee_split_bps` | u16 | Proposed ratio |

---

### `executeFeeSplit`

Execute timelocked fee split change.

**Access:** Admin only

**Constraints:**
- Cooldown period elapsed (default 1 hour)

---

### `recordFailure`

Record a cycle failure.

**Access:** Permissionless (called by orchestrator)

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `error_code` | u32 | Error code |

**Effects:**
- Increments failed_cycles
- Increments consecutive_failures
- Auto-pauses at 5+ consecutive failures

---

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| 6000 | `DATNotActive` | System paused or inactive |
| 6001 | `InsufficientFees` | Below minimum threshold |
| 6002 | `UnauthorizedAccess` | Wrong signer |
| 6003 | `CycleTooSoon` | Min interval not elapsed |
| 6004 | `InvalidParameter` | Constraint violation |
| 6005 | `MathOverflow` | Arithmetic error |
| 6006 | `SlippageExceeded` | Slippage tolerance exceeded |
| 6007 | `InvalidPool` | Bad bonding curve data |
| 6008 | `InvalidRootToken` | Root not configured |
| 6009 | `InvalidRootTreasury` | PDA mismatch |
| 6010 | `InvalidFeeSplit` | Out of range (1000-9000) |
| 6011 | `FeeSplitDeltaTooLarge` | > 500 bps change |
| 6012 | `InsufficientPoolLiquidity` | Pool too empty |
| 6013 | `StaleValidation` | Slot already processed |
| 6014 | `SlotRangeTooLarge` | > 1000 slots |
| 6015 | `ValidatorNotStale` | < 1000 slot gap |
| 6016 | `FeeTooHigh` | Exceeds slot cap |
| 6017 | `TooManyTransactions` | TX count cap exceeded |
| 6018 | `NoPendingBurn` | Nothing to burn |
| 6019 | `PendingFeesOverflow` | > 69 SOL pending |

---

## Constants

### On-Chain Constants

```rust
// Fee thresholds
MIN_FEES_TO_CLAIM: u64 = 10_000_000;      // 0.01 SOL
MAX_FEES_PER_CYCLE: u64 = 1_000_000_000;  // 1 SOL
MIN_FEES_FOR_SPLIT: u64 = 5_500_000;      // 0.0055 SOL
MINIMUM_BUY_AMOUNT: u64 = 100_000;        // 0.0001 SOL

// Safety margins
RENT_EXEMPT_MINIMUM: u64 = 890_880;       // ~0.00089 SOL
SAFETY_BUFFER: u64 = 50_000;              // ~0.00005 SOL
ATA_RENT_RESERVE: u64 = 2_100_000;        // ~0.0021 SOL

// Timing
MIN_CYCLE_INTERVAL: i64 = 60;             // 60 seconds
ADMIN_OPERATION_COOLDOWN: i64 = 3600;     // 1 hour

// Slippage
INITIAL_SLIPPAGE_BPS: u16 = 500;          // 5%
MAX_SLIPPAGE_BPS: u16 = 500;              // 5% cap

// Fee split
DEFAULT_FEE_SPLIT_BPS: u16 = 5520;        // 55.2%
MIN_FEE_SPLIT_BPS: u16 = 1000;            // 10%
MAX_FEE_SPLIT_BPS: u16 = 9000;            // 90%
MAX_FEE_SPLIT_DELTA_BPS: u16 = 500;       // 5% per change

// Validator
MAX_PENDING_FEES: u64 = 69_000_000_000;   // 69 SOL
MAX_SLOT_RANGE: u64 = 1000;               // ~7 minutes
MAX_FEE_PER_SLOT: u64 = 10_000_000;       // 0.01 SOL
MAX_TX_PER_SLOT: u32 = 100;
```

### External Programs

```rust
// Pump.fun Bonding Curve
PUMP_PROGRAM: &str = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

// PumpSwap AMM
PUMPSWAP_PROGRAM: &str = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
```

---

*For integration examples, see [Developer Guide](DEVELOPER_GUIDE.md).*
*For operational procedures, see [Operations](OPERATIONS.md).*
