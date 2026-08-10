import { log } from "./log.ts";
import { fetchViaTrawl, isBlockedStatus, trawlEnabled, unwrapJsonBody } from "./trawl.ts";

export class HttpError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, url: string) {
    super(`HTTP ${status} for ${url}: ${body.slice(0, 400)}`);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

export type FetchOpts = RequestInit & {
  timeoutMs?: number;
  retries?: number;
  /** Statuses worth retrying. Defaults to 408/429/5xx. */
  retryOn?: (status: number) => boolean;
  /**
   * For scraped/unauthenticated endpoints: if the direct request comes back
   * blocked (403/429/451) and TRAWL_URL is configured, retry once through it.
   * No-op otherwise, so the normal path is unaffected.
   */
  escalateIfBlocked?: boolean;
};

const defaultRetryOn = (s: number) => s === 408 || s === 429 || s >= 500;

/** fetch with a hard wall-clock timeout, bounded retries, and exponential backoff. */
export async function request(url: string, opts: FetchOpts = {}): Promise<Response> {
  const { timeoutMs = 20_000, retries = 2, retryOn = defaultRetryOn, ...init } = opts;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ac.signal });
      if (!res.ok && retryOn(res.status) && attempt < retries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 800 * 2 ** attempt;
        log.warn("http retrying", { url, status: res.status, waitMs, attempt });
        await sleep(waitMs);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const waitMs = 800 * 2 ** attempt;
        log.warn("http error, retrying", { url, waitMs, attempt, err: String(err) });
        await sleep(waitMs);
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`request failed: ${url}`);
}

export async function getJson<T>(url: string, opts: FetchOpts = {}): Promise<T> {
  const res = await request(url, {
    ...opts,
    headers: { accept: "application/json", "user-agent": userAgent(), ...(opts.headers ?? {}) },
  });
  const text = await res.text();

  if (!res.ok) {
    if (opts.escalateIfBlocked && isBlockedStatus(res.status) && trawlEnabled()) {
      log.warn("blocked, escalating to trawl", { url, status: res.status });
      return JSON.parse(unwrapJsonBody(await fetchViaTrawl(url))) as T;
    }
    throw new HttpError(res.status, text, url);
  }

  return JSON.parse(text) as T;
}

export async function getText(url: string, opts: FetchOpts = {}): Promise<string> {
  const res = await request(url, {
    ...opts,
    headers: { "user-agent": userAgent(), ...(opts.headers ?? {}) },
  });
  const text = await res.text();

  if (!res.ok) {
    if (opts.escalateIfBlocked && isBlockedStatus(res.status) && trawlEnabled()) {
      log.warn("blocked, escalating to trawl", { url, status: res.status });
      return await fetchViaTrawl(url);
    }
    throw new HttpError(res.status, text, url);
  }

  return text;
}

export function userAgent(): string {
  return process.env.USER_AGENT ?? "x-agent/1.0 (+https://github.com/)";
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
