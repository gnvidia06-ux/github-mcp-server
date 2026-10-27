// =====================================================
// Logger estructurado con niveles (debug, info, warn, error)
// - Escribe SIEMPRE en stderr: stdout está reservado para MCP.
// - Oculta tokens y datos sensibles antes de escribir.
// =====================================================

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Se lee en cada llamada para respetar LOG_LEVEL aunque cambie. */
function currentLevel(): LogLevel {
  const env = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return env in LEVEL_PRIORITY ? (env as LogLevel) : "info";
}

const SENSITIVE_KEYS = ["token", "authorization", "password", "secret"];
const TOKEN_PATTERN = /(ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]+/g;

/** Reemplaza tokens y campos sensibles por [REDACTED]. */
export function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(TOKEN_PATTERN, "[REDACTED]");
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      const isSensitive = SENSITIVE_KEYS.some((s) =>
        key.toLowerCase().includes(s)
      );
      result[key] = isSensitive ? "[REDACTED]" : redact(val);
    }
    return result;
  }
  return value;
}

function write(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[currentLevel()]) return;

  const entry = {
    time: new Date().toISOString(),
    level: level.toUpperCase(),
    message: redact(message),
    ...(meta ? { meta: redact(meta) } : {}),
  };

  process.stderr.write(JSON.stringify(entry) + "\n");
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => write("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => write("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write("error", message, meta),
};