# 🔥 ASDF-DAT

**Decentralized Autonomous Treasury for Solana Tokens**

[![Solana](https://img.shields.io/badge/Solana-Mainnet-blueviolet)](https://solana.com)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Phase](https://img.shields.io/badge/Phase-1%20Live-success)](https://pump.fun)

> 🤖 Automated buy & burn treasury that turns creator fees into deflationary pressure.
> Trading happens. Fees appear. Tokens burn. Supply shrinks. *This is fine.* 🐕

---

## 🎯 Vision

**Phase 1** (Now): Proof of concept - single ecosystem, automated buy→burn→treasury cycle
**Phase 2** (2026): SaaS platform - any creator can deploy their own DAT

> "Solana is complex. Rust is technical. Pump.fun is borderline magic.
> But that's OK. We build clean, modular, stable, and future-ready.
> This is fine." 🔥🐶

---

## 😤 The Problem

Creator fees on Pump.fun exist, but most projects ignore them. Value leaks out instead of compounding back. And when you have multiple tokens in an ecosystem? Good luck coordinating anything.

## 💡 The Solution

DAT automates the entire cycle:

```
┌─────────────────────────────────────────────────────────────────┐
│                    🔄 THE DAT CYCLE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│    TRADE             COLLECT            SPLIT                   │
│    ─────►           ─────────►        ──────────►               │
│                                                                 │
│   Someone          Creator fee        55.2% → Token buyback     │
│   buys/sells       captured           44.8% → Root treasury     │
│   any token        (0.3-0.95%)                                  │
│                                                                 │
│    ◄─────           ◄─────────        ◄──────────               │
│    BURN               BUY              ALLOCATE                 │
│                                                                 │
│   🔥 Tokens        💰 Fees used       📊 Proportional           │
│   permanently      to buy tokens      distribution              │
│   destroyed        from market        per token                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Result**: Every trade creates buying pressure. Every cycle reduces supply. Automatic. Trustless. Relentless. 📈

### 💡 Why It Matters

- **For holders**: Every trade = automatic buyback pressure
- **For creators**: Set it and forget it. Treasury works 24/7.
- **For the ecosystem**: Aligned incentives. Less rugs. More trust.

---

## 🧠 How It Works

### Token Hierarchy

DAT creates economic alignment between a root token and its ecosystem:

```
                      ┌─────────────────┐
                      │  👑 ROOT TOKEN  │
                      │     ($ASDF)     │
                      │                 │
                      │  Receives 44.8% │
                      │  of ALL fees    │
                      └────────┬────────┘
                               │
             ┌─────────────────┼─────────────────┐
             │                 │                 │
             ▼                 ▼                 ▼
      ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
      │ SECONDARY 1 │   │ SECONDARY 2 │   │ SECONDARY N │
      │             │   │             │   │             │
      │ Keeps 55.2% │   │ Keeps 55.2% │   │ Keeps 55.2% │
      │ for buyback │   │ for buyback │   │ for buyback │
      └─────────────┘   └─────────────┘   └─────────────┘
```

**The math is simple:**
- 📈 Trade any secondary token → Root gets stronger
- 🔗 More secondaries = more fees flowing to root
- 🤝 Everyone wins: secondaries burn, root accumulates

### 💸 The 55.2% / 44.8% Split

| Destination | Share | Purpose |
|-------------|-------|---------|
| 🔥 Secondary Token | 55.2% | Buy & burn the traded token |
| 👑 Root Treasury | 44.8% | Accumulate for root buyback |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     ☁️  OFF-CHAIN                               │
│                                                                 │
│  ┌──────────────────┐         ┌───────────────────────────┐    │
│  │  👁️ FEE DAEMON   │         │  ⚡ CYCLE ORCHESTRATOR    │    │
│  │  ─────────────   │         │  ────────────────────     │    │
│  │  • Polls trades  │────────►│  • Reads pending fees     │    │
│  │  • Tracks fees   │         │  • Calculates splits      │    │
│  │  • Updates chain │         │  • Executes buy & burn    │    │
│  └──────────────────┘         └───────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                      ⛓️  ON-CHAIN                               │
│                                                                 │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐    │
│  │   DAT STATE    │  │  TOKEN STATS   │  │ ROOT TREASURY  │    │
│  │  ────────────  │  │  ────────────  │  │  ────────────  │    │
│  │  Global config │  │  Per-token     │  │  44.8% from    │    │
│  │  Fee split %   │  │  pending fees  │  │  all tokens    │    │
│  │  Admin control │  │  burn totals   │  │  accumulates   │    │
│  └────────────────┘  └────────────────┘  └────────────────┘    │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐│
│  │               🎰 PUMP.FUN INTEGRATION                      ││
│  │  • Bonding Curve (pre-migration) → Native SOL vault        ││
│  │  • PumpSwap AMM (post-migration) → WSOL token vault        ││
│  └────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

**Program ID:** `ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui`

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Solana CLI
- A funded wallet (devnet or mainnet)

### Installation

```bash
git clone https://github.com/asdfDAT/asdf-dat.git
cd asdf-dat
npm install
```

### Devnet Test (4 Commands)

```bash
# 1. Start the fee daemon
npx ts-node scripts/monitor-ecosystem-fees.ts --network devnet &

# 2. Generate volume (buy + sell creates fees)
npx ts-node scripts/generate-volume.ts devnet-tokens/01-froot.json 2 0.5

# 3. Wait for daemon sync
sleep 30

# 4. Execute the cycle
npx ts-node scripts/execute-ecosystem-cycle.ts devnet-tokens/01-froot.json --network devnet
```

✨ Watch the magic: fees collected → tokens bought → tokens burned.

### Mainnet

Same commands, replace `--network devnet` with `--network mainnet` and use `mainnet-tokens/` configs.

---

## ✨ Key Features

| Feature | Description |
|---------|-------------|
| 🤖 **Automatic Buyback** | No manual intervention. Daemon monitors, orchestrator executes. |
| 🔗 **Cross-Token Alignment** | Secondary tokens strengthen the root. Economic symbiosis. |
| 📊 **Fee Attribution** | Shared vault problem solved via balance polling. Each token tracked. |
| 🛡️ **Emergency Controls** | Pause/resume, admin transfer (two-step), configurable parameters. |
| 🎰 **Pump.fun Native** | Works with bonding curves AND migrated AMM pools. |
| 📈 **Scalable** | Add tokens anytime. System handles N secondaries + 1 root. |

---

## 🗺️ Roadmap

```
═══════════════════════════════════════════════════════════════════

   PHASE 1 (NOW) 🔥            │          PHASE 2 (2026) 🚀
   Proof of Concept            │          SaaS Platform
                               │
   ✅ Single ecosystem         │    ⏳ Multi-tenant support
   ✅ $ASDF + secondaries      │    ⏳ Any creator can deploy
   ✅ CLI operations           │    ⏳ One-click setup
   ✅ Devnet + Mainnet         │    ⏳ Web dashboard
   ✅ Basic monitoring         │    ⏳ Full analytics suite
                               │    ⏳ Public API
                               │

═══════════════════════════════════════════════════════════════════
```

**Phase 1** proves the concept. **Phase 2** makes it universal.

---

## 📁 Project Structure

```
asdf-dat/
├── programs/asdf-dat/src/     # 🦀 Anchor smart contract (Rust)
│   └── lib.rs                 # 26 instructions, all logic
├── scripts/                   # 📜 TypeScript automation
│   ├── execute-ecosystem-cycle.ts   # Main orchestrator
│   ├── monitor-ecosystem-fees.ts    # Fee daemon
│   └── [20+ utility scripts]
├── lib/                       # 🔧 Shared utilities
├── devnet-tokens/             # 🧪 Devnet token configs
├── mainnet-tokens/            # 💎 Mainnet token configs
└── docs/                      # 📚 Technical documentation
```

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [🏗️ Architecture](docs/ARCHITECTURE.md) | System design, PDAs, data flow |
| [👨‍💻 Developer Guide](docs/DEVELOPER_GUIDE.md) | Integration, accounts, errors |
| [📖 API Reference](docs/API_REFERENCE.md) | All 26 instructions documented |
| [🔧 Operations](docs/OPERATIONS.md) | Monitoring, runbooks, troubleshooting |

---

## 🛡️ Security

- ✅ **Audited**: Internal security review completed (Nov 2025)
- ⏸️ **Emergency Pause**: Admin can halt all operations instantly
- 🔐 **Two-Step Admin Transfer**: Prevents accidental ownership loss
- ⚖️ **Fee Split Limits**: Max 5% change per transaction, timelocked for larger changes
- 🚨 **Auto-Pause**: System pauses after 5 consecutive failures

See [Security Notes](docs/DEVELOPER_GUIDE.md#security) for details.

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/amazing-feature`)
3. Test on devnet first
4. Submit a PR with clear description

**Code Standards**: See `CLAUDE.md` for development guidelines.

---

## 🌐 Community

Building in public. Join the conversation.

- 🐦 **Twitter**: [@ASDFASDFA552](https://x.com/ASDFASDFA552)
- 👥 **Community**: [ASDF Community](https://x.com/i/communities/1942343109159051272)

*Phase 1 is live. Mainnet stats coming soon.*

---

## 📜 License

MIT License - see [LICENSE](LICENSE) for details.

---

## 🔗 Links

- 🔍 **Program**: [Explorer](https://solscan.io/account/ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui)
- 🪙 **Root Token ($ASDF)**: [Pump.fun](https://pump.fun/coin/9FxrRPwDF44zzjfzxGKtdqXqH1JKjD4MJ1nbFP7Zpump)

---

*Building infrastructure for Creator Capital Markets.*
*This is fine.* 🔥🐕
