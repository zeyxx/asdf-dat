/**
 * Cycle Module - Ecosystem Flush Orchestration
 *
 * Clean, modular architecture for the Optimistic Burn Protocol cycle execution.
 *
 * Exports:
 * - CycleExecutor: Main orchestrator
 * - Domain modules: DLQ, TokenSelector, DryRun, TokenLoader, Validation, FeeAllocator
 * - Utilities: Logging, Formatting, Wallet
 */

// Main Executor
export { CycleExecutor, CycleExecutorConfig, CycleResult, CycleSummary } from './executor';

// Domain Modules
export {
  DeadLetterQueue,
  DeadLetterEntry,
  DLQProcessResult,
  isCycleTooSoonError,
} from './dead-letter-queue';

export { TokenSelector, TokenAllocation } from './token-selector';

export { DryRunReporter, DryRunReport } from './dry-run';

export { TokenLoader } from './token-loader';

export {
  CycleValidator,
  FlushResult,
  EcosystemValidation,
  DaemonSyncResult,
} from './validation';

export {
  FeeAllocator,
  ScalableAllocationResult,
  DynamicAllocationResult,
  SECONDARY_KEEP_RATIO,
  MIN_ALLOCATION_SECONDARY,
  MIN_ALLOCATION_ROOT,
} from './fee-allocator';

// Utilities
export { log, logSection, colors } from './utils/logging';
export { formatSOL, formatNumber, formatPercent, formatDuration, truncatePubkey } from './utils/formatting';
export { loadAndValidateWallet } from './utils/wallet';
