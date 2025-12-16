/**
 * Cycle Logging Utilities
 *
 * Specialized logging for cycle execution with color support and tracing.
 */

import { getCycleLogger } from '../../observability/logger';
import { getCurrentTraceId } from '../../observability/tracing';

const logger = getCycleLogger();

export const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

/**
 * Log a message with icon, color, and optional structured data
 */
export function log(
  icon: string,
  message: string,
  color = colors.reset,
  data?: Record<string, unknown>
): void {
  // Console output for real-time feedback
  const tracePrefix = getCurrentTraceId() ? `[${getCurrentTraceId()}] ` : '';
  console.log(`${color}${tracePrefix}${icon} ${message}${colors.reset}`);

  // Structured logger (captures trace context automatically)
  const cleanMessage = `${icon} ${message}`.replace(/[\x1b\[\]0-9;m]/g, ''); // Strip ANSI
  logger.info(cleanMessage, data);
}

/**
 * Log a section header
 */
export function logSection(title: string): void {
  console.log(`\n${colors.bright}${colors.cyan}${'='.repeat(80)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(80)}${colors.reset}\n`);

  // Structured log for section
  logger.info(`=== ${title} ===`);
}
