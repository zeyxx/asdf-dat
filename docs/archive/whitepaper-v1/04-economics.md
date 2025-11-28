# Economics: The 55.2%/44.8% Split and Buyback Mechanics

## The Fee Split Explained

Every trade on Pump.fun generates a **creator fee**. The percentage is dynamic and determined by Pump.fun based on the token's market cap (ranging from 0.05% to 0.95% - higher for smaller tokens, lower for larger ones). DAT captures these fees and splits them:

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

This split is carefully designed to balance two goals:

1. **Secondary Token Support (55.2%)**
   - Majority goes back to the token that generated it
   - Ensures secondary tokens have strong buyback support
   - Incentivizes activity on secondaries
   - Maintains secondary token holder confidence

2. **Root Token Accumulation (44.8%)**
   - Significant portion flows to root
   - Root benefits from ALL secondaries combined
   - Creates compound effect across ecosystem
   - Rewards ecosystem builders

### The Math in Action

**Example:** A secondary token does $100,000 in daily volume

| Step | Amount |
|------|--------|
| Trading Volume | $100,000 |
| Creator Fee (e.g. 1%) | $1,000 |
| Secondary Buyback (55.2%) | $552 |
| Root Treasury (44.8%) | $448 |

Now multiply by 10 secondaries, each doing $100,000/day:

| Metric | Per Secondary | 10 Secondaries |
|--------|---------------|----------------|
| Volume | $100,000 | $1,000,000 |
| Creator Fees | $1,000 | $10,000 |
| Secondary Burns | $552 each | $5,520 total |
| Root Treasury | $448 each | **$4,480/day** |

**The root token receives $4,480/day in buyback fuel from the ecosystem!**

## Buyback & Burn Mechanics

### What is Buyback & Burn?

1. **Buyback:** Use collected fees to purchase tokens from the open market
2. **Burn:** Permanently destroy those tokens (send to dead address)

### Why Burn Instead of Distribute?

| Approach | Effect |
|----------|--------|
| **Distribute** | Increases sell pressure (people sell rewards) |
| **Burn** | Reduces supply permanently (deflationary) |

Burning creates **permanent value** rather than temporary rewards that get dumped.

### The Deflationary Effect

```
Initial Supply: 1,000,000,000 tokens
                     │
                     ▼ (trading activity)
                     │
Year 1 Burns: -50,000,000 tokens
                     │
                     ▼
Remaining: 950,000,000 tokens
                     │
                     ▼ (more trading)
                     │
Year 2 Burns: -45,000,000 tokens
                     │
                     ▼
Remaining: 905,000,000 tokens
                     │
                    ...
```

**Supply constantly decreases while demand can increase.**

## Proportional Distribution

When multiple secondaries exist, the root treasury is distributed proportionally based on each token's contribution:

### Example: Three Secondaries

| Token | Volume | Fees Generated | Share |
|-------|--------|----------------|-------|
| $ALPHA | $50,000 | $500 | 50% |
| $BETA | $30,000 | $300 | 30% |
| $GAMMA | $20,000 | $200 | 20% |
| **Total** | $100,000 | $1,000 | 100% |

**Distribution of 55.2% Secondary Buybacks:**
- $ALPHA gets: $500 × 55.2% = $276 buyback
- $BETA gets: $300 × 55.2% = $165.60 buyback
- $GAMMA gets: $200 × 55.2% = $110.40 buyback

**Each token receives buybacks proportional to its activity!**

## The Compound Effect

### For Root Token Holders

```
More Secondaries → More Total Volume → More Root Treasury → More Burns
       ↑                                                        │
       └────────────────────────────────────────────────────────┘
                        (attracts more secondaries)
```

### For Secondary Token Holders

```
More Trading → More Fees → More Buybacks → Higher Price
       ↑                                        │
       └────────────────────────────────────────┘
                  (attracts more trading)
```

## Real-World Scenario

Let's model a mature ecosystem:

**Assumptions:**
- 1 Root Token
- 20 Secondary Tokens
- Average $50,000 daily volume per secondary
- Total ecosystem volume: $1,000,000/day

**Daily Economics:**

| Metric | Value |
|--------|-------|
| Total Volume | $1,000,000 |
| Total Creator Fees | $10,000 |
| Total Secondary Burns | $5,520 |
| Root Treasury | $4,480 |

**Monthly:**

| Metric | Value |
|--------|-------|
| Total Burns (Secondaries) | $165,600 |
| Root Treasury Burns | $134,400 |
| **Total Ecosystem Burns** | **$300,000** |

**Annually:**

| Metric | Value |
|--------|-------|
| Total Ecosystem Burns | **$3,650,000** |

Over $3.6 million in tokens permanently removed from circulation every year!

## Key Economic Principles

### 1. Activity = Value
More trading activity = more burns = more scarcity = more value.

### 2. Alignment Over Time
Long-term holding is rewarded through continuous supply reduction.

### 3. No Free Riders
Every participant contributes to the ecosystem through trading fees.

### 4. Transparent & Predictable
All economics are on-chain, verifiable, and predictable.

### 5. Self-Reinforcing
Success breeds success through the flywheel effect.

---

## Summary

| Aspect | Details |
|--------|---------|
| **Fee Source** | Pump.fun creator fee (0.05% - 0.95% based on market cap) |
| **Secondary Share** | 55.2% for buyback & burn |
| **Root Share** | 44.8% for treasury |
| **Distribution** | Proportional to activity |
| **Mechanism** | Buyback & Burn (deflationary) |
| **Result** | Decreasing supply, aligned incentives |

---

*Next: [Use Cases](05-use-cases.md) - Real-World Applications of DAT*
