# @asdf/validator-sdk

Run your own validator daemon to track creator fees on Pump.fun.

## Install

```bash
npm install -g @asdf/validator-sdk
```

## Quick Start

```bash
# Run daemon for your creator address
asdf-validator --creator YOUR_CREATOR_WALLET_ADDRESS

# With verbose logging
asdf-validator -c YOUR_ADDRESS -v

# Custom RPC
asdf-validator -c YOUR_ADDRESS -r https://my-rpc.com
```

## What It Does

1. Monitors your creator vault for balance changes
2. Detects fee accumulation from trading activity
3. Tracks total fees in real-time
4. Reports stats every 60 seconds

```
🔥 ASDF VALIDATOR DAEMON
═══════════════════════════════════════════════════════
Creator:    5ABC...xyz
BC Vault:   7DEF...uvw
AMM Vault:  9GHI...rst
═══════════════════════════════════════════════════════

▶ Starting daemon...

✅ Daemon running. Press Ctrl+C to stop.

[12:34:56] 💰 BC: +0.001234 SOL
[12:35:12] 💰 BC: +0.000567 SOL

📊 STATS
────────────────────────────────────
Total: 0.001801 SOL
────────────────────────────────────
```

## Options

```
--creator, -c <ADDRESS>   Creator wallet address (required)
--rpc, -r <URL>           RPC URL (default: mainnet)
--tokens, -t <FILE>       JSON file with token configs
--interval, -i <SECONDS>  Poll interval (default: 5)
--verbose, -v             Verbose logging
--help, -h                Show help
```

## Token Config File

Track specific tokens with a JSON file:

```json
[
  {
    "mint": "TokenMintAddress...",
    "symbol": "MYTOKEN",
    "bondingCurve": "BCAddress...",
    "poolType": "bonding_curve"
  }
]
```

```bash
asdf-validator -c YOUR_ADDRESS -t tokens.json
```

## Programmatic Usage

```typescript
import { ValidatorDaemon } from '@asdf/validator-sdk';

const daemon = new ValidatorDaemon({
  rpcUrl: 'https://api.mainnet-beta.solana.com',
  creatorAddress: 'YOUR_CREATOR_ADDRESS',
  verbose: true,

  onFeeDetected: (record) => {
    console.log(`${record.symbol}: +${record.amount} lamports`);
    // Save to database, send notification, etc.
  },

  onStats: (stats) => {
    // Periodic stats callback
    const total = stats.reduce((sum, s) => sum + Number(s.totalFees), 0);
    console.log(`Total: ${total / 1e9} SOL`);
  },
});

await daemon.start();

// Later...
daemon.stop();
console.log(`Final total: ${daemon.getTotalFees()}`);
```

## API

### `ValidatorDaemon`

```typescript
new ValidatorDaemon(config: DaemonConfig)
```

#### Config

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `rpcUrl` | string | Yes | Solana RPC URL |
| `creatorAddress` | string | Yes | Creator wallet |
| `tokens` | TokenConfig[] | No | Tokens to track |
| `pollInterval` | number | No | Poll interval ms (default: 5000) |
| `verbose` | boolean | No | Enable logging |
| `onFeeDetected` | function | No | Fee callback |
| `onStats` | function | No | Stats callback |
| `statsInterval` | number | No | Stats interval ms (default: 60000) |

#### Methods

| Method | Description |
|--------|-------------|
| `start()` | Start the daemon |
| `stop()` | Stop the daemon |
| `isRunning()` | Check if running |
| `getStats()` | Get current stats |
| `getTotalFees()` | Get total fees (bigint) |
| `addToken(config)` | Add token to track |

### Utility Functions

```typescript
import {
  deriveBondingCurveVault,
  derivePumpSwapVault,
} from '@asdf/validator-sdk';

// Get vault addresses for a creator
const bcVault = deriveBondingCurveVault(creatorPubkey);
const ammVault = derivePumpSwapVault(creatorPubkey);
```

## Environment Variables

```bash
RPC_URL=https://my-rpc.com  # Default RPC URL
```

## License

MIT
