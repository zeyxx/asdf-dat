# ASDF-DAT Technical Reference

Definitive technical reference for the Optimistic Burn Protocol.

---

## Philosophy

### Creation > Extraction

We don't take value. We create it.
We don't print tokens. We burn them.
We don't optimize for fees. We minimize them.

### Optimistic Burn Model

Single daemon executes. Chain proves. Anyone verifies.

```
Volume → Fees accumulate → Daemon flushes → Tokens burn → On-chain proof
```

### Fee Distribution

**Root Token**: 100% burn (no dev fee)
- All creator fees → Buyback & burn
- Receives 44.8% from all secondaries → Mega burn

**Secondary Tokens**: 99/1 split on their 55.2% share
- 99% → Buyback & burn
- 1% → Dev sustainability (keeps infrastructure running)

*1% of secondary share today = 99% burns forever.*

---

## Core Concept

DAT creates value through automatic fee capture and permanent supply reduction.

### Token Hierarchy

```
                    ROOT TOKEN ($ASDF)
                           │
           ┌───────────────┼───────────────┐
           │               │               │
           ▼               ▼               ▼
     SECONDARY 1      SECONDARY 2     SECONDARY N
```

- **Root Token**: Receives 44.8% of ALL secondary token fees
- **Secondary Tokens**: Keep 55.2% for their own buyback & burn

### Fee Flow

```
Secondary Token Trade
           │
           ▼
    Creator Fee (dynamic)
           │
    ┌──────┴──────┐
    │             │
    ▼             ▼
  55.2%        44.8%
Secondary    Root Token
 Burn        Treasury
```

---

## External App Rebate System

External applications can deposit $ASDF tokens for burn with user rebates.

### Fee Split (Exact Precision)

```
External App Deposit
        │
        ▼
    Split (÷100000)
        │
   ┌────┴────┐
   │         │
   ▼         ▼
99.448%    0.552%
  Burn     Rebate Pool
```

**Constants** (programs/asdf-dat/src/constants.rs):
```rust
BURN_SHARE: u32 = 99448;        // 99.448% → burn via DAT ATA
REBATE_SHARE: u32 = 552;        // 0.552% → rebate pool
SHARE_DENOMINATOR: u64 = 100000; // Enables exact precision
```

### Accounts

**RebatePool** - Self-sustaining rebate fund
- PDA: `["rebate_pool"]`
- Tracks: total_deposited, total_distributed, rebates_count

**UserStats** - Per-user contribution tracking
- PDA: `["user_stats_v1", user_pubkey]`
- Tracks: pending_contribution, total_contributed, total_rebate

### Instructions

1. **deposit_fee_asdf** - External app deposits $ASDF
   - Splits: 99.448% → DAT ATA, 0.552% → Rebate Pool
   - Creates/updates UserStats with pending contribution
   - Minimum: 0.01 SOL equivalent

2. **process_user_rebate** - Distribute rebate to eligible user
   - Eligibility: pending_contribution >= 0.07 SOL equivalent
   - Rebate: 0.552% of pending contribution
   - Selection: Deterministic (slot-based, not cryptographic random)

### User Selection

Selection uses slot-based deterministic algorithm (Phase 1):
```typescript
selectedIndex = currentSlot % eligibleUsers.length;
```
Note: Predictable selection is acceptable for Phase 1 with small rebate amounts. Oracle randomness planned for Phase 2.

---

## Pump.fun Integration

### Creator Fees (Dynamic)

Set by Pump.fun based on market cap:

| Market Cap | Creator Fee |
|------------|-------------|
| $88K-$300K | 0.95% |
| > $20M | 0.05% |

### Pool Types

**Bonding Curve (Pre-migration)**
- Program: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`
- Vault: Native SOL
- Seeds: `["creator-vault", creator]` (hyphen)

**PumpSwap AMM (Post-migration)**
- Program: `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`
- Vault: WSOL
- Seeds: `["creator_vault", creator]` (underscore)

### Shared Vault Architecture

All tokens from same creator share ONE vault.

```
Creator Wallet (DAT Authority)
           │
           ▼
    Shared Creator Vault  ◄── All fees here
           │
    ┌──────┼──────┬──────┐
    │      │      │      │
    ▼      ▼      ▼      ▼
  Token1  Token2  Token3  Token4
```

Implication: Daemon required for per-token fee attribution.

---

## On-Chain Architecture

### Program ID
```
ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui
```

### PDA Seeds

| Account | Seeds |
|---------|-------|
| DAT State | `["dat_v3"]` |
| DAT Authority | `["auth_v3"]` |
| Token Stats | `["token_stats_v1", mint]` |
| Root Treasury | `["root_treasury", root_mint]` |
| Validator State | `["validator_v1", mint, bonding_curve]` |
| Rebate Pool | `["rebate_pool"]` |
| User Stats | `["user_stats_v1", user_pubkey]` |

### Key Accounts

**DATState** - Global configuration
- `admin`, `root_token_mint`, `fee_split_bps`
- `is_active`, `emergency_pause`

**TokenStats** - Per-token statistics
- `mint`, `total_burned`, `total_sol_collected`
- `pending_fees_lamports` (fees tracked, not yet flushed)
- `is_root_token`

---

## Fee Attribution

### Problem
Shared vault = cannot determine per-token fees from balance alone.

### Solution: Balance Polling Daemon

Each token has a unique bonding curve/pool, but shares the vault.

```
Token A Trade ──► Token A's BC (unique) ──► Creator Vault (shared)
Token B Trade ──► Token B's BC (unique) ──► Creator Vault (shared)

Fee Daemon
    │
    ├── Poll Token A's BC for transactions
    │   └── Extract vault delta → attribute to Token A
    │
    └── Poll Token B's BC for transactions
        └── Extract vault delta → attribute to Token B
```

### Daemon Operation

1. **Monitor** (`monitor-ecosystem-fees.ts`):
   - Polls each token's bonding curve/pool
   - Extracts vault balance deltas
   - Updates `pending_fees` on-chain
   - Persists state to `.daemon-state.json`

2. **Flush** (`execute-ecosystem-cycle.ts`):
   - Reads `pending_fees` from all TokenStats
   - Calculates proportional distribution
   - Executes buyback & burn per token

### Scalability

| Feature | Implementation |
|---------|---------------|
| State persistence | `.daemon-state.json` |
| TX limit | 50 per poll (configurable) |
| Crash recovery | Auto-restore signatures |

---

## Thresholds

### Constants (lib.rs)

```rust
FLUSH_THRESHOLD: u64 = 10_000_000;        // 0.01 SOL - minimum to flush
INITIAL_SLIPPAGE_BPS: u16 = 500;          // 5% - slippage protection
MIN_CYCLE_INTERVAL: i64 = 60;             // 60 seconds between cycles

// Safety margins
RENT_EXEMPT_MINIMUM: u64 = 890_880;
ATA_RENT_RESERVE: u64 = 2_100_000;
MIN_FEES_FOR_SPLIT: u64 = 5_500_000;      // ~0.0055 SOL
```

### TypeScript Constants

```typescript
SECONDARY_KEEP_RATIO = 0.552;  // 55.2%

// Minimum allocation per secondary (before split)
MIN_ALLOCATION_SECONDARY = ~5,690,000 lamports (~0.00569 SOL)

// TX fee reserve per token
TX_FEE_RESERVE_PER_TOKEN = 7,000,000 lamports (~0.007 SOL)
```

---

## Execution Flow

### Flush Cycle (N+1 Pattern)

Each secondary in single batch transaction:
```
[Compute Budget] + [Collect] + [Buy] + [Finalize] + [Burn]
```

1. First token: Collect drains vault → Buy with proportional share
2. Other tokens: Collect (no-op) → Buy from remaining balance

### Root Token Cycle

After all secondaries:
1. Collect from root creator vault
2. Add root_treasury balance (44.8% from secondaries)
3. Buy tokens
4. Burn tokens

---

## Testing

### Volume Requirements

To reach 0.006 SOL fees per token with ~0.3% creator fee:
```
Required: 2 SOL volume per token
Optimized: 2 rounds of 0.5 SOL buy + sell
```

### Quick Devnet Test

```bash
# Start daemon
npx ts-node scripts/monitor-ecosystem-fees.ts --network devnet &

# Generate volume (buy + sell = fees both directions)
npx ts-node scripts/generate-volume.ts devnet-tokens/01-froot.json 2 0.5
npx ts-node scripts/sell-spl-tokens-simple.ts devnet-tokens/01-froot.json

# Wait for sync
sleep 30

# Flush
npx ts-node scripts/execute-ecosystem-cycle.ts devnet-tokens/01-froot.json --network devnet
```

### Token Configs

```
devnet-tokens/01-froot.json  - Root token
devnet-tokens/02-fs1.json    - Secondary 1
mainnet-tokens/01-root.json  - Root token ($ASDF)
```

---

## Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| Below threshold | pending_fees < 0.0055 SOL | Generate more volume |
| Cycle too soon | < 60s elapsed | Wait |
| Invalid root treasury | Root not configured | Run `set-root-token.ts` |
| Vault not initialized | No trades yet | Execute a trade |

---

## File Structure

```
asdf-dat/
├── programs/asdf-dat/src/lib.rs   # Solana program
├── lib/
│   ├── fee-monitor.ts             # Daemon library
│   ├── amm-utils.ts               # AMM utilities
│   └── network-config.ts          # Network config
├── scripts/
│   ├── execute-ecosystem-cycle.ts # Flush orchestrator
│   ├── monitor-ecosystem-fees.ts  # Fee daemon
│   └── ...                        # Utilities
├── devnet-tokens/                 # Devnet configs
├── mainnet-tokens/                # Mainnet configs
└── docs/                          # Documentation
```

---

## Network Configuration

| Aspect | Devnet | Mainnet |
|--------|--------|---------|
| Wallet | devnet-wallet.json | mainnet-wallet.json |
| Tokens | devnet-tokens/ | mainnet-tokens/ |
| RPC Fallback | Optional | Required |

Use `--network devnet` or `--network mainnet` on all scripts.

---

## Principles

1. **Don't trust, verify** - Always check on-chain state
2. **Shared vault = daemon required** - Fee attribution is a feature
3. **Both directions generate fees** - Buy AND sell for volume
4. **Root gets 100% of its own fees** - Hardcoded in infrastructure
5. **Multiple daemons can cross-verify** - Redundancy is good

---

# Development Standards

## Quality > Quantity

```
1 working feature    >  3 half-done features
1 clean file         >  5 messy files
Simple & readable    >  Complex & impressive
```

## Phase 2 Ready

Phase 1 is foundation. Always ask: "Will this make Phase 2 easier or harder?"

```rust
// Creation, not extraction (secondaries only)
pub const DEV_FEE_BPS: u16 = 100;  // 1% of secondary share - keeps lights on
```

## Commit Format

```
type(scope): description

- Why this change matters
- What it enables
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

## Before Commit

- Tests pass
- No debug code
- No commented junk
- No hardcoded secrets
- Clear message

## Comments Explain WHY

```rust
// Accumulate until threshold - reduces tx costs
total += fee;

// 1% dev sustainability (secondaries only) - keeps infrastructure running
let dev_share = secondary_share / 100;
```

---

## Deployment

**Devnet**: Experiment freely. Break things, learn, fix.

**Mainnet**: Triple-check. Small test first. Monitor after.

```
MAINNET = REAL VALUE
If doubt exists, ask first.
```

---

*Flush. Burn. Verify.*
*This is fine.* 🔥🐕
- organic always win.
- ASDF - Optimistic Burn Protocol
- eligibility is efficiency
- plus jamais de ta vie tu affiches des données sensibles