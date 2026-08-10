import { readSeen } from "../state/store.ts";
import { canonicalUrl, titleSimilarity } from "../util/text.ts";
import { log } from "../util/log.ts";
import type { Candidate } from "../types.ts";

const TITLE_MATCH_THRESHOLD = 0.6;

/**
 * Removes anything we've already posted about, plus intra-batch duplicates —
 * the same launch routinely lands on HN, Reddit, and X within an hour, and
 * without this the bot would happily post about it three times.
 */
export function dedupe(candidates: Candidate[]): Candidate[] {
  const seen = readSeen();
  const seenUrls = new Set(seen.map((e) => e.urlKey));
  const seenIds = new Set(seen.map((e) => e.candidateId));
  const seenTitles = seen.map((e) => e.title);

  const keptUrls = new Set<string>();
  const keptTitles: string[] = [];
  const out: Candidate[] = [];

  let droppedHistory = 0;
  let droppedBatch = 0;

  // Strongest signal first, so when two sources carry the same story we keep
  // the one with more engagement behind it.
  const ordered = [...candidates].sort((a, b) => b.engagement - a.engagement);

  for (const candidate of ordered) {
    const urlKey = canonicalUrl(candidate.url);

    if (seenIds.has(candidate.id) || seenUrls.has(urlKey)) {
      droppedHistory++;
      continue;
    }
    if (seenTitles.some((t) => titleSimilarity(t, candidate.title) >= TITLE_MATCH_THRESHOLD)) {
      droppedHistory++;
      continue;
    }

    if (keptUrls.has(urlKey)) {
      droppedBatch++;
      continue;
    }
    if (keptTitles.some((t) => titleSimilarity(t, candidate.title) >= TITLE_MATCH_THRESHOLD)) {
      droppedBatch++;
      continue;
    }

    keptUrls.add(urlKey);
    keptTitles.push(candidate.title);
    out.push(candidate);
  }

  log.info("dedupe complete", { kept: out.length, droppedHistory, droppedBatch });
  return out;
}
