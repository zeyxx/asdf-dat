# ASDF DAT - Autonomous Supply Reduction Protocol

<div align="center">

![Build Status](https://img.shields.io/badge/Build-Passing-success?style=flat-square)
![Solana](https://img.shields.io/badge/Solana-Mainnet-blueviolet?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)
![Version](https://img.shields.io/badge/Version-2.0.0-orange?style=flat-square)

**An open-source protocol for autonomous token supply management on Solana**

[Documentation](#documentation) • [Installation](#installation) • [Architecture](#architecture) • [Contributing](#contributing)

</div>

---

## Overview

The ASDF DAT (Decentralized Autonomous Token) protocol is a community-developed solution that automatically manages token supply through a transparent, on-chain mechanism. The protocol collects creator fees generated from trading activity and uses them to permanently reduce the circulating supply of $ASDFASDFA tokens.

## Purpose

This protocol addresses the need for sustainable token economics within the $ASDFASDFA ecosystem by:

- Converting passive fee accumulation into active supply management
- Providing transparent and verifiable on-chain operations
- Eliminating manual intervention through autonomous execution
- Ensuring equal benefit distribution to all token holders

## How It Works

### Core Mechanism

The protocol operates through a simple, repeatable cycle:

1. **Collection**: Aggregates creator fees from PumpSwap trading activity
2. **Acquisition**: Purchases tokens from the open market
3. **Removal**: Permanently removes acquired tokens from circulation
4. **Documentation**: Records all operations on-chain for transparency

### Technical Flow

```
Trading Activity (PumpSwap)
         │
         ├─→ Creator Fees (0.3%-1.25% based on market cap)
         │
         └─→ Creator Vault (PDA)
                  │
                  ├─→ Threshold Check (≥0.19 SOL)
                  │
                  └─→ DAT Protocol Execution
                           │
                           ├─→ Fee Collection
                           ├─→ Token Acquisition
                           ├─→ Supply Reduction
                           └─→ Event Emission
```

## Architecture

### Smart Contract Components

- **State Management**: Tracks operational metrics and parameters
- **Fee Collection**: Interfaces with PumpSwap creator vault
- **Market Operations**: Executes token acquisitions via PumpSwap
- **Supply Management**: Implements permanent token removal
- **Safety Controls**: Enforces operational limits and protections

### Operational Parameters

| Parameter | Value | Purpose |
|-----------|-------|---------|
| Minimum Threshold | 0.19 SOL | Ensures gas efficiency |
| Maximum per Cycle | 10 SOL | Prevents market disruption |
| Execution Frequency | 2x daily | Random times to prevent gaming |
| Price Impact Limit | 3% | Maintains market stability |
| Supply Reduction | 100% | All acquired tokens removed |

### Security Features

- **Immutable Core Logic**: Critical functions cannot be altered
- **Multi-signature Admin**: Administrative actions require approval
- **Automatic Safeguards**: Self-pausing on anomaly detection
- **Slippage Protection**: Adaptive tolerance (1-3%)
- **Anti-manipulation**: Random execution timing

## Implementation

### Prerequisites

- Node.js v18.0.0 or higher
- Rust 1.70.0 or higher
- Solana CLI 1.17.0 or higher
- Anchor Framework 0.30.0

### Installation

```bash
# Clone repository
git clone https://github.com/asdf-community/asdf-dat
cd asdf-dat

# Install dependencies
npm install

# Build program
anchor build

# Run tests
anchor test
```

### Deployment

```bash
# Deploy to Solana
anchor deploy --provider.cluster mainnet

# Initialize protocol
npm run dat:init

# Start automation
npm run dat:start
```

### Configuration

Create `.env` file with required parameters:

```env
PROGRAM_ID=<deployed_program_id>
WALLET_PATH=./wallet.json
NETWORK=mainnet
RPC_URL=https://api.mainnet-beta.solana.com
```

## Monitoring

### Dashboard

Access real-time metrics and operational data:

```bash
npm run dashboard
# Available at http://localhost:3000
```

### Metrics Tracked

- Total tokens removed from circulation
- Creator fees collected (SOL)
- Number of execution cycles
- Success rate percentage
- Current operational status

### On-Chain Verification

All operations are verifiable through:
- Solana Explorer
- Program event logs
- Transaction signatures
- Account state queries

## Fee Structure

The protocol operates within PumpSwap's dynamic fee framework:

| Market Cap Range | Creator Fee | Protocol Fee | LP Fee | Total |
|-----------------|-------------|--------------|--------|-------|
| < $85k | 0.30% | 0.95% | 0% | 1.25% |
| $85k - $300k | 0.30% | 0.93% | 0.02% | 1.25% |
| $300k - $500k | 0.95% | 0.05% | 0.20% | 1.20% |
| $500k - $2M | 0.85% | 0.05% | 0.20% | 1.10% |
| $2M - $20M | 0.70% | 0.05% | 0.20% | 0.95% |
| > $20M | 0.05% | 0.05% | 0.20% | 0.30% |

## Project Structure

```
asdf-dat/
├── programs/           # Solana program (Rust)
│   └── asdf-dat/
│       ├── src/
│       │   └── lib.rs
│       └── Cargo.toml
├── src/               # Off-chain components (TypeScript)
│   ├── bot.ts         # Automation service
│   ├── dashboard.tsx  # Monitoring interface
│   └── index.ts       # Entry point
├── tests/             # Test suite
├── scripts/           # Utility scripts
└── docs/              # Documentation
```

## Contributing

We welcome contributions from the community. Please see our [Contributing Guidelines](CONTRIBUTING.md) for details on:

- Code standards
- Testing requirements
- Pull request process
- Issue reporting

### Development Setup

```bash
# Install development dependencies
npm install --save-dev

# Run linter
npm run lint

# Format code
npm run format

# Run test suite
npm test
```

## Governance

The protocol is governed by the $ASDFASDFA community through:

- **Technical Committee**: Oversees code quality and security
- **Community Proposals**: Submit improvements via GitHub Issues
- **Transparent Operations**: All changes documented and reviewed

## Addresses

### Mainnet Contracts

| Contract | Address |
|----------|---------|
| Program | To be deployed |
| Authority | PDA (derived) |
| State | PDA (derived) |

### Token Information

| Token | Address |
|-------|---------|
| ASDF | `9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump` |
| WSOL | `So11111111111111111111111111111111111111112` |

### PumpSwap Integration

| Component | Address |
|-----------|---------|
| Pool | `DuhRX5JTPtsWU5n44t8tcFEfmzy2Eu27p4y6z8Rhf2bb` |
| Program | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` |

## Documentation

- [Technical Specification](docs/TECHNICAL_SPEC.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [API Reference](docs/API.md)
- [Security Audit](docs/AUDIT.md)

## Support

- **GitHub Issues**: [Report bugs or request features](https://github.com/asdf-community/asdf-dat/issues)
- **Discord**: [Join community discussions](https://discord.gg/asdf)
- **Documentation**: [Read the docs](https://docs.asdf-dat.com)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

```
MIT License

Copyright (c) 2025 ASDF Community

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
```

## Disclaimer

This software is experimental and provided "as is" without warranty of any kind. Users should understand the technical aspects and risks associated with blockchain protocols. The protocol operates autonomously based on predetermined parameters and cannot guarantee specific outcomes.

---

<div align="center">

**ASDF DAT Protocol** - Open Source Supply Management

Developed by the $ASDFASDFA Community

</div>