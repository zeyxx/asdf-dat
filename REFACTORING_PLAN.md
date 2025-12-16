# Refactoring Plan - Execute Ecosystem Cycle

## Current State

**File:** `scripts/execute-ecosystem-cycle.ts`
- **Size:** 3,334 lines
- **Functions:** 30+ functions
- **Complexity:** Very High
- **Maintainability:** Low
- **Testability:** Difficult

## Problems

1. **Monolithic File**
   - Hard to navigate
   - Difficult to test individual components
   - High risk of merge conflicts
   - Poor code reusability

2. **Mixed Concerns**
   - Dead letter queue logic
   - Token selection
   - Dry run reporting
   - Logging utilities
   - Wallet management
   - Daemon integration
   - Fee allocation
   - Transaction execution

3. **No Unit Tests**
   - 88 Rust tests ✅
   - 0 TypeScript tests ❌

## Target Architecture

### Module Structure
```
src/cycle/
├── index.ts                    # Public API exports
├── executor.ts                 # Main CycleExecutor class (200 lines)
├── token-loader.ts             # Token discovery & loading (150 lines)
├── token-selector.ts           # Probabilistic token selection (100 lines)
├── fee-allocator.ts            # Fee allocation logic (150 lines)
├── transaction-builder.ts      # TX construction (200 lines)
├── dead-letter-queue.ts        # DLQ management (100 lines)
├── dry-run.ts                  # Dry run reporting (100 lines)
└── validation.ts               # Pre-flight checks (100 lines)

src/cycle/utils/
├── logging.ts                  # Cycle-specific logging (50 lines)
├── formatting.ts               # Display formatting (50 lines)
└── wallet.ts                   # Wallet operations (50 lines)

scripts/
└── execute-ecosystem-cycle.ts  # Entry point (150 lines max)
```

### Refactored Entry Point
```typescript
// scripts/execute-ecosystem-cycle.ts (150 lines)
import { CycleExecutor } from '../src/cycle/executor';
import { CycleConfig } from '../src/cycle/types';
import { validateEnv } from '../src/utils/validate-env';
import { getNetworkConfig } from '../src/network/config';

async function main() {
  // 1. Parse args
  const args = process.argv.slice(2);
  const networkConfig = getNetworkConfig(args);

  // 2. Validate environment
  validateEnv(networkConfig.name === 'Mainnet' ? 'production' : 'development');

  // 3. Create executor
  const config: CycleConfig = {
    network: networkConfig,
    dryRun: args.includes('--dry-run'),
    // ... other config
  };

  const executor = new CycleExecutor(config);

  // 4. Execute
  await executor.run();
}

main().catch(console.error);
```

## Refactoring Steps

### Phase 1: Extract Utilities (1 hour)
**Goal:** Move pure functions to separate modules

1. **Create `src/cycle/utils/logging.ts`**
   - Move: `log()`, `logSection()`, `formatSOL()`
   - Size: ~50 lines

2. **Create `src/cycle/utils/formatting.ts`**
   - Move: Date/time formatting helpers
   - Size: ~50 lines

3. **Create `src/cycle/utils/wallet.ts`**
   - Move: `loadAndValidateWallet()`
   - Size: ~50 lines

**Benefit:** -150 lines from main file

### Phase 2: Extract Domain Logic (2 hours)
**Goal:** Separate business logic into cohesive modules

1. **Create `src/cycle/dead-letter-queue.ts`**
   ```typescript
   export class DeadLetterQueue {
     process(): { retryable: string[]; expired: string[] }
     markResolved(mint: string): void
     append(mint: string, error: Error, context: any): void
     getNextRetryTime(retryCount: number): Date
   }
   ```
   - Move: 4 DLQ functions
   - Size: ~100 lines

2. **Create `src/cycle/token-selector.ts`**
   ```typescript
   export class TokenSelector {
     getEligible(allocations: TokenAllocation[]): TokenAllocation[]
     selectForCycle(eligible: TokenAllocation[], slot: number): TokenAllocation
   }
   ```
   - Move: Token selection logic
   - Size: ~100 lines

3. **Create `src/cycle/dry-run.ts`**
   ```typescript
   export class DryRunReporter {
     generate(allocations: TokenAllocation[]): DryRunReport
     print(report: DryRunReport): void
   }
   ```
   - Move: Dry run reporting
   - Size: ~100 lines

4. **Create `src/cycle/token-loader.ts`**
   ```typescript
   export class TokenLoader {
     async loadTrustless(connection: Connection): Promise<TokenConfig[]>
     async loadFromDaemon(): Promise<TokenConfig[]>
     loadFromFiles(networkConfig: NetworkConfig): TokenConfig[]
     loadFromState(): TokenConfig[]
   }
   ```
   - Move: 4 token loading functions
   - Size: ~150 lines

5. **Create `src/cycle/validation.ts`**
   ```typescript
   export class CycleValidator {
     validateMinimumFees(allocations: TokenAllocation[]): void
     async validateOperationalBuffer(connection: Connection): Promise<void>
     async waitForDaemonSync(connection: Connection): Promise<void>
   }
   ```
   - Move: Validation logic
   - Size: ~100 lines

6. **Create `src/cycle/fee-allocator.ts`**
   ```typescript
   export class FeeAllocator {
     async queryPendingFees(connection: Connection, tokens: TokenConfig[]): Promise<TokenAllocation[]>
     normalizeAllocations(allocations: TokenAllocation[], totalFees: number): TokenAllocation[]
     calculateDynamicAllocation(vaultBalance: number, allocations: TokenAllocation[]): TokenAllocation[]
   }
   ```
   - Move: Fee allocation logic
   - Size: ~150 lines

**Benefit:** -700 lines from main file

### Phase 3: Create Main Executor (1 hour)
**Goal:** Orchestrate all modules in clean class

**Create `src/cycle/executor.ts`**
```typescript
export class CycleExecutor {
  private dlq: DeadLetterQueue;
  private tokenLoader: TokenLoader;
  private tokenSelector: TokenSelector;
  private feeAllocator: FeeAllocator;
  private validator: CycleValidator;
  private dryRunReporter: DryRunReporter;

  constructor(private config: CycleConfig) {
    // Initialize all dependencies
  }

  async run(): Promise<void> {
    // 1. Acquire lock
    // 2. Load tokens
    // 3. Query pending fees
    // 4. Validate
    // 5. Select token
    // 6. Execute or dry-run
    // 7. Release lock
  }

  private async executeSecondaryToken(token: TokenConfig): Promise<void> {
    // Execute single token cycle
  }

  private async executeRootToken(): Promise<void> {
    // Execute root cycle
  }
}
```
- Size: ~200 lines

**Benefit:** Clear orchestration, testable

### Phase 4: Add Unit Tests (2 hours)
**Goal:** Achieve 70%+ test coverage

**Create test structure:**
```
src/cycle/__tests__/
├── token-selector.test.ts
├── fee-allocator.test.ts
├── dead-letter-queue.test.ts
├── dry-run.test.ts
├── validation.test.ts
└── executor.test.ts
```

**Example test:**
```typescript
// src/cycle/__tests__/token-selector.test.ts
import { TokenSelector } from '../token-selector';

describe('TokenSelector', () => {
  it('selects token deterministically based on slot', () => {
    const selector = new TokenSelector();
    const eligible = [/* mock tokens */];
    const slot = 12345;

    const selected = selector.selectForCycle(eligible, slot);

    expect(selected).toBeDefined();
    expect(selected.mint).toBe(eligible[slot % eligible.length].mint);
  });

  it('filters tokens below threshold', () => {
    const selector = new TokenSelector();
    const allocations = [
      { mint: 'A', pendingFees: 100_000_000 },
      { mint: 'B', pendingFees: 1_000_000 },  // Below threshold
    ];

    const eligible = selector.getEligible(allocations);

    expect(eligible.length).toBe(1);
    expect(eligible[0].mint).toBe('A');
  });
});
```

### Phase 5: Clean Up (30 minutes)
**Goal:** Remove obsolete files

**Delete:**
- `scripts/test-buy-as-creator.ts`
- `scripts/test-collect-buy.ts`
- `scripts/test-collect-only.ts`
- `scripts/test-collect-then-buy-separate.ts`
- `scripts/test-direct-pump-buy.ts`
- `scripts/test-exact-cycle-sequence.ts`
- `scripts/test-root-cycle.ts`
- `scripts/test-verify-architecture.ts`

**Total:** 14 obsolete test files

## Benefits

### Before Refactoring
- Main file: 3,334 lines ❌
- Functions: 30+ in one file ❌
- Tests: 0 TypeScript tests ❌
- Maintainability: Low ❌
- Reusability: None ❌

### After Refactoring
- Main file: 150 lines ✅
- Modules: 9 focused modules (100-200 lines each) ✅
- Tests: 70%+ coverage ✅
- Maintainability: High ✅
- Reusability: Full ✅

### Metrics
| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Largest file | 3,334 lines | 200 lines | 94% reduction |
| Testability | Difficult | Easy | 100% improvement |
| Maintainability | Low | High | Significant |
| Code reuse | None | Full | New capability |
| Test coverage | 0% | 70%+ | New coverage |

## Timeline

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| Phase 1 | 1 hour | Utils extracted |
| Phase 2 | 2 hours | Domain modules |
| Phase 3 | 1 hour | Main executor |
| Phase 4 | 2 hours | Unit tests |
| Phase 5 | 30 min | Cleanup |
| **Total** | **6.5 hours** | **Production-ready refactor** |

## Risk Mitigation

1. **Regression Prevention**
   - Keep old file as backup initially
   - Run all 88 Rust tests after each phase
   - Test on devnet before committing

2. **Gradual Migration**
   - Extract one module at a time
   - Test after each extraction
   - Keep both versions until verified

3. **Rollback Plan**
   - Git branch for refactoring
   - Can revert entire branch if issues
   - Old file preserved as `*.backup`

## Success Criteria

- ✅ Main file < 200 lines
- ✅ All modules < 200 lines
- ✅ 70%+ test coverage
- ✅ All 88 Rust tests passing
- ✅ Devnet validation successful
- ✅ No regressions in functionality

## Next Steps

**Immediate:**
1. Create `src/cycle/` directory structure
2. Start with Phase 1 (utilities)
3. Add tests incrementally

**After Refactoring:**
1. Add CI/CD with automated tests
2. Set up code coverage reporting
3. Enable pre-commit hooks

---

**Status:** Ready to execute
**Estimated Time:** 6.5 hours
**Expected Score Impact:** 7.7/10 → 9/10

*Make code simple. Make tests comprehensive. Make maintenance easy.* 🔨
