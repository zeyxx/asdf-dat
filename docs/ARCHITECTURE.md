# ASDF-DAT Architecture

Technical system design for the Decentralized Autonomous Treasury.

---

## System Overview

ASDF-DAT is a two-layer system combining on-chain smart contracts with off-chain automation:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              ASDF-DAT                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                         OFF-CHAIN LAYER                           │  │
│  │                                                                   │  │
│  │   ┌─────────────────┐              ┌─────────────────────────┐   │  │
│  │   │   FEE DAEMON    │              │   CYCLE ORCHESTRATOR    │   │  │
│  │   │                 │              │                         │   │  │
│  │   │  Runs 24/7      │   triggers   │  Executes on-demand     │   │  │
│  │   │  Polls trades   │ ──────────►  │  or scheduled           │   │  │
│  │   │  Tracks fees    │              │  Batch transactions     │   │  │
│  │   │  Updates chain  │              │  Buy & burn cycles      │   │  │
│  │   └─────────────────┘              └─────────────────────────┘   │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    │                                    │
│                                    ▼                                    │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                          ON-CHAIN LAYER                           │  │
│  │                                                                   │  │
│  │   ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │  │
│  │   │  DAT STATE   │  │ TOKEN STATS  │  │   ROOT TREASURY      │   │  │
│  │   │              │  │   (per token)│  │                      │   │  │
│  │   │  • admin     │  │  • mint      │  │  PDA that collects   │   │  │
│  │   │  • fee_split │  │  • burned    │  │  44.8% from all      │   │  │
│  │   │  • is_active │  │  • pending   │  │  secondary tokens    │   │  │
│  │   │  • root_mint │  │  • is_root   │  │                      │   │  │
│  │   └──────────────┘  └──────────────┘  └──────────────────────┘   │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    │                                    │
│                                    ▼                                    │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                       PUMP.FUN LAYER                              │  │
│  │                                                                   │  │
│  │   ┌─────────────────────────┐    ┌─────────────────────────┐     │  │
│  │   │    BONDING CURVE        │    │     PUMPSWAP AMM        │     │  │
│  │   │    (pre-migration)      │    │    (post-migration)     │     │  │
│  │   │                         │    │                         │     │  │
│  │   │  • Native SOL vault     │    │  • WSOL token vault     │     │  │
│  │   │  • Creator fee: 0.3-1%  │    │  • Creator fee: 0.05%+  │     │  │
│  │   │  • Constant product AMM │    │  • Full liquidity pool  │     │  │
│  │   └─────────────────────────┘    └─────────────────────────┘     │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## On-Chain Components

### Program ID

```
ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui
```

### Account Types

#### 1. DATState (Global Configuration)

Single instance per deployment. Controls all ecosystem behavior.

| Field | Type | Description |
|-------|------|-------------|
| `admin` | Pubkey | Current administrator |
| `root_token_mint` | Option<Pubkey> | Designated root token |
| `fee_split_bps` | u16 | Secondary keep ratio (5520 = 55.2%) |
| `is_active` | bool | Execution enabled |
| `emergency_pause` | bool | Emergency stop flag |
| `total_burned` | u64 | Cumulative tokens burned |
| `total_sol_collected` | u64 | Cumulative SOL collected |
| `consecutive_failures` | u8 | Auto-pause trigger (5+) |

**PDA Derivation:**
```rust
seeds = ["dat_v3"]
```

#### 2. TokenStats (Per-Token Tracking)

One instance per ecosystem token. Tracks individual performance.

| Field | Type | Description |
|-------|------|-------------|
| `mint` | Pubkey | Token mint address |
| `pending_fees_lamports` | u64 | Fees awaiting distribution |
| `total_burned` | u64 | Tokens burned for this token |
| `total_sol_collected` | u64 | SOL collected from this token |
| `total_sol_sent_to_root` | u64 | SOL sent to root (secondary only) |
| `is_root_token` | bool | Root token flag |
| `cycles_participated` | u64 | Number of cycles executed |

**PDA Derivation:**
```rust
seeds = ["token_stats_v1", mint.as_ref()]
```

#### 3. Root Treasury

Native SOL account accumulating 44.8% from all secondary tokens.

**PDA Derivation:**
```rust
seeds = ["root_treasury", root_token_mint.as_ref()]
```

#### 4. DAT Authority

Program-owned signer for all CPI operations.

**PDA Derivation:**
```rust
seeds = ["auth_v3"]
```

---

## Off-Chain Components

### Fee Daemon (`monitor-ecosystem-fees.ts`)

**Problem Solved**: All tokens from the same creator share ONE vault. Cannot determine per-token fees from vault balance alone.

**Solution**: Balance polling with transaction attribution.

```
Token A Trade ──► Token A's BC (unique) ──┐
                                          ├──► Creator Vault (shared)
Token B Trade ──► Token B's BC (unique) ──┘

Daemon polls Token A's BC → detects vault change → attribute to A
Daemon polls Token B's BC → detects vault change → attribute to B
```

**How it works:**

1. Every 5 seconds, poll each token's bonding curve/AMM for new transactions
2. For each transaction, extract the vault's balance change
3. Call `update_pending_fees` on-chain to attribute the fee
4. Persist state to `.daemon-state.json` for crash recovery

**State Persistence:**
```json
{
  "lastSignatures": {
    "9Gs59vJFFZWfZ72j7BNiTyzUPovH5oMVtTjGnrATECMG": "5xK3...",
    "ABC123...": "4yJ2..."
  },
  "lastUpdated": "2025-12-01T00:00:00.000Z",
  "version": 1
}
```

### Cycle Orchestrator (`execute-ecosystem-cycle.ts`)

Executes the buy & burn cycle for all tokens.

**N+1 Batch Pattern:**

```
┌─────────────────────────────────────────────────────────────────┐
│                     ECOSYSTEM CYCLE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  SECONDARY 1 (Single Batch TX)                                  │
│  ┌─────────┬─────────┬──────────┬────────┬─────────┐           │
│  │ Compute │ Collect │ Buy+Split│Finalize│  Burn   │           │
│  │ Budget  │  Fees   │  Tokens  │ Cycle  │ Tokens  │           │
│  └─────────┴─────────┴──────────┴────────┴─────────┘           │
│                         │                                       │
│                         ▼                                       │
│  SECONDARY 2 (Single Batch TX)                                  │
│  ┌─────────┬─────────┬──────────┬────────┬─────────┐           │
│  │ Compute │ Collect │ Buy+Split│Finalize│  Burn   │           │
│  │ Budget  │ (no-op) │  Tokens  │ Cycle  │ Tokens  │           │
│  └─────────┴─────────┴──────────┴────────┴─────────┘           │
│                         │                                       │
│                         ▼                                       │
│  ...more secondaries...                                         │
│                         │                                       │
│                         ▼                                       │
│  ROOT TOKEN (Single Batch TX)                                   │
│  ┌─────────┬─────────┬──────────┬────────┬─────────┐           │
│  │ Compute │ Collect │   Buy    │Finalize│  Burn   │           │
│  │ Budget  │  All    │  Tokens  │ Cycle  │ Tokens  │           │
│  └─────────┴─────────┴──────────┴────────┴─────────┘           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Why N+1?**
- First secondary: Drains shared vault to datAuthority
- Other secondaries: Use proportional share from datAuthority balance
- Root token: Uses root_treasury (44.8% accumulated) + vault

---

## Fee Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        FEE FLOW                                 │
└─────────────────────────────────────────────────────────────────┘

  TRADING
     │
     ▼
┌─────────────────┐
│  Someone trades │
│  Secondary #1   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│  Creator Fee    │     │  Daemon detects │
│  (0.3-0.95%)    │────►│  & attributes   │
│  → Shared Vault │     │  to token #1    │
└─────────────────┘     └────────┬────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │ TokenStats #1   │
                        │ pending_fees++  │
                        └────────┬────────┘
                                 │
                                 │ (Cycle Execution)
                                 ▼
         ┌───────────────────────┴───────────────────────┐
         │                                               │
         ▼                                               ▼
┌─────────────────┐                            ┌─────────────────┐
│     55.2%       │                            │     44.8%       │
│                 │                            │                 │
│  Buy Secondary  │                            │  Root Treasury  │
│     Tokens      │                            │   (accumulates) │
└────────┬────────┘                            └────────┬────────┘
         │                                              │
         ▼                                              │
┌─────────────────┐                                     │
│  Burn Tokens    │                                     │
│  Supply: -N     │                                     │
└─────────────────┘                                     │
                                                        │
                              (On Root Cycle)           │
                                       ┌────────────────┘
                                       ▼
                              ┌─────────────────┐
                              │  Buy Root Token │
                              │  with treasury  │
                              └────────┬────────┘
                                       │
                                       ▼
                              ┌─────────────────┐
                              │  Burn Root      │
                              │  Supply: -M     │
                              └─────────────────┘
```

---

## Pump.fun Integration

### Two Pool Types

| Aspect | Bonding Curve | PumpSwap AMM |
|--------|---------------|--------------|
| Program | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` |
| Vault Type | Native SOL | WSOL Token Account |
| Vault Derivation | `["creator-vault", creator]` | `["creator_vault", creator]` |
| Creator Fee | 0.3% - 0.95% (market cap based) | 0.05%+ (Project Ascend) |
| Migration | Pre-migration | Post-migration |

### Shared Vault Architecture

**Critical**: All tokens from the same creator share ONE vault.

```
Creator Wallet (DAT Authority)
           │
           ▼
    Shared Creator Vault  ◄── All secondary fees go here
           │
    ┌──────┼──────┬──────┐
    │      │      │      │
    ▼      ▼      ▼      ▼
  Token1 Token2 Token3 Token4
```

This is why the daemon is necessary - we can't determine per-token fees from vault balance alone.

---

## Security Architecture

### Access Control

```
┌─────────────────────────────────────────────────────────────────┐
│                      ACCESS CONTROL                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ADMIN ONLY                      PERMISSIONLESS                 │
│  ────────────                    ──────────────                 │
│  • initialize                    • collect_fees                 │
│  • set_root_token                • execute_buy                  │
│  • update_parameters             • burn_and_update              │
│  • emergency_pause               • update_pending_fees          │
│  • resume                        • register_validated_fees      │
│  • propose_admin_transfer        • sync_validator_slot          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Safety Mechanisms

| Mechanism | Description |
|-----------|-------------|
| **Emergency Pause** | Admin can halt all operations instantly |
| **Auto-Pause** | System pauses after 5 consecutive failures |
| **Two-Step Admin Transfer** | Propose → Accept prevents accidental loss |
| **Fee Split Limits** | Max 5% change per TX, timelocked for larger |
| **Slippage Cap** | Maximum 5% slippage on buybacks |
| **Min Cycle Interval** | 60 seconds between cycles |

### Key Constants

```rust
// Thresholds
MIN_FEES_TO_CLAIM: u64 = 10_000_000;      // 0.01 SOL
MAX_FEES_PER_CYCLE: u64 = 1_000_000_000;  // 1 SOL
MIN_FEES_FOR_SPLIT: u64 = 5_500_000;      // 0.0055 SOL

// Safety
RENT_EXEMPT_MINIMUM: u64 = 890_880;       // ~0.00089 SOL
SAFETY_BUFFER: u64 = 50_000;              // ~0.00005 SOL
ATA_RENT_RESERVE: u64 = 2_100_000;        // ~0.0021 SOL

// Timing
MIN_CYCLE_INTERVAL: i64 = 60;             // 60 seconds
INITIAL_SLIPPAGE_BPS: u16 = 500;          // 5%
```

---

## Data Flow Sequence

```
┌────────┐    ┌────────┐    ┌──────────┐    ┌────────────┐
│ Trader │    │ Daemon │    │ On-Chain │    │Orchestrator│
└───┬────┘    └───┬────┘    └────┬─────┘    └─────┬──────┘
    │             │              │                │
    │ buy/sell    │              │                │
    ├────────────►│              │                │
    │             │              │                │
    │             │ poll BC      │                │
    │             ├─────────────►│                │
    │             │              │                │
    │             │ balance Δ    │                │
    │             │◄─────────────┤                │
    │             │              │                │
    │             │update_pending│                │
    │             ├─────────────►│                │
    │             │              │                │
    │             │              │   execute      │
    │             │              │◄───────────────┤
    │             │              │                │
    │             │              │ collect_fees   │
    │             │              │◄───────────────┤
    │             │              │                │
    │             │              │ execute_buy    │
    │             │              │◄───────────────┤
    │             │              │                │
    │             │              │ burn_tokens    │
    │             │              │◄───────────────┤
    │             │              │                │
```

---

## Scalability

The system is designed to handle unlimited tokens:

| Feature | Implementation |
|---------|---------------|
| **Token Addition** | Create config file, run init-token-stats, restart daemon |
| **Daemon Recovery** | State persisted to `.daemon-state.json` |
| **Batch Efficiency** | Each token = 1 transaction (N+1 pattern) |
| **Rate Limiting** | Adaptive polling (3-30 second intervals) |
| **Memory Bounds** | 10,000 signature cache with FIFO eviction |

---

## Network Configuration

| Aspect | Devnet | Mainnet |
|--------|--------|---------|
| RPC | Helius devnet | Helius mainnet + fallback |
| Token Dir | `devnet-tokens/` | `mainnet-tokens/` |
| Wallet | `devnet-wallet.json` | `mainnet-wallet.json` |
| Jito | Disabled | Optional |
| Commitment | confirmed | finalized |

---

## PDA Derivation Edge Cases & Recovery

### PDA Seeds Reference

| Account | Seeds | Program |
|---------|-------|---------|
| DAT State | `["dat_v3"]` | ASDF-DAT |
| DAT Authority | `["auth_v3"]` | ASDF-DAT |
| Token Stats | `["token_stats_v1", mint]` | ASDF-DAT |
| Root Treasury | `["root_treasury", root_mint]` | ASDF-DAT |
| Validator State | `["validator_v1", mint, bonding_curve]` | ASDF-DAT |
| BC Creator Vault | `["creator-vault", creator]` (hyphen) | Pump.fun |
| AMM Creator Vault | `["creator_vault", creator]` (underscore) | PumpSwap |

### Bump Seeds & Collision Prevention

PDAs use "bump seeds" (255→0 search) to find valid off-curve addresses. The Solana runtime guarantees uniqueness for a given seed combination.

**Key Points:**
- Different seeds = different PDA (no collision possible)
- Same seeds in different programs = different PDA
- Bump is deterministic (always same for same seeds)

### Validator State Stale Recovery

If `validator_state.last_validated_slot` lags significantly (>1000 slots):

1. **Diagnosis**: Check `last_validated_slot` vs current slot
2. **Cause**: Usually RPC downtime or daemon restart without state
3. **Recovery**: Call `sync_validator_slot` (admin only, 1hr cooldown)

```bash
# Check validator state
npx ts-node scripts/check-validator-state.ts --network devnet

# Sync if stale (admin only)
npx ts-node scripts/sync-validator-slot.ts --network devnet
```

### Bonding Curve → AMM Migration

When a Pump.fun token graduates from bonding curve to PumpSwap AMM:

1. **Detect**: Token config `poolType` changes from `bonding_curve` to `pumpswap_amm`
2. **Update Config**: Edit token JSON: `"poolType": "amm"`, update `bondingCurve` to pool address
3. **Restart Daemon**: New pool address will be polled for transactions
4. **Verify**: Daemon logs show "AMM pool" for the token

**No fund loss during migration** - fees accumulate in the new AMM creator vault automatically.

---

*For implementation details, see [Developer Guide](DEVELOPER_GUIDE.md).*
*For instruction reference, see [API Reference](API_REFERENCE.md).*
