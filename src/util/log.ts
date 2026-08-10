const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

const threshold = LEVELS[(process.env.LOG_LEVEL as Level) ?? "info"] ?? LEVELS.info;
const asJson = process.env.LOG_FORMAT === "json";

function emit(level: Level, msg: string, extra?: Record<string, unknown>) {
  if (LEVELS[level] < threshold) return;
  const at = new Date().toISOString();
  if (asJson) {
    console.log(JSON.stringify({ at, level, msg, ...extra }));
    return;
  }
  const tail = extra && Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : "";
  console.log(`${at} ${level.toUpperCase().padEnd(5)} ${msg}${tail}`);
}

export const log = {
  debug: (m: string, e?: Record<string, unknown>) => emit("debug", m, e),
  info: (m: string, e?: Record<string, unknown>) => emit("info", m, e),
  warn: (m: string, e?: Record<string, unknown>) => emit("warn", m, e),
  error: (m: string, e?: Record<string, unknown>) => emit("error", m, e),
};
