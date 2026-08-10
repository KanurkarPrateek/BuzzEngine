import { log } from "./log.ts";

/**
 * Optional last-resort fetch path for sources that scrape HTML or hit
 * unauthenticated endpoints (GitHub trending, public Reddit JSON). Datacenter
 * IPs — which is where this bot usually runs — get blocked by both far more
 * often than laptops do.
 *
 * This is deliberately *not* the normal path: it is only consulted when a
 * direct request comes back blocked, and only when TRAWL_URL is configured.
 * Leave it unset and the bot behaves exactly as if this file did not exist.
 *
 * Expects a TRAWL / FlareSolverr-v2 compatible server (https://trawl.germondai.com).
 */

type FlareSolverrResponse = {
  status?: string;
  message?: string;
  solution?: { response?: string; status?: number; url?: string };
};

export function trawlEnabled(): boolean {
  return Boolean(process.env.TRAWL_URL);
}

/** Statuses that mean "you were blocked", as opposed to "this page is broken". */
export function isBlockedStatus(status: number): boolean {
  return status === 403 || status === 429 || status === 451;
}

export async function fetchViaTrawl(url: string, timeoutMs = 70_000): Promise<string> {
  const base = (process.env.TRAWL_URL ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("TRAWL_URL is not set");

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const res = await fetch(`${base}/v1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cmd: "request.get", url, maxTimeout: timeoutMs - 5_000 }),
      signal: ac.signal,
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`trawl ${res.status}: ${text.slice(0, 200)}`);

    const parsed = JSON.parse(text) as FlareSolverrResponse;
    const html = parsed.solution?.response;
    if (!html) {
      throw new Error(`trawl returned no page body: ${parsed.message ?? text.slice(0, 200)}`);
    }

    log.info("fetched via trawl", { url, upstreamStatus: parsed.solution?.status });
    return html;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * TRAWL returns rendered HTML. When the target is a JSON endpoint the body is
 * often wrapped in a <pre> tag by the headless browser, so unwrap before parsing.
 */
export function unwrapJsonBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;

  const pre = trimmed.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  if (pre?.[1]) {
    return pre[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .trim();
  }
  return trimmed;
}
