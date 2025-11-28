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

In Phase 2, ASDF-DAT becomes infrastructure for ALL pump.fun creators. Each integrated DAT sends **5.52% of all collected fees** to $asdfasdfa.

```
┌─────────────────────────────────────────────────────────────┐
│                    INTEGRATED DAT FEES                       │
│                         100%                                │
├─────────────────────────────────────────────────────────────┤
│                           │                                 │
│              ┌────────────┴────────────┐                    │
│              │                         │                    │
│              ▼                         ▼                    │
│     ┌─────────────────┐     ┌─────────────────┐            │
│     │     5.52%       │     │     94.48%      │            │
│     │   PROTOCOL FEE  │     │   DAT INTERNAL  │            │
│     │  ($asdfasdfa)   │     │  (configurable) │            │
│     └─────────────────┘     └─────────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

### Why 5.52%?

- **Low enough**: Attractive for integrators (keeps 94.48%)
- **High enough**: Creates meaningful accumulation at scale
- **Network effect**: More DATs = more root burns

### Internal Split (Configurable)

Within each DAT, the remaining 94.48% can be distributed according to the creator's preference:

| Allocation | Purpose |
|------------|---------|
| X% | Token buyback/burn (deflationary) |
| Y% | Community treasury (optional) |
| Z% | Creator allocation (optional) |

Example configurations:

**Pure Deflationary DAT**
- 94.48% → Token buyback/burn
- 0% → Treasury/Creator

**Community DAO DAT**
- 70% → Token buyback/burn
- 24.48% → Community treasury

**Creator Revenue DAT**
- 50% → Token buyback/burn
- 24.48% → Community treasury
- 20% → Creator

### Scaling Projections

| DATs Integrated | Avg Daily Volume/DAT | Total Volume | Protocol Fee (5.52%) | Root Burns/Month |
|-----------------|---------------------|--------------|---------------------|------------------|
| 10 | $100,000 | $1M | $5,520/day | $165,600 |
| 50 | $50,000 | $2.5M | $13,800/day | $414,000 |
| 100 | $50,000 | $5M | $27,600/day | $828,000 |
| 500 | $20,000 | $10M | $55,200/day | $1,656,000 |
| 1,000 | $10,000 | $10M | $55,200/day | $1,656,000 |

### $asdfasdfa as Index Fund

With Phase 2, $asdfasdfa becomes an "index fund" of the entire DAT ecosystem:

**Benefits for $asdfasdfa holders:**
- Exposure to ALL DAT ecosystem activity
- No need to pick individual winners
- Diversified across all integrated tokens
- Protocol success = token success

```
                  ┌───────────────────┐
                  │    $asdfasdfa     │
                  │   (Index Fund)    │
                  └─────────┬─────────┘
                            │
           ┌────────────────┼────────────────┐
           │                │                │
           ▼                ▼                ▼
      ┌─────────┐      ┌─────────┐      ┌─────────┐
      │  DAT A  │      │  DAT B  │      │  DAT N  │
      │  5.52%  │      │  5.52%  │      │  5.52%  │
      └─────────┘      └─────────┘      └─────────┘
           │                │                │
    Token volume     Token volume     Token volume
```

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
| **Scope** | $asdfasdfa ecosystem | All pump.fun |
| **Root Fee** | 44.8% | 5.52% |
| **Secondary Split** | 55.2% fixed | Configurable |
| **Target Users** | $asdfasdfa holders | All creators/communities |
| **Integration** | Manual | Permissionless |
| **Root Token Role** | Ecosystem root | Protocol root (index fund) |

---

## Summary

**Phase 1 validates the mechanism:**
- 55.2%/44.8% split proves buyback/burn works
- Single ecosystem demonstrates compound effects
- On-chain track record establishes trust

**Phase 2 scales the infrastructure:**
- 5.52% protocol fee funds $asdfasdfa burns
- Each integrated DAT keeps 94.48% configurable
- $asdfasdfa becomes the index fund of DAT ecosystem
- Network effects: more DATs = more value for all

---

## Related Documentation

- [Architecture](ARCHITECTURE.md) - Technical implementation details
- [Integration Guide](INTEGRATION.md) - How to integrate with DAT (Phase 2)
- [Glossary](GLOSSARY.md) - Terminology definitions
