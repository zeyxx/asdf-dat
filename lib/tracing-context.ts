/**
 * Tracing Context for ASDF-DAT
 *
 * Provides distributed tracing capabilities using AsyncLocalStorage.
 * Enables trace ID propagation across async operations without explicit passing.
 *
 * "Flush. Burn. Trace. This is fine." 🔥🐕
 */

import { AsyncLocalStorage } from 'async_hooks';
import { randomBytes } from 'crypto';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface TraceContext {
  /** UUID for the complete cycle/operation */
  traceId: string;
  /** UUID for the current span/sub-operation */
  spanId: string;
  /** Operation type: "cycle", "poll", "buy", "burn", "collect", "rebate" */
  operation: string;
  /** Token symbol if operation is token-specific */
  tokenSymbol?: string;
  /** Parent span ID for nested operations */
  parentSpanId?: string;
  /** Timestamp when trace started */
  startTime: number;
  /** Additional context data */
  metadata?: Record<string, unknown>;
}

export interface SpanOptions {
  operation: string;
  tokenSymbol?: string;
  metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Storage
// ═══════════════════════════════════════════════════════════════════════════

const asyncLocalStorage = new AsyncLocalStorage<TraceContext>();

// ═══════════════════════════════════════════════════════════════════════════
// ID Generation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a short trace ID (8 hex chars)
 * Format: abc12def
 */
export function generateTraceId(): string {
  return randomBytes(4).toString('hex');
}

/**
 * Generate a span ID (6 hex chars)
 * Format: a1b2c3
 */
export function generateSpanId(): string {
  return randomBytes(3).toString('hex');
}

// ═══════════════════════════════════════════════════════════════════════════
// Context Access
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get the current trace context (if any)
 */
export function getCurrentContext(): TraceContext | undefined {
  return asyncLocalStorage.getStore();
}

/**
 * Get the current trace ID (shorthand)
 */
export function getCurrentTraceId(): string | undefined {
  return asyncLocalStorage.getStore()?.traceId;
}

/**
 * Get the current span ID (shorthand)
 */
export function getCurrentSpanId(): string | undefined {
  return asyncLocalStorage.getStore()?.spanId;
}

/**
 * Get current operation name
 */
export function getCurrentOperation(): string | undefined {
  return asyncLocalStorage.getStore()?.operation;
}

// ═══════════════════════════════════════════════════════════════════════════
// Context Execution
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Execute a function within a new trace context
 * Creates a new trace ID if none exists
 */
export async function withTraceContext<T>(
  options: SpanOptions,
  fn: () => Promise<T>
): Promise<T> {
  const parentContext = getCurrentContext();

  const context: TraceContext = {
    traceId: parentContext?.traceId ?? generateTraceId(),
    spanId: generateSpanId(),
    operation: options.operation,
    tokenSymbol: options.tokenSymbol,
    parentSpanId: parentContext?.spanId,
    startTime: Date.now(),
    metadata: options.metadata,
  };

  return asyncLocalStorage.run(context, fn);
}

/**
 * Execute a synchronous function within a new trace context
 */
export function withTraceContextSync<T>(
  options: SpanOptions,
  fn: () => T
): T {
  const parentContext = getCurrentContext();

  const context: TraceContext = {
    traceId: parentContext?.traceId ?? generateTraceId(),
    spanId: generateSpanId(),
    operation: options.operation,
    tokenSymbol: options.tokenSymbol,
    parentSpanId: parentContext?.spanId,
    startTime: Date.now(),
    metadata: options.metadata,
  };

  return asyncLocalStorage.run(context, fn);
}

/**
 * Create a child span within the current trace
 * Preserves the trace ID but creates a new span ID
 */
export async function withSpan<T>(
  operation: string,
  fn: () => Promise<T>,
  tokenSymbol?: string
): Promise<T> {
  return withTraceContext({ operation, tokenSymbol }, fn);
}

/**
 * Start a new root trace (for cycle start)
 */
export async function withNewTrace<T>(
  operation: string,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>
): Promise<T> {
  const context: TraceContext = {
    traceId: generateTraceId(),
    spanId: generateSpanId(),
    operation,
    startTime: Date.now(),
    metadata,
  };

  return asyncLocalStorage.run(context, fn);
}

// ═══════════════════════════════════════════════════════════════════════════
// Formatting
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Format trace context for log prefix
 * Format: [traceId:abc123] or [traceId:abc123|span:d4e5f6]
 */
export function formatTracePrefix(includeSpan = false): string {
  const ctx = getCurrentContext();
  if (!ctx) return '';

  if (includeSpan) {
    return `[traceId:${ctx.traceId}|span:${ctx.spanId}]`;
  }
  return `[traceId:${ctx.traceId}]`;
}

/**
 * Format trace context for structured logging
 */
export function getTraceFields(): Record<string, string | undefined> {
  const ctx = getCurrentContext();
  if (!ctx) return {};

  return {
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    parentSpanId: ctx.parentSpanId,
    operation: ctx.operation,
    tokenSymbol: ctx.tokenSymbol,
  };
}

/**
 * Get elapsed time since trace started (ms)
 */
export function getElapsedMs(): number {
  const ctx = getCurrentContext();
  if (!ctx) return 0;
  return Date.now() - ctx.startTime;
}

// ═══════════════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Add metadata to current context
 * Note: This mutates the current context
 */
export function addMetadata(key: string, value: unknown): void {
  const ctx = getCurrentContext();
  if (ctx) {
    ctx.metadata = ctx.metadata ?? {};
    ctx.metadata[key] = value;
  }
}

/**
 * Create a trace context summary for reports
 */
export function createTraceSummary(): string {
  const ctx = getCurrentContext();
  if (!ctx) return 'no-trace';

  const elapsed = getElapsedMs();
  const parts = [
    `trace:${ctx.traceId}`,
    `op:${ctx.operation}`,
    `elapsed:${elapsed}ms`,
  ];

  if (ctx.tokenSymbol) {
    parts.push(`token:${ctx.tokenSymbol}`);
  }

  return parts.join(' ');
}
