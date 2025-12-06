# @asdf/validator-sdk

Per-token fee attribution for Pump.fun token ecosystems.

## Problem

Multiple tokens from the same creator share ONE vault. Impossible to know which token generated which fees.

```
Token A ─┐
Token B ─┼─► Shared Vault ─► ???
Token C ─┘
```

## Solution

Each token gets a `ValidatorState` tracking its contributions.

```
Token A ─► ValidatorState A: 0.5 SOL
Token B ─► ValidatorState B: 0.3 SOL
Token C ─► ValidatorState C: 0.2 SOL
```

## Install

```bash
npm install @asdf/validator-sdk @solana/web3.js
```

## Quick Start

```typescript
import { Connection, PublicKey } from '@solana/web3.js';
import { ValidatorSDK } from '@asdf/validator-sdk';

const connection = new Connection('https://api.mainnet-beta.solana.com');
const sdk = new ValidatorSDK(connection);

// Check if validator exists
const mint = new PublicKey('YOUR_TOKEN_MINT');
const exists = await sdk.isInitialized(mint);

// Get contribution
const contribution = await sdk.getContribution(mint);
console.log(`Total fees: ${contribution.totalSOL} SOL`);
```

## Initialize Validator

After launching a token on Pump.fun:

```typescript
const mint = new PublicKey('TOKEN_MINT');
const bondingCurve = new PublicKey('BONDING_CURVE');
const payer = wallet.publicKey;

// Build transaction
const tx = sdk.buildInitializeTransaction(mint, bondingCurve, payer);

// Sign and send (using your wallet adapter)
const sig = await sendTransaction(tx);
```

## Get Leaderboard

```typescript
const mints = [mint1, mint2, mint3];
const leaderboard = await sdk.getLeaderboard(mints);

for (const entry of leaderboard) {
  console.log(`#${entry.rank} ${entry.mint}: ${entry.totalSOL} SOL (${entry.percentage}%)`);
}
```

## Distribute Rewards

```typescript
const contributions = await sdk.getContributions(mints);
const distribution = sdk.calculateDistribution(contributions, 1_000_000_000n); // 1 SOL

for (const [mint, amount] of distribution) {
  console.log(`${mint}: ${Number(amount) / 1e9} SOL`);
}
```

## API

### `ValidatorSDK`

```typescript
new ValidatorSDK(connection: Connection, programId?: PublicKey)
```

#### Methods

| Method | Description |
|--------|-------------|
| `isInitialized(mint)` | Check if validator exists |
| `getContribution(mint)` | Get single token contribution |
| `getContributions(mints)` | Get multiple contributions |
| `getLeaderboard(mints)` | Get ranked contributions |
| `buildInitializeTransaction(mint, bc, payer)` | Build init transaction |
| `calculateDistribution(contributions, amount)` | Calculate proportional split |
| `verifyPool(bondingCurve)` | Verify pool ownership |

### Types

```typescript
interface TokenContribution {
  mint: string;
  totalLamports: bigint;
  totalSOL: number;
  validationCount: number;
  lastSlot: number;
  feeRateBps: number;
}

interface RankedContribution extends TokenContribution {
  percentage: number;
  rank: number;
}
```

## Standalone Functions

For functional style:

```typescript
import {
  isValidatorInitialized,
  getTokenContribution,
  deriveValidatorPDA
} from '@asdf/validator-sdk';

const exists = await isValidatorInitialized(connection, mint);
const contribution = await getTokenContribution(connection, mint);
const [pda, bump] = deriveValidatorPDA(mint);
```

## Constants

```typescript
import {
  ASDF_PROGRAM_ID,    // Main program
  PUMP_PROGRAM_ID,    // PumpFun
  PUMPSWAP_PROGRAM_ID // PumpSwap AMM
} from '@asdf/validator-sdk';
```

## Running the Daemon

The SDK is read-only. To register fees, run the validator daemon:

```bash
# Clone the full repo
git clone https://github.com/zeyxx/asdf-dat.git
cd asdf-dat
npm install

# Run daemon
npx ts-node scripts/run-validator-daemon.ts --network mainnet
```

## License

MIT
