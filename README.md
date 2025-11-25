# ASDF-DAT Ecosystem

**Automated Buyback & Burn Protocol for Solana**

An automated system for collecting Pump.fun trading fees and executing buyback-and-burn cycles, with multi-token support and hierarchical redistribution.

[![Solana](https://img.shields.io/badge/Solana-Devnet-green)](https://solana.com)
[![Anchor](https://img.shields.io/badge/Anchor-0.31.1-blue)](https://anchor-lang.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://typescriptlang.org)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    ASDF-DAT ECOSYSTEM                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  ROOT TOKEN  │◄───│  SECONDARY   │◄───│   MAYHEM     │      │
│  │   (DATSPL)   │    │   (DATS2)    │    │   (DATM)     │      │
│  │    100%      │    │  55.2%/44.8% │    │  55.2%/44.8% │      │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘      │
│         │                   │                   │               │
│         └─────────┬─────────┴─────────┬─────────┘               │
│                   ▼                   ▼                         │
│           ┌──────────────────────────────────┐                  │
│           │     ECOSYSTEM ORCHESTRATOR       │                  │
│           │   Dynamic Balance Allocation     │                  │
│           └──────────────┬───────────────────┘                  │
│                          ▼                                      │
│           ┌──────────────────────────────────┐                  │
│           │      SOLANA SMART CONTRACT       │                  │
│           │   ASDfNfUHwVGfrg3SV7SQYWhaVxnrCU │                  │
│           └──────────────────────────────────┘                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Economic Flow

1. **Trading Fees** → Collected from Pump.fun creator vaults
2. **Fee Split** → Secondary tokens send 44.8% to root treasury
3. **Buyback** → SOL used to buy tokens on the bonding curve
4. **Burn** → Purchased tokens are burned, reducing supply

---

## Features

- **Multi-Token Ecosystem** - Unlimited secondary token support
- **Hierarchical Fee Distribution** - 44.8% of secondary fees → root token
- **Dynamic Allocation** - Proportional distribution based on pending fees
- **Mayhem Mode** - Token-2022 support with extensions
- **Graceful Deferral** - Tokens with insufficient allocation deferred to next cycle
- **Emergency Controls** - Pause/Resume for critical situations

---

## Quick Start (Devnet)

### Prerequisites

```bash
# Install dependencies
npm install

# Configure Solana CLI
solana config set --url devnet
```

### Generate Test Volume

```bash
# Generate trades (buys + sells) to accumulate fees
npx ts-node scripts/generate-volume.ts devnet-token-spl.json 10 0.1
npx ts-node scripts/generate-volume.ts devnet-token-secondary.json 10 0.1
npx ts-node scripts/generate-volume.ts devnet-token-mayhem.json 10 0.1
```

### Execute Ecosystem Cycle

```bash
# Full cycle: collect → distribute → buyback → burn (all tokens)
npx ts-node scripts/execute-ecosystem-cycle.ts devnet-token-spl.json
```

### Check Statistics

```bash
# Current token state
npx ts-node scripts/check-current-stats.ts

# DAT protocol state
npx ts-node scripts/check-dat-state.ts
```

---

## Project Structure

```
asdf-dat/
├── programs/asdf-dat/          # Solana Smart Contract (Rust)
│   └── src/
│       ├── lib.rs              # Main program (2,164 LOC)
│       └── tests.rs            # Unit tests
│
├── scripts/                    # Operation scripts (56 files)
│   ├── execute-ecosystem-cycle.ts   # Main orchestrator
│   ├── generate-volume.ts           # Trade generation
│   ├── check-*.ts                   # Monitoring scripts
│   ├── buy-*.ts / sell-*.ts         # Trading operations
│   └── init-*.ts / create-*.ts      # Initialization
│
├── src/                        # TypeScript applications
│   ├── bot.ts                  # Automated bot
│   ├── dashboard.ts            # Web dashboard
│   └── index.ts                # CLI entry point
│
├── lib/                        # Daemons and utilities
│   ├── fee-monitor.ts          # Fee monitoring
│   └── validator-daemon.ts     # Validator synchronization
│
├── tests/                      # Integration tests
├── docs/                       # Documentation
│
├── devnet-token-spl.json       # Root token config
├── devnet-token-secondary.json # Secondary token config
├── devnet-token-mayhem.json    # Mayhem token config
└── asdf_dat.json               # Program IDL
```

---

## Smart Contract Instructions (21 total)

### Core Operations
| Instruction | Description |
|-------------|-------------|
| `initialize` | Initialize DAT state and authority PDAs |
| `initialize_token_stats` | Create per-token tracking |
| `collect_fees` | Collect SOL from Pump.fun vault |
| `execute_buy` | Buy tokens with collected SOL |
| `burn_and_update` | Burn tokens and update stats |
| `finalize_allocated_cycle` | Finalize an orchestrated cycle |

### Ecosystem Management
| Instruction | Description |
|-------------|-------------|
| `set_root_token` | Configure root token for fee split |
| `update_fee_split` | Adjust distribution ratio (1000-9000 bps) |
| `register_validated_fees` | Register daemon-validated fees |
| `sync_validator_slot` | Synchronize validator state |

### Token Creation
| Instruction | Description |
|-------------|-------------|
| `create_pumpfun_token` | Create standard SPL token |
| `create_pumpfun_token_mayhem` | Create Mayhem token (Token-2022) |

### Administration
| Instruction | Description |
|-------------|-------------|
| `emergency_pause` | Pause all operations |
| `resume` | Resume after pause |
| `update_parameters` | Modify system parameters |
| `transfer_admin` | Transfer admin authority |

---

## Configuration

### Token Configs

Each token is configured via a JSON file:

```json
{
  "mint": "rxeo277TLJfPYX6zaSfbtyHWY7BkTREL9AidoNi38jr",
  "bondingCurve": "HDHVCfjbnxX3EzAhDpHj1Coiooq7yEPBXp74CDtkvCap",
  "creator": "4nS8cak3SUafTXsmaZVi1SEVoL67tNotsnmHG1RH7Jjd",
  "symbol": "DATSPL",
  "isRoot": true,
  "mayhemMode": false,
  "network": "devnet"
}
```

### Environment Variables

```bash
# .env
RPC_URL=https://api.devnet.solana.com
WALLET_PATH=./devnet-wallet.json
```

---

## Fee Distribution

### Secondary Tokens (55.2% / 44.8%)

```
Received allocation: 100%
    │
    ├── 55.2% → Secondary token buyback
    │
    └── 44.8% → Root Treasury
                    │
                    └── Root token buyback
```

### Root Token (100%)

```
Collected fees: 100%
    │
    └── 100% → Root token buyback
```

---

## Main Scripts

### Ecosystem Cycle
```bash
# Execute full cycle on all tokens
npx ts-node scripts/execute-ecosystem-cycle.ts devnet-token-spl.json
```

### Volume Generation
```bash
# Generate trades to accumulate fees
# Args: <token-config> <rounds> <amount-sol>
npx ts-node scripts/generate-volume.ts devnet-token-spl.json 10 0.1
```

### Monitoring
```bash
# Token statistics
npx ts-node scripts/check-current-stats.ts

# Protocol state
npx ts-node scripts/check-dat-state.ts

# Vault balance
npx ts-node scripts/check-creator-vault.ts devnet-token-spl.json
```

### Token Sales
```bash
# Sell all SPL tokens
npx ts-node scripts/sell-spl-tokens-simple.ts devnet-token-spl.json

# Sell Mayhem tokens
npx ts-node scripts/sell-mayhem-tokens.ts devnet-token-mayhem.json
```

---

## Security

### TESTING_MODE

```rust
// programs/asdf-dat/src/lib.rs:97
pub const TESTING_MODE: bool = true;  // ⚠️ MUST BE false FOR MAINNET
```

| Mode | Cycle Interval | AM/PM Limits | Min Fees |
|------|----------------|--------------|----------|
| `true` (devnet) | Disabled | Disabled | Disabled |
| `false` (mainnet) | 60s min | Enforced | 10 SOL |

### Sensitive Files (gitignored)

- `devnet-wallet.json` / `mainnet-wallet.json`
- `wallet.json`
- `ASDF*.json` (program keypairs)
- `*.key` / `*.pem`

---

## Mainnet Deployment

### Checklist

- [ ] `TESTING_MODE = false` in lib.rs
- [ ] New program keypair (never reuse devnet)
- [ ] Mainnet RPC endpoint configured
- [ ] Secure mainnet wallet
- [ ] Mainnet token configs created
- [ ] Tests on mainnet-beta completed
- [ ] Monitoring/alerting configured

### Commands

```bash
# Build with TESTING_MODE = false
anchor build

# Deploy mainnet
anchor deploy --provider.cluster mainnet

# Update IDL
cp target/idl/asdf_dat.json .
```

---

## Dependencies

### Rust
- `anchor-lang` = "0.31.1"
- `anchor-spl` = "0.31.1"

### TypeScript
- `@coral-xyz/anchor` = "0.31.1"
- `@solana/web3.js` = "^1.91.0"
- `@pump-fun/pump-sdk` = "^1.22.1"
- `@pump-fun/pump-swap-sdk` = "^1.7.7"

---

## Documentation

| Document | Description |
|----------|-------------|
| [AUDIT-REPORT-2025-11-25.md](AUDIT-REPORT-2025-11-25.md) | Complete professional audit |
| [PRODUCTION-WORKFLOW.md](PRODUCTION-WORKFLOW.md) | Production guide |
| [QUICK_START_DEVNET.md](QUICK_START_DEVNET.md) | Quick start guide |
| [PUMPFUN_DEVNET_GUIDE.md](PUMPFUN_DEVNET_GUIDE.md) | Pump.fun integration |
| [MAYHEM-MODE-LAUNCH-GUIDE.md](MAYHEM-MODE-LAUNCH-GUIDE.md) | Mayhem Mode guide |

---

## Metrics

| Component | Files | Lines |
|-----------|-------|-------|
| Smart Contract | 2 | 2,559 |
| Scripts | 56 | 13,748 |
| Utilities | 5 | 1,509 |
| Documentation | 20+ | 4,835+ |
| **Total** | **89+** | **~23,000** |

---

## Addresses (Devnet)

| Element | Address |
|---------|---------|
| **Program ID** | `ASDfNfUHwVGfrg3SV7SQYWhaVxnrCUZyWmMpWJAPu4MZ` |
| **PumpSwap** | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` |
| **Pump.fun** | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` |
| **Token-2022** | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` |

---

## License

Private project. Contact the team for inquiries.

---

**Built with [Anchor](https://anchor-lang.com) on [Solana](https://solana.com)**
