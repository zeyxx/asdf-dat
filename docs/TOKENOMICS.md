# ASDF-DAT Tokenomics

Economic model documentation for the Decentralized Autonomous Treasury protocol.

---

## Overview

ASDF-DAT creates sustainable token economics through automated buyback and burn mechanisms. The economic model evolves through two phases:

- **Phase 1**: Validation with 55.2%/44.8% split within $asdfasdfa ecosystem
- **Phase 2**: Universal infrastructure with 5.52% protocol fee to $asdfasdfa

---

## Phase 1: Validation Economics

### The Fee Split: 55.2% / 44.8%

Every trade on pump.fun generates a creator fee. DAT captures and splits these fees:

```
┌─────────────────────────────────────────────────────────────┐
│                    CREATOR FEE (dynamic)                    │
│                         100%                                │
├─────────────────────────────────────────────────────────────┤
│                           │                                 │
│              ┌────────────┴────────────┐                    │
│              │                         │                    │
│              ▼                         ▼                    │
│     ┌─────────────────┐     ┌─────────────────┐            │
│     │     55.2%       │     │     44.8%       │            │
│     │   SECONDARY     │     │      ROOT       │            │
│     │    BUYBACK      │     │    TREASURY     │            │
│     └─────────────────┘     └─────────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

### Why 55.2% / 44.8%?

**Secondary Token Support (55.2%)**
- Majority goes back to the token that generated it
- Ensures secondary tokens have strong buyback support
- Incentivizes trading activity on secondaries
- Maintains secondary token holder confidence

**Root Token Accumulation (44.8%)**
- Significant portion flows to root
- Root benefits from ALL secondaries combined
- Creates compound effect across ecosystem
- Rewards ecosystem participation

### Creator Fee Dynamics

Pump.fun creator fees are **dynamic** based on market cap:

| Market Cap | Creator Fee |
|------------|-------------|
| ~$88K | up to 0.95% |
| ~$300K | ~0.5% |
| >$20M | 0.05% |

### Example Calculation

**Single Secondary Token**: $100,000 daily volume

| Step | Amount |
|------|--------|
| Trading Volume | $100,000 |
| Creator Fee (~0.5%) | $500 |
| Secondary Buyback (55.2%) | $276 |
| Root Treasury (44.8%) | $224 |

**Ecosystem with 5 Secondaries**: Each doing $100,000/day

| Metric | Per Secondary | Total (5 tokens) |
|--------|---------------|------------------|
| Volume | $100,000 | $500,000 |
| Creator Fees | $500 | $2,500 |
| Secondary Burns | $276 | $1,380 |
| Root Treasury | $224 | **$1,120/day** |

The root token receives $1,120/day in buyback fuel from the ecosystem.

### The Compound Effect

```
More Secondaries → More Total Volume → More Root Treasury → More Burns
       ↑                                                        │
       └────────────────────────────────────────────────────────┘
                        (attracts more secondaries)
```

For secondary token holders:

```
More Trading → More Fees → More Buybacks → Higher Price
       ↑                                        │
       └────────────────────────────────────────┘
                  (attracts more trading)
```

### Deflationary Mechanism

All buybacks result in permanent burns:

```
Initial Supply: 1,000,000,000 tokens
                     │
                     ▼ (trading activity)
Year 1 Burns: -50,000,000 tokens
                     │
                     ▼
Remaining: 950,000,000 tokens
                     │
                    ...
```

Supply constantly decreases while demand can increase.

---

## Phase 2: Universal Economics

### Protocol Fee: 5.52%

In Phase 2, ASDF-DAT becomes infrastructure for ALL pump.fun creators. Anyone can create their own DAT ecosystem with:
- Their own **root token** (main community token)
- Multiple **secondary tokens** (ecosystem tokens)
- **Configurable internal split** between root and secondaries

The protocol takes **5.52% of ALL collected fees** for $asdfasdfa buyback/burn. The remaining **94.48%** is distributed within the DAT according to its configured split.

### Phase 2 Fee Formula

```
INPUTS:
  total_fees = 100% of creator fees collected from secondary trading
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

VERIFICATION:
  5.52% + 94.48% = 100% ✓
```

### Fee Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│           SECONDARY TOKEN TRADE IN DAT X                     │
│                    Creator Fee (100%)                        │
├─────────────────────────────────────────────────────────────┤
│                           │                                 │
│              ┌────────────┴────────────┐                    │
│              │                         │                    │
│              ▼                         ▼                    │
│     ┌─────────────────┐     ┌─────────────────────────────┐ │
│     │     5.52%       │     │         94.48%              │ │
│     │  PROTOCOL FEE   │     │    DAT X INTERNAL SPLIT     │ │
│     │  $asdfasdfa     │     │      (CONFIGURABLE)         │ │
│     │  BUYBACK/BURN   │     │                             │ │
│     │    (FIXED)      │     │  ┌───────────┬───────────┐  │ │
│     └─────────────────┘     │  │ X% DAT    │(100-X)%   │  │ │
│                             │  │ Root      │Secondary  │  │ │
│                             │  │ Buyback   │Buyback    │  │ │
│                             │  └───────────┴───────────┘  │ │
│                             └─────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**No treasury accumulation** - all fees at all levels are immediately converted to buyback/burn.

### Why 5.52%?

- **Low enough**: Attractive for integrators (DAT keeps 94.48% for their ecosystem)
- **High enough**: Creates meaningful burn volume at scale
- **Network effect**: More DATs = more $asdfasdfa burns
- **Aligned incentives**: Protocol success benefits all participants

### Phase 2 Example Calculation

**MemeDAO creates a DAT:**
- Root token: $MEME
- Secondary tokens: $MEME2, $MEME3
- Internal root ratio: 40%

**When 1 SOL of fees is collected from $MEME2 trading:**

| Recipient | Calculation | Amount | Action |
|-----------|-------------|--------|--------|
| $asdfasdfa (Protocol) | 1 × 5.52% | 0.0552 SOL | Buyback & burn |
| $MEME (DAT Root) | 0.9448 × 40% | 0.3779 SOL | Buyback & burn |
| $MEME2 (Secondary) | 0.9448 × 60% | 0.5669 SOL | Buyback & burn |
| **Total** | | **1.0000 SOL** | |

### Scaling Projections

| DATs Integrated | Avg Volume/DAT | Protocol Fee (5.52%) | $asdfasdfa Burns/Month |
|-----------------|----------------|---------------------|------------------------|
| 10 | $100K/day | $5,520/day | $165,600 |
| 50 | $50K/day | $13,800/day | $414,000 |
| 100 | $50K/day | $27,600/day | $828,000 |
| 500 | $20K/day | $55,200/day | $1,656,000 |

### $asdfasdfa as Index Fund

With Phase 2, $asdfasdfa becomes an "index fund" of the entire DAT ecosystem:

```
                  ┌───────────────────┐
                  │    $asdfasdfa     │
                  │   (Protocol Root) │
                  │   5.52% from ALL  │
                  └─────────┬─────────┘
                            │
           ┌────────────────┼────────────────┐
           │                │                │
           ▼                ▼                ▼
    ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
    │   DAT A     │  │   DAT B     │  │   DAT N     │
    │ Root + Sec  │  │ Root + Sec  │  │ Root + Sec  │
    │ (40% / 60%) │  │ (50% / 50%) │  │ (30% / 70%) │
    └─────────────┘  └─────────────┘  └─────────────┘
         │                │                │
  Each DAT has own   Configurable     All immediate
  root + secondaries internal split    buyback/burn
```

**Benefits for $asdfasdfa holders:**
- Exposure to ALL DAT ecosystem activity (5.52% from every DAT)
- No need to pick individual winners
- Diversified across all integrated tokens and their ecosystems
- Protocol success = token success

---

## Economic Principles

### 1. Activity = Value
More trading activity → more burns → more scarcity → more value.

### 2. Alignment Over Time
Long-term holding is rewarded through continuous supply reduction.

### 3. No Free Riders
Every participant contributes through trading fees.

### 4. Transparent & Predictable
All economics are on-chain, verifiable, and predictable.

### 5. Self-Reinforcing
Success breeds success through the flywheel effect.

---

## On-Chain Constants

From `programs/asdf-dat/src/lib.rs`:

| Constant | Value | Description |
|----------|-------|-------------|
| `fee_split_bps` | 5520 | 55.2% to secondary (Phase 1) |
| `MIN_FEES_TO_CLAIM` | 0.01 SOL | Minimum for cycle execution |
| `MAX_FEES_PER_CYCLE` | 1 SOL | Maximum per cycle |
| `MIN_FEES_FOR_SPLIT` | 0.0055 SOL | Minimum for fee split operation |
| `MINIMUM_BUY_AMOUNT` | 0.0001 SOL | Minimum buyback amount |

---

## Comparison: Phase 1 vs Phase 2

| Aspect | Phase 1 | Phase 2 |
|--------|---------|---------|
| **Scope** | Single $asdfasdfa ecosystem | Multi-tenant (any community can create a DAT) |
| **Protocol Fee** | N/A | 5.52% → $asdfasdfa (FIXED) |
| **DAT Structure** | Single root + secondaries | Each DAT has own root + secondaries |
| **Internal Split** | Fixed 55.2%/44.8% | Configurable per DAT |
| **Treasury** | Root treasury accumulates | No treasury (all immediate burns) |
| **Integration** | Manual | Permissionless (factory pattern) |
| **$asdfasdfa Role** | Ecosystem root | Protocol root (index fund of all DATs) |

---

## Summary

**Phase 1 validates the mechanism:**
- 55.2%/44.8% split proves buyback/burn works
- Single ecosystem demonstrates compound effects
- On-chain track record establishes trust
- Root treasury accumulates for batch buybacks

**Phase 2 scales the infrastructure:**
- 5.52% protocol fee funds $asdfasdfa burns
- Each DAT has own root + secondary tokens
- Internal split is configurable per DAT (applied to 94.48%)
- No treasury at any level - all immediate buyback/burn
- $asdfasdfa becomes the index fund of entire DAT ecosystem
- Network effects: more DATs = more value for all

---

## Related Documentation

- [Architecture](ARCHITECTURE.md) - Technical implementation details
- [Integration Guide](INTEGRATION.md) - How to integrate with DAT (Phase 2)
- [Glossary](GLOSSARY.md) - Terminology definitions
