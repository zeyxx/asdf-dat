# FAQ: Frequently Asked Questions

## General Questions

### What is DAT?
**DAT (Decentralized Autonomous Treasury)** is a smart contract protocol that creates economic alignment between tokens. It captures trading fees and automatically distributes them as buybacks, creating deflationary pressure across an entire ecosystem of connected tokens.

### How is DAT different from other token mechanisms?
Most token mechanisms focus on a single token. DAT creates **relationships between tokens**, turning what would be competitors into economic allies. It's infrastructure for token cooperation, not just another tokenomics model.

### Is DAT a new blockchain or chain?
No. DAT is a **protocol built on Solana**. It works with existing Pump.fun tokens and doesn't require any new chain or bridge.

---

## For Token Holders

### Do I need to do anything special to benefit from burns?
**No.** Just hold your tokens. The burns happen automatically from trading activity. Your tokens become scarcer over time without any action required from you.

### How often do buybacks occur?
The system runs **cycles regularly** (typically every few hours or when enough fees accumulate). Each cycle:
1. Collects accumulated fees
2. Swaps them for tokens
3. Burns the tokens permanently

### Can I see the burns happening?
**Yes.** Everything is on-chain. You can verify:
- Fee collections
- Swap transactions
- Burn transactions
- Supply changes

### Is holding root token or secondary token better?
**It depends on your goals:**

| Goal | Better Choice |
|------|---------------|
| Benefit from entire ecosystem | Root token |
| Benefit from specific project | Secondary token |
| Maximum diversification | Root token |
| Higher risk/reward | Secondary tokens |
| Long-term ecosystem bet | Root token |

### What happens if trading volume drops?
Burns slow down proportionally. However, DAT is designed for **sustainability** - even low volumes create some deflation. The mechanism works regardless of market conditions, just at different speeds.

---

## For Creators

### How do I launch a secondary token?
1. Create your token on Pump.fun using the ecosystem's creator wallet
2. Register it with the DAT protocol
3. Your token automatically joins the ecosystem

### Can any token become a secondary?
Tokens must be **created with the ecosystem creator wallet** to have their fees captured by DAT. This ensures proper fee routing from the start.

### What percentage goes to my token's buyback?
**55.2%** of your token's creator fees go directly to buying back and burning your token. The remaining 44.8% goes to the root token treasury.

### Can I launch my own ecosystem as a root?
**Coming soon.** Currently, the ASDF ecosystem is the primary implementation. Self-service root token creation is planned for future releases.

### Do I lose control of my token?
**No.** Your token remains fully independent. DAT only captures and distributes the creator fee - it doesn't affect your token's supply, your community, or your control.

---

## Technical Questions

### Who controls the treasury?
**Smart contracts control everything.** There are no admin keys that can access collected fees. The contracts automatically:
- Collect fees
- Execute swaps
- Burn tokens

No human can intercept or redirect funds.

### What if the smart contract has a bug?
The contracts have been carefully designed and tested. Additionally:
- Code is open source and auditable
- Multi-sig controls exist for upgrades
- Emergency pause mechanisms protect users

### Can the fee split be changed?
The current split (55.2%/44.8%) is **configurable by governance** but cannot be changed arbitrarily. Any changes would require proper governance approval and transparency.

### What DEX is used for buybacks?
DAT integrates with **PumpSwap AMM** for executing swaps. This ensures reliable liquidity and efficient price execution.

### What happens to burned tokens?
Tokens are sent to a **dead address** (a wallet with no private key). They're permanently removed from circulation and can never be recovered.

---

## Economic Questions

### Where does the money for buybacks come from?
From the **creator fee** on Pump.fun trades. The percentage is dynamic and set by Pump.fun based on the token's market cap (ranging from 0.05% to 0.95%). Every trade generates this fee automatically. DAT simply captures and redirects these existing fees.

### Is this a Ponzi scheme?
**No.** A Ponzi pays old investors with new investor money. DAT creates value through:
- Trading activity (not new investment)
- Permanent supply reduction (actual value creation)
- Self-sustaining mechanics (doesn't require growth to function)

The burns create real scarcity. Value isn't redistributed - it's created through deflation.

### What's preventing infinite growth?
Nothing prevents growth, but the model is **sustainable at any size**. Burns scale with activity:
- High volume = high burns
- Low volume = low burns

It's not dependent on perpetual growth like a Ponzi.

### How much has been burned so far?
Check the on-chain records for current burn totals. The protocol tracks all burns transparently and they can be verified by anyone.

---

## Safety & Trust

### Is this safe? Can developers rug?
The smart contract architecture means:
- Developers cannot access the treasury
- Fees are programmatically controlled
- Burns are automatic and verifiable
- No manual intervention possible

### What if Pump.fun changes their fees?
The protocol is designed to work with Pump.fun's current fee structure. If Pump.fun changes, the community can adapt the protocol through governance.

### Is the code audited?
The code is open source on GitHub. Community review and formal audits are part of the security approach.

### What if a secondary token rugs?
Individual secondary token rugs don't affect the protocol or other tokens. The fee capture mechanism continues regardless of what happens to individual projects.

---

## Participation Questions

### How do I check my token's buyback stats?
Use the ecosystem dashboard (coming soon) or query on-chain directly. All stats are public and verifiable.

### Can I propose changes to DAT?
Yes! DAT is community-driven. Proposals can be made through the governance process. Join the Discord to participate in discussions.

### Where can I learn more?
| Resource | Where |
|----------|-------|
| Technical Docs | GitHub repository |
| Community | Discord server |
| Updates | Twitter @asikiland |
| Code | github.com/zeyxx/asdf-dat |

---

## Quick Reference

### Key Numbers
| Metric | Value |
|--------|-------|
| Creator Fee Captured | 0.05% - 0.95% (based on market cap) |
| Secondary Buyback | 55.2% |
| Root Treasury | 44.8% |
| Burn Rate | 100% of buybacks |

### Key Concepts
| Term | Meaning |
|------|---------|
| Root Token | Main ecosystem token ($ASDF) |
| Secondary Token | Any token linked to the root |
| Buyback | Using fees to purchase tokens |
| Burn | Permanently destroying tokens |
| Treasury | Accumulated fees awaiting cycle |
| Cycle | Periodic buyback & burn execution |

---

## Still Have Questions?

Join the community:
- **Discord:** [Coming Soon]
- **Twitter:** [@asikiland](https://twitter.com/asikiland)
- **GitHub:** [asdf-dat](https://github.com/zeyxx/asdf-dat)

---

*Return to [Table of Contents](README.md)*
