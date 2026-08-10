import { config } from "../config.ts";
import { hoursSince } from "../util/text.ts";
import { log } from "../util/log.ts";
import type { Candidate, ScoredCandidate, SourceName } from "../types.ts";

/**
 * Sources use incomparable engagement units (HN points vs GitHub stars-today vs
 * X likes), so each gets a divisor that maps "a genuinely notable item" onto
 * roughly 1.0 before the shared velocity curve is applied.
 */
const SOURCE_SCALE: Record<SourceName, number> = {
  hn: 300, // points on a story that made the front page properly
  github: 800, // stars in a day for a repo people are actually talking about
  reddit: 1000, // upvotes on a top post in a mid-size technical subreddit
  x: 3000, // likes + 2×retweets on a post with real reach
};

/** How much we trust each source's signal-to-noise for this bot's purpose. */
const SOURCE_WEIGHT: Record<SourceName, number> = {
  hn: 1.0,
  github: 0.9,
  reddit: 0.75,
  x: 0.7,
};

export function score(candidates: Candidate[]): ScoredCandidate[] {
  const topics = config.editorial.topics.map((t) => t.toLowerCase());
  const blocked = config.editorial.blockedTerms.map((t) => t.toLowerCase());

  const scored: ScoredCandidate[] = [];

  for (const candidate of candidates) {
    const haystack = `${candidate.title} ${candidate.summary ?? ""}`.toLowerCase();

    if (blocked.some((term) => haystack.includes(term))) continue;

    const matchedTopics = topics.filter((topic) => matchesTopic(haystack, topic));
    // Off-topic items aren't banned outright — a big enough story still gets
    // through — but they start at a heavy disadvantage.
    const topicFit = matchedTopics.length === 0 ? 0.35 : Math.min(1.5, 0.8 + matchedTopics.length * 0.25);

    const ageHours = hoursSince(candidate.createdAt);
    const normalized = candidate.engagement / SOURCE_SCALE[candidate.source];
    // Gravity curve: a 3-hour-old story at 180 points should beat a 20-hour-old
    // one at 400, because the first is still accelerating.
    const velocity = normalized / Math.pow(ageHours + 2, 0.8);

    // Comments relative to engagement mark stories people argue about, which
    // make better posts than press releases that get silently upvoted.
    const discussionBonus =
      candidate.engagement > 0
        ? 1 + Math.min(0.3, (candidate.comments / candidate.engagement) * 0.5)
        : 1;

    const finalScore = velocity * topicFit * SOURCE_WEIGHT[candidate.source] * discussionBonus;

    scored.push({ ...candidate, score: finalScore, velocity, topicFit, matchedTopics });
  }

  scored.sort((a, b) => b.score - a.score);

  log.info("scoring complete", {
    scored: scored.length,
    top: scored.slice(0, 3).map((c) => ({ t: c.title.slice(0, 60), s: Number(c.score.toFixed(3)) })),
  });

  return scored;
}

/** Word-boundary aware so "ai" doesn't match "chain" or "maintenance". */
function matchesTopic(haystack: string, topic: string): boolean {
  if (topic.includes(" ")) return haystack.includes(topic);
  const escaped = topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(haystack);
}
