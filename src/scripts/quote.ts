import { config } from "../config.ts";
import { gate } from "../pipeline/gate.ts";
import { draft } from "../pipeline/draft.ts";
import { createPost } from "../publish/buffer.ts";
import { log } from "../util/log.ts";
import type { ScoredCandidate } from "../types.ts";

/**
 * Quote-post a specific tweet, with a take written and gated by the normal
 * pipeline.
 *
 *   node src/scripts/quote.ts <tweet-url-or-id> "<what the tweet says>"
 *
 * Quote posts are what X permits for automated engagement; replies were
 * restricted on every paid tier in February 2026, so there is no reply mode.
 */

function tweetIdFrom(input: string): string {
  const m = input.match(/status\/(\d+)/);
  if (m) return m[1];
  if (/^\d+$/.test(input)) return input;
  throw new Error(`Could not read a tweet id from "${input}"`);
}

async function main(): Promise<void> {
  const [rawTarget, context] = process.argv.slice(2);
  if (!rawTarget) {
    console.error('Usage: node src/scripts/quote.ts <tweet-url-or-id> "<tweet text / context>"');
    process.exit(1);
  }

  const tweetId = tweetIdFrom(rawTarget);
  const url = `https://x.com/i/status/${tweetId}`;

  // The pipeline is built around candidates, so present the tweet as one.
  // Engagement is unknown here (this is a manual quote), so it is left at zero
  // rather than invented — buildMaterial reports it honestly to both stages.
  const candidate: ScoredCandidate = {
    id: `x:${tweetId}`,
    source: "x",
    title: (context ?? "A post on X").slice(0, 200),
    url,
    summary: context,
    engagement: 0,
    comments: 0,
    createdAt: Date.now(),
    score: 0,
    velocity: 0,
    topicFit: 1,
    matchedTopics: [],
  };

  log.info("drafting a quote post", { tweetId });

  const drafted = await draft(candidate);
  const verdict = await gate(drafted, candidate);

  if (!verdict.approved) {
    console.error("\nGate rejected the draft:");
    for (const r of verdict.reasons) console.error("  -", r);
    console.error("\nNothing published.");
    process.exit(1);
  }

  const text = verdict.revised ?? drafted.post;
  console.log("\n--- the quote post ---");
  console.log(text);
  console.log("--- quoting ---");
  console.log(url, "\n");

  if (config.dryRun) {
    console.log("DRY_RUN set — not published.");
    return;
  }

  const queued = await createPost(text, { quoteTweetId: tweetId });
  console.log("queued in Buffer:", queued.id, queued.dueAt ? `for ${queued.dueAt}` : "(next slot)");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
