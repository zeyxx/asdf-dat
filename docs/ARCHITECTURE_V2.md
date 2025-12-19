# ASDF Burn Engine - Architecture V2

## Vision: Precision Infrastructure for Creator Capital Markets

```
"Don't trust, verify. Creation > Extraction."
```

## The Perfect Solution: Hybrid Fee Tracking

### Problem Statement

| Approach | Latency | Reliability | Recovery |
|----------|---------|-------------|----------|
| Polling only | 5-30s | ✅ High | ✅ Full |
| WebSocket only | ~400ms | ❌ Unstable | ❌ None |
| **Hybrid** | **~400ms** | **✅ High** | **✅ Full** |

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        ASDF BURN ENGINE DAEMON                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────┐ │
│  │  Helius Geyser  │    │   FeeTracker    │    │    CycleManager     │ │
│  │   (WebSocket)   │───▶│   (Polling)     │───▶│   (Burns/Flushes)   │ │
│  │   PRIMARY       │    │   FALLBACK      │    │                     │ │
│  └────────┬────────┘    └────────┬────────┘    └──────────┬──────────┘ │
│           │                      │                        │            │
│           ▼                      ▼                        ▼            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      FEE AGGREGATOR                              │   │
│  │  - Deduplication (signature cache)                               │   │
│  │  - Token attribution                                             │   │
│  │  - State reconciliation                                          │   │
│  └───────────────────────────────┬─────────────────────────────────┘   │
│                                  │                                      │
│                                  ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      PoH CHAIN                                   │   │
│  │  - fee_detected (off-chain attribution proof)                    │   │
│  │  - cycle_token_burn (per-token burn record)                      │   │
│  │  - daemon_start/stop (lifecycle audit)                           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Component Stack

### Layer 1: Data Ingestion

#### Helius Geyser WebSocket (Primary - Phase 2)
```typescript
// Real-time account change notifications
// ~100-400ms latency from Solana confirmation
HeliusGeyser.subscribe({
  accounts: [creatorVault, rootTreasury],
  commitment: "confirmed",
  onAccountChange: (update) => feeAggregator.process(update)
});
```

**Why Helius Geyser?**
- Direct from validator, not RPC relay
- Enhanced transaction parsing included
- Priority fee estimates built-in
- Single API key for all features

#### FeeTracker Polling (Fallback - Always Active)
```typescript
// 5-second polling interval
// Catches anything WebSocket misses
setInterval(() => feeTracker.poll(), 5000);
```

**Why keep polling?**
- WebSocket connections can drop
- HTTP is universally supported
- State persistence for crash recovery
- Pre-cycle verification

### Layer 2: Fee Aggregator

Central deduplication and attribution:

```typescript
class FeeAggregator {
  private signatureCache: LRUCache<string, boolean>;
  private pendingFees: Map<string, bigint>; // mint -> lamports

  async process(event: FeeEvent): Promise<void> {
    // 1. Deduplicate
    if (this.signatureCache.has(event.signature)) return;
    this.signatureCache.set(event.signature, true);

    // 2. Attribute to token
    const mint = await this.attributeToToken(event);
    if (!mint) return;

    // 3. Accumulate
    const current = this.pendingFees.get(mint) || 0n;
    this.pendingFees.set(mint, current + event.amount);

    // 4. Record in PoH
    await this.history.recordFeeDetected(mint, event);
  }
}
```

### Layer 3: Cycle Execution

```typescript
class CycleManager {
  async executeCycle(): Promise<void> {
    // 1. Pre-cycle verification
    const verification = await this.feeTracker.preCycleVerification();
    if (!verification.safeToExecute) {
      log.warn("State reconciled, skipping cycle");
      return;
    }

    // 2. Get priority fee from Helius
    const priorityFee = await this.helius.getPriorityFeeEstimate(
      [datState, tokenStats, rootTreasury],
      "High"
    );

    // 3. Execute burns per token
    for (const token of this.getEligibleTokens()) {
      const result = await this.burnToken(token, priorityFee);

      // 4. Record in PoH
      await this.history.recordCycleTokenBurn(
        token.mint,
        token.symbol,
        result.solAmount,
        result.tokensBurned,
        result.signature,
        token.isRoot
      );
    }
  }
}
```

## Data Flow

```
                    SOLANA BLOCKCHAIN
                          │
         ┌────────────────┼────────────────┐
         ▼                ▼                ▼
    ┌─────────┐     ┌─────────┐     ┌─────────┐
    │ Helius  │     │ Helius  │     │ Public  │
    │ Geyser  │     │ RPC     │     │ RPC     │
    │  (WS)   │     │ (HTTP)  │     │ (HTTP)  │
    └────┬────┘     └────┬────┘     └────┬────┘
         │               │               │
         │ ~400ms        │ 5s poll       │ fallback
         │               │               │
         ▼               ▼               ▼
    ┌────────────────────────────────────────┐
    │           FEE AGGREGATOR               │
    │  ┌──────────────────────────────────┐  │
    │  │   Signature Deduplication Cache  │  │
    │  │      (LRU, 10k signatures)       │  │
    │  └──────────────────────────────────┘  │
    │                   │                    │
    │                   ▼                    │
    │  ┌──────────────────────────────────┐  │
    │  │   Token Attribution Engine       │  │
    │  │   1. Mint in accountKeys         │  │
    │  │   2. BondingCurve match          │  │
    │  │   3. Inner instruction parse     │  │
    │  │   4. Dynamic discovery           │  │
    │  └──────────────────────────────────┘  │
    └────────────────────┬───────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
    ┌─────────┐    ┌──────────┐    ┌─────────┐
    │ TokenA  │    │ TokenB   │    │  Root   │
    │ pending │    │ pending  │    │ pending │
    │  fees   │    │  fees    │    │  fees   │
    └────┬────┘    └────┬─────┘    └────┬────┘
         │              │               │
         └──────────────┼───────────────┘
                        │
                        ▼
              ┌─────────────────┐
              │  CYCLE MANAGER  │
              │                 │
              │  threshold?     │
              │  cooldown?      │
              │  verification?  │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │   BURN ENGINE   │
              │                 │
              │  Secondary:     │
              │  - 55.2% burn   │
              │  - 44.8% root   │
              │  - 1% dev fee   │
              │                 │
              │  Root:          │
              │  - 100% burn    │
              └─────────────────┘
```

## Helius Integration Points

### 1. Enhanced RPC (Current)
```typescript
// Already integrated in RpcManager
const connection = new Connection(helius.getRpcUrl());
```

### 2. Enhanced Transactions API (Current)
```typescript
// Batch parsing in FeeTracker
const parsed = await helius.parseTransactions(signatures);
```

### 3. Priority Fee Estimates (Current)
```typescript
// Dynamic priority fees per cycle
const fee = await helius.getPriorityFeeEstimate(accounts, "High");
```

### 4. Geyser WebSocket (Phase 2)
```typescript
// Real-time account notifications
// Requires Helius paid plan
const ws = new HeliusGeyser(apiKey);
ws.subscribeAccount(vault, onUpdate);
```

### 5. Webhooks (Phase 2 Alternative)
```typescript
// Helius can POST to your endpoint on account changes
// Good for serverless/edge deployments
POST /webhook { account, slot, data }
```

## State Management

### In-Memory State
```typescript
interface DaemonState {
  // Per-token tracking
  tokens: Map<string, {
    mint: PublicKey;
    pendingFeesLamports: bigint;
    totalCollected: bigint;
    lastSlot: number;
  }>;

  // Deduplication
  processedSignatures: Set<string>;
  lastProcessedSignature?: string;

  // Stats
  pollCount: number;
  heliusParsedCount: number;
  cycleCount: number;
}
```

### Persistent State (.asdf-state.json)
```json
{
  "version": 2,
  "tokens": [...],
  "lastProcessedSignature": "...",
  "lastCycleSlot": 123456789,
  "pohLatestHash": "abc123..."
}
```

### PoH Chain (data/history/chain.jsonl)
```jsonl
{"seq":1,"prevHash":"000...","hash":"abc...","event":"daemon_start","data":{}}
{"seq":2,"prevHash":"abc...","hash":"def...","event":"fee_detected","data":{"mint":"...","amount":1000000}}
{"seq":3,"prevHash":"def...","hash":"ghi...","event":"cycle_token_burn","data":{"mint":"...","signature":"..."}}
```

## Reliability Guarantees

### 1. No Fee Lost
- Polling catches what WebSocket misses
- Helius backfill for crash recovery
- State reconciliation before cycles

### 2. No Double Counting
- Signature-based deduplication
- LRU cache (10k signatures)
- On-chain verification

### 3. Tamper-Proof Audit
- PoH chain with SHA-256 linking
- Every fee_detected recorded
- Every burn recorded with signature

### 4. Graceful Degradation
```
Helius Geyser → Helius RPC → Public RPC → Cached State
     ↓              ↓             ↓            ↓
  ~400ms         ~5s poll      ~5s poll    Read-only
```

## Phase 1 vs Phase 2

| Feature | Phase 1 (Now) | Phase 2 (Multi-tenant) |
|---------|---------------|------------------------|
| Fee Detection | Polling + Helius batch | + Geyser WebSocket |
| Tokens | Single creator | Multi-creator |
| Dashboard | CLI only | Real-time web UI |
| Backfill | Manual script | Automatic on startup |
| Alerts | Discord webhook | Multi-channel + PagerDuty |

## Configuration

### Environment Variables
```bash
# Required
HELIUS_API_KEY=your-key-here
ANCHOR_WALLET=./wallet.json

# Optional
NETWORK=devnet                    # or mainnet
POLL_INTERVAL=5000                # ms
FLUSH_THRESHOLD=100000000         # 0.1 SOL in lamports
MIN_CYCLE_INTERVAL=60000          # ms

# Phase 2
HELIUS_GEYSER_ENABLED=true
HELIUS_WEBHOOK_URL=https://...
```

## Metrics & Observability

```typescript
// Exposed via /metrics endpoint
{
  "feeTracker": {
    "pollCount": 1234,
    "heliusParsedCount": 5678,
    "heliusEnabled": true,
    "processedSignatures": 9876
  },
  "tokens": [
    {
      "symbol": "ASDF",
      "pendingSOL": 0.0234,
      "isRoot": true
    }
  ],
  "poh": {
    "sequence": 456,
    "latestHash": "abc123...",
    "totalFeesDetected": 12345678
  }
}
```

---

## Summary

**The Perfect Solution = Hybrid Architecture**

1. **Helius Geyser** for real-time (~400ms)
2. **FeeTracker polling** for reliability
3. **Signature deduplication** for accuracy
4. **PoH chain** for auditability
5. **State reconciliation** for safety

```
Speed + Reliability + Auditability = CCM Infrastructure
```

THIS IS FINE 🔥
