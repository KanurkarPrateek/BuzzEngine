import { config } from "../config.ts";

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "ref",
  "ref_src",
  "source",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
]);

/** Collapse the many spellings of the same link into one comparable key. */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.protocol = "https:";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) u.searchParams.delete(key);
    }
    u.searchParams.sort();
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.replace(/\/+$/, "");
    }
    return u.toString();
  } catch {
    return raw.trim().toLowerCase();
  }
}

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "to", "of", "in", "on", "for", "with",
  "is", "are", "was", "were", "be", "been", "it", "its", "this", "that", "as",
  "at", "by", "from", "how", "why", "what", "new", "you", "your", "we",
]);

export function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
  return new Set(tokens);
}

/** Jaccard overlap of significant tokens — catches reposts with reworded titles. */
export function titleSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  return intersection / (ta.size + tb.size - intersection);
}

/**
 * X counts every URL as a fixed-width t.co link, so a naive `.length` check
 * under-counts posts that contain links and over-counts nothing.
 */
export function tweetLength(text: string): number {
  const urlPattern = /https?:\/\/\S+/g;
  const urls = text.match(urlPattern) ?? [];
  let length = text.length;
  for (const url of urls) {
    length = length - url.length + config.x.tcoLength;
  }
  return length;
}

export function stripWrappingQuotes(text: string): string {
  const t = text.trim();
  if (t.length > 1 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1).trim();
  return t;
}

export function hoursSince(epochMs: number): number {
  return Math.max(0, (Date.now() - epochMs) / 3_600_000);
}
