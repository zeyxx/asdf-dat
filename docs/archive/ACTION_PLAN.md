# 🎯 ASDF BURN ENGINE - PLAN D'ACTION SÉQUENTIEL

**Objectif:** Passer de 72/100 à 85+/100 (Production Ready)
**Timeline:** 11-14 jours
**Approach:** Build like Pump.fun/Solana Foundation pros

---

## 📋 PRINCIPES D'EXÉCUTION

### Architecture Philosophy
```
Simple > Complex
Modular > Monolithic
Tested > Assumed
Monitored > Hoped
```

### Quality Gates
Chaque sprint DOIT passer:
- ✅ Tests automatisés passent
- ✅ Code review (self-review OK pour Phase 1)
- ✅ Documentation mise à jour
- ✅ Pas de régression sur features existantes

### Git Workflow
```bash
# Feature branches
git checkout -b fix/sec-01-remove-hardcoded-keys
# ... work ...
git commit -m "fix(security): Remove hardcoded API keys (SEC-01)"
git checkout main && git merge fix/sec-01-remove-hardcoded-keys
```

---

## 🚀 SPRINT 1: CRITICAL SECURITY (J1-J2)

**Objectif:** Éliminer les vulnérabilités critiques
**Duration:** 2 jours
**Output:** Secrets sécurisés, .env clean

### Task 1.1: Remove Hardcoded API Keys (SEC-01)
**Priority:** CRITIQUE
**Effort:** 2h
**Assigné:** Main dev

**Steps:**
1. Create `.env.template` avec placeholders
```bash
# .env.template
HELIUS_API_KEY=your_helius_key_here
HELIUS_DEVNET_RPC=https://devnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}
QUICKNODE_RPC=your_quicknode_url_here
```

2. Update all hardcoded occurrences
```typescript
// BAD (12 occurrences à fixer):
rpc: "https://devnet.helius-rpc.com/?api-key=ac94987a-2acd-4778-8759-1bb4708e905b"

// GOOD:
rpc: process.env.HELIUS_DEVNET_RPC || 'https://api.devnet.solana.com'
```

3. Files to update:
```bash
scripts/demo-burn-engine.ts
scripts/archive/debug/*.ts (9 files)
src/network/config.ts (verify fallback logic)
```

4. Validation:
```bash
grep -r "ac94987a" . --include="*.ts" # Should return 0 results
```

**Deliverable:**
- [ ] All API keys removed
- [ ] `.env.template` created
- [ ] `.env` in `.gitignore`
- [ ] README updated with env setup instructions

---

### Task 1.2: Secure .env Files (SEC-02)
**Priority:** CRITIQUE
**Effort:** 1h

**Steps:**
1. Update `.gitignore`:
```gitignore
# Secrets
.env
.env.local
.env.*.local
*.pem
*.key
*-wallet.json  # Except template

# Keep templates
!.env.template
!wallet.template.json
```

2. Remove .env from git history (if committed):
```bash
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch .env" \
  --prune-empty --tag-name-filter cat -- --all
```

3. Rotate all secrets:
- [ ] New Helius API key
- [ ] New QuickNode URL
- [ ] New wallet keypairs (devnet OK to keep)

4. Document secret management:
```markdown
# docs/SECRETS_MANAGEMENT.md
## Environment Variables

Required secrets:
- HELIUS_API_KEY: Helius RPC API key
- QUICKNODE_RPC: QuickNode RPC URL
- MAINNET_WALLET: Path to mainnet wallet
...
```

**Deliverable:**
- [ ] .env removed from git
- [ ] Secrets rotated
- [ ] SECRETS_MANAGEMENT.md created
- [ ] Team notified

---

### Task 1.3: Environment Validation Script
**Priority:** HAUTE
**Effort:** 1h

Create `scripts/validate-env.ts`:
```typescript
/**
 * Validate environment configuration before running
 * Prevents runtime failures due to missing secrets
 */

const requiredEnvVars = {
  development: ['HELIUS_API_KEY', 'CREATOR'],
  production: ['HELIUS_API_KEY', 'QUICKNODE_RPC', 'MAINNET_WALLET', 'CREATOR'],
};

function validateEnv(mode: 'development' | 'production') {
  const required = requiredEnvVars[mode];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    console.error('Copy .env.template to .env and fill in your values');
    process.exit(1);
  }

  console.log('✅ Environment validation passed');
}
```

Add to all main scripts:
```typescript
// Top of execute-ecosystem-cycle.ts, monitor-ecosystem-fees.ts, etc.
import { validateEnv } from './validate-env';
validateEnv(isMainnet ? 'production' : 'development');
```

**Deliverable:**
- [ ] validate-env.ts created
- [ ] Integrated into main scripts
- [ ] Tested with missing vars (should fail gracefully)

---

## 🏗️ SPRINT 2: INFRASTRUCTURE RESILIENCE (J3-J5)

**Objectif:** RPC fallback + retry logic robuste
**Duration:** 3 jours
**Output:** Zero single points of failure

### Task 2.1: Multi-RPC Configuration (INF-01)
**Priority:** CRITIQUE
**Effort:** 4h

**Steps:**
1. Update `src/network/rpc-manager.ts` (create if not exists):
```typescript
export class RPCManager {
  private endpoints: RPCEndpoint[];
  private currentIndex = 0;
  private healthChecks: Map<string, HealthStatus>;

  constructor(urls: string[]) {
    this.endpoints = urls.map(url => ({ url, healthy: true, lastCheck: 0 }));
    this.startHealthChecks();
  }

  async getConnection(): Promise<Connection> {
    // Try current endpoint
    if (this.endpoints[this.currentIndex].healthy) {
      return new Connection(this.endpoints[this.currentIndex].url);
    }

    // Failover to next healthy endpoint
    for (let i = 0; i < this.endpoints.length; i++) {
      const endpoint = this.endpoints[i];
      if (endpoint.healthy) {
        this.currentIndex = i;
        return new Connection(endpoint.url);
      }
    }

    throw new Error('All RPC endpoints unhealthy');
  }

  private async startHealthChecks() {
    setInterval(async () => {
      for (const endpoint of this.endpoints) {
        endpoint.healthy = await this.checkHealth(endpoint.url);
      }
    }, 30_000); // Check every 30s
  }

  private async checkHealth(url: string): Promise<boolean> {
    try {
      const conn = new Connection(url);
      await conn.getSlot();
      return true;
    } catch {
      return false;
    }
  }
}
```

2. Update network config:
```typescript
// src/network/config.ts
export const NETWORK_CONFIGS: Record<NetworkType, NetworkConfig> = {
  mainnet: {
    rpcUrls: [
      process.env.HELIUS_RPC,           // Primary
      process.env.QUICKNODE_RPC,        // Secondary
      process.env.TRITON_RPC,           // Tertiary
      'https://api.mainnet-beta.solana.com', // Public fallback
    ].filter(Boolean),
    // ...
  },
  devnet: {
    rpcUrls: [
      process.env.HELIUS_DEVNET_RPC,
      'https://api.devnet.solana.com',
    ].filter(Boolean),
    // ...
  },
};
```

3. Integration example:
```typescript
// scripts/execute-ecosystem-cycle.ts
import { RPCManager } from '../src/network/rpc-manager';

const rpcManager = new RPCManager(networkConfig.rpcUrls);
const connection = await rpcManager.getConnection();
```

**Deliverable:**
- [ ] RPCManager class implemented
- [ ] Health checks running
- [ ] Integrated into main scripts
- [ ] Tested with RPC failure simulation

---

### Task 2.2: Unified Retry Logic (INF-02)
**Priority:** CRITIQUE
**Effort:** 8h

**Steps:**
1. Create `src/network/retry-utils.ts`:
```typescript
interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;  // ms
  maxDelay: number;   // ms
  exponential: boolean;
  retryableErrors: string[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelay: 500,
  maxDelay: 5000,
  exponential: true,
  retryableErrors: ['429', 'timeout', 'ECONNRESET', 'ETIMEDOUT'],
};

export async function withRetry<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...config };

  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const isRetryable = cfg.retryableErrors.some(e =>
        error.message?.includes(e) || error.code?.includes(e)
      );

      if (!isRetryable || attempt === cfg.maxAttempts) {
        throw error;
      }

      const delay = cfg.exponential
        ? Math.min(cfg.baseDelay * Math.pow(2, attempt - 1), cfg.maxDelay)
        : cfg.baseDelay;

      console.warn(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }

  throw new Error('Unreachable');
}
```

2. Apply to all RPC calls:
```typescript
// BEFORE:
const accountInfo = await connection.getAccountInfo(address);

// AFTER:
const accountInfo = await withRetry(() =>
  connection.getAccountInfo(address)
);
```

3. Transaction confirmation with retry:
```typescript
export async function sendAndConfirmWithRetry(
  connection: Connection,
  transaction: Transaction,
  signers: Signer[]
): Promise<string> {
  return withRetry(async () => {
    const signature = await connection.sendTransaction(transaction, signers);

    // Confirm with timeout
    const confirmation = await Promise.race([
      connection.confirmTransaction(signature, 'confirmed'),
      sleep(30_000).then(() => { throw new Error('Confirmation timeout'); }),
    ]);

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${confirmation.value.err}`);
    }

    return signature;
  }, { maxAttempts: 3, baseDelay: 1000 });
}
```

**Deliverable:**
- [ ] retry-utils.ts implemented
- [ ] Applied to all RPC calls (audit codebase)
- [ ] Transaction confirmation refactored
- [ ] Tests for retry logic
- [ ] Error logging for failed retries

---

### Task 2.3: Transaction Confirmation Robustness (INF-03)
**Priority:** HAUTE
**Effort:** 4h

**Steps:**
1. Create `src/network/tx-confirmer.ts`:
```typescript
export async function confirmTransactionRobust(
  connection: Connection,
  signature: string,
  commitment: Commitment = 'confirmed'
): Promise<void> {
  const TIMEOUT_MS = 60_000;
  const POLL_INTERVAL = 2_000;
  const startTime = Date.now();

  while (Date.now() - startTime < TIMEOUT_MS) {
    try {
      const status = await connection.getSignatureStatus(signature);

      if (status?.value?.confirmationStatus === commitment) {
        if (status.value.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
        }
        return; // Success
      }

      await sleep(POLL_INTERVAL);
    } catch (error) {
      if (Date.now() - startTime >= TIMEOUT_MS) {
        // Last attempt: try getTransaction as fallback
        const tx = await connection.getTransaction(signature, {
          maxSupportedTransactionVersion: 0,
        });

        if (tx && tx.meta && !tx.meta.err) {
          console.warn('Confirmed via getTransaction fallback');
          return;
        }

        throw new Error(`Transaction confirmation timeout: ${signature}`);
      }
    }
  }
}
```

2. Use in cycle executor:
```typescript
const signature = await sendAndConfirmWithRetry(connection, tx, signers);
await confirmTransactionRobust(connection, signature);
```

**Deliverable:**
- [ ] tx-confirmer.ts implemented
- [ ] Integrated into execute-ecosystem-cycle.ts
- [ ] Tested with slow confirmations
- [ ] Metrics tracked (confirmation time)

---

## ⚙️ SPRINT 3: OPERATIONAL MATURITY (J6-J8)

**Objectif:** Production-grade ops infrastructure
**Duration:** 3 jours
**Output:** Daemon unkillable, monitoring live

### Task 3.1: PM2 Daemon Setup (OPS-01)
**Priority:** CRITIQUE
**Effort:** 4h

**Steps:**
1. Install PM2:
```bash
npm install -g pm2
```

2. Create `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [
    {
      name: 'asdf-daemon',
      script: 'npx',
      args: 'ts-node scripts/monitor-ecosystem-fees.ts --network mainnet',
      cwd: '/path/to/asdf-dat',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        CREATOR: process.env.CREATOR,
        HELIUS_API_KEY: process.env.HELIUS_API_KEY,
      },
      error_file: './logs/daemon-error.log',
      out_file: './logs/daemon-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
    },
    {
      name: 'asdf-cycle-trigger',
      script: 'npx',
      args: 'ts-node scripts/cycle-trigger-bot.ts --network mainnet',
      cwd: '/path/to/asdf-dat',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
```

3. Create management scripts:
```bash
# scripts/pm2-start.sh
#!/bin/bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup # Generate startup script

# scripts/pm2-stop.sh
#!/bin/bash
pm2 stop all

# scripts/pm2-logs.sh
#!/bin/bash
pm2 logs asdf-daemon --lines 100
```

4. Health check endpoint:
```typescript
// Add to monitor-ecosystem-fees.ts
import express from 'express';

const app = express();
app.get('/health', (req, res) => {
  const uptime = Date.now() - daemonStartTime;
  const lastPollAge = Date.now() - lastPollTimestamp;

  if (lastPollAge > 120_000) { // 2 minutes
    return res.status(503).json({ status: 'unhealthy', reason: 'Stale poll' });
  }

  res.json({
    status: 'healthy',
    uptime,
    lastPoll: lastPollAge,
    tokensMonitored: monitoredTokens.length,
  });
});

app.listen(3030, () => console.log('Health check on :3030/health'));
```

**Deliverable:**
- [ ] PM2 configured
- [ ] Auto-restart tested (kill -9 process)
- [ ] Health endpoint responding
- [ ] Startup script generated
- [ ] Logs rotating (PM2 handles this)

---

### Task 3.2: Monitoring Dashboard (OPS-02)
**Priority:** CRITIQUE
**Effort:** 6h

**Steps:**
1. Setup Grafana Cloud (free tier):
```bash
# Sign up at grafana.com
# Get API key
```

2. Create `src/observability/metrics-exporter.ts`:
```typescript
import { MonitoringService } from './monitoring';

export class MetricsExporter {
  private metricsUrl: string;

  constructor(private monitoring: MonitoringService) {
    this.metricsUrl = process.env.GRAFANA_METRICS_URL!;
  }

  async exportMetrics() {
    const metrics = {
      timestamp: Date.now(),
      daemon: this.monitoring.daemonMetrics,
      cycle: this.monitoring.cycleMetrics,
      tokens: Array.from(this.monitoring.getTokenMetrics().values()),
    };

    await fetch(this.metricsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metrics),
    });
  }

  startExporting(intervalMs = 60_000) {
    setInterval(() => this.exportMetrics(), intervalMs);
  }
}
```

3. Grafana dashboard JSON (template):
```json
{
  "dashboard": {
    "title": "ASDF Burn Engine",
    "panels": [
      {
        "title": "Daemon Uptime",
        "type": "stat",
        "targets": [{ "expr": "daemon_uptime" }]
      },
      {
        "title": "Fees Flushed (24h)",
        "type": "graph",
        "targets": [{ "expr": "sum(fees_flushed)" }]
      },
      {
        "title": "Error Rate",
        "type": "graph",
        "targets": [{ "expr": "rate(errors_total[5m])" }]
      }
    ]
  }
}
```

4. Alerting rules:
```yaml
# grafana-alerts.yml
groups:
  - name: asdf_alerts
    interval: 1m
    rules:
      - alert: DaemonDown
        expr: time() - daemon_last_poll_timestamp > 300
        annotations:
          summary: "Daemon hasn't polled in 5+ minutes"

      - alert: HighErrorRate
        expr: rate(errors_total[5m]) > 0.1
        annotations:
          summary: "Error rate > 10%"
```

**Deliverable:**
- [ ] Grafana dashboard live
- [ ] Metrics exporting every minute
- [ ] Alerts configured
- [ ] Screenshot in docs/

---

### Task 3.3: Runbook Documentation (OPS-03)
**Priority:** HAUTE
**Effort:** 4h

Create `docs/RUNBOOK.md`:
```markdown
# ASDF Burn Engine Operational Runbook

## Health Checks

### Check Daemon Status
\`\`\`bash
pm2 status
curl http://localhost:3030/health
\`\`\`

Expected: `status: healthy`, uptime > 0

### Check RPC Health
\`\`\`bash
solana epoch-info --url $HELIUS_RPC
\`\`\`

Expected: < 2s response time

### Check On-Chain State
\`\`\`bash
npm run check-state -- --network mainnet
\`\`\`

Expected: `is_active: true`, no pause

## Common Issues

### Issue: Daemon Stopped
**Symptoms:** Health check fails, no logs updating
**Diagnosis:**
\`\`\`bash
pm2 logs asdf-daemon --err --lines 50
\`\`\`

**Solution:**
\`\`\`bash
pm2 restart asdf-daemon
# If persists:
pm2 delete asdf-daemon
pm2 start ecosystem.config.js
\`\`\`

### Issue: Transaction Stuck
**Symptoms:** Pending tx > 2 minutes
**Diagnosis:**
\`\`\`bash
solana confirm <SIGNATURE> --url $HELIUS_RPC
\`\`\`

**Solution:**
- Wait up to 60s (confirmation retries active)
- If > 60s: Check explorer, may need manual intervention
- Last resort: Emergency pause + admin fix

### Issue: RPC Rate Limited
**Symptoms:** 429 errors in logs
**Diagnosis:**
\`\`\`bash
grep "429" logs/daemon-error.log | wc -l
\`\`\`

**Solution:**
- Automatic fallback to secondary RPC
- If all RPCs limited: Wait 60s, retries will succeed
- Long-term: Upgrade RPC plan

### Issue: Root Treasury Empty
**Symptoms:** `InsufficientFunds` error
**Diagnosis:**
\`\`\`bash
npm run check-fees -- --network mainnet
# Check "Root Treasury" balance
\`\`\`

**Solution:**
1. This shouldn't happen (44.8% auto-fills)
2. If happens: Check last cycle logs
3. Verify fee split still 5520 bps
4. Emergency: Admin can manually fund

## Emergency Procedures

### Emergency Pause
\`\`\`bash
# Set emergency_pause = true
anchor run emergency-pause --provider.cluster mainnet
\`\`\`

When to use:
- Critical bug discovered
- Unexpected behavior
- Security incident

### Rollback Procedure
1. Pause system
2. Document issue
3. Fix offline
4. Test on devnet
5. Deploy fix
6. Resume

## Monitoring

### Key Metrics
- Daemon uptime: Target 99.9%
- Error rate: Target < 1%
- Confirmation time: Target < 30s
- Fees flushed: Should trend up

### Alerts
- PagerDuty for CRITICAL
- Slack for WARNINGS
- Email for INFO

## Escalation

1. **Self-service** (5 min): Check runbook
2. **On-call dev** (15 min): Slack #asdf-alerts
3. **Lead engineer** (30 min): Phone call
4. **Emergency** (immediate): All hands

## Maintenance Windows

Weekly: Sunday 2-4am UTC
- Dependency updates
- Log rotation
- Performance tuning

Monthly: First Sunday 2-6am UTC
- Major upgrades
- Security patches
```

**Deliverable:**
- [ ] RUNBOOK.md complete
- [ ] Tested all procedures
- [ ] Team trained on runbook

---

## 🧪 SPRINT 4: TESTING & QUALITY (J9-J11)

**Objectif:** Automated testing + code quality
**Duration:** 3 jours
**Output:** CI/CD passing, >70% coverage

### Task 4.1: E2E Test Suite (TEST-01)
**Priority:** HAUTE
**Effort:** 12h

**Steps:**
1. Install test framework:
```bash
npm install --save-dev jest ts-jest @types/jest
```

2. Create `jest.config.js`:
```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    'scripts/**/*.ts',
    '!**/__tests__/**',
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
};
```

3. Create test structure:
```
tests/
├── e2e/
│   ├── daemon.test.ts          # Daemon lifecycle tests
│   ├── cycle-execution.test.ts # Full cycle tests
│   └── recovery.test.ts        # Failure recovery tests
├── integration/
│   ├── rpc-manager.test.ts
│   ├── retry-logic.test.ts
│   └── token-verifier.test.ts
└── unit/
    ├── math.test.ts
    └── pda-derivation.test.ts
```

4. Example E2E test:
```typescript
// tests/e2e/cycle-execution.test.ts
describe('Cycle Execution E2E', () => {
  let connection: Connection;
  let daemon: ChildProcess;

  beforeAll(async () => {
    connection = new Connection('https://api.devnet.solana.com');
    // Start daemon
    daemon = spawn('npx', ['ts-node', 'scripts/monitor-ecosystem-fees.ts', '--network', 'devnet']);
    await sleep(5000); // Wait for startup
  });

  afterAll(() => {
    daemon.kill();
  });

  it('should detect fees and trigger cycle', async () => {
    // 1. Generate volume
    await generateVolume(devnetToken, 0.5);

    // 2. Wait for daemon to detect
    await sleep(10_000);

    // 3. Check pending fees
    const tokenStats = await getTokenStats(connection, devnetToken.mint);
    expect(tokenStats.pendingFees).toBeGreaterThan(0);

    // 4. Trigger cycle
    const result = await executeCycle(devnetToken);
    expect(result.success).toBe(true);

    // 5. Verify burn
    const statsAfter = await getTokenStats(connection, devnetToken.mint);
    expect(statsAfter.totalBurned).toBeGreaterThan(tokenStats.totalBurned);
  }, 120_000); // 2min timeout
});
```

**Deliverable:**
- [ ] Jest configured
- [ ] 15+ E2E tests written
- [ ] Tests passing on devnet
- [ ] Coverage > 70%

---

### Task 4.2: CI/CD Pipeline (TEST-01 cont.)
**Priority:** HAUTE
**Effort:** 4h

Update `.github/workflows/build-program.yml`:
```yaml
name: ASDF CI/CD

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  rust-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions-rs/toolchain@v1
        with:
          toolchain: stable
      - name: Run Rust tests
        run: cargo test --manifest-path programs/asdf-dat/Cargo.toml

  typescript-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run test
      - run: npm run test:coverage
      - uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json

  build:
    needs: [rust-tests, typescript-tests]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Build program
        run: anchor build
      - name: Build TypeScript
        run: npm run build

  deploy-devnet:
    needs: build
    if: github.ref == 'refs/heads/develop'
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to devnet
        run: anchor deploy --provider.cluster devnet
```

**Deliverable:**
- [ ] CI/CD pipeline configured
- [ ] Tests run on every PR
- [ ] Build artifacts saved
- [ ] Coverage reported

---

### Task 4.3: Code Refactoring (ARCH-01)
**Priority:** MOYENNE
**Effort:** 6h

Split `execute-ecosystem-cycle.ts` (128KB):
```
src/cycle/
├── orchestrator.ts          # Main entry point
├── token-selection.ts       # Probabilistic O(1) selection
├── fee-collector.ts         # Collect operations
├── buyback-executor.ts      # Buy CPI logic
├── burn-executor.ts         # Burn logic
├── root-cycle.ts            # Root token cycle
├── reporting.ts             # Cycle summary
└── types.ts                 # Shared types
```

Each module < 500 lines, single responsibility.

**Deliverable:**
- [ ] Code split into modules
- [ ] All tests still pass
- [ ] No functionality lost
- [ ] Improved maintainability

---

## 🎯 SPRINT 5: VALIDATION & LAUNCH PREP (J12-J14)

**Objectif:** Final validation, mainnet dry-run
**Duration:** 2-3 jours
**Output:** Launch-ready system

### Task 5.1: Load Testing (TEST-02)
**Priority:** MOYENNE
**Effort:** 8h

**Steps:**
1. Install K6:
```bash
brew install k6  # or download from k6.io
```

2. Create `tests/load/daemon-stress.js`:
```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 10 },  // Ramp up
    { duration: '5m', target: 10 },  // Sustain
    { duration: '2m', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'], // 95% of requests < 2s
    http_req_failed: ['rate<0.05'],    // <5% failure rate
  },
};

export default function () {
  const res = http.get('http://localhost:3030/health');
  check(res, {
    'status is 200': (r) => r.status === 200,
    'daemon is healthy': (r) => JSON.parse(r.body).status === 'healthy',
  });
  sleep(1);
}
```

3. Run load tests:
```bash
# Daemon stress test
k6 run tests/load/daemon-stress.js

# Cycle stress test (100 tokens)
CREATOR=$CREATOR npm run volume -- --all 10 0.1
# Monitor daemon behavior

# RPC failover test
# Block primary RPC, verify fallback works
```

**Deliverable:**
- [ ] Load tests pass
- [ ] System stable under 10 concurrent ops
- [ ] RPC failover tested
- [ ] Results documented

---

### Task 5.2: Mainnet Dry-Run
**Priority:** HAUTE
**Effort:** 4h

**Steps:**
1. Checklist:
```markdown
- [ ] All .env vars set for mainnet
- [ ] Wallet funded (>= 2 SOL)
- [ ] Program deployed to mainnet
- [ ] DAT state initialized
- [ ] Root token configured
- [ ] PM2 running
- [ ] Monitoring dashboard live
- [ ] Alerts configured
```

2. Test flow:
```bash
# 1. Initialize (if not done)
npm run init -- --network mainnet

# 2. Set root token
npm run set-root -- --network mainnet

# 3. Start daemon
pm2 start ecosystem.config.js

# 4. Generate small volume (0.01 SOL)
npm run volume -- root 1 0.01 --network mainnet

# 5. Wait for daemon sync
sleep 30

# 6. Check fees
npm run check-fees -- --network mainnet

# 7. Execute cycle (if threshold met)
npm run cycle -- --network mainnet

# 8. Verify burn
npm run check-fees -- --network mainnet
# total_burned should increase
```

3. Validation:
- [ ] Transaction confirmed on mainnet
- [ ] Tokens burned (supply reduced)
- [ ] Explorer shows burn tx
- [ ] No errors in logs
- [ ] Monitoring shows cycle

**Deliverable:**
- [ ] Successful mainnet cycle executed
- [ ] All metrics captured
- [ ] Screenshots saved
- [ ] Go/No-Go decision made

---

### Task 5.3: Final Security Review
**Priority:** CRITIQUE
**Effort:** 4h

**Checklist:**
```markdown
## Secrets & Access
- [ ] No hardcoded secrets in codebase
- [ ] .env in .gitignore
- [ ] All API keys rotated
- [ ] Wallet private keys secured

## Smart Contract
- [ ] All Rust tests pass (88/88)
- [ ] No unsafe code
- [ ] Admin operations timelocked
- [ ] Emergency pause functional

## Infrastructure
- [ ] 3+ RPC endpoints configured
- [ ] Retry logic on all RPC calls
- [ ] Transaction confirmation robust
- [ ] PM2 auto-restart tested

## Operations
- [ ] Health checks responding
- [ ] Monitoring dashboard live
- [ ] Alerts configured and tested
- [ ] Runbook documented

## Testing
- [ ] E2E tests pass
- [ ] Load tests pass
- [ ] Mainnet dry-run successful
- [ ] Coverage > 70%
```

**Deliverable:**
- [ ] All checkboxes ✅
- [ ] Security sign-off
- [ ] Launch approved

---

## 📊 DAILY STANDUP FORMAT

Each day, document progress:
```markdown
### Date: YYYY-MM-DD
**Sprint:** X
**Tasks Completed:**
- [x] Task X.Y - Description
- [x] Task X.Z - Description

**Tasks In Progress:**
- [ ] Task X.A - Description (50% done)

**Blockers:**
- None / Issue description

**Metrics:**
- Tests passing: X/Y
- Coverage: Z%
- Issues closed: N

**Next 24h:**
- Complete Task X.A
- Start Task X.B
```

---

## 🎓 QUALITY STANDARDS

### Code Review Checklist
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] No console.log (use logger)
- [ ] Error handling present
- [ ] Types defined
- [ ] No magic numbers

### Commit Message Format
```
type(scope): description

- Why this change is needed
- What it enables/fixes

Refs: #issue-number (if applicable)
```

Types: feat, fix, docs, refactor, test, chore

### PR Template
```markdown
## Description
[What this PR does]

## Changes
- Change 1
- Change 2

## Testing
- [ ] Unit tests pass
- [ ] E2E tests pass
- [ ] Manual testing on devnet

## Checklist
- [ ] Documentation updated
- [ ] No breaking changes
- [ ] Backward compatible
```

---

## 🚀 LAUNCH CRITERIA

System is **PRODUCTION-READY** when:

### MUST HAVE (Blockers)
- ✅ All CRITICAL issues resolved (SEC-01, SEC-02, INF-01, INF-02, OPS-01, OPS-02)
- ✅ 88 Rust tests passing
- ✅ E2E test suite passing
- ✅ PM2 daemon running 24h+ without crashes
- ✅ Monitoring dashboard live
- ✅ Mainnet dry-run successful

### SHOULD HAVE (Highly Recommended)
- ✅ Load tests passing
- ✅ Runbook documented
- ✅ Coverage > 70%
- ✅ All HIGH priority issues resolved

### NICE TO HAVE (Post-Launch)
- Multisig admin (Phase 2)
- Advanced alerting (Phase 2)
- Performance optimizations

---

## 📈 SUCCESS METRICS

### Sprint Completion
- Sprint 1: 100% critical security fixed
- Sprint 2: 100% infrastructure resilient
- Sprint 3: 100% ops maturity achieved
- Sprint 4: 70%+ test coverage
- Sprint 5: Mainnet validated

### Overall Progress
- Week 1: 40% → 60% (Security + Infra)
- Week 2: 60% → 85% (Ops + Testing + Launch)

### Final Score Target
- Current: 72/100
- Target: 85/100
- Stretch: 90/100

---

## 🔄 RETROSPECTIVE (After Each Sprint)

Questions to answer:
1. What went well?
2. What could be improved?
3. What did we learn?
4. What should we do differently?

Document in `docs/RETROS.md`

---

## 📞 SUPPORT & QUESTIONS

Stuck on a task?
1. Check runbook
2. Review audit report
3. Ask in #dev-chat
4. Escalate if blocking > 2h

---

*"Build like a professional team. Ship like a startup. Monitor like an enterprise."*

**Let's make this fine. 🔥🐕**

**START WITH SPRINT 1, TASK 1.1 - REMOVE HARDCODED API KEYS**
