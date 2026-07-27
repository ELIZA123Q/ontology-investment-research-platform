// 统一日志出口。
// 目标：逐步替代散落在 engine / adapters 中的裸 console.* 调用，
// 使生产环境可关闭调试噪音，并统一前缀与分级。
type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const isProduction = process.env.NODE_ENV === "production";
const minLevel: LogLevel = isProduction ? "info" : "debug";

function emit(level: LogLevel, scope: string, message: string, meta?: unknown): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[minLevel]) return;
  const prefix = `[${level.toUpperCase()}] ${scope}`;
  const payload = meta === undefined ? "" : meta;
  if (level === "error") console.error(prefix, message, payload);
  else if (level === "warn") console.warn(prefix, message, payload);
  else console.log(prefix, message, payload);
}

export const logger = {
  debug: (scope: string, message: string, meta?: unknown) => emit("debug", scope, message, meta),
  info: (scope: string, message: string, meta?: unknown) => emit("info", scope, message, meta),
  warn: (scope: string, message: string, meta?: unknown) => emit("warn", scope, message, meta),
  error: (scope: string, message: string, meta?: unknown) => emit("error", scope, message, meta),
};

export type { LogLevel };
