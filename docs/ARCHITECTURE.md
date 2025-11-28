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
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │              $asdfasdfa (PROTOCOL ROOT)                          │   │
│   │         Receives 5.52% from ALL DATs ecosystem-wide              │   │
│   │                  Immediate buyback/burn                          │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                  ▲                                       │
│                    5.52% protocol fee (FIXED)                           │
│     ┌────────────────────────────┼────────────────────────────┐         │
│     │                            │                            │         │
│     │                            │                            │         │
│ ┌───┴─────────────────┐   ┌──────┴──────────────┐   ┌─────────┴───────┐ │
│ │       DAT A         │   │       DAT B         │   │       DAT N     │ │
│ │  (own ecosystem)    │   │  (own ecosystem)    │   │  (own ecosystem)│ │
│ │                     │   │                     │   │                 │ │
│ │  ┌───────────────┐  │   │  ┌───────────────┐  │   │  ┌───────────┐  │ │
│ │  │ DAT A Root    │  │   │  │ DAT B Root    │  │   │  │ DAT N Root│  │ │
│ │  │ (40% config)  │  │   │  │ (50% config)  │  │   │  │ (30%)     │  │ │
│ │  └───────┬───────┘  │   │  └───────┬───────┘  │   │  └─────┬─────┘  │ │
│ │          │          │   │          │          │   │        │        │ │
│ │  ┌───────┴───────┐  │   │  ┌───────┴───────┐  │   │  ┌─────┴─────┐  │ │
│ │  │ Secondaries   │  │   │  │ Secondaries   │  │   │  │Secondaries│  │ │
│ │  │ (60% config)  │  │   │  │ (50% config)  │  │   │  │ (70%)     │  │ │
│ │  └───────────────┘  │   │  └───────────────┘  │   │  └───────────┘  │ │
│ └─────────────────────┘   └─────────────────────┘   └─────────────────┘ │
│                                                                          │
│    Each DAT = own root + secondaries with CONFIGURABLE internal split    │
│         No treasury - ALL fees immediately converted to burns            │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Architectural Changes

| Aspect | Phase 1 | Phase 2 |
|--------|---------|---------|
| **Scope** | Single ecosystem | Multi-tenant (anyone can create a DAT) |
| **Protocol Fee** | N/A | 5.52% → $asdfasdfa (FIXED) |
| **DAT Structure** | Single root + secondaries | Each DAT has own root + secondaries |
| **Internal Split** | Fixed 55.2%/44.8% | Configurable per DAT |
| **DAT Creation** | Manual setup | Factory pattern (permissionless) |
| **Daemon** | Single ecosystem | Supports N DATs |
| **Treasury** | Root treasury accumulates | No treasury (all immediate burns) |

### Phase 2 Fee Formula

```
INPUTS:
  total_fees = 100% of creator fees collected
  protocol_fee_rate = 5.52% (FIXED, non-configurable)
  internal_root_ratio = X% (CONFIGURABLE per DAT)

STEP 1: Protocol Fee (taken first from total)
  protocol_fee = total_fees × 5.52%
  → Immediate $asdfasdfa buyback/burn

STEP 2: DAT Internal Distribution (remaining 94.48%)
  remaining = total_fees × 94.48%

  dat_root_share = remaining × internal_root_ratio
  → Immediate DAT root token buyback/burn

  secondary_share = remaining × (1 - internal_root_ratio)
  → Immediate secondary token buyback/burn
```

### Component Evolution

#### 1. DAT Factory (Phase 2)

New instruction for permissionless DAT creation:

```
create_dat(
    creator: Pubkey,
    root_token_mint: Pubkey,
    internal_root_ratio_bps: u16,  // e.g., 4000 = 40%
) → DATInstance
```

Each DAT instance has:
- Own state account (DATInstance PDA)
- Own root token + ability to add secondary tokens
- Configurable internal root/secondary split
- Fixed 5.52% protocol fee to $asdfasdfa (automatic)

#### 2. Universal Daemon

```
Universal Daemon
        │
        ├── Registry of all DATs (on-chain)
        │
        ├── For each DAT:
        │   ├── Monitor creator vault
        │   ├── Attribute fees per token (root + secondaries)
        │   └── Update pending_fees on-chain
        │
        └── Batch updates for efficiency
```

#### 3. Immediate Buyback/Burn

No treasury accumulation at any level - all fees immediately converted to burns:

```
Example: DAT A with 40% internal root ratio

Secondary Token Trade generates 1 SOL fees:
├── 0.0552 SOL (5.52%) ──► $asdfasdfa buyback/burn
└── 0.9448 SOL (94.48%) ──► DAT A internal
    ├── 0.3779 SOL (40%) ──► DAT A Root buyback/burn
    └── 0.5669 SOL (60%) ──► Secondary buyback/burn
```

### Fee Flow (Phase 2)

```
Trading on Secondary Token in DAT X
              │
              ▼
       Creator Fee (100%)
              │
              ▼
┌─────────────┴─────────────┐
│                           │
▼                           ▼
5.52% (FIXED)          94.48% (remaining)
$asdfasdfa             DAT X Internal
buyback/burn           (CONFIGURABLE)
                            │
                   ┌────────┴────────┐
                   │                 │
                   ▼                 ▼
           (94.48% × X%)      (94.48% × (1-X)%)
           DAT X Root          Secondary Token
           buyback/burn        buyback/burn
```

### Phase 2 Use Case Example

**Community "MemeDAO" creates their DAT:**
- Root token: $MEME (their main community token)
- Secondary tokens: $MEME2, $MEME3 (ecosystem tokens)
- Internal root ratio: 40%
- Protocol fee: 5.52% to $asdfasdfa (automatic)

**When 1 SOL of fees is collected from $MEME2 trading:**

| Recipient | Calculation | Amount |
|-----------|-------------|--------|
| $asdfasdfa (Protocol) | 1 × 5.52% | 0.0552 SOL |
| $MEME (DAT Root) | 0.9448 × 40% | 0.3779 SOL |
| $MEME2 (Secondary) | 0.9448 × 60% | 0.5669 SOL |
| **Total** | | **1.0000 SOL** |

**Core Principle**: No treasury accumulation at any level. Every SOL collected is immediately used for buyback and the purchased tokens are permanently burned.

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
