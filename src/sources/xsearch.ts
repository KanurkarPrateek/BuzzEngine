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
 * Group topics into a few OR-ed queries rather than one query per topic —
 * each request is billed, so fewer, broader queries cost less and return more.
 */
function buildQueries(minLikes: number, sinceEpoch: number): string[] {
  const topics = config.editorial.topics;
  const groupSize = 4;
  const filters = `min_faves:${minLikes} -filter:replies -filter:retweets lang:en since_time:${sinceEpoch}`;

  const queries: string[] = [];
  for (let i = 0; i < topics.length; i += groupSize) {
    const group = topics
      .slice(i, i + groupSize)
      .map((t) => `"${t}"`)
      .join(" OR ");
    queries.push(`(${group}) ${filters}`);
  }
  return queries;
}
