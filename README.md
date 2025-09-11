# ASDF DAT - Decentralized Autonomous Token

An automated buyback and burn system for $ASDFASDFA on Solana, creating deflationary pressure through systematic token burns.

## Overview

The ASDF DAT (Decentralized Autonomous Token) is a Solana program that automatically:
1. **Claims** creator fees from the CTO wallet on PumpSwap
2. **Buys back** ASDF tokens using collected fees
3. **Burns** 100% of purchased tokens immediately

This creates consistent deflationary pressure on the token supply while operating efficiently with minimal gas costs.

## Key Features

- **Automated Operations**: Runs 4 cycles daily at optimal times
- **Cost Efficient**: Gas costs limited to ~4.5% of revenue
- **Fully Decentralized**: On-chain program with transparent operations
- **Emergency Controls**: Pause/resume functionality for safety
- **Complete Logging**: All operations tracked for audit purposes

## Technical Specifications

### On-Chain Addresses
```
CTO_WALLET: vcGYZbvDid6cRUkCCqcWpBxow73TLpmY6ipmDUtrTF8
ASDF_MINT: 9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump
POOL_PUMPSWAP: DuhRX5JTPtsWU5n44t8tcFEfmzy2Eu27p4y6z8Rhf2bb
LP_TOKEN: GjfJvEY1Yw4bjt15r1q8ek4ZxjR5cC7bMTZZdrCWoGtA
PUMP_SWAP_PROGRAM: pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEa
```

### Operating Parameters
- **Check Interval**: 6 hours (4 cycles/day)
- **Minimum Fees**: 0.05 SOL to trigger execution
- **Cycle Times**: 00:00, 06:00, 12:00, 18:00 UTC

## Installation

### Prerequisites
- Node.js v18+ and npm
- Rust 1.70+
- Solana CLI 1.17+
- Anchor Framework 0.30.0

### Quick Start

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/asdf-dat.git
cd asdf-dat
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure environment**
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. **Build the program**
```bash
anchor build
```

5. **Deploy to Solana**
```bash
anchor deploy
```

6. **Initialize the DAT**
```bash
npm run dat:init
```

7. **Start the bot**
```bash
npm run dat:bot
```

## Usage

### CLI Commands

```bash
# Initialize the DAT (first time only)
npm run dat:init

# Check available fees in creator vault
npm run dat:check

# Execute a manual cycle
npm run dat:cycle

# Run automated bot (6-hour intervals)
npm run dat:bot

# View statistics and metrics
npm run dat:stats

# Pause operations (emergency)
npm run dat:pause

# Resume operations
npm run dat:resume
```

### Production Deployment with PM2

```bash
# Install PM2 globally
npm install -g pm2

# Start the DAT bot
pm2 start npm --name "asdf-dat" -- run dat:bot

# Save PM2 configuration
pm2 save
pm2 startup

# Monitor logs
pm2 logs asdf-dat

# Check status
pm2 status
```

## Architecture

### Project Structure
```
asdf-dat/
├── programs/
│   └── asdf-dat/
│       ├── src/
│       │   └── lib.rs         # Solana program (Rust)
│       └── Cargo.toml
├── src/
│   ├── bot.ts                 # Automation bot
│   ├── config.ts              # Configuration
│   ├── utils.ts               # Helper functions
│   └── types.ts               # TypeScript types
├── tests/
│   └── asdf-dat.test.ts      # Test suite
├── scripts/
│   ├── install.sh             # Installation script
│   └── monitor.sh             # Monitoring script
├── .env.example               # Environment template
├── package.json
├── tsconfig.json
├── Anchor.toml
└── README.md
```

### Program Components

1. **State Account (PDA)**
   - Authority (admin wallet)
   - CTO wallet address
   - Total burned amount
   - Total buyback count
   - Active status flag

2. **Instructions**
   - `initialize`: One-time setup
   - `execute_cycle`: Atomic claim → buyback → burn
   - `pause`: Emergency stop
   - `resume`: Restart operations
   - `update_authority`: Transfer admin control

## Performance Metrics

### Expected Daily Performance
Based on current market conditions:
- **Daily Volume**: $40,646
- **Creator Fees (0.5%)**: ~$203/day
- **Cycles**: 4 per day @ $51 each
- **Tokens Burned**: ~135,000 ASDF/day
- **Supply Impact**: -0.4% monthly reduction
- **Gas Costs**: 0.04 SOL/day (4.5% of revenue)

### Example Successful Cycle
```
1. Check: 0.075 SOL available in creator vault ✓
2. Claim: Retrieved 0.075 SOL from vault ✓
3. Buyback: Purchased 50,000 ASDF on PumpSwap ✓
4. Burn: Destroyed 50,000 ASDF tokens ✓
5. Log: Transaction confirmed, stats updated ✓
```

## Security Features

- **Minimum threshold checks** before execution
- **Slippage protection** (1% max) on swaps
- **Emergency pause** functionality
- **Authority-only** admin functions
- **Comprehensive error handling**
- **Transaction atomicity** (all-or-nothing execution)

## Monitoring

### Dashboard Metrics
The bot provides real-time metrics including:
- Total SOL collected
- Total ASDF burned
- Number of cycles completed
- Current burn rate
- Supply reduction percentage
- Gas efficiency ratio

### Logs
All operations are logged with timestamps:
```
[2024-01-15 12:00:00] Cycle started
[2024-01-15 12:00:01] Fees available: 0.075 SOL
[2024-01-15 12:00:02] Claiming fees...
[2024-01-15 12:00:05] Buying back 50,000 ASDF...
[2024-01-15 12:00:08] Burning tokens...
[2024-01-15 12:00:10] Cycle complete: 50,000 ASDF burned
```

## Troubleshooting

### Common Issues

1. **Insufficient fees in vault**
   - Solution: Wait for fees to accumulate above 0.05 SOL

2. **Transaction failures**
   - Check RPC endpoint status
   - Verify wallet has SOL for gas
   - Review slippage settings

3. **Bot not running cycles**
   - Verify DAT is not paused
   - Check system time synchronization
   - Review logs for errors

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Setup
```bash
# Install dev dependencies
npm install --save-dev

# Run tests
npm test

# Run linter
npm run lint

# Format code
npm run format
```

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/asdf-dat/issues)
- **Documentation**: [Wiki](https://github.com/yourusername/asdf-dat/wiki)
- **Community**: [Discord](https://discord.gg/asdf)

## Disclaimer

This software is provided "as is" without warranty of any kind. Users should understand the risks involved in DeFi operations and conduct their own research before using this system.

---

**Built with ❤️ for the ASDF community**
