/**
 * Structured Logging System
 *
 * Provides leveled, environment-aware logging with structured output.
 * Replaces ad-hoc console.log statements for production readiness.
 */

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

export interface LogEntry {
  timestamp: string;
  level: string;
  component: string;
  message: string;
  data?: any;
}

export class Logger {
  private static instance: Logger;
  private level: LogLevel;
  private logToFile: boolean;
  private logFilePath?: string;

  private constructor() {
    // Determine log level from environment
    const envLevel = process.env.NEXUS_LOG_LEVEL?.toUpperCase();

    if (envLevel === 'ERROR') {
      this.level = LogLevel.ERROR;
    } else if (envLevel === 'WARN') {
      this.level = LogLevel.WARN;
    } else if (envLevel === 'INFO') {
      this.level = LogLevel.INFO;
    } else if (envLevel === 'DEBUG') {
      this.level = LogLevel.DEBUG;
    } else {
      // Default: production = WARN, development = DEBUG
      this.level = process.env.NODE_ENV === 'production'
        ? LogLevel.WARN
        : LogLevel.DEBUG;
    }

    // File logging (optional)
    this.logToFile = process.env.NEXUS_LOG_FILE === 'true';
    this.logFilePath = process.env.NEXUS_LOG_FILE_PATH;
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * Set the log level programmatically
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Get current log level
   */
  getLevel(): LogLevel {
    return this.level;
  }

  /**
   * Check if a level should be logged
   */
  private shouldLog(level: LogLevel): boolean {
    return level <= this.level;
  }

  /**
   * Format a log entry
   */
  private format(level: LogLevel, component: string, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const levelStr = LogLevel[level];

    let output = `[${timestamp}] [${levelStr}] [${component}] ${message}`;

    if (data !== undefined) {
      if (typeof data === 'object') {
        output += ` ${JSON.stringify(data)}`;
      } else {
        output += ` ${data}`;
      }
    }

    return output;
  }

  /**
   * Write log entry
   */
  private write(level: LogLevel, component: string, message: string, data?: any): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const formatted = this.format(level, component, message, data);

    // Write to console (stderr for errors/warnings, stdout for info/debug)
    if (level <= LogLevel.WARN) {
      console.error(formatted);
    } else {
      console.log(formatted);
    }

    // Write to file if enabled
    if (this.logToFile && this.logFilePath) {
      try {
        const fs = require('fs');
        fs.appendFileSync(this.logFilePath, formatted + '\n', 'utf-8');
      } catch (err) {
        // Can't log the logging error - just fail silently
      }
    }
  }

  /**
   * Log an error (always shown in production)
   */
  error(component: string, message: string, data?: any): void {
    this.write(LogLevel.ERROR, component, message, data);
  }

  /**
   * Log a warning (shown in production)
   */
  warn(component: string, message: string, data?: any): void {
    this.write(LogLevel.WARN, component, message, data);
  }

  /**
   * Log informational message (hidden in production by default)
   */
  info(component: string, message: string, data?: any): void {
    this.write(LogLevel.INFO, component, message, data);
  }

  /**
   * Log debug message (only in development)
   */
  debug(component: string, message: string, data?: any): void {
    this.write(LogLevel.DEBUG, component, message, data);
  }

  /**
   * Create a component-scoped logger
   */
  createComponentLogger(component: string) {
    return {
      error: (message: string, data?: any) => this.error(component, message, data),
      warn: (message: string, data?: any) => this.warn(component, message, data),
      info: (message: string, data?: any) => this.info(component, message, data),
      debug: (message: string, data?: any) => this.debug(component, message, data),
    };
  }
}

/**
 * Get the singleton logger instance
 */
export function getLogger(): Logger {
  return Logger.getInstance();
}

/**
 * Create a component-specific logger
 */
export function createLogger(component: string) {
  return getLogger().createComponentLogger(component);
}
