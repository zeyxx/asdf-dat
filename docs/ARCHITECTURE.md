# ASDF Burn Engine Architecture

Optimistic Burn Protocol - Technical Design

Single daemon executes. Chain proves. Anyone verifies.

---

## System Overview

ASDF Burn Engine is a two-layer system combining on-chain smart contracts with off-chain automation:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              ASDF Burn Engine                                   │
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

## Source Code Organization

The TypeScript source is organized into modular directories:

```
src/
├── cli.ts              # CLI entry point (daemon launcher)
├── daemon.ts           # Main daemon orchestration
│
├── core/               # Protocol constants, types, business logic
│   ├── constants.ts    # All protocol constants (single source of truth)
│   ├── pda-utils.ts    # PDA derivation functions
│   ├── types.ts        # On-chain account type definitions
│   ├── user-pool.ts    # Rebate pool & user stats
│   ├── allocation-calculator.ts  # Fee split calculations
│   ├── burn-engine.ts           # Core burn execution logic
│   ├── token-verifier.ts        # "Don't trust, verify" on-chain verification
│   ├── transaction-builder.ts   # Transaction construction helpers
│   └── index.ts        # Barrel exports
│
├── pump/               # Pump.fun SDK integration
│   ├── sdk.ts          # Buy/sell, wallet loading
│   ├── amm-utils.ts    # AMM pool, creator vault derivation
│   ├── price-utils.ts  # Price calculation, slippage
│   └── index.ts        # Barrel exports
│
├── monitoring/         # Fee monitoring & tracking
│   ├── realtime-tracker.ts  # WebSocket tracking
│   ├── validator-daemon.ts  # Trustless validation
│   └── index.ts        # Barrel exports
│
├── network/            # Network & RPC layer
│   ├── config.ts       # Network configs (devnet/mainnet)
│   ├── rpc-utils.ts    # Retry, TX confirmation
│   ├── jito-utils.ts   # Jito bundle submission
│   └── index.ts        # Barrel exports
│
├── observability/      # Logging, tracing, alerting
│   ├── logger.ts       # Structured logging with file output
│   ├── tracing.ts      # Distributed tracing context
│   ├── monitoring.ts   # Metrics collection
│   ├── alerting.ts     # Alert thresholds
│   ├── metrics-persistence.ts  # Metrics storage
│   └── index.ts        # Barrel exports
│
├── managers/           # Daemon manager classes
│   ├── rpc-manager.ts      # RPC connection pool
│   ├── token-manager.ts    # Token tracking & discovery
│   ├── fee-tracker.ts      # Fee attribution
│   └── cycle-manager.ts    # Cycle execution
│
├── utils/              # Config, state, utilities
│   ├── token-loader.ts      # Auto-discovery token loading (state → API → on-chain)
│   ├── config-validator.ts  # Token config validation
│   ├── execution-lock.ts    # Concurrency locks
│   ├── state-persistence.ts # Daemon state persistence
│   ├── env-validator.ts     # Environment validation
│   ├── history-manager.ts   # History tracking
│   ├── logger.ts            # Utility logger
│   ├── test-utils.ts        # Test helpers
│   ├── websocket-manager.ts # WebSocket management
│   └── index.ts        # Barrel exports
│
├── api/                # HTTP API & dashboard
│   ├── server.ts       # Express server
│   ├── control-panel.ts  # Dashboard control actions
│   └── websocket.ts    # WebSocket API
│
└── types/              # Runtime type definitions
    ├── index.ts        # All runtime types
    ├── dat-program.ts  # Program-specific types
    └── pump-sdk.d.ts   # Pump.fun SDK type declarations
```

### Module Imports

```typescript
// Import constants and PDAs
import { PROGRAM_ID, PUMP_PROGRAM, SECONDARY_KEEP_RATIO } from '../src/core';
import { deriveDATState, deriveTokenStats, deriveCreatorVaultBC } from '../src/core';

// Import token loading (autonomous discovery)
import { loadTokenFromState, loadAllTokensFromState, TokenLoader } from '../src/utils/token-loader';

// Import network utilities
import { withRetryAndTimeout, confirmTransactionWithRetry } from '../src/network';
import { NETWORK_CONFIGS, NetworkType } from '../src/network/config';

// Import Pump.fun SDK
import { buyTokens, sellTokens, loadWallet, deriveCreatorVault } from '../src/pump/sdk';

// Import token verifier ("Don't trust, verify")
import { verifyToken, discoverTokensByCreator, deriveTokenAddresses } from '../src/core/token-verifier';

// Import types
import { TokenConfig, DATState, TokenStats } from '../src/core/types';
```

---

## Off-Chain Components

### Unified Daemon (`src/daemon.ts`)

**Problem Solved**: All tokens from the same creator share ONE vault. Cannot determine per-token fees from vault balance alone.

**Solution**: Balance polling with transaction attribution + autonomous token discovery.

```
Token A Trade ──► Token A's BC (unique) ──┐
                                          ├──► Creator Vault (shared)
Token B Trade ──► Token B's BC (unique) ──┘

Daemon polls Token A's BC → detects vault change → attribute to A
Daemon polls Token B's BC → detects vault change → attribute to B
```

**How it works:**

1. **Auto-Discovery**: On startup, discovers all creator tokens on-chain (no JSON files needed)
2. **Token Verification**: Verifies each token on-chain ("Don't trust, verify")
3. **Fee Polling**: Every 5 seconds, polls each token's bonding curve/AMM for transactions
4. **Attribution**: Extracts vault balance changes and attributes to correct token
5. **State Persistence**: Saves state to `.asdf-state.json` for crash recovery

**Token Loading Priority (TokenLoader):**
```
1. State file (.asdf-state.json) → Cached tokens
2. API (daemon /tokens endpoint) → Live daemon state
3. On-chain discovery → getProgramAccounts with creator filter
```

**State Persistence:**
```json
{
  "tokens": [
    {
      "mint": "...",
      "symbol": "DROOT",
      "isRoot": true,
      "poolType": "bonding_curve",
      "bondingCurve": "...",
      "creator": "..."
    }
  ],
  "lastUpdated": "2025-12-01T00:00:00.000Z",
  "version": 2
}
```

**Starting the Daemon:**
```bash
# Autonomous mode (discovers tokens automatically)
npx ts-node src/cli.ts -c <creator-pubkey> -n devnet

# With all options
npx ts-node src/cli.ts --creator <pubkey> --network devnet --port 3030
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
│  ┌─────────┬─────────┬──────────┬────────┬─────────┬─────────┐ │
│  │ Compute │ Collect │ Buy+Split│Finalize│  Burn   │ Dev Fee │ │
│  │ Budget  │  Fees   │  Tokens  │ Cycle  │ Tokens  │  (1%)   │ │
│  └─────────┴─────────┴──────────┴────────┴─────────┴─────────┘ │
│                         │                                       │
│                         ▼                                       │
│  SECONDARY 2 (Single Batch TX)                                  │
│  ┌─────────┬─────────┬──────────┬────────┬─────────┬─────────┐ │
│  │ Compute │ Collect │ Buy+Split│Finalize│  Burn   │ Dev Fee │ │
│  │ Budget  │ (no-op) │  Tokens  │ Cycle  │ Tokens  │  (1%)   │ │
│  └─────────┴─────────┴──────────┴────────┴─────────┴─────────┘ │
│                         │                                       │
│                         ▼                                       │
│  ...more secondaries...                                         │
│                         │                                       │
│                         ▼                                       │
│  ROOT TOKEN (Single Batch TX) - NO DEV FEE                      │
│  ┌─────────┬─────────┬──────────┬────────┬─────────┐           │
│  │ Compute │ Collect │   Buy    │Finalize│  Burn   │           │
│  │ Budget  │  All    │  Tokens  │ Cycle  │ Tokens  │           │
│  └─────────┴─────────┴──────────┴────────┴─────────┘           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Dev Fee**: 1% of secondary's 55.2% share goes to dev wallet. Root token has no dev fee.

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
    ┌────┴────┐                                         │
    │         │                                         │
    ▼         ▼                                         │
┌───────┐ ┌───────┐                                     │
│  99%  │ │  1%   │                                     │
│ Burn  │ │ Dev   │                                     │
└───────┘ └───────┘                                     │
                                                        │
                              (On Root Cycle)           │
                                       ┌────────────────┘
                                       ▼
                              ┌─────────────────┐
                              │  Buy Root Token │
                              │  with treasury  │
                              │  + creator fees │
                              └────────┬────────┘
                                       │
                                       ▼
                              ┌─────────────────┐
                              │  100% Burn Root │
                              │  (no dev fee)   │
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
// Flush thresholds
FLUSH_THRESHOLD: u64 = 10_000_000;        // 0.01 SOL - minimum to flush
MAX_FEES_PER_CYCLE: u64 = 69_420_000_000_000;  // Market-driven via slippage
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
| **Token Addition** | Automatic on-chain discovery (no config files needed) |
| **Daemon Recovery** | State persisted to `.asdf-state.json` |
| **Batch Efficiency** | Each token = 1 transaction (N+1 pattern) |
| **Rate Limiting** | Adaptive polling (3-30 second intervals) |
| **Memory Bounds** | 10,000 signature cache with FIFO eviction |
| **Token Discovery** | getProgramAccounts with creator filter at offset 49 |

---

## Network Configuration

| Aspect | Devnet | Mainnet |
|--------|--------|---------|
| RPC | Helius devnet | Helius mainnet + fallback |
| Token Source | Auto-discovered on-chain | Auto-discovered on-chain |
| Wallet | `devnet-wallet.json` | `mainnet-wallet.json` |
| State File | `.asdf-state.json` | `.asdf-state.json` |
| Jito | Disabled | Optional |
| Commitment | confirmed | finalized |

---

## PDA Derivation Edge Cases & Recovery

### PDA Seeds Reference

| Account | Seeds | Program |
|---------|-------|---------|
| DAT State | `["dat_v3"]` | ASDF Burn Engine |
| DAT Authority | `["auth_v3"]` | ASDF Burn Engine |
| Token Stats | `["token_stats_v1", mint]` | ASDF Burn Engine |
| Root Treasury | `["root_treasury", root_mint]` | ASDF Burn Engine |
| Validator State | `["validator_v1", mint, bonding_curve]` | ASDF Burn Engine |
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

1. **Auto-Detection**: Daemon automatically detects pool type via `detectPoolType()`:
   - Checks bonding curve account existence
   - Falls back to AMM pool detection
2. **Seamless Transition**: No manual intervention required - daemon polls correct pool
3. **Verification**: Check daemon logs for "Pool type: pumpswap_amm" for migrated tokens

**No fund loss during migration** - fees accumulate in the new AMM creator vault automatically.

**Manual Check (if needed):**
```bash
# Verify a token's pool type
npx ts-node scripts/test-verify-architecture.ts --creator <pubkey>
```

---

## HTTP API Reference

The daemon exposes an HTTP API on port 3030 for dashboard and integrations.

### Status Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Daemon health status |
| `/health/sync` | GET | "Don't trust, verify" - Compare daemon state vs on-chain vault |
| `/fees` | GET | Current pending fees across all tokens |
| `/tokens` | GET | List of tracked tokens (auto-discovered) |
| `/burns` | GET | Recent burn history (query: `?limit=20`) |
| `/treasury` | GET | Root treasury balance |
| `/rebate-pool` | GET | Rebate pool stats |
| `/attestation` | GET | PoH chain attestation (cryptographic proof) |
| `/history` | GET | Recent PoH entries (query: `?count=50&type=fee_detected`) |

### Cycle Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/flush` | POST | Force daemon to sync fees on-chain |
| `/cycle` | POST | Execute burn cycle |
| `/cycle/status` | GET | Current cycle readiness status |

### Dashboard Control Endpoints (Devnet)

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/control/tokens` | GET | - | List tokens (from daemon, no files needed) |
| `/control/wallet` | GET | - | Wallet balance |
| `/control/fees` | GET | `?creator=...&rootMint=...` | Check creator vault fees |
| `/control/volume` | POST | `{ tokenFile, numBuys?, buyAmount? }` | Generate buy volume |
| `/control/sell` | POST | `{ tokenFile }` | Sell tokens |
| `/control/cycle` | POST | `{ tokenFile, network? }` | Execute burn cycle |
| `/control/sync-fees` | POST | `{ tokenFile?, network? }` | Sync fees to on-chain |
| `/control/workflow` | POST | `{ tokenFile, cycles?, solPerCycle?, waitMs? }` | Full E2E workflow |
| `/control/create-token` | POST | `{ name, symbol, isRoot?, mayhemMode? }` | Create new token |
| `/control/init-token-stats` | POST | `{ tokenFile }` | Initialize TokenStats |
| `/control/set-root-token` | POST | `{ tokenFile }` | Set token as root |

### Test/Mock Endpoints (Dashboard Development)

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/test/add-token` | POST | `{ symbol, name?, isRoot? }` | Add mock token |
| `/test/add-fee` | POST | `{ mint, amountSOL }` | Add mock fee |
| `/test/simulate-burn` | POST | `{ mint }` | Simulate burn cycle |
| `/test/clear` | POST | - | Clear all mock data |
| `/test/scenario` | POST | `{ scenario }` | Load scenario: "healthy", "pending", "active" |

### Example API Usage

```bash
# Check health with sync verification
curl http://localhost:3030/health
curl http://localhost:3030/health/sync

# Get pending fees
curl http://localhost:3030/fees

# Get all discovered tokens
curl http://localhost:3030/tokens

# Force flush
curl -X POST http://localhost:3030/flush

# Execute cycle
curl -X POST http://localhost:3030/cycle

# Check cycle readiness
curl http://localhost:3030/cycle/status

# Get attestation (cryptographic proof)
curl http://localhost:3030/attestation
```

---

*For implementation details, see [Developer Guide](DEVELOPER_GUIDE.md).*
*For instruction reference, see [API Reference](API_REFERENCE.md).*
