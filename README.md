# ASDF DAT - Automated Buyback and Burn System

Automated system for collecting PumpFun trading fees and executing buyback-and-burn cycles on Solana.

## 🏗️ **Architecture**

### Program (Solana/Rust)
- **Program ID**: `ASDFznSwUWikqQMNE1Y7qqskDDkbE74GXZdUe6wu4UCz`
- **Location**: `programs/asdf-dat/src/lib.rs`
- **Framework**: Anchor 0.31.1

### Supported Instructions (11 total)

**Core Operations:**
1. `initialize` - Setup DAT state and authority PDAs
2. `collect_fees` - Collect SOL from PumpFun creator vault (2x daily: AM/PM)
3. `execute_buy` - Buy ASDF tokens with collected SOL
4. `burn_and_update` - Burn tokens and update statistics
5. `record_failure` - Log failed cycles on-chain

**Admin Controls:**
6. `emergency_pause` - Pause all operations
7. `resume` - Resume after pause
8. `update_parameters` - Adjust fees, slippage, intervals
9. `transfer_admin` - Transfer admin authority
10. `create_pumpfun_token` - Create tokens via CPI

## 📁 **Project Structure**

```
asdf-dat/
├── programs/asdf-dat/      # Solana program (Rust)
│   └── src/lib.rs
├── src/                     # TypeScript application
│   ├── bot.ts              # Automated bot
│   ├── dashboard.tsx       # UI dashboard
│   └── index.ts
├── scripts/                 # Essential setup scripts
│   ├── init.ts             # Initialize DAT protocol
│   ├── create-token.ts     # Create PumpFun token
│   ├── init-all-accounts.ts
│   ├── setup-ata.ts
│   └── find-creator-vault.ts
├── tests/scripts/           # Test scripts
│   ├── test-dat-cycle.ts   # Full cycle test
│   ├── buy-normal-wallet.ts
│   └── simulate-fees.ts
├── docs/                    # Documentation
│   ├── setup/              # Setup guides
│   └── guides/             # User guides
├── config/                  # Configuration files
│   └── devnet-dat-deployment.json
├── devnet-config.json       # Active devnet config
├── devnet-token-info.json   # Token metadata
└── devnet-wallet.json       # Admin wallet (gitignored)
```

## 🚀 **Quick Start (Devnet)**

### 1. Prerequisites

```bash
# Install dependencies
npm install

# Setup Solana CLI
solana config set --url devnet
solana-keygen new -o devnet-wallet.json
solana airdrop 2 devnet-wallet.json
```

### 2. Deploy Program

```bash
# Build
anchor build

# Deploy
anchor deploy --provider.cluster devnet

# Note the Program ID and update in lib.rs
```

### 3. Initialize Protocol

```bash
# Initialize DAT state and authority
npm run init

# This creates:
# - DAT State PDA (seed: "dat_v3")
# - DAT Authority PDA (seed: "auth_v3")
```

### 4. Create Token

```bash
# Create PumpFun token with DAT Authority as creator
npm run create-token

# Saves token info to devnet-token-info.json
```

### 5. Test Cycle

```bash
# Run complete cycle test
npx ts-node tests/scripts/test-dat-cycle.ts

# This executes:
# 1. collect_fees (requires 0.01+ SOL in creator vault)
# 2. execute_buy (buys ASDF tokens)
# 3. burn_and_update (burns tokens, updates stats)
```

### 6. Run Bot (Production)

```bash
npm run bot

# Bot monitors and executes cycles automatically
# - Runs twice daily (AM/PM)
# - Validates fee thresholds
# - Records failures on-chain
```

## 📋 **Available NPM Scripts**

```bash
npm run build          # Compile TypeScript & build Anchor program
npm run clean          # Remove build artifacts
npm run test           # Run Anchor tests

# Setup
npm run init           # Initialize DAT protocol
npm run create-token   # Create PumpFun token
npm run init-accounts  # Initialize all accounts
npm run setup-ata      # Setup associated token accounts

# Utilities
npm run find-vault     # Find creator vault PDA

# Production
npm run bot            # Run automated bot
```

## 🔧 **Configuration**

### Environment Variables (`.env`)

```bash
RPC_URL=https://api.devnet.solana.com
WALLET_PATH=./devnet-wallet.json
PROGRAM_ID=ASDFznSwUWikqQMNE1Y7qqskDDkbE74GXZdUe6wu4UCz
```

### Config Files

- `config/devnet-dat-deployment.json` - DAT deployment info
- `devnet-config.json` - Active configuration
- `devnet-token-info.json` - Token metadata

## 🔐 **Security**

**⚠️ NEVER commit these files:**
- `devnet-wallet.json`
- `mainnet-wallet.json`
- `ASDF*.json` (program keypairs)
- Any file with private keys

These are automatically ignored via `.gitignore`.

## ⚠️ **TESTING_MODE - Production Deployment**

**CRITICAL: Before deploying to mainnet/production:**

The program includes a `TESTING_MODE` constant in `programs/asdf-dat/src/lib.rs` (line 59):

```rust
pub const TESTING_MODE: bool = true;  // ⚠️ MUST BE FALSE FOR MAINNET
```

### What TESTING_MODE Controls

When `TESTING_MODE = true` (current default for devnet):
- ✅ Disables minimum cycle interval enforcement
- ✅ Disables AM/PM execution limits
- ✅ Disables minimum fees threshold checks
- 🎯 Allows rapid testing without waiting periods

When `TESTING_MODE = false` (required for production):
- ✅ Enforces 60-second minimum between cycles
- ✅ Enforces AM/PM execution limits (prevents spam)
- ✅ Enforces minimum fees threshold (10 SOL)
- 🔒 Full production safety constraints active

### Before Mainnet Deployment

1. **Change TESTING_MODE to false**:
   ```rust
   pub const TESTING_MODE: bool = false;
   ```

2. **Rebuild the program**:
   ```bash
   anchor build
   ```

3. **Deploy to mainnet**:
   ```bash
   anchor deploy --provider.cluster mainnet
   ```

**⚠️ Deploying with TESTING_MODE=true on mainnet is a security risk!**

## 🧪 **Testing**

### Unit Tests
```bash
anchor test
```

### Integration Tests
```bash
# Test full cycle
npx ts-node tests/scripts/test-dat-cycle.ts

# Test buy functionality
npx ts-node tests/scripts/buy-with-idl.ts

# Simulate fees
npx ts-node tests/scripts/simulate-fees.ts
```

## 📊 **Program Constants**

- **ASDF Mint**: `9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump`
- **Min Fees**: 10 SOL (10,000,000 lamports)
- **Max Fees/Cycle**: 1 SOL (1,000,000,000 lamports)
- **Slippage**: 5% (500 bps)
- **Cycle Interval**: 60 seconds minimum

## 🛠️ **Development**

### Build from Source

```bash
# Clone repository
git clone https://github.com/zeyxx/asdf-dat.git
cd asdf-dat

# Install dependencies
npm install

# Build program
anchor build

# Compile TypeScript
npm run compile
```

### Rust Dependencies
- `anchor-lang` = "0.31.1"
- `anchor-spl` = "0.31.1"

### TypeScript Dependencies
- `@coral-xyz/anchor` = "0.30.1" (compatible with 0.31.1)
- `@solana/web3.js` = "^1.95.0"
- `@solana/spl-token` = "^0.4.8"

## 📖 **Documentation**

- [Setup Guide](docs/setup/wsl-setup.sh)
- [Quick Start](docs/guides/quick-start-test.md)
- [E2E Testing](docs/guides/e2e-testing.md)
- [PumpFun Guide](PUMPFUN_DEVNET_GUIDE.md)

## 🤝 **Contributing**

This is a private project. For questions or issues, contact the team.

## 📜 **License**

See [LICENSE](LICENSE) file for details.

---

**⚡ Built with [Anchor](https://www.anchor-lang.com/) on [Solana](https://solana.com/)**
