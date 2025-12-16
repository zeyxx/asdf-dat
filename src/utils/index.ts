/**
 * Utility modules
 * @module utils
 */

// Logger exports
export { createLogger, type LogLevel } from './logger';

// Config validator exports
export {
  validateTokenConfig,
  loadAndValidateTokenConfig,
  loadAndValidateTokenDirectory,
  validateEcosystemConsistency,
  getPoolAddress,
  PoolTypeSchema,
  TokenProgramSchema,
  NetworkSchema,
  TokenConfigSchema,
  type PoolType,
  type TokenProgram,
  type Network,
  type TokenConfig,
  type ValidationResult,
} from './config-validator';

// Env validator exports
export {
  validateDaemonEnv,
  validateOrchestratorEnv,
  validateAlertingEnv,
  validateMetricsPersistenceEnv,
  logConfig,
  DaemonEnvSchema,
  OrchestratorEnvSchema,
  AlertingEnvSchema,
  MetricsPersistenceEnvSchema,
  type DaemonEnv,
  type OrchestratorEnv,
  type AlertingEnv,
  type MetricsPersistenceEnv,
} from './env-validator';

// Execution lock exports
export {
  ExecutionLock,
  LockError,
  TokenLockManager,
  getGlobalLock,
  acquireGlobalLock,
  releaseGlobalLock,
  isGloballyLocked,
  type LockInfo,
  type LockStatus,
  type ExecutionLockOptions,
} from './execution-lock';

// State persistence exports
export * from './state-persistence';

// WebSocket manager exports
export { WebSocketManager } from './websocket-manager';

// History manager exports
export {
  HistoryManager,
  initHistory,
  getHistory,
  type EventType,
  type HistoryEntry,
  type ChainMetadata,
  type HistoryManagerConfig,
} from './history-manager';

// Test utilities (for dev/test)
export * from './test-utils';
