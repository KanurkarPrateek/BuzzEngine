import { config } from "../config.ts";
import { fetchGitHubTrending } from "../sources/github.ts";
import { fetchHackerNews } from "../sources/hn.ts";
import { fetchReddit } from "../sources/reddit.ts";
import { fetchXBuzz } from "../sources/xsearch.ts";
import { log } from "../util/log.ts";
import type { Candidate } from "../types.ts";

const FETCHERS: Record<string, () => Promise<Candidate[]>> = {
  hn: fetchHackerNews,
  github: fetchGitHubTrending,
  reddit: fetchReddit,
  x: fetchXBuzz,
};

/**
 * Fan out across every enabled source. A source that fails contributes zero
 * candidates rather than aborting the run — losing one signal is survivable,
 * losing the whole cycle is not.
 */
export async function collect(): Promise<Candidate[]> {
  const enabled = config.sources.enabled.filter((name) => name in FETCHERS);
  if (enabled.length === 0) throw new Error("No valid sources enabled. Check SOURCES.");

  const results = await Promise.allSettled(enabled.map((name) => FETCHERS[name]()));

  const candidates: Candidate[] = [];
  const failed: string[] = [];

  results.forEach((result, i) => {
    if (result.status === "fulfilled") candidates.push(...result.value);
    else {
      failed.push(enabled[i]);
      log.error("source failed", { source: enabled[i], err: String(result.reason) });
    }
  });

  log.info("collect complete", {
    total: candidates.length,
    sources: enabled.length - failed.length,
    failed,
  });

  return candidates;
}
