/**
 * ASDF Burn Engine Logger
 *
 * Structured logging with levels and context.
 * Clean output for production, verbose for debugging.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  timestamp: string;
  component: string;
  message: string;
  data?: Record<string, unknown>;
}

const LOG_COLORS = {
  debug: "\x1b[90m",  // Gray
  info: "\x1b[36m",   // Cyan
  warn: "\x1b[33m",   // Yellow
  error: "\x1b[31m",  // Red
  reset: "\x1b[0m",
};

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private component: string;
  private minLevel: LogLevel;
  private useColors: boolean;

  constructor(component: string, options?: { minLevel?: LogLevel; useColors?: boolean }) {
    this.component = component;
    this.minLevel = options?.minLevel ?? "info";
    this.useColors = options?.useColors ?? process.stdout.isTTY ?? false;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.minLevel];
  }

  private formatTimestamp(): string {
    return new Date().toISOString().replace("T", " ").replace("Z", "");
  }

  private formatMessage(entry: LogEntry): string {
    const { level, timestamp, component, message, data } = entry;

    if (this.useColors) {
      const color = LOG_COLORS[level];
      const reset = LOG_COLORS.reset;
      const levelPad = level.toUpperCase().padEnd(5);
      let line = `${color}[${timestamp}] ${levelPad}${reset} [${component}] ${message}`;
      if (data && Object.keys(data).length > 0) {
        line += ` ${JSON.stringify(data)}`;
      }
      return line;
    } else {
      // JSON format for production/log aggregation
      return JSON.stringify(entry);
    }
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      level,
      timestamp: this.formatTimestamp(),
      component: this.component,
      message,
      data,
    };

    const formatted = this.formatMessage(entry);

    if (level === "error") {
      console.error(formatted);
    } else if (level === "warn") {
      console.warn(formatted);
    } else {
      console.log(formatted);
    }
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log("debug", message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log("warn", message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log("error", message, data);
  }

  /**
   * Create a child logger with same settings but different component name
   */
  child(subComponent: string): Logger {
    return new Logger(`${this.component}:${subComponent}`, {
      minLevel: this.minLevel,
      useColors: this.useColors,
    });
  }

  /**
   * Set minimum log level
   */
  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * Log with timing measurement
   */
  time(label: string): () => void {
    const start = performance.now();
    return () => {
      const duration = performance.now() - start;
      this.debug(`${label}`, { durationMs: Math.round(duration) });
    };
  }
}

// Global logger factory
let globalMinLevel: LogLevel = "info";

export function setGlobalLogLevel(level: LogLevel): void {
  globalMinLevel = level;
}

export function createLogger(component: string): Logger {
  return new Logger(component, {
    minLevel: globalMinLevel,
    useColors: process.stdout.isTTY ?? false,
  });
}

// Pre-configured loggers for common components
export const loggers = {
  daemon: createLogger("daemon"),
  rpc: createLogger("rpc"),
  tokens: createLogger("tokens"),
  fees: createLogger("fees"),
  cycle: createLogger("cycle"),
  api: createLogger("api"),
  ws: createLogger("ws"),
};

export { Logger };
