import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.ts";
import { log } from "../util/log.ts";
import type { HistoryEntry } from "../types.ts";

export type SeenEntry = {
  urlKey: string;
  title: string;
  candidateId: string;
  at: number;
  /** What the post was about — see pipeline/subjects.ts. */
  subjects?: string[];
};

const SEEN_FILE = () => join(config.stateDir, "seen.json");
const HISTORY_FILE = () => join(config.stateDir, "history.jsonl");
const TOKEN_FILE = () => join(config.stateDir, "x-token.json");
const PAUSE_FILE = () => join(config.stateDir, "PAUSED");

export function ensureStateDir(): void {
  mkdirSync(config.stateDir, { recursive: true });
}

/** Write to a temp file then rename, so a crash mid-write can't corrupt state. */
function writeAtomic(path: string, contents: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, contents, "utf8");
  renameSync(tmp, path);
}

export function readSeen(): SeenEntry[] {
  const path = SEEN_FILE();
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { entries?: SeenEntry[] };
    return parsed.entries ?? [];
  } catch (err) {
    log.warn("seen.json unreadable, starting fresh", { err: String(err) });
    return [];
  }
}

export function writeSeen(entries: SeenEntry[]): void {
  ensureStateDir();
  const cutoff = Date.now() - config.limits.seenRetentionDays * 86_400_000;
  const kept = entries.filter((e) => e.at >= cutoff);
  writeAtomic(SEEN_FILE(), JSON.stringify({ entries: kept }, null, 2));
}

export function recordSeen(entry: SeenEntry): void {
  const entries = readSeen();
  entries.push(entry);
  writeSeen(entries);
}

export function readHistory(): HistoryEntry[] {
  const path = HISTORY_FILE();
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as HistoryEntry];
      } catch {
        return [];
      }
    });
}

export function appendHistory(entry: HistoryEntry): void {
  ensureStateDir();
  appendFileSync(HISTORY_FILE(), `${JSON.stringify(entry)}\n`, "utf8");
}

export function isPaused(): boolean {
  return existsSync(PAUSE_FILE());
}

/**
 * X rotates the refresh token on every exchange, so the live token has to
 * outlive the process. A file in the state dir works on a laptop, in a
 * container with a volume, and on a Kubernetes PVC alike.
 */
export function readStoredRefreshToken(): string | undefined {
  const path = TOKEN_FILE();
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { refreshToken?: string };
    return parsed.refreshToken;
  } catch {
    return undefined;
  }
}

export function writeRefreshToken(refreshToken: string): void {
  ensureStateDir();
  writeAtomic(TOKEN_FILE(), JSON.stringify({ refreshToken, updatedAt: new Date().toISOString() }, null, 2));
}
