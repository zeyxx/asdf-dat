# ASDF Validator SDK

Per-token fee attribution for Pump.fun token ecosystems.

---

## Overview

The Validator SDK enables external applications (like token launchers) to track individual token contributions to creator rewards. When multiple tokens share the same creator wallet, the validator system provides trustless, on-chain attribution of fees per token.

### Problem

```
Token A Trade ─► Creator Vault (shared) ─► ???
Token B Trade ─► Creator Vault (shared) ─► ???
Token C Trade ─► Creator Vault (shared) ─► ???

Who generated which fees? Impossible to tell from vault balance alone.
```

### Solution

```
Token A Trade ─► Bonding Curve A ─┐
Token B Trade ─► Bonding Curve B ─┼─► Creator Vault (shared)
Token C Trade ─► Bonding Curve C ─┘
                      │
              ValidatorDaemon
                      │
         ┌────────────┼────────────┐
         ▼            ▼            ▼
  ValidatorState A  ValidatorState B  ValidatorState C
  total: 0.5 SOL    total: 0.3 SOL    total: 0.2 SOL
```

Each token gets a `ValidatorState` account tracking its cumulative fee contribution.

---

## Quick Start

### 1. Clone and Build

```bash
git clone https://github.com/your-org/asdf-dat.git
cd asdf-dat
npm install
anchor build
```

### 2. Configure Wallet

```bash
# Devnet - create or use existing wallet
solana-keygen new -o devnet-wallet.json
solana airdrop 2 $(solana-keygen pubkey devnet-wallet.json) --url devnet

# Set environment
export DEVNET_RPC_URL=https://api.devnet.solana.com
export WALLET_PATH=./devnet-wallet.json
```

### 3. Initialize Validator for Your Token

```bash
npx ts-node scripts/validator-cli.ts init \
  <YOUR_TOKEN_MINT> \
  <YOUR_BONDING_CURVE> \
  --network devnet
```

### 4. Run the Daemon

```bash
npx ts-node scripts/run-validator-daemon.ts --network devnet --verbose
```

### 5. Check Status

```bash
npx ts-node scripts/validator-cli.ts status <YOUR_TOKEN_MINT>
```

---

## CLI Reference

### `validator-cli.ts`

```bash
# Initialize validator for a token
npx ts-node scripts/validator-cli.ts init <mint> <bonding-curve> [--network devnet|mainnet]

# Check validator status
npx ts-node scripts/validator-cli.ts status <mint> [--network devnet|mainnet]

# List all configured tokens
npx ts-node scripts/validator-cli.ts list [--network devnet|mainnet]

# Add token to config
npx ts-node scripts/validator-cli.ts add-token <mint> <bc> <symbol> [--network devnet|mainnet]
```

### `run-validator-daemon.ts`

```bash
# Run with defaults (devnet)
npx ts-node scripts/run-validator-daemon.ts

# Run on mainnet with verbose logging
npx ts-node scripts/run-validator-daemon.ts --network mainnet --verbose

# Custom flush interval (60 seconds)
npx ts-node scripts/run-validator-daemon.ts --interval 60

# Custom tokens directory
npx ts-node scripts/run-validator-daemon.ts --tokens ./my-tokens
```

---

## Token Configuration

Create JSON files in `devnet-tokens/` or `mainnet-tokens/`:

```json
{
  "name": "My Token",
  "symbol": "MYTOKEN",
  "mint": "TokenMintAddress...",
  "bondingCurve": "BondingCurveAddress...",
  "poolType": "bonding_curve",
  "creator": "CreatorWalletAddress...",
  "isRoot": false
}
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `mint` | Yes | Token mint address |
| `creator` | Yes | Creator wallet address (shares vault) |
| `bondingCurve` | Yes* | PumpFun bonding curve address |
| `pool` | Yes* | PumpSwap AMM pool address |
| `poolType` | No | `bonding_curve` or `pumpswap_amm` |
| `symbol` | No | Token symbol for display |
| `isRoot` | No | Is this the root token? |

*One of `bondingCurve` or `pool` required depending on pool type.

---

## Integration Library

### TypeScript/JavaScript

```typescript
import {
  initializeValidatorForToken,
  getTokenContribution,
  getContributionLeaderboard,
  isValidatorInitialized,
} from './lib/asdev-integration';

// Check if validator exists
const exists = await isValidatorInitialized(connection, mintPubkey);

// Initialize validator (after launching token)
if (!exists) {
  const tx = await initializeValidatorForToken(
    program,
    mintPubkey,
    bondingCurvePubkey,
    payerPubkey
  );
  console.log('Initialized:', tx);
}

// Get contribution data
const contribution = await getTokenContribution(connection, mintPubkey);
console.log(`Total fees: ${contribution.totalFeesSOL} SOL`);

// Get leaderboard
const leaderboard = await getContributionLeaderboard(connection, mints);
for (const token of leaderboard) {
  console.log(`${token.mint}: ${token.percentage.toFixed(1)}%`);
}
```

### API Reference

#### `isValidatorInitialized(connection, mint)`

Check if a validator exists for a token.

```typescript
const exists: boolean = await isValidatorInitialized(connection, mintPubkey);
```

#### `initializeValidatorForToken(program, mint, bondingCurve, payer)`

Initialize a new validator for a token.

```typescript
const tx: string = await initializeValidatorForToken(
  program,
  mintPubkey,
  bondingCurvePubkey,
  payerPubkey
);
```

#### `getTokenContribution(connection, mint)`

Get contribution data for a single token.

```typescript
const contribution: TokenContribution | null = await getTokenContribution(
  connection,
  mintPubkey
);

// Returns:
// {
//   mint: string,
//   totalFees: number,      // lamports
//   totalFeesSOL: number,   // SOL
//   validationCount: number,
//   lastSlot: number,
//   feeRateBps: number
// }
```

#### `getContributionLeaderboard(connection, mints)`

Get sorted leaderboard of contributions.

```typescript
const leaderboard: TokenContributionWithPercentage[] =
  await getContributionLeaderboard(connection, mints);

// Returns array sorted by totalFees descending:
// {
//   ...TokenContribution,
//   percentage: number  // % of total
// }
```

#### `calculateProportionalDistribution(contributions, amount)`

Calculate proportional distribution based on contributions.

```typescript
const distribution = calculateProportionalDistribution(
  contributionsMap,
  1_000_000_000  // 1 SOL to distribute
);

// Returns Map<mint, lamports>
```

---

## Architecture

### On-Chain Accounts

**ValidatorState** - Per-token tracking (PDA: `["validator_v1", mint]`)

```rust
pub struct ValidatorState {
    pub mint: Pubkey,                // Token mint
    pub bonding_curve: Pubkey,       // Pool address
    pub last_validated_slot: u64,    // Last validated slot
    pub total_validated_lamports: u64, // Cumulative fees
    pub total_validated_count: u64,  // Validation batches
    pub fee_rate_bps: u16,           // Fee rate (50 = 0.5%)
    pub bump: u8,
}
```

### Instructions

| Instruction | Access | Description |
|-------------|--------|-------------|
| `initialize_validator` | Anyone | Create ValidatorState for a token |
| `register_validated_fees` | Admin | Register validated fees (daemon only) |
| `sync_validator_slot` | Admin | Reset stale validator |

### Daemon Flow

```
1. Poll vault balances (every 5s)
   └── Detect balance increases = fees

2. Accumulate in memory
   └── Track per-token pending amounts

3. Flush to chain (every 30s)
   └── register_validated_fees(amount, slot, count)

4. ValidatorState updated
   └── total_validated_lamports += amount
```

---

## Security

### Admin Authority

The daemon requires admin authority to call `register_validated_fees`. This prevents:
- Unauthorized fee attribution
- Double-counting
- Manipulation of contributions

### Validation Rules

On-chain validations in `register_validated_fees`:
- Slot progression (no going backwards)
- Max slot range (1000 slots ~7 minutes)
- Fee sanity check (max 0.01 SOL/slot)
- TX count sanity (max 100 TX/slot)
- Pending fees cap (69 SOL max)

### Running Your Own Daemon

If you run your own daemon:
1. You control which tokens are tracked
2. You need admin authority for your tokens
3. Multiple daemons can cross-verify

---

## Troubleshooting

### "Validator NOT initialized"

Initialize the validator first:
```bash
npx ts-node scripts/validator-cli.ts init <mint> <bonding-curve>
```

### "Bonding curve not owned by PumpFun"

The bonding curve address is incorrect or the token hasn't been created yet on Pump.fun.

### "Slot range too large"

The daemon has been offline too long (>7 minutes). Run:
```bash
npx ts-node scripts/validator-cli.ts sync <mint>
```

### "Insufficient balance"

The daemon wallet needs SOL for transaction fees:
```bash
solana airdrop 1 <wallet> --url devnet
```

### No fees appearing

1. Check the daemon is running
2. Verify trading activity on the token
3. Wait for flush interval (30s default)
4. Check verbose logs: `--verbose`

---

## Best Practices

1. **One daemon per ecosystem** - Don't run multiple daemons for the same tokens
2. **Monitor the daemon** - Set up alerts for daemon crashes
3. **Keep wallet funded** - ~0.001 SOL per flush transaction
4. **Use reliable RPC** - Public RPCs may rate limit

---

## Example Integration

See `examples/asdev-integration.ts` for a complete integration example showing:
- Token launch flow
- Validator initialization
- Contribution querying
- Proportional distribution

---

## Support

- Issues: https://github.com/your-org/asdf-dat/issues
- Documentation: https://docs.asdf.xyz

---

*Flush. Burn. Verify.* 🔥🐕
