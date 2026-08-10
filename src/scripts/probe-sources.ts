import { collect } from "../pipeline/collect.ts";
import { dedupe } from "../pipeline/dedupe.ts";
import { score } from "../pipeline/score.ts";
import { hoursSince } from "../util/text.ts";

/**
 * Runs collect → dedupe → score and prints the ranking. No LLM calls, no posting.
 * Use it to tune thresholds and topic lists before spending tokens.
 *
 *   npm run probe:sources
 */
async function main(): Promise<void> {
  const raw = await collect();
  const bySource = raw.reduce<Record<string, number>>((acc, c) => {
    acc[c.source] = (acc[c.source] ?? 0) + 1;
    return acc;
  }, {});

  console.log("\nRaw candidates by source:", bySource);

  const ranked = score(dedupe(raw));

  console.log(`\nTop ${Math.min(15, ranked.length)} after dedupe + scoring:\n`);
  for (const [i, c] of ranked.slice(0, 15).entries()) {
    console.log(
      `${String(i + 1).padStart(2)}. [${c.score.toFixed(3)}] ${c.source.padEnd(6)} ` +
        `${c.engagement} eng / ${c.comments} comments / ${hoursSince(c.createdAt).toFixed(1)}h old`,
    );
    console.log(`    ${c.title.slice(0, 110)}`);
    console.log(`    ${c.url}`);
    if (c.matchedTopics.length) console.log(`    topics: ${c.matchedTopics.join(", ")}`);
    console.log();
  }

  if (ranked.length === 0) {
    console.log("Nothing survived. Lower the per-source thresholds or widen TOPICS.");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
