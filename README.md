# ASDF-DAT

**Decentralized Autonomous Treasury Infrastructure for Solana**

Automated buyback and burn infrastructure for Creator Capital Markets.

[![Solana](https://img.shields.io/badge/Solana-Mainnet-green)](https://solana.com)
[![Anchor](https://img.shields.io/badge/Anchor-0.31.1-blue)](https://anchor-lang.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://typescriptlang.org)

---

## What is ASDF-DAT?

ASDF-DAT is a protocol that enables token communities and creators to automate buyback and burn mechanisms, creating sustainable economic flywheels for pump.fun tokens.

```
Trading Volume → Creator Fees → Buyback → Burn → Scarcity → Value
       ↑                                                    │
       └────────────────────────────────────────────────────┘
```

---

## The Problem

Tokens on pump.fun lack sustainability mechanisms:

- Creators extract fees and dump
- No creator/holder economic alignment
- Absence of deflationary pressure
- 99% of tokens die within weeks

**Result**: A race to the bottom where everyone loses.

---

## The Solution: DAT Infrastructure

DAT (Decentralized Autonomous Treasury) provides:

- **Automated buyback**: Fees converted to market purchases
- **Permanent burns**: Purchased tokens destroyed forever
- **On-chain execution**: Transparent and verifiable
- **Configurable parameters**: Adapt to community needs

---

## Roadmap

### Phase 1: Validation (Current)

Proving the infrastructure works with a single ecosystem.

```
                    $asdfasdfa (ROOT)
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
    [Secondary 1]   [Secondary 2]   [Secondary N]
         │               │               │
         └───────────────┼───────────────┘
                         │
              55.2% ◄────┴────► 44.8%
           Secondary          Root
            Buyback         Treasury
```

**Fee Split**: 55.2% to secondary token buyback / 44.8% to root treasury

**Objective**: Demonstrate on-chain track record of:
- Successful buyback cycles
- Deflationary burns
- Compound ecosystem effects

### Phase 2: Universal Infrastructure

Opening the protocol to all pump.fun communities and creators.

```
┌─────────────────────────────────────────────────────────────┐
│                    DAT PROTOCOL                              │
│                                                              │
│                  ┌─────────────────┐                         │
│                  │   $asdfasdfa    │                         │
│                  │ (Protocol Root) │                         │
│                  └────────┬────────┘                         │
│                           │                                  │
│              ┌────────────┼────────────┐                     │
│              │            │            │                     │
│              ▼            ▼            ▼                     │
│         ┌─────────┐ ┌─────────┐ ┌─────────┐                 │
│         │  DAT A  │ │  DAT B  │ │  DAT N  │                 │
│         │Community│ │ Creator │ │ Project │                 │
│         └────┬────┘ └────┬────┘ └────┬────┘                 │
│              │           │           │                       │
│              └───────────┼───────────┘                       │
│                          │                                   │
│                       5.52%                                  │
│                   to $asdfasdfa                              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Protocol Fee**: 5.52% of ALL integrated DAT fees flow to $asdfasdfa

**$asdfasdfa becomes an index fund**: Holders gain exposure to the entire DAT ecosystem without needing to pick individual winners.

---

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | Technical system design |
| [Tokenomics](docs/TOKENOMICS.md) | Economic model (Phase 1 & 2) |
| [Integration Guide](docs/INTEGRATION.md) | How to integrate (Phase 2) |
| [Glossary](docs/GLOSSARY.md) | Terminology definitions |

---

## Quick Start (Devnet)

### Prerequisites

```bash
npm install
solana config set --url devnet
```

### Generate Test Volume

```bash
# Buy + Sell cycles to generate fees
npx ts-node scripts/generate-volume.ts devnet-token-spl.json 2 0.5
npx ts-node scripts/sell-spl-tokens-simple.ts devnet-token-spl.json
```

### Start Fee Monitor Daemon

```bash
npx ts-node scripts/monitor-ecosystem-fees.ts --network devnet
```

### Execute Ecosystem Cycle

```bash
# Wait 15s for daemon sync, then:
npx ts-node scripts/execute-ecosystem-cycle.ts devnet-token-spl.json
```

### Check Statistics

```bash
npx ts-node scripts/check-current-stats.ts
npx ts-node scripts/check-dat-state.ts
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    ASDF-DAT SYSTEM                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────────────┐    ┌──────────────────┐                  │
│   │   Fee Monitor    │    │   Orchestrator   │                  │
│   │     Daemon       │    │    (Cycles)      │                  │
│   └────────┬─────────┘    └────────┬─────────┘                  │
│            │                       │                             │
│            │    ┌──────────────────┘                             │
│            │    │                                                │
│            ▼    ▼                                                │
│   ┌──────────────────────────────────┐                          │
│   │      SOLANA SMART CONTRACT       │                          │
│   │  ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5 │                          │
│   └──────────────────────────────────┘                          │
│                       │                                          │
│            ┌──────────┼──────────┐                               │
│            │          │          │                               │
│            ▼          ▼          ▼                               │
│       ┌────────┐ ┌────────┐ ┌────────┐                          │
│       │ Token  │ │ Token  │ │ Token  │                          │
│       │ Stats  │ │ Stats  │ │ Stats  │                          │
│       └────────┘ └────────┘ └────────┘                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Components**:
- **Fee Monitor Daemon**: Attributes fees to specific tokens (solves shared vault problem)
- **Ecosystem Orchestrator**: Executes batched buyback/burn cycles
- **Smart Contract**: On-chain logic for fee collection, buyback, and burns

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Multi-Token Support** | Unlimited secondary tokens |
| **Token-Agnostic** | SPL and Token-2022 supported |
| **Hierarchical Distribution** | Configurable fee splits |
| **Batch Execution** | N+1 pattern for efficiency |
| **Emergency Controls** | Pause/Resume capabilities |
| **State Persistence** | Crash recovery without fee loss |

---

## Project Structure

```
asdf-dat/
├── programs/asdf-dat/          # Solana Smart Contract (Rust)
│   └── src/lib.rs              # Main program
│
├── scripts/                    # Operation scripts
│   ├── execute-ecosystem-cycle.ts   # Main orchestrator
│   ├── monitor-ecosystem-fees.ts    # Fee daemon
│   ├── generate-volume.ts           # Test volume
│   └── check-*.ts                   # Monitoring
│
├── lib/                        # Utilities
│   ├── fee-monitor.ts          # Daemon library
│   └── network-config.ts       # Configuration
│
├── docs/                       # Documentation
│   ├── ARCHITECTURE.md
│   ├── TOKENOMICS.md
│   ├── INTEGRATION.md
│   └── GLOSSARY.md
│
└── devnet-token-*.json         # Token configurations
```

---

## Addresses

| Element | Address |
|---------|---------|
| **Program ID** | `ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui` |
| **PumpSwap** | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` |
| **Pump.fun** | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` |

---

## Security

- **TESTING_MODE**: Must be `false` for mainnet
- **Emergency Pause**: Admin can halt operations
- **Slippage Protection**: Configurable tolerance on buybacks
- **Audit Status**: See [Security Audit](docs/SECURITY-AUDIT-2025-11-27.md)

---

## Links

| Resource | Link |
|----------|------|
| Twitter | [@asikiland](https://twitter.com/asikiland) |
| GitHub | [asdf-dat](https://github.com/zeyxx/asdf-dat) |

---

## License

Private project. Contact the team for inquiries.

---

**Built with [Anchor](https://anchor-lang.com) on [Solana](https://solana.com)**
