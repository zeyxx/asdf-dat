# DAT Integration Guide

How to integrate your pump.fun token with the ASDF-DAT infrastructure (Phase 2).

---

## Overview

ASDF-DAT provides automated buyback and burn infrastructure for any pump.fun token. Integration gives your community:

- Automated treasury management
- Deflationary token mechanics
- Association with the DAT ecosystem
- Shared security and audits

---

## Prerequisites

Before integrating, ensure you have:

1. **Existing pump.fun token** (bonding curve or migrated to PumpSwap AMM)
2. **Creator wallet access** (the wallet that created the token)
3. **Understanding of DAT mechanics** (see [Architecture](ARCHITECTURE.md) and [Tokenomics](TOKENOMICS.md))

---

## Fee Structure

All integrated DATs share this fee structure:

| Allocation | Percentage | Destination |
|------------|------------|-------------|
| Protocol Fee | 5.52% | $asdfasdfa (non-configurable) |
| Internal Split | 94.48% | Your configuration |

The 5.52% protocol fee funds buyback and burns of $asdfasdfa, making it an "index fund" of the entire DAT ecosystem.

---

## Internal Split Configuration

The remaining 94.48% can be configured according to your community's needs:

### Option A: Pure Deflationary

All fees go to buyback and burn.

```
94.48% → Token Buyback/Burn
```

Best for: Communities focused on price appreciation through scarcity.

### Option B: Community Treasury

Split between buyback and community fund.

```
70.00% → Token Buyback/Burn
24.48% → Community Treasury
```

Best for: DAOs that want to fund development or initiatives.

### Option C: Creator Revenue

Include a creator allocation for ongoing work.

```
50.00% → Token Buyback/Burn
24.48% → Community Treasury
20.00% → Creator Wallet
```

Best for: Active creators providing ongoing value.

---

## Integration Steps

### Step 1: Register Your Token

Register your token with the DAT protocol:

```bash
npx ts-node scripts/register-dat.ts \
  --token <YOUR_TOKEN_MINT> \
  --creator <YOUR_CREATOR_WALLET> \
  --network mainnet
```

This creates:
- A DATInstance account for your token
- Association with the DAT protocol
- Default configuration (100% buyback/burn)

### Step 2: Configure Internal Split

Set your preferred fee distribution:

```bash
npx ts-node scripts/configure-dat-split.ts \
  --token <YOUR_TOKEN_MINT> \
  --buyback 7000 \           # 70% in basis points
  --treasury 2448 \          # 24.48% in basis points
  --creator 0 \              # 0% (optional)
  --treasury-wallet <TREASURY_PUBKEY> \
  --network mainnet
```

**Note**: Total must equal 9448 basis points (94.48%).

### Step 3: Verify Registration

Confirm your DAT is registered:

```bash
npx ts-node scripts/check-dat-registration.ts \
  --token <YOUR_TOKEN_MINT> \
  --network mainnet
```

Expected output:
```
DAT Registration Status
=======================
Token: <YOUR_TOKEN_MINT>
Status: Active
Protocol Fee: 5.52%
Internal Split:
  - Buyback/Burn: 70.00%
  - Treasury: 24.48%
  - Creator: 0.00%
```

### Step 4: Connect to Universal Daemon

Two options for fee monitoring:

**Option A: Use Shared Daemon (Recommended)**

Register with the universal daemon service:
```bash
npx ts-node scripts/register-with-daemon.ts \
  --token <YOUR_TOKEN_MINT> \
  --network mainnet
```

**Option B: Run Your Own Daemon**

For full control, run a dedicated daemon:
```bash
npx ts-node scripts/monitor-dat-fees.ts \
  --token <YOUR_TOKEN_MINT> \
  --network mainnet
```

### Step 5: Monitor and Verify

Track your DAT's performance:

```bash
# Check pending fees
npx ts-node scripts/check-dat-stats.ts \
  --token <YOUR_TOKEN_MINT> \
  --network mainnet

# View cycle history
npx ts-node scripts/view-cycle-history.ts \
  --token <YOUR_TOKEN_MINT> \
  --network mainnet
```

---

## Cycle Execution

Cycles are executed automatically when:

1. **Sufficient fees accumulated**: MIN_FEES_TO_CLAIM (0.01 SOL)
2. **Minimum interval elapsed**: MIN_CYCLE_INTERVAL (60 seconds)

### Manual Cycle Execution

If needed, trigger a cycle manually:

```bash
npx ts-node scripts/execute-dat-cycle.ts \
  --token <YOUR_TOKEN_MINT> \
  --network mainnet
```

---

## Benefits of Integration

### For Your Community

| Benefit | Description |
|---------|-------------|
| **Automated Treasury** | No manual management required |
| **Deflationary Pressure** | Continuous buyback/burn reduces supply |
| **Transparency** | All operations on-chain and verifiable |
| **Security** | Audited smart contracts |

### For $asdfasdfa Holders

| Benefit | Description |
|---------|-------------|
| **Ecosystem Exposure** | 5.52% from every integrated DAT |
| **Network Effects** | More DATs = more burns |
| **Index Fund Model** | Diversified across all tokens |

---

## Technical Requirements

### Supported Token Types

| Token Type | Support |
|------------|---------|
| SPL Token (standard) | Supported |
| Token-2022 (extensions) | Supported |
| Bonding Curve | Supported |
| PumpSwap AMM | Supported |

### RPC Requirements

For daemon operation:
- Reliable RPC endpoint (Helius recommended)
- WebSocket support for real-time updates
- Rate limits: ~100 requests/minute minimum

---

## Frequently Asked Questions

### Can I change my internal split after registration?

Yes. Use the `configure-dat-split.ts` script to update your configuration. Changes take effect on the next cycle.

### What happens if the daemon goes down?

Fee attribution is based on blockchain transactions. When the daemon restarts, it resumes from the last processed signature (stored in `.daemon-state.json`). No fees are lost.

### Is the 5.52% protocol fee negotiable?

No. The 5.52% protocol fee is fixed and applies equally to all integrated DATs. This ensures fair contribution to the ecosystem.

### Can I unregister my token?

Contact the DAT team to discuss deactivation. Pending fees will be processed in a final cycle before deactivation.

### How are multiple tokens from the same creator handled?

Each token is registered separately. The shared vault architecture is handled by the daemon's fee attribution system.

---

## Support

For integration support:

- **GitHub Issues**: [asdf-dat/issues](https://github.com/zeyxx/asdf-dat/issues)
- **Twitter**: [@asikiland](https://twitter.com/asikiland)

---

## Related Documentation

- [Architecture](ARCHITECTURE.md) - Technical implementation details
- [Tokenomics](TOKENOMICS.md) - Economic model and fee mathematics
- [Glossary](GLOSSARY.md) - Terminology definitions
