# ASDF-DAT Technical Reference

This document serves as the definitive technical reference for the ASDF-DAT ecosystem. **Always consult this before making changes or assumptions about the system.**

## Core Concept: DAT (Decentralized Autonomous Treasury)

DAT creates economic alignment between tokens through automatic fee capture and buyback & burn mechanics.

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
- **Secondary Tokens**: Keep 55.2% of their own fees for buyback

### Fee Split: 55.2% / 44.8%

```
Secondary Token Trade (any DEX volume)
           │
           ▼
    Creator Fee (dynamic %)
           │
    ┌──────┴──────┐
    │             │
    ▼             ▼
  55.2%        44.8%
Secondary    Root Token
 Buyback     Treasury
```

---

## Pump.fun Integration

### CRITICAL: Creator Fee Structure

**Creator fees on Pump.fun are DYNAMIC and set by Pump.fun based on market cap:**

| Market Cap Range | Creator Fee |
|------------------|-------------|
| $88K - $300K     | 0.95%       |
| > $20M           | 0.05%       |

The fee percentage is **NOT** set by the token creator. It is determined by Pump.fun's "Project Ascend" system.

### Two Pool Types

#### 1. Bonding Curve (Pre-migration)
- Program: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`
- Creator vault: Native SOL
- Vault derivation: `["creator-vault", creator_pubkey]` (with HYPHEN)
- Fees accumulate as SOL

#### 2. PumpSwap AMM (Post-migration)
- Program: `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`
- Creator vault: WSOL Token Account
- Vault derivation: `["creator_vault", creator_pubkey]` (with UNDERSCORE)
- Fees accumulate as WSOL (need unwrap to SOL)

### CRITICAL: Shared Vault Architecture

**All tokens created by the same creator share a SINGLE vault.**

```
Creator Wallet (DAT Authority)
           │
           ▼
    Shared Creator Vault  ◄── All secondary fees go here
           │
    ┌──────┼──────┬──────┐
    │      │      │      │
    ▼      ▼      ▼      ▼
  DATS2   DATM  Token3  Token4
```

**Implications:**
1. Cannot know per-token fees just from vault balance
2. Need daemon to track fees via preBalances/postBalances
3. Proportional distribution based on tracked `pending_fees`

---

## On-Chain Architecture

### Program ID
```
ASDfNfUHwVGfrg3SV7SQYWhaVxnrCUZyWmMpWJAPu4MZ
```

### PDA Seeds
| Account | Seeds |
|---------|-------|
| DAT State | `["dat_v3"]` |
| DAT Authority | `["auth_v3"]` |
| Token Stats | `["token_stats_v1", mint]` |
| Root Treasury | `["root_treasury", root_mint]` |
| Validator State | `["validator_v1", mint, bonding_curve]` |

### Key Accounts

#### DATState
Global configuration:
- `admin`: Admin pubkey
- `root_token_mint`: Root token for 44.8% share
- `fee_split_bps`: 5520 = 55.2% to secondary
- `is_active`, `emergency_pause`: Control flags

#### TokenStats
Per-token statistics:
- `mint`: Token mint address
- `total_burned`: Cumulative tokens burned
- `total_sol_collected`: Cumulative fees collected
- `pending_fees_lamports`: **CRITICAL** - Fees tracked but not yet used
- `is_root_token`: Boolean flag

---

## Fee Attribution System

### The Problem
Shared vault = Cannot know per-token fees from balance alone.

### The Solution: Balance Polling Daemon

**Key insight:** Each token has a UNIQUE bonding curve/pool, but they share the SAME creator vault.

```
Token A Trade ──► Token A's BC (unique) ──► Creator Vault (shared)
Token B Trade ──► Token B's BC (unique) ──► Creator Vault (shared)

Fee Monitor Daemon
       │
       ├── Poll Token A's bonding curve for transactions
       │   └── In those TX: extract vault balance delta → attribute to Token A
       │
       ├── Poll Token B's bonding curve for transactions
       │   └── In those TX: extract vault balance delta → attribute to Token B
       │
       └── Update each TokenStats.pending_fees on-chain
```

### How It Works

1. **Daemon** (`monitor-ecosystem-fees.ts`):
   - Polls each token's **unique** bonding curve/pool for transactions
   - For each TX, extracts the shared vault's balance change
   - Since we polled TOKEN A's BC, the fee in that TX belongs to TOKEN A
   - Calls `update_pending_fees` instruction
   - **State persistence**: Saves `lastSignatures` to `.daemon-state.json` for crash recovery

2. **Orchestrator** (`execute-ecosystem-cycle.ts`):
   - Reads `pending_fees` from all TokenStats
   - Calculates proportional distribution
   - Executes buyback for each token with allocated amount

### Scalability to N Tokens

The daemon is designed to scale to **any number of tokens**:

| Feature | Implementation | Benefit |
|---------|---------------|---------|
| **State Persistence** | `.daemon-state.json` | No fee loss on restart |
| **TX Limit** | 50 per poll (configurable) | Handles high-volume periods |
| **Parallel Polling** | Sequential per token | Prevents RPC rate limits |
| **Crash Recovery** | Auto-restore signatures | Resume from last known state |

**State File Format:**
```json
{
  "lastSignatures": {
    "<mint_pubkey>": "<last_processed_signature>",
    ...
  },
  "lastUpdated": "2025-01-01T00:00:00.000Z",
  "version": 1
}
```

**Adding New Tokens:**
1. Create `devnet-token-new.json` config
2. Run `init-token-stats.ts` for the new token
3. Restart daemon - auto-detects new tokens

### Fee Flow

```
Trading Activity
       │
       ▼
Creator Vault (shared)
       │
       ├── Daemon detects via balance polling
       │   └── Updates TokenStats.pending_fees
       │   └── Persists lastSignature to .daemon-state.json
       │
       ▼
Cycle Execution
       │
       ├── collect_fees (drains vault to datAuthority)
       │
       ├── For each secondary (proportional to pending_fees):
       │   ├── execute_buy_secondary (with allocated_lamports)
       │   ├── split_fees_to_root (44.8% to root_treasury)
       │   ├── finalize_allocated_cycle (reset pending_fees)
       │   └── burn_and_update (burn tokens)
       │
       └── Root token cycle (uses root_treasury balance)
```

---

## Key Constants

### From lib.rs
```rust
MIN_FEES_TO_CLAIM: u64 = 10_000_000;      // 0.01 SOL
MAX_FEES_PER_CYCLE: u64 = 1_000_000_000;  // 1 SOL
INITIAL_SLIPPAGE_BPS: u16 = 500;          // 5%
MIN_CYCLE_INTERVAL: i64 = 60;             // 60 seconds

// Buy safety margins
RENT_EXEMPT_MINIMUM: u64 = 890_880;       // ~0.00089 SOL
SAFETY_BUFFER: u64 = 50_000;              // ~0.00005 SOL
ATA_RENT_RESERVE: u64 = 2_100_000;        // ~0.0021 SOL
MIN_FEES_FOR_SPLIT: u64 = 5_500_000;      // ~0.0055 SOL
MINIMUM_BUY_AMOUNT: u64 = 100_000;        // ~0.0001 SOL
```

### From execute-ecosystem-cycle.ts
```typescript
SECONDARY_KEEP_RATIO = 0.552;  // 55.2%

// Minimum allocation = amount needed BEFORE 44.8% split
MIN_ALLOCATION_SECONDARY = Math.ceil(
  (RENT_EXEMPT_MINIMUM + SAFETY_BUFFER + ATA_RENT_RESERVE + MINIMUM_BUY_AMOUNT)
  / SECONDARY_KEEP_RATIO
);
// = 3,140,880 / 0.552 = ~5,690,000 lamports (~0.00569 SOL)

TX_FEE_RESERVE_PER_TOKEN = 7_000_000;  // ~0.007 SOL

TOTAL_COST_PER_SECONDARY = MIN_ALLOCATION_SECONDARY + TX_FEE_RESERVE_PER_TOKEN;
// = ~12,690,000 lamports (~0.0127 SOL per secondary token)
```

---

## Execution Flow

### Ecosystem Cycle (N+1 Pattern)

Each secondary token executes in a **single batch transaction**:

```
TX: [Compute Budget] + [Collect] + [Buy] + [Finalize] + [Burn]
```

This is the N+1 pattern:
1. First token: Collect drains vault → Buy with proportional share
2. Other tokens: Collect (no-op, vault empty) → Buy from remaining datAuthority balance

### Root Token Cycle

After all secondaries:
1. Collect from root creator vault (if bonding curve)
2. Add root_treasury balance (44.8% from all secondaries)
3. Buy tokens with full balance
4. Burn tokens

---

## Testing Requirements

**Full documentation: [docs/DEVNET_TESTING_PROCEDURE.md](docs/DEVNET_TESTING_PROCEDURE.md)**

### Critical Thresholds for Testing

| Threshold | Value | Description |
|-----------|-------|-------------|
| **MIN_FEES_FOR_SPLIT** | 0.0055 SOL | Minimum per secondary token to execute cycle |
| **MIN_ALLOCATION_SECONDARY** | 0.00569 SOL | Minimum allocation after proportional split |
| **Creator Fee (devnet BC)** | ~0.3% | Approximate fee on bonding curve trades |

### Volume Calculation for Successful Cycle

To reach **0.006 SOL fees** per secondary token with ~0.3% creator fee:
```
Required volume = 0.006 / 0.003 = 2 SOL per token
```

**Optimized approach (buy + sell cycles):**
- Each round: 0.5 SOL buy + sell all = ~0.003 SOL fees
- **2 rounds minimum** per token = 0.006 SOL fees ✅

### Quick Devnet Test (OPTIMIZED)

```bash
# 1. Start daemon (background)
pkill -f "monitor-ecosystem-fees" 2>/dev/null || true
npx ts-node scripts/monitor-ecosystem-fees.ts --network devnet > /tmp/daemon-output.txt 2>&1 &

# 2. Generate volume: 2 rounds of buy (0.5 SOL) + sell per token
# Round 1 - BUYS
npx ts-node scripts/generate-volume.ts devnet-token-spl.json 1 0.5
npx ts-node scripts/generate-volume.ts devnet-token-secondary.json 1 0.5
npx ts-node scripts/generate-volume.ts devnet-token-mayhem.json 1 0.5

# Round 1 - SELLS
npx ts-node scripts/sell-spl-tokens-simple.ts devnet-token-spl.json
npx ts-node scripts/sell-spl-tokens-simple.ts devnet-token-secondary.json
npx ts-node scripts/sell-mayhem-tokens.ts

# Round 2 - BUYS
npx ts-node scripts/generate-volume.ts devnet-token-spl.json 1 0.5
npx ts-node scripts/generate-volume.ts devnet-token-secondary.json 1 0.5
npx ts-node scripts/generate-volume.ts devnet-token-mayhem.json 1 0.5

# Round 2 - SELLS
npx ts-node scripts/sell-spl-tokens-simple.ts devnet-token-spl.json
npx ts-node scripts/sell-spl-tokens-simple.ts devnet-token-secondary.json
npx ts-node scripts/sell-mayhem-tokens.ts

# 3. Wait for daemon sync (15s)
sleep 15

# 4. Execute cycle
npx ts-node scripts/execute-ecosystem-cycle.ts devnet-token-spl.json
```

### Volume Generation Rules
- **ALWAYS buy AND sell** - Each direction generates creator fees
- **Use 0.5 SOL per trade** for efficient fee accumulation (~0.0015 SOL fees each)
- **2 rounds minimum** (buy+sell each) = ~0.006 SOL fees per token
- Creator fee varies: 0.05% (high mcap) to 0.95% (low mcap), ~0.3% typical on devnet

### Devnet Tokens
```
devnet-token-spl.json      - DATSPL (Root token, SPL bonding curve)
devnet-token-secondary.json - DATS2 (Secondary, SPL bonding curve)
devnet-token-mayhem.json    - DATM (Secondary, Token2022)
```

### Sell Scripts
```bash
# SPL tokens (DATSPL, DATS2)
npx ts-node scripts/sell-spl-tokens-simple.ts <token-config.json>

# Token2022 / Mayhem mode (DATM)
npx ts-node scripts/sell-mayhem-tokens.ts
```

---

## Common Errors & Solutions

### "Insufficient fees"
- pending_fees below MIN_FEES_FOR_SPLIT (0.0055 SOL)
- Solution: Generate more volume or wait for daemon sync

### "Cycle too soon"
- MIN_CYCLE_INTERVAL (60s) not elapsed
- TESTING_MODE = false in production

### "Invalid root treasury"
- Root token not configured via `set_root_token`
- Solution: Run `set-root-token.ts` first

### "Vault not initialized"
- Creator vault doesn't exist yet
- Solution: Execute at least one trade to initialize

---

## File Structure

```
asdf-dat/
├── programs/asdf-dat/src/lib.rs   # Solana program (Anchor)
├── lib/
│   ├── fee-monitor.ts             # Balance polling daemon library
│   ├── amm-utils.ts               # PumpSwap AMM utilities
│   └── network-config.ts          # Network configuration
├── scripts/
│   ├── execute-ecosystem-cycle.ts # Main orchestrator
│   ├── monitor-ecosystem-fees.ts  # Fee daemon entry point
│   ├── init-dat-state.ts          # Initialize DAT state
│   ├── init-token-stats.ts        # Initialize TokenStats
│   ├── set-root-token.ts          # Configure root token
│   └── generate-volume.ts         # Generate test volume
├── devnet-token-*.json            # Token configurations
├── devnet-wallet.json             # Devnet admin wallet
└── docs/whitepaper/               # Public documentation
```

---

## Mainnet vs Devnet

| Aspect | Devnet | Mainnet |
|--------|--------|---------|
| RPC | api.devnet.solana.com | api.mainnet-beta.solana.com |
| Wallet | devnet-wallet.json | mainnet-wallet.json |
| TESTING_MODE | Can be true | Must be false |
| Token files | devnet-token-*.json | mainnet-token-*.json |

Use `--network devnet` or `--network mainnet` flag on all scripts.

---

## Important Reminders

1. **All documentation in English** (per project requirements)
2. **Shared vault = need daemon for fee attribution**
3. **Creator fees are dynamic** (set by Pump.fun based on market cap)
4. **55.2%/44.8% split is configurable** via `fee_split_bps`
5. **N+1 batch transactions** for efficiency
6. **Always verify daemon is syncing** before running cycles
- Pour générer des volumes sur des tokens Pumpfun, il faut toujours faire des achats ainsi que des ventes.
- Pour les tests futurs, le daemon tourne déjà - tu peux directement:
  # Générer du volume (le daemon détecte automatiquement)
  npx ts-node scripts/generate-volume.ts devnet-token-spl.json 1 0.5
  npx ts-node scripts/sell-spl-tokens-simple.ts devnet-token-spl.json

  # Attendre 15s pour sync
  sleep 30

  # Exécuter le cycle
  npx ts-node scripts/execute-ecosystem-cycle.ts devnet-token-spl.json