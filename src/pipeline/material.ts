import type { ScoredCandidate } from "../types.ts";

/**
 * The single description of a candidate, shared by the drafting and gating
 * stages.
 *
 * These MUST be identical. The gate's job is to reject claims unsupported by
 * the source material — so if it sees less than the drafter did, it flags
 * accurate facts as fabrications and rejects perfectly good posts. Keeping one
 * builder makes that class of mismatch impossible rather than merely unlikely.
 */
export function buildMaterial(candidate: ScoredCandidate): string {
  const isQuote = candidate.source === "x";

  return [
    isQuote
      ? "FORMAT: quote post — your text appears ABOVE someone else's post, which readers can see. Respond to their point; do not restate it."
      : "FORMAT: original post about a story.",
    `SOURCE: ${candidate.source}`,
    `TITLE: ${candidate.title}`,
    `URL: ${candidate.url}`,
    candidate.discussionUrl && candidate.discussionUrl !== candidate.url
      ? `DISCUSSION: ${candidate.discussionUrl}`
      : undefined,
    `ENGAGEMENT: ${candidate.engagement} ${engagementUnit(candidate.source)} (${candidate.comments} comments)`,
    candidate.matchedTopics.length ? `TOPICS: ${candidate.matchedTopics.join(", ")}` : undefined,
    candidate.summary ? `CONTEXT: ${candidate.summary}` : "CONTEXT: (none beyond the title)",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Naming the unit stops the model reporting HN points as stars, or vice versa. */
function engagementUnit(source: ScoredCandidate["source"]): string {
  switch (source) {
    case "hn":
      return "points";
    case "github":
      return "stars today";
    case "reddit":
      return "upvotes";
    case "x":
      return "likes (weighted)";
  }
}
