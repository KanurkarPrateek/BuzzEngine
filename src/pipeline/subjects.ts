import type { Candidate } from "../types.ts";

/**
 * Derives what a post is *about*, so the account doesn't cover the same thing
 * twice in a week.
 *
 * URL dedupe only catches the identical story. This catches "another repo from
 * the same org", "a second Docker announcement", "the same product covered by
 * two outlets" — the repetitions a reader actually notices.
 */

/**
 * Hosts that carry other people's subjects rather than being one. Blocking
 * `github.com` would block every repository, so these are never site keys.
 */
const AGGREGATORS = new Set([
  "github.com",
  "gitlab.com",
  "news.ycombinator.com",
  "reddit.com",
  "x.com",
  "twitter.com",
  "medium.com",
  "substack.com",
  "youtube.com",
  "arxiv.org",
]);

export function subjectsOf(candidate: Candidate): string[] {
  const subjects = new Set<string>();

  for (const raw of [candidate.url, candidate.discussionUrl]) {
    if (!raw) continue;
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }

    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const parts = u.pathname.split("/").filter(Boolean);

    if (host === "github.com" || host === "gitlab.com") {
      if (parts.length >= 2) {
        subjects.add(`repo:${parts[0].toLowerCase()}/${parts[1].toLowerCase()}`);
        // Also block the org: three repos from one lab in a week reads as a
        // sponsored account, even though each repo is a different story.
        subjects.add(`org:${parts[0].toLowerCase()}`);
      }
      continue;
    }

    if (AGGREGATORS.has(host)) continue;

    // Everything else is identified by its registrable domain: two posts about
    // docker.com in a week are two posts about Docker, whatever the headline.
    subjects.add(`site:${registrableDomain(host)}`);
  }

  return [...subjects];
}

/** Crude but adequate: strips subdomains down to the last two labels. */
function registrableDomain(host: string): string {
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  // Handle the common two-part public suffixes without a full PSL dependency.
  const tail = labels.slice(-2).join(".");
  if (/^(co|com|org|net|gov|ac)\.[a-z]{2}$/.test(tail)) return labels.slice(-3).join(".");
  return tail;
}
