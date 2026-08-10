import { config } from "../config.ts";
import { readSeen } from "../state/store.ts";
import { subjectsOf } from "./subjects.ts";
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

  // Subjects covered recently enough that repeating them would read as
  // repetition, mapped to when they were last used.
  const cooldownMs = config.limits.subjectCooldownDays * 86_400_000;
  const recentSubjects = new Map<string, number>();
  for (const entry of seen) {
    if (Date.now() - entry.at > cooldownMs) continue;
    for (const s of entry.subjects ?? []) {
      recentSubjects.set(s, Math.max(recentSubjects.get(s) ?? 0, entry.at));
    }
  }

  const keptUrls = new Set<string>();
  const keptTitles: string[] = [];
  const keptSubjects = new Set<string>();
  const out: Candidate[] = [];

  let droppedHistory = 0;
  let droppedBatch = 0;
  let droppedSubject = 0;

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

    // Same subject as something published recently — a different story about
    // the same repo, org, or company still reads as repeating yourself.
    const subjects = subjectsOf(candidate);
    const clash = subjects.find((s) => recentSubjects.has(s));
    if (clash) {
      droppedSubject++;
      continue;
    }
    // ...and only one candidate per subject within a single batch.
    if (subjects.some((s) => keptSubjects.has(s))) {
      droppedBatch++;
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
    for (const s of subjects) keptSubjects.add(s);
    out.push(candidate);
  }

  log.info("dedupe complete", { kept: out.length, droppedHistory, droppedBatch, droppedSubject });
  return out;
}
