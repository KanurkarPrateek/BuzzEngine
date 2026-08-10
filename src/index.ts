import { config } from "./config.ts";
import { selectImage } from "./media/index.ts";
import { getNotifier } from "./notify/index.ts";
import { createPost } from "./publish/buffer.ts";
import { buildIntentUrl } from "./publish/intent.ts";
import { collect } from "./pipeline/collect.ts";
import { dedupe } from "./pipeline/dedupe.ts";
import { draft } from "./pipeline/draft.ts";
import { enrich } from "./pipeline/enrich.ts";
import { gate } from "./pipeline/gate.ts";
import { publish } from "./pipeline/post.ts";
import { score } from "./pipeline/score.ts";
import {
  appendHistory,
  ensureStateDir,
  isPaused,
  readHistory,
  recordSeen,
} from "./state/store.ts";
import { canonicalUrl } from "./util/text.ts";
import { log } from "./util/log.ts";
import { sleep } from "./util/http.ts";
import type { HistoryEntry } from "./types.ts";

type RunOutcome = "posted" | "skipped" | "paused" | "rate-limited" | "no-candidates";

/** Returns false with a logged reason when posting now would break a cadence rule. */
function cadenceAllows(): boolean {
  const history = readHistory().filter((h) => !h.dryRun);

  const dayAgo = Date.now() - 86_400_000;
  const today = history.filter((h) => Date.parse(h.at) >= dayAgo);
  if (today.length >= config.limits.maxPostsPerDay) {
    log.info("cadence: daily cap reached", {
      posts: today.length,
      cap: config.limits.maxPostsPerDay,
    });
    return false;
  }

  const last = history.at(-1);
  if (last) {
    const minutesSince = (Date.now() - Date.parse(last.at)) / 60_000;
    if (minutesSince < config.limits.minMinutesBetweenPosts) {
      log.info("cadence: too soon since last post", {
        minutesSince: Math.round(minutesSince),
        required: config.limits.minMinutesBetweenPosts,
      });
      return false;
    }
  }

  return true;
}

export async function runOnce(): Promise<RunOutcome> {
  ensureStateDir();

  if (isPaused()) {
    log.warn("paused: remove the PAUSED file in the state directory to resume");
    return "paused";
  }
  if (!config.dryRun && !cadenceAllows()) return "rate-limited";

  const candidates = await collect();
  const fresh = dedupe(candidates);
  const ranked = score(fresh);

  if (ranked.length === 0) {
    log.info("nothing worth posting this cycle");
    return "no-candidates";
  }

  // Walk down the ranking: the top story may draft badly or fail the gate, and
  // the second-best story is usually still worth posting.
  const attempts = Math.min(config.limits.draftAttempts, ranked.length);

  for (let i = 0; i < attempts; i++) {
    const candidate = ranked[i];
    log.info("attempting candidate", {
      rank: i + 1,
      id: candidate.id,
      title: candidate.title.slice(0, 80),
      score: Number(candidate.score.toFixed(3)),
    });

    let text: string;
    try {
      // RESEARCH: pull the primary source so the writer has real material to
      // ground an insight in, and the gate has real material to check it against.
      const researched = config.editorial.research ? await enrich(candidate) : candidate;

      const drafted = await draft(researched);
      const verdict = await gate(drafted, researched);

      if (!verdict.approved) {
        // Burn the candidate so the next cycle doesn't retry the same dead end.
        markSeen(candidate.id, candidate.title, candidate.url);
        continue;
      }
      text = verdict.revised ?? drafted.post;
    } catch (err) {
      log.error("draft/gate failed for candidate", { id: candidate.id, err: String(err) });
      continue;
    }

    const entry: HistoryEntry = {
      at: new Date().toISOString(),
      candidateId: candidate.id,
      source: candidate.source,
      title: candidate.title,
      url: candidate.url,
      score: candidate.score,
      post: text,
      dryRun: config.dryRun,
    };

    // Alt text can only honestly describe where the image came from — we never
    // see its contents — so it names the page rather than inventing a caption.
    const altText = `Preview image for "${candidate.title}" (${hostOf(candidate.url)})`;

    if (config.dryRun) {
      // Media only applies to the API path — an intent URL cannot carry an image.
      const image =
        config.publishMode === "api"
          ? await selectImage(candidate.url).catch(() => undefined)
          : undefined;

      entry.intentUrl = buildIntentUrl(text, candidate.url);
      log.info("DRY RUN — would post", {
        text,
        url: candidate.url,
        media: image ? `${image.origin} (${Math.round(image.bytes.length / 1024)}KB)` : "none",
        intentUrl: config.publishMode === "notify" ? entry.intentUrl : undefined,
      });
      appendHistory(entry);
      markSeen(candidate.id, candidate.title, candidate.url);
      return "posted";
    }

    if (config.publishMode === "buffer") {
      // Buffer publishes to X on our behalf, so no X credentials are involved
      // and the link carries no surcharge.
      const queued = await createPost(
        config.editorial.linkMode === "main" ? `${text}\n\n${candidate.url}` : text,
      );

      entry.bufferPostId = queued.id;
      appendHistory(entry);
      markSeen(candidate.id, candidate.title, candidate.url);

      log.info("done — queued in Buffer", { postId: queued.id, dueAt: queued.dueAt ?? "next slot" });
      return "posted";
    }

    if (config.publishMode === "notify") {
      // Nothing is published here — the post is delivered for a human tap.
      const intentUrl = buildIntentUrl(text, candidate.url);
      await getNotifier().send({
        post: text,
        intentUrl,
        sourceUrl: candidate.url,
        sourceTitle: candidate.title,
        origin: `${candidate.source} · score ${candidate.score.toFixed(2)}`,
      });

      entry.intentUrl = intentUrl;
      appendHistory(entry);
      markSeen(candidate.id, candidate.title, candidate.url);

      log.info("done — sent for review", { channel: config.notify.channel });
      return "posted";
    }

    const result = await publish(text, candidate.url, altText);
    entry.tweetId = result.tweetId;
    appendHistory(entry);
    markSeen(candidate.id, candidate.title, candidate.url);

    log.info("done", { url: `https://x.com/i/status/${result.tweetId}` });
    return "posted";
  }

  log.info("no candidate cleared the gate this cycle", { attempts });
  return "skipped";
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

function markSeen(candidateId: string, title: string, url: string): void {
  recordSeen({ candidateId, title, urlKey: canonicalUrl(url), at: Date.now() });
}

async function main(): Promise<void> {
  log.info("buzzengine starting", {
    dryRun: config.dryRun,
    stateDir: config.stateDir,
    sources: config.sources.enabled,
    provider: config.llm.provider,
    publishMode: config.publishMode,
    mode: config.schedule ? "daemon" : "one-shot",
  });

  if (!config.schedule) {
    const outcome = await runOnce();
    log.info("run complete", { outcome });
    return;
  }

  // Daemon mode for environments without an external scheduler (a plain
  // container, a Deployment, a systemd unit). Kubernetes CronJob users should
  // leave SCHEDULE unset and let the cluster do the scheduling.
  const intervalMs = config.scheduleIntervalMinutes * 60_000;
  let running = true;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      log.info("shutdown signal received", { signal });
      running = false;
      // Don't wait out the sleep if we're mid-interval.
      process.exit(0);
    });
  }

  while (running) {
    try {
      const outcome = await runOnce();
      log.info("run complete", { outcome });
    } catch (err) {
      log.error("run failed", { err: String(err) });
    }
    log.info("sleeping", { minutes: config.scheduleIntervalMinutes });
    await sleep(intervalMs);
  }
}

main().catch((err) => {
  log.error("fatal", { err: err instanceof Error ? err.stack : String(err) });
  process.exit(1);
});
