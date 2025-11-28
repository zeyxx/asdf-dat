# ASDF-DAT Architecture

Technical architecture documentation for the Decentralized Autonomous Treasury protocol.

---

## Overview

ASDF-DAT is a Solana-based protocol that automates buyback and burn mechanisms for pump.fun tokens. The architecture evolves through two phases:

- **Phase 1**: Single ecosystem validation with $asdfasdfa
- **Phase 2**: Universal infrastructure for all pump.fun creators

---

## Phase 1: Single Ecosystem Architecture

### System Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         ASDF-DAT ECOSYSTEM                               │
│                                                                          │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                     ROOT TOKEN ($asdfasdfa)                      │   │
│   │                         Receives 44.8%                           │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                  ▲                                       │
│                                  │                                       │
│                    ┌─────────────┴─────────────┐                        │
│                    │      Root Treasury        │                        │
│                    │   (accumulates 44.8%)     │                        │
│                    └─────────────┬─────────────┘                        │
│                                  │                                       │
│         ┌────────────────────────┼────────────────────────┐             │
│         │                        │                        │             │
│         ▼                        ▼                        ▼             │
│   ┌───────────┐            ┌───────────┐            ┌───────────┐       │
│   │ Secondary │            │ Secondary │            │ Secondary │       │
│   │  Token 1  │            │  Token 2  │            │  Token N  │       │
│   │  (55.2%)  │            │  (55.2%)  │            │  (55.2%)  │       │
│   └─────┬─────┘            └─────┬─────┘            └─────┬─────┘       │
│         │                        │                        │             │
│         └────────────────────────┼────────────────────────┘             │
│                                  │                                       │
│                                  ▼                                       │
│                    ┌─────────────────────────┐                          │
│                    │    Shared Creator Vault  │                          │
│                    │   (fees accumulate here) │                          │
│                    └─────────────────────────┘                          │
│                                  ▲                                       │
│                                  │                                       │
│                         Trading Activity                                 │
│                    (pump.fun bonding curve / AMM)                        │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Components

#### 1. On-Chain Program (Anchor/Rust)

**Program ID**: `ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui`

Core instructions:
- `initialize`: Set up DAT state and authority PDAs
- `initialize_token_stats`: Create per-token tracking
- `set_root_token`: Configure root token for fee distribution
- `collect_fees`: Drain creator vault to DAT authority
- `execute_buy_secondary`: Buy tokens with fee split
- `split_fees_to_root`: Transfer 44.8% to root treasury
- `burn_and_update`: Burn tokens and update statistics
- `finalize_allocated_cycle`: Complete cycle and reset pending fees

#### 2. Fee Monitor Daemon

**File**: `scripts/monitor-ecosystem-fees.ts`

Purpose: Solves the "shared vault problem" by attributing fees to specific tokens.

```
Shared Creator Vault ◄─── All secondary fees go here
        │
        │  Daemon Process:
        │  ├── Poll Token A's bonding curve transactions
        │  │   └── Extract vault balance delta → attribute to Token A
        │  ├── Poll Token B's bonding curve transactions
        │  │   └── Extract vault balance delta → attribute to Token B
        │  └── Call update_pending_fees on-chain
        │
        ▼
TokenStats.pending_fees (per token, on-chain)
```

State persistence via `.daemon-state.json`:
- Stores last processed signature per token
- Enables crash recovery without fee loss

#### 3. Ecosystem Orchestrator

**File**: `scripts/execute-ecosystem-cycle.ts`

Executes buyback/burn cycles using the N+1 pattern:

```
For each token with sufficient pending_fees:
┌─────────────────────────────────────────────────────────────┐
│ Single Transaction:                                          │
│   [Compute Budget] → [Collect] → [Buy] → [Finalize] → [Burn] │
└─────────────────────────────────────────────────────────────┘

Token 1: Collect drains vault → Buy with proportional share
Token 2: Collect (no-op) → Buy from datAuthority balance
Token N: Collect (no-op) → Buy from remaining balance
Root:    Uses root_treasury balance for buyback
```

### PDA Structure

| Account | Seeds | Purpose |
|---------|-------|---------|
| DAT State | `["dat_v3"]` | Global configuration |
| DAT Authority | `["auth_v3"]` | Holds SOL between operations |
| Token Stats | `["token_stats_v1", mint]` | Per-token statistics |
| Root Treasury | `["root_treasury", root_mint]` | Accumulated 44.8% for root |
| Validator State | `["validator_v1", mint, bonding_curve]` | Fee validation |

### Fee Flow (Phase 1)

```
Trading Activity (pump.fun)
        │
        ▼
Creator Fee (0.05% - 0.95% of volume)
        │
        ▼
Shared Creator Vault
        │
        ├── Daemon detects via balance polling
        │   └── Updates TokenStats.pending_fees
        │
        ▼
Cycle Execution (Orchestrator)
        │
        ├── collect_fees (drains vault → datAuthority)
        │
        ├── For each secondary (proportional to pending_fees):
        │   │
        │   ├── execute_buy_secondary (with allocated_lamports)
        │   │   │
        │   │   ├── 55.2% → Buy secondary tokens
        │   │   └── 44.8% → root_treasury
        │   │
        │   ├── finalize_allocated_cycle (reset pending_fees)
        │   └── burn_and_update (burn purchased tokens)
        │
        └── Root token cycle
            │
            ├── Collect root_treasury balance
            ├── Buy root tokens
            └── Burn root tokens
```

---

## Phase 2: Universal Infrastructure Architecture

### System Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      ASDF-DAT UNIVERSAL PROTOCOL                         │
│                                                                          │
│                    ┌─────────────────────────────┐                       │
│                    │    $asdfasdfa ROOT TOKEN    │                       │
│                    │    (Protocol Root)          │                       │
│                    └─────────────────────────────┘                       │
│                                  ▲                                       │
│                                  │                                       │
│                    ┌─────────────┴─────────────┐                        │
│                    │     Protocol Treasury      │                        │
│                    │   (receives 5.52% from     │                        │
│                    │    ALL integrated DATs)    │                        │
│                    └─────────────┬─────────────┘                        │
│                                  │                                       │
│     ┌────────────────────────────┼────────────────────────────┐         │
│     │                            │                            │         │
│     ▼                            ▼                            ▼         │
│ ┌─────────┐               ┌─────────┐               ┌─────────┐         │
│ │  DAT A  │               │  DAT B  │               │  DAT N  │         │
│ │Community│               │ Creator │               │  Project│         │
│ │   DAO   │               │   Solo  │               │   Team  │         │
│ └────┬────┘               └────┬────┘               └────┬────┘         │
│      │                         │                         │              │
│      │ 5.52%                   │ 5.52%                   │ 5.52%        │
│      │ to root                 │ to root                 │ to root      │
│      │                         │                         │              │
│      ▼                         ▼                         ▼              │
│ ┌─────────┐               ┌─────────┐               ┌─────────┐         │
│ │Token(s) │               │Token(s) │               │Token(s) │         │
│ │Buyback  │               │Buyback  │               │Buyback  │         │
│ │& Burn   │               │& Burn   │               │& Burn   │         │
│ └─────────┘               └─────────┘               └─────────┘         │
│                                                                          │
│     Each DAT configures their own internal fee split                     │
│     (how to distribute the remaining 94.48%)                             │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Architectural Changes

| Aspect | Phase 1 | Phase 2 |
|--------|---------|---------|
| **Scope** | Single ecosystem | Multi-tenant |
| **Root Fee** | 44.8% from secondaries | 5.52% from all DATs |
| **DAT Creation** | Manual setup | Factory pattern |
| **Fee Split** | Fixed 55.2%/44.8% | Configurable per DAT |
| **Daemon** | Single ecosystem | Supports N DATs |
| **Integration** | Permissioned | Permissionless |

### Component Evolution

#### 1. DAT Factory (Phase 2)

New instruction for permissionless DAT creation:

```
create_dat(
    creator: Pubkey,
    token_mint: Pubkey,
    internal_split_config: SplitConfig,
) → DATInstance
```

Each DAT instance has:
- Own state account
- Configurable internal fee distribution
- Fixed 5.52% protocol fee to root

#### 2. Universal Daemon

```
Universal Daemon
        │
        ├── Registry of all DATs
        │
        ├── For each DAT:
        │   ├── Monitor creator vault
        │   ├── Attribute fees per token
        │   └── Update pending_fees
        │
        └── Batch updates for efficiency
```

#### 3. Protocol Treasury

Dedicated treasury for $asdfasdfa that receives 5.52% from ALL integrated DATs:

```
DAT A fees ──► 5.52% ──┐
DAT B fees ──► 5.52% ──┼──► Protocol Treasury ──► $asdfasdfa Buyback/Burn
DAT N fees ──► 5.52% ──┘
```

### Fee Flow (Phase 2)

```
Any pump.fun Token Trading
        │
        ▼
Creator Fee Collected
        │
        ▼
Integrated DAT Processing
        │
        ├── 5.52% → Protocol Treasury ($asdfasdfa)
        │
        └── 94.48% → DAT Internal Distribution
            │
            ├── X% → Token buyback/burn
            ├── Y% → Community treasury (optional)
            └── Z% → Creator allocation (optional)
```

---

## Pump.fun Integration

### Two Pool Types

#### Bonding Curve (Pre-migration)
- **Program**: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`
- **Creator Vault**: Native SOL
- **Vault Seeds**: `["creator-vault", creator_pubkey]` (with HYPHEN)

#### PumpSwap AMM (Post-migration)
- **Program**: `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`
- **Creator Vault**: WSOL Token Account
- **Vault Seeds**: `["creator_vault", creator_pubkey]` (with UNDERSCORE)

### Shared Vault Architecture

All tokens from the same creator share a single vault. This creates the "fee attribution problem" solved by the daemon.

```
Creator Wallet
       │
       ▼
Single Creator Vault ◄── All tokens' fees merge here
       │
   Cannot know per-token fees from vault balance alone
       │
       ▼
Daemon Solution: Poll each token's unique bonding curve,
                 extract vault delta from those TX
```

---

## Security Architecture

### On-Chain Safety

- Admin-only functions protected by signer verification
- Emergency pause capability
- MIN_CYCLE_INTERVAL prevents rapid-fire attacks
- Slippage protection on buybacks

### Daemon Safety

- State persistence for crash recovery
- No private key storage (uses wallet file)
- Read-only RPC operations (except update_pending_fees)

### Mainnet Configuration

| Parameter | Devnet | Mainnet |
|-----------|--------|---------|
| TESTING_MODE | true | false |
| MIN_CYCLE_INTERVAL | bypassed | 60 seconds |
| MIN_FEES_TO_CLAIM | bypassed | 0.01 SOL |

---

## File Structure

```
asdf-dat/
├── programs/asdf-dat/
│   └── src/lib.rs              # Solana program (Anchor)
│
├── scripts/
│   ├── execute-ecosystem-cycle.ts   # Orchestrator
│   ├── monitor-ecosystem-fees.ts    # Fee daemon
│   ├── init-dat-state.ts            # DAT initialization
│   ├── init-token-stats.ts          # Token stats setup
│   └── set-root-token.ts            # Root token config
│
├── lib/
│   ├── fee-monitor.ts          # Daemon library
│   ├── amm-utils.ts            # PumpSwap utilities
│   └── network-config.ts       # Network configuration
│
└── docs/
    ├── ARCHITECTURE.md         # This document
    ├── TOKENOMICS.md           # Economic model
    ├── INTEGRATION.md          # Phase 2 integration
    └── GLOSSARY.md             # Terminology
```

---

## Related Documentation

- [Tokenomics](TOKENOMICS.md) - Economic model and fee mathematics
- [Integration Guide](INTEGRATION.md) - How to integrate with DAT (Phase 2)
- [Glossary](GLOSSARY.md) - Technical terminology
