type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const currentLevel: LogLevel =
  process.env.LOG_LEVEL === "debug" ||
  process.env.LOG_LEVEL === "info" ||
  process.env.LOG_LEVEL === "warn" ||
  process.env.LOG_LEVEL === "error"
    ? process.env.LOG_LEVEL
    : process.env.NODE_ENV === "production"
      ? "info"
      : "debug";

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(level: LogLevel, message: string, meta?: unknown): string {
  const timestamp = new Date().toISOString();
  const base = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  if (meta === undefined) {
    return base;
  }
  return `${base} ${typeof meta === "string" ? meta : JSON.stringify(meta)}`;
}

export const logger = {
  debug(message: string, meta?: unknown): void {
    if (shouldLog("debug")) {
      console.debug(formatMessage("debug", message, meta));
    }
  },
  info(message: string, meta?: unknown): void {
    if (shouldLog("info")) {
      console.info(formatMessage("info", message, meta));
    }
  },
  warn(message: string, meta?: unknown): void {
    if (shouldLog("warn")) {
      console.warn(formatMessage("warn", message, meta));
    }
  },
  error(message: string, meta?: unknown): void {
    if (shouldLog("error")) {
      console.error(formatMessage("error", message, meta));
    }
  },
};
