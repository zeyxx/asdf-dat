# DAT Integration Guide

How to create and integrate your own DAT ecosystem with the ASDF-DAT universal infrastructure (Phase 2).

---

## Overview

ASDF-DAT provides automated buyback and burn infrastructure for pump.fun communities. With Phase 2, you can create your own DAT ecosystem with:

- **Your own root token** (main community token)
- **Multiple secondary tokens** (ecosystem tokens)
- **Configurable internal split** between root and secondaries
- **Fixed 5.52% protocol fee** to $asdfasdfa

### What You Get

| Feature | Description |
|---------|-------------|
| **Automated Deflation** | No manual intervention required |
| **Multi-Token Support** | Root + unlimited secondary tokens |
| **Configurable Economics** | Choose your internal root/secondary split |
| **Transparent** | All operations on-chain and verifiable |
| **Audited** | Shared security infrastructure |

---

## Prerequisites

Before creating your DAT, ensure you have:

1. **Existing pump.fun token(s)** (bonding curve or PumpSwap AMM)
2. **Creator wallet access** (the wallet that created your tokens)
3. **Understanding of DAT mechanics** (see [Architecture](ARCHITECTURE.md) and [Tokenomics](TOKENOMICS.md))

---

## Fee Structure

### Protocol Fee (Fixed)

All DATs pay **5.52%** of collected fees to $asdfasdfa buyback/burn. This is non-negotiable and applies equally to all integrated DATs.

### Internal Split (Configurable)

The remaining **94.48%** is distributed within your DAT according to your configured `internal_root_ratio`:

```
Creator Fees Collected (100%)
              │
              ▼
┌─────────────┴─────────────┐
│                           │
▼                           ▼
5.52% (FIXED)          94.48% (remaining)
$asdfasdfa             Your DAT Internal Split
buyback/burn           (CONFIGURABLE)
                            │
                   ┌────────┴────────┐
                   │                 │
                   ▼                 ▼
           (94.48% × X%)      (94.48% × (1-X)%)
           Your Root Token    Secondary Token
           buyback/burn       buyback/burn
```

### Fee Formula

```
INPUTS:
  total_fees = 100% of creator fees collected
  protocol_fee_rate = 5.52% (FIXED)
  internal_root_ratio = X% (YOUR CHOICE, e.g., 40%)

CALCULATIONS:
  protocol_fee = total_fees × 5.52%       → $asdfasdfa buyback/burn
  remaining = total_fees × 94.48%
  root_share = remaining × X%             → Your root token buyback/burn
  secondary_share = remaining × (100-X)%  → Secondary token buyback/burn
```

### Example: 1 SOL fees with 40% internal root ratio

| Recipient | Calculation | Amount |
|-----------|-------------|--------|
| $asdfasdfa (Protocol) | 1 × 5.52% | 0.0552 SOL |
| Your Root Token | 0.9448 × 40% | 0.3779 SOL |
| Secondary Token | 0.9448 × 60% | 0.5669 SOL |
| **Total** | | **1.0000 SOL** |

---

## Integration Steps

### Step 1: Create Your DAT

Register your DAT ecosystem with the protocol:

```bash
npx ts-node scripts/create-dat.ts \
  --root-token <YOUR_ROOT_TOKEN_MINT> \
  --creator <YOUR_CREATOR_WALLET> \
  --internal-split 4000 \
  --network mainnet
```

**Parameters:**
- `--root-token`: Your main community token mint address
- `--creator`: Wallet that created the tokens
- `--internal-split`: Internal root ratio in basis points (4000 = 40%)

This creates:
- A DATInstance account for your ecosystem
- Your root token configuration
- Protocol fee of 5.52% (automatic)

### Step 2: Add Secondary Tokens

Add secondary tokens to your DAT ecosystem:

```bash
npx ts-node scripts/add-secondary-token.ts \
  --dat <YOUR_DAT_INSTANCE> \
  --token <SECONDARY_TOKEN_MINT> \
  --network mainnet
```

You can add multiple secondaries. Each secondary's trading fees will be split according to your configured `internal_root_ratio`.

### Step 3: Verify Registration

Confirm your DAT is correctly configured:

```bash
npx ts-node scripts/check-dat-status.ts \
  --dat <YOUR_DAT_INSTANCE> \
  --network mainnet
```

Expected output:
```
DAT Status
==========
Instance: <YOUR_DAT_INSTANCE>
Root Token: <YOUR_ROOT_TOKEN>
Secondary Tokens: 2
Internal Root Ratio: 40%
Protocol Fee: 5.52% → $asdfasdfa

Fee Distribution (when secondary trades):
  - $asdfasdfa: 5.52%
  - Root Token: 37.79%
  - Secondary: 56.69%
```

### Step 4: Connect to Daemon

**Option A: Use Shared Daemon (Recommended)**

Register with the universal daemon service:
```bash
npx ts-node scripts/register-with-daemon.ts \
  --dat <YOUR_DAT_INSTANCE> \
  --network mainnet
```

**Option B: Run Your Own Daemon**

For full control, run a dedicated daemon:
```bash
npx ts-node scripts/monitor-dat-fees.ts \
  --dat <YOUR_DAT_INSTANCE> \
  --network mainnet
```

### Step 5: Monitor Performance

Track your DAT's activity:

```bash
# Check pending fees
npx ts-node scripts/check-dat-stats.ts \
  --dat <YOUR_DAT_INSTANCE> \
  --network mainnet

# View cycle history
npx ts-node scripts/view-dat-history.ts \
  --dat <YOUR_DAT_INSTANCE> \
  --network mainnet
```

---

## Cycle Execution

### Automatic Execution

Cycles execute automatically when:

1. **Sufficient fees accumulated**: MIN_FEES_TO_CLAIM (0.019 SOL mainnet)
2. **Minimum interval elapsed**: MIN_CYCLE_INTERVAL (60 seconds)

### What Happens in a Cycle

```
1. Collect fees from creator vault
2. Calculate splits:
   - 5.52% for $asdfasdfa
   - 94.48% × internal_root_ratio for your root token
   - 94.48% × (1 - internal_root_ratio) for secondary token
3. Execute buyback on all three tokens
4. Burn all purchased tokens immediately
5. Update on-chain statistics
```

### Manual Cycle Execution

Trigger a cycle manually if needed:

```bash
npx ts-node scripts/execute-dat-cycle.ts \
  --dat <YOUR_DAT_INSTANCE> \
  --network mainnet
```

---

## Configuration Options

### Internal Root Ratio

Choose how the 94.48% is split between your root and secondary tokens:

| Ratio | Root Gets | Secondary Gets | Use Case |
|-------|-----------|----------------|----------|
| 0% | 0% | 94.48% | Secondary-only ecosystem |
| 30% | 28.34% | 66.14% | Secondary-focused |
| 50% | 47.24% | 47.24% | Balanced |
| 70% | 66.14% | 28.34% | Root-focused |
| 100% | 94.48% | 0% | Root-only ecosystem |

### Modifying Configuration

Internal split can be modified after creation (by DAT admin):

```bash
npx ts-node scripts/update-dat-config.ts \
  --dat <YOUR_DAT_INSTANCE> \
  --internal-split 5000 \
  --network mainnet
```

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

### Is the 5.52% protocol fee negotiable?

No. The 5.52% protocol fee is fixed and applies equally to all integrated DATs. This ensures fair contribution to the ecosystem and maintains $asdfasdfa's role as an index of all DAT activity.

### Can I change my internal split ratio?

Yes. The internal root ratio can be modified by the DAT admin using `update-dat-config.ts`. Changes take effect on the next cycle.

### What if I only want one token (no secondaries)?

Set your internal root ratio to 100%. All 94.48% will go to your root token buyback/burn.

### What happens if the daemon goes down?

Fee attribution is based on blockchain transactions. When the daemon restarts, it resumes from the last processed signature (stored in `.daemon-state.json`). No fees are lost.

### Can I unregister my DAT?

Contact the protocol team to discuss deactivation. Pending fees will be processed in a final cycle before deactivation.

### Why no treasury option?

DAT's core principle is automated deflation through buyback and burn. Treasury accumulation would introduce centralization and reduce the deflationary impact. All collected fees are immediately used for buyback/burn at all levels.

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
