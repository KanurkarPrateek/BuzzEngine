import { config } from "../config.ts";
import { getJson } from "../util/http.ts";
import { log } from "../util/log.ts";
import type { Candidate } from "../types.ts";

type AlgoliaHit = {
  objectID: string;
  title?: string | null;
  url?: string | null;
  points?: number | null;
  num_comments?: number | null;
  created_at_i?: number | null;
  author?: string | null;
  story_text?: string | null;
};

type AlgoliaResponse = { hits: AlgoliaHit[] };

const BASE = "https://hn.algolia.com/api/v1";

/**
 * Two passes: the current front page (what the community has already endorsed)
 * and recent high-velocity stories (what is climbing right now but hasn't
 * peaked). The union is deduped by story id.
 */
export async function fetchHackerNews(): Promise<Candidate[]> {
  const sinceEpoch = Math.floor((Date.now() - config.sources.hn.lookbackHours * 3_600_000) / 1000);

  const frontPage = `${BASE}/search?tags=front_page&hitsPerPage=50`;
  const rising =
    `${BASE}/search_by_date?tags=story` +
    `&numericFilters=created_at_i>${sinceEpoch},points>${config.sources.hn.minPoints}` +
    `&hitsPerPage=100`;

  const [a, b] = await Promise.allSettled([
    getJson<AlgoliaResponse>(frontPage),
    getJson<AlgoliaResponse>(rising),
  ]);

  const hits: AlgoliaHit[] = [];
  for (const result of [a, b]) {
    if (result.status === "fulfilled") hits.push(...result.value.hits);
    else log.warn("hn fetch failed", { err: String(result.reason) });
  }

  const byId = new Map<string, Candidate>();
  for (const hit of hits) {
    const candidate = toCandidate(hit);
    if (!candidate) continue;
    const existing = byId.get(candidate.id);
    // Keep whichever pass reported the higher point count.
    if (!existing || candidate.engagement > existing.engagement) byId.set(candidate.id, candidate);
  }

  const out = [...byId.values()].filter((c) => c.engagement >= config.sources.hn.minPoints);
  log.info("hn collected", { count: out.length });
  return out;
}

function toCandidate(hit: AlgoliaHit): Candidate | undefined {
  if (!hit.title || !hit.created_at_i) return undefined;
  const discussionUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;
  // Ask HN / Show HN text posts have no external URL; the thread is the artifact.
  const url = hit.url ?? discussionUrl;

  return {
    id: `hn:${hit.objectID}`,
    source: "hn",
    title: hit.title,
    url,
    discussionUrl,
    summary: hit.story_text?.slice(0, 600) ?? undefined,
    engagement: hit.points ?? 0,
    comments: hit.num_comments ?? 0,
    createdAt: hit.created_at_i * 1000,
    author: hit.author ?? undefined,
  };
}
