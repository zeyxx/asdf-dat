# FAQ - ASDF Burn Engine

Frequently asked questions about the Optimistic Burn Protocol.

---

## For Holders

### How do I earn yield?

**Through deflation, not inflation.**

Every trade, every app deposit = fewer tokens in existence. Your share of the remaining supply automatically grows. No staking required. No actions needed.

### How are fees distributed?

**Root Token ($ASDF)**
- 100% → Buyback & Burn (no dev fee)
- Plus 44.8% from all secondaries → Mega burn

**Secondary Tokens (99/1 split on their 55.2% share)**
| Portion | Destination |
|---------|-------------|
| 99% | Buyback & Burn |
| 1% | Dev sustainability |

*"1% of secondary share today = 99% burns forever"*

### Where do the burns come from?

Three sources feed the burn engine:

1. **Trading Volume** - Pump.fun creator fees from every trade
2. **Ecosystem Apps** - Revenue from apps like ASDForecast (99.448% burned)
3. **Token Hierarchy** - 44.8% of all secondary token fees flow to root

### Do I need to stake or lock tokens?

**No.** Simply holding $ASDF gives you exposure to all burns across the ecosystem. The protocol works autonomously.

### How can I verify burns?

Everything is on-chain. Check:
- [Program on Solscan](https://solscan.io/account/ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui)
- Token supply on any Solana explorer
- Burn transactions in program history

---

## For Developers

### How do I integrate my app?

Your app can contribute revenue in **two ways**:

**Option 1: Send SOL (Simple)**
- Transfer SOL to ecosystem
- Automatically included in cycles
- Zero integration complexity

**Option 2: Send $ASDF (With Rebates)**
```typescript
await program.methods
  .depositFeeAsdf(amount)
  .accounts({ /* ... */ })
  .rpc();
```
- 99.448% → Burned permanently
- 0.552% → Rebate pool for users

See [Developer Guide](DEVELOPER_GUIDE.md#external-app-integration) for full details.

### What's the rebate system?

Users who interact with ecosystem apps become eligible for rebates:

| Threshold | Requirement |
|-----------|-------------|
| Eligibility | pending_contribution >= 0.07 SOL equivalent |
| Rebate | 0.552% of contribution |

### How does the daemon work?

The daemon monitors Pump.fun pools for trades, attributes fees to specific tokens, and executes burn cycles:

```
Trades → Daemon monitors → Fees attributed → Cycle executes → Tokens burn
```

Single daemon executes. Chain proves. Anyone verifies.

### Can I run my own daemon?

Yes. The daemon is open source. Multiple daemons can cross-verify each other.

---

## Technical

### What is "Optimistic Burn"?

An execution model where:
1. A single daemon performs off-chain attribution
2. On-chain execution provides immutable proof
3. Anyone can verify the results

No trust required - just math and on-chain records.

### Why 55.2% / 44.8% split?

Secondary tokens keep 55.2% for their own buyback & burn. The remaining 44.8% flows to the root token's treasury, creating a flywheel where more ecosystem activity = more root burns.

### What happens if the daemon fails?

- Fees accumulate in creator vaults (no loss)
- Auto-pause triggers after 5 consecutive failures
- Admin can resume when fixed
- Multiple daemons provide redundancy

### What's Phase 2?

**Current (Phase 1)**: Single DAT for $ASDF ecosystem - proof of concept.

**Phase 2 (2026)**: Multi-tenant platform - any creator can deploy their own DAT with one click.

---

## Philosophy

### What does "Creation, not extraction" mean?

Traditional models: Creator takes fees → Value extracted from holders.

ASDF Burn Engine: Fees → Buyback → Burn → Value created for holders.

We don't extract value. We create it through permanent supply reduction.

### What does "This is fine" mean?

A nod to the famous meme. We're building in a chaotic market, shipping production infrastructure, and staying calm. The fire is fine. The dog is fine. We're fine. 🔥🐕

---

*More questions? Open an issue or reach out on Twitter [@ASDFASDFA552](https://x.com/ASDFASDFA552).*
