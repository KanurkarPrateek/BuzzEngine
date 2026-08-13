import { config } from "../config.ts";
import { getJson } from "../util/http.ts";
import { log } from "../util/log.ts";
import type { Candidate } from "../types.ts";

type SearchTweet = {
  id?: string;
  url?: string;
  text?: string;
  likeCount?: number;
  retweetCount?: number;
  replyCount?: number;
  quoteCount?: number;
  viewCount?: number;
  createdAt?: string;
  lang?: string;
  isReply?: boolean;
  author?: { userName?: string; followers?: number };
};

type SearchResponse = {
  tweets?: SearchTweet[];
  has_next_page?: boolean;
  next_cursor?: string;
};

/**
 * Reads what's actually buzzing on X. Uses a third-party search API rather than
 * the official trends endpoint, which sits behind a five-figure monthly tier.
 * Any provider exposing the same shape works via XSEARCH_BASE_URL.
 */
export async function fetchXBuzz(): Promise<Candidate[]> {
  const { apiKey, baseUrl, minLikes, lookbackHours, maxQueries } = config.sources.x;
  if (!apiKey) {
    log.info("x search skipped (no XSEARCH_API_KEY)");
    return [];
  }

  const sinceEpoch = Math.floor((Date.now() - lookbackHours * 3_600_000) / 1000);
  const queries = buildQueries(minLikes, sinceEpoch).slice(0, maxQueries);
  const byId = new Map<string, Candidate>();

  for (const query of queries) {
    const url =
      `${baseUrl.replace(/\/+$/, "")}/twitter/tweet/advanced_search` +
      `?query=${encodeURIComponent(query)}&queryType=Top`;

    try {
      const res = await getJson<SearchResponse>(url, { headers: { "X-API-Key": apiKey } });

      for (const tweet of res.tweets ?? []) {
        if (!tweet.id || !tweet.text || tweet.isReply) continue;
        const likes = tweet.likeCount ?? 0;
        if (likes < minLikes) continue;

        const createdAt = tweet.createdAt ? Date.parse(tweet.createdAt) : Date.now();
        if (!Number.isFinite(createdAt)) continue;

        byId.set(tweet.id, {
          id: `x:${tweet.id}`,
          source: "x",
          // The tweet body is the "title" — there's no headline to borrow.
          title: tweet.text.replace(/\s+/g, " ").slice(0, 200),
          url: tweet.url ?? `https://x.com/i/status/${tweet.id}`,
          summary: tweet.text.slice(0, 600),
          engagement: likes + (tweet.retweetCount ?? 0) * 2,
          comments: (tweet.replyCount ?? 0) + (tweet.quoteCount ?? 0),
          createdAt,
          author: tweet.author?.userName,
        });
      }
    } catch (err) {
      log.warn("x search query failed", { query, err: String(err) });
    }
  }

  const out = [...byId.values()];
  log.info("x collected", { count: out.length, queries: queries.length });
  return out;
}

/**
 * Builds the search queries. Each request is billed, so handles and topics are
 * batched into as few OR-ed queries as the operator length allows.
 */
function buildQueries(minLikes: number, sinceEpoch: number): string[] {
  const base = `-filter:replies -filter:retweets lang:en since_time:${sinceEpoch}`;
  const queries: string[] = [];

  // Curated accounts first: a known voice clears a lower engagement bar than
  // an anonymous viral post, because the signal is who said it.
  const handles = config.sources.x.handles;
  if (handles.length > 0) {
    const handleFilters = `min_faves:${config.sources.x.handleMinLikes} ${base}`;
    for (const group of chunkByLength(handles.map((h) => `from:${h}`), 380)) {
      queries.push(`(${group.join(" OR ")}) ${handleFilters}`);
    }
  }

  // Then open topic search, which needs a higher bar to be worth reading.
  const topicFilters = `min_faves:${minLikes} ${base}`;
  for (const group of chunkByLength(config.editorial.topics.map((t) => `"${t}"`), 300)) {
    queries.push(`(${group.join(" OR ")}) ${topicFilters}`);
  }

  return queries;
}

/** X caps search operators around 512 characters; stay well inside it. */
function chunkByLength(terms: string[], maxChars: number): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  for (const term of terms) {
    const candidate = [...current, term];
    if (current.length > 0 && candidate.join(" OR ").length > maxChars) {
      chunks.push(current);
      current = [term];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
