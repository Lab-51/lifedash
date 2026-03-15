// === FILE PURPOSE ===
// Structured logger for main process. Wraps console with levels, timestamps, and prefixes.
// After initFileLogging() is called, also writes to daily log files with rotation and cleanup.

import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = 'info';

// File logging state
let logDir: string | null = null;
let logStream: fs.WriteStream | null = null;
const buffer: string[] = [];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_AGE_DAYS = 5;

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatTimestamp(): string {
  return new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
}

function getLogFileName(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `lifedash-${date}.log`;
}

function writeToFile(line: string): void {
  if (logStream) {
    logStream.write(line + '\n');
  } else {
    buffer.push(line);
  }
}

function cleanOldLogs(): void {
  if (!logDir) return;
  try {
    const files = fs.readdirSync(logDir);
    const now = Date.now();
    const maxAge = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    for (const file of files) {
      if (!file.endsWith('.log')) continue;
      const filePath = path.join(logDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > maxAge) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // Skip files that can't be accessed
      }
    }
  } catch {
    // Directory read failed — non-fatal
  }
}

function rotateIfNeeded(logFilePath: string): string {
  try {
    const stat = fs.statSync(logFilePath);
    if (stat.size > MAX_FILE_SIZE) {
      const rotatedPath = logFilePath + '.1';
      // Remove old rotated file if it exists
      try {
        fs.unlinkSync(rotatedPath);
      } catch {
        /* ignore */
      }
      fs.renameSync(logFilePath, rotatedPath);
    }
  } catch {
    // File doesn't exist yet — no rotation needed
  }
  return logFilePath;
}

export function initFileLogging(): void {
  // Lazy import app to avoid issues when module is loaded before app is ready
  const { app } = require('electron');
  const dir: string = app.getPath('logs');
  logDir = dir;
  fs.mkdirSync(dir, { recursive: true });

  const logFilePath = rotateIfNeeded(path.join(dir, getLogFileName()));
  logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

  // Flush buffered lines
  for (const line of buffer) {
    logStream.write(line + '\n');
  }
  buffer.length = 0;

  cleanOldLogs();
}

export function getLogDirectory(): string {
  if (logDir) return logDir;
  const { app } = require('electron');
  return app.getPath('logs');
}

function formatMessage(level: LogLevel, prefix: string, message: string, ...args: unknown[]): void {
  if (!shouldLog(level)) return;
  const tag = `${formatTimestamp()} [${level.toUpperCase().padEnd(5)}] [${prefix}]`;
  switch (level) {
    case 'error':
      console.error(tag, message, ...args);
      break;
    case 'warn':
      console.warn(tag, message, ...args);
      break;
    default:
      console.log(tag, message, ...args);
      break;
  }

  // Write to file
  const argsStr =
    args.length > 0 ? ' ' + args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') : '';
  writeToFile(`${tag} ${message}${argsStr}`);
}

/** Create a scoped logger with a fixed prefix */
export function createLogger(prefix: string) {
  return {
    debug: (message: string, ...args: unknown[]) => formatMessage('debug', prefix, message, ...args),
    info: (message: string, ...args: unknown[]) => formatMessage('info', prefix, message, ...args),
    warn: (message: string, ...args: unknown[]) => formatMessage('warn', prefix, message, ...args),
    error: (message: string, ...args: unknown[]) => formatMessage('error', prefix, message, ...args),
  };
}
