/**
 * Unified logging for code outside Effect.gen blocks.
 * Use Effect.logDebug/logInfo for code inside Effect.gen.
 *
 * Log level controlled by DAEDUX_DEBUG=1 (debug) vs default (info).
 * All output uses consistent `[tag] message` format.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL: LogLevel = process.env.DAEDUX_DEBUG === "1" ? "debug" : "info";
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const shouldLog = (level: LogLevel): boolean =>
  LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[LOG_LEVEL];

export const log = {
  debug: (tag: string, ...args: unknown[]): void => {
    if (shouldLog("debug")) {
      console.log(`[${tag}]`, ...args);
    }
  },
  info: (tag: string, ...args: unknown[]): void => {
    if (shouldLog("info")) {
      console.log(`[${tag}]`, ...args);
    }
  },
  warn: (tag: string, ...args: unknown[]): void => {
    if (shouldLog("warn")) {
      console.warn(`[${tag}]`, ...args);
    }
  },
  error: (tag: string, ...args: unknown[]): void => {
    if (shouldLog("error")) {
      console.error(`[${tag}]`, ...args);
    }
  },
};

// Backward compatibility
export const DEBUG = LOG_LEVEL === "debug";
export const debugLog = log.debug;
