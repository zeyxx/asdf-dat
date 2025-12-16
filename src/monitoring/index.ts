/**
 * Monitoring module
 * @module monitoring
 *
 * Legacy fee-monitor.ts and token-discovery.ts have been removed.
 * Use the new architecture in src/managers/ instead:
 * - FeeTracker (src/managers/fee-tracker.ts)
 * - TokenManager (src/managers/token-manager.ts)
 */

// Realtime tracker exports (still used for WebSocket subscriptions)
export { RealtimeTracker, type TokenInfo, type FeeEvent } from './realtime-tracker';

// Validator daemon exports
export { ValidatorDaemon, type TokenConfig as ValidatorTokenConfig } from './validator-daemon';
