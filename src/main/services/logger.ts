// === FILE PURPOSE ===
// Structured logger for main process. Wraps console with levels, timestamps, and prefixes.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatTimestamp(): string {
  return new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
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
