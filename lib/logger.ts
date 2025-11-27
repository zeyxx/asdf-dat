/**
 * ASDF-DAT Structured Logger
 *
 * Provides structured logging with:
 * - Console output (stdout/stderr)
 * - File output with rotation
 * - JSON format for parsing
 * - Log levels (debug, info, warn, error)
 */

import * as fs from 'fs';
import * as path from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface LoggerConfig {
  level: LogLevel;
  console: boolean;
  file: boolean;
  filePath?: string;
  maxFileSize?: number;    // bytes, default 10MB
  maxFiles?: number;       // number of rotated files to keep
  jsonFormat?: boolean;    // JSON format for file output
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m',  // cyan
  info: '\x1b[32m',   // green
  warn: '\x1b[33m',   // yellow
  error: '\x1b[31m',  // red
};

const RESET = '\x1b[0m';

export class Logger {
  private config: Required<LoggerConfig>;
  private fileStream: fs.WriteStream | null = null;
  private currentFileSize: number = 0;
  private component: string;

  constructor(component: string, config: Partial<LoggerConfig> = {}) {
    this.component = component;
    this.config = {
      level: config.level || 'info',
      console: config.console !== false,
      file: config.file || false,
      filePath: config.filePath || './logs/asdf-daemon.log',
      maxFileSize: config.maxFileSize || 10 * 1024 * 1024, // 10MB
      maxFiles: config.maxFiles || 5,
      jsonFormat: config.jsonFormat !== false,
    };

    if (this.config.file) {
      this.initFileLogging();
    }
  }

  private initFileLogging(): void {
    const dir = path.dirname(this.config.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Check existing file size
    if (fs.existsSync(this.config.filePath)) {
      const stats = fs.statSync(this.config.filePath);
      this.currentFileSize = stats.size;
    }

    this.fileStream = fs.createWriteStream(this.config.filePath, { flags: 'a' });
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
  }

  private rotateFile(): void {
    if (!this.fileStream) return;

    this.fileStream.end();

    // Rotate existing files
    for (let i = this.config.maxFiles - 1; i >= 1; i--) {
      const oldPath = `${this.config.filePath}.${i}`;
      const newPath = `${this.config.filePath}.${i + 1}`;
      if (fs.existsSync(oldPath)) {
        if (i === this.config.maxFiles - 1) {
          fs.unlinkSync(oldPath); // Delete oldest
        } else {
          fs.renameSync(oldPath, newPath);
        }
      }
    }

    // Rename current to .1
    if (fs.existsSync(this.config.filePath)) {
      fs.renameSync(this.config.filePath, `${this.config.filePath}.1`);
    }

    // Create new file
    this.fileStream = fs.createWriteStream(this.config.filePath, { flags: 'a' });
    this.currentFileSize = 0;
  }

  private formatConsole(entry: LogEntry): string {
    const color = LEVEL_COLORS[entry.level];
    const levelStr = entry.level.toUpperCase().padEnd(5);
    let msg = `${color}[${entry.timestamp}] [${levelStr}] [${entry.component}]${RESET} ${entry.message}`;

    if (entry.data && Object.keys(entry.data).length > 0) {
      const dataStr = Object.entries(entry.data)
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join(' ');
      msg += ` ${LEVEL_COLORS.debug}${dataStr}${RESET}`;
    }

    return msg;
  }

  private formatFile(entry: LogEntry): string {
    if (this.config.jsonFormat) {
      return JSON.stringify(entry);
    }

    let msg = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.component}] ${entry.message}`;
    if (entry.data && Object.keys(entry.data).length > 0) {
      msg += ` ${JSON.stringify(entry.data)}`;
    }
    return msg;
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      message,
      data,
    };

    // Console output
    if (this.config.console) {
      const consoleMsg = this.formatConsole(entry);
      if (level === 'error') {
        console.error(consoleMsg);
      } else {
        console.log(consoleMsg);
      }
    }

    // File output
    if (this.config.file && this.fileStream) {
      const fileMsg = this.formatFile(entry) + '\n';
      const msgSize = Buffer.byteLength(fileMsg);

      // Check if rotation needed
      if (this.currentFileSize + msgSize > this.config.maxFileSize) {
        this.rotateFile();
      }

      this.fileStream.write(fileMsg);
      this.currentFileSize += msgSize;
    }
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log('error', message, data);
  }

  // Convenience methods with emojis for visual clarity
  success(message: string, data?: Record<string, unknown>): void {
    this.info(`✅ ${message}`, data);
  }

  fee(message: string, data?: Record<string, unknown>): void {
    this.info(`💰 ${message}`, data);
  }

  cycle(message: string, data?: Record<string, unknown>): void {
    this.info(`🔄 ${message}`, data);
  }

  burn(message: string, data?: Record<string, unknown>): void {
    this.info(`🔥 ${message}`, data);
  }

  // Create child logger with sub-component
  child(subComponent: string): Logger {
    return new Logger(`${this.component}:${subComponent}`, this.config);
  }

  // Close file stream
  close(): void {
    if (this.fileStream) {
      this.fileStream.end();
      this.fileStream = null;
    }
  }

  // Set log level dynamically
  setLevel(level: LogLevel): void {
    this.config.level = level;
  }
}

// Default logger factory
export function createLogger(
  component: string,
  options: Partial<LoggerConfig> = {}
): Logger {
  const defaultConfig: Partial<LoggerConfig> = {
    level: (process.env.LOG_LEVEL as LogLevel) || 'info',
    console: true,
    file: process.env.LOG_FILE === 'true' || process.env.NODE_ENV === 'production',
    filePath: process.env.LOG_PATH || './logs/asdf-daemon.log',
  };

  return new Logger(component, { ...defaultConfig, ...options });
}

// Singleton for daemon
let daemonLogger: Logger | null = null;

export function getDaemonLogger(): Logger {
  if (!daemonLogger) {
    daemonLogger = createLogger('daemon', {
      file: true,
      filePath: './logs/asdf-daemon.log',
    });
  }
  return daemonLogger;
}

export function getCycleLogger(): Logger {
  return createLogger('cycle', {
    file: true,
    filePath: './logs/asdf-cycles.log',
  });
}
