# ASDF-DAT

**Optimistic Burn Protocol**

Flush. Burn. Verify.

---

## What It Is

An autonomous treasury that converts trading fees into permanent token supply reduction.

```
Trading happens → Fees accumulate → Daemon flushes → Tokens burn → Anyone verifies
```

No inflation. No emissions. Just deflation.

---

## The Model

### Optimistic Burn

A single daemon executes cycles. The chain records everything. Anyone can verify.

```
┌─────────────────────────────────────────────────────────────┐
│                    THE BURN CYCLE                           │
│                                                             │
│   TRADE          FLUSH           BURN          VERIFY       │
│   ─────►        ──────►         ──────►        ──────►      │
│                                                             │
│   Volume         Daemon          99% to        On-chain     │
│   generates      collects        buyback       proof        │
│   creator        and             & burn        forever      │
│   fees           executes                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 99/1 Split

| Destination | Share | Purpose |
|-------------|-------|---------|
| Burn | 99% | Permanent supply reduction |
| Dev | 1% | Infrastructure sustainability |

1% today = 99% burns forever.

### Native Yield

Holders earn through deflation, not inflation.

No token printing. No reward pools. No staking mechanics.
Just fewer tokens existing over time.

---

## Token Hierarchy

```
                    ROOT TOKEN
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
    SECONDARY 1     SECONDARY 2     SECONDARY N
```

Each secondary token's fees flow:
- 55.2% → Secondary buyback & burn
- 44.8% → Root treasury (burned in root cycles)

More tokens in ecosystem = more burn pressure on root.

---

## Architecture

```
OFF-CHAIN
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  FEE DAEMON                    CYCLE ORCHESTRATOR            │
│  ───────────                   ──────────────────            │
│  Monitors trades               Calculates splits             │
│  Attributes fees               Executes buybacks             │
│  Updates chain                 Burns tokens                  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
ON-CHAIN
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  DAT STATE          TOKEN STATS          ROOT TREASURY       │
│  ─────────          ───────────          ──────────────      │
│  Global config      Per-token fees       44.8% accumulator   │
│  Fee split %        Burn totals          For root burns      │
│  Controls           Pending fees                             │
│                                                              │
│  ────────────────────────────────────────────────────────    │
│                    PUMP.FUN INTEGRATION                      │
│  Bonding Curve (pre-migration) │ PumpSwap AMM (post)         │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Program:** `ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui`

---

## Quick Start

```bash
# Clone
git clone https://github.com/asdfDAT/asdf-dat.git
cd asdf-dat && npm install

# Start daemon
npx ts-node scripts/monitor-ecosystem-fees.ts --network devnet &

# Generate volume
npx ts-node scripts/generate-volume.ts devnet-tokens/01-froot.json 2 0.5

# Wait for sync
sleep 30

# Flush
npx ts-node scripts/execute-ecosystem-cycle.ts devnet-tokens/01-froot.json --network devnet
```

Verify on-chain: fees collected, tokens burned, supply reduced.

---

## Verification

Everything is on-chain. Verify yourself:

```bash
# Check burn totals
npx ts-node scripts/query-token-stats.ts <mint> --network mainnet

# View cycle history
npx ts-node scripts/query-cycles.ts --network mainnet
```

Or read directly from Solscan.

---

## Philosophy

### Creation > Extraction

We don't take value. We create it.
We don't print tokens. We burn them.
We don't optimize for fees. We minimize them.

### Trust Through Verification

Single daemon executes.
Chain proves.
Anyone audits.

### Sustainable Infrastructure

1% keeps the lights on.
99% goes to holders through deflation.

---

## Documentation

| Document | Purpose |
|----------|---------|
| [Architecture](docs/ARCHITECTURE.md) | System design |
| [Developer Guide](docs/DEVELOPER_GUIDE.md) | Integration |
| [API Reference](docs/API_REFERENCE.md) | Instructions |
| [Operations](docs/OPERATIONS.md) | Runbooks |

---

## Roadmap

**Phase 1** (Current): Single ecosystem proof of concept
**Phase 2** (2026): Multi-tenant platform - any creator can deploy

---

## Security

- Emergency pause capability
- Two-step admin transfer
- Fee split change limits (5% max delta)
- Auto-pause after consecutive failures
- Timelock for significant parameter changes

---

## Links

- [Program Explorer](https://solscan.io/account/ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui)
- [Root Token](https://pump.fun/coin/9FxrRPwDF44zzjfzxGKtdqXqH1JKjD4MJ1nbFP7Zpump)
- [@ASDFASDFA552](https://x.com/ASDFASDFA552)

---

## License

MIT

---

*Creation, not extraction.*
*This is fine.* 🔥🐕
