import { getText } from "../util/http.ts";
import { log } from "../util/log.ts";
import type { ScoredCandidate } from "../types.ts";

/**
 * The RESEARCH step: pull the actual primary source before writing.
 *
 * Without this the writer gets a headline and a one-line blurb, is asked to
 * say something the headline does not, and can only speculate — which the
 * editorial gate then correctly rejects as unsupported. Enrichment is what
 * makes "add a real insight" and "never assert unsupported facts" compatible
 * instead of contradictory.
 */
export async function enrich(candidate: ScoredCandidate): Promise<ScoredCandidate> {
  try {
    const body = candidate.source === "github"
      ? await fetchReadme(candidate)
      : await fetchArticleText(candidate.url);

    if (!body || body.length < 200) {
      log.info("enrich: no usable body", { id: candidate.id, chars: body?.length ?? 0 });
      return candidate;
    }

    log.info("enriched", { id: candidate.id, chars: body.length });
    return {
      ...candidate,
      summary: [candidate.summary, "", "PRIMARY SOURCE EXCERPT:", body]
        .filter(Boolean)
        .join("\n"),
    };
  } catch (err) {
    // Thin material is survivable — the gate will catch anything speculative
    // that results. A failed fetch must not drop the candidate.
    log.warn("enrich failed", { id: candidate.id, err: String(err) });
    return candidate;
  }
}

/**
 * Tuned against real runs: a ~3.8K excerpt produced a clean draft, while ~5K
 * sent a reasoning model into 18K characters of deliberation and blew the
 * token budget. More source text is not monotonically better.
 */
const MAX_BODY_CHARS = 3500;

/** GitHub's README is the primary source for a repo — far richer than the blurb. */
async function fetchReadme(candidate: ScoredCandidate): Promise<string | undefined> {
  const slug = candidate.id.replace(/^github:/, "");
  for (const name of ["README.md", "readme.md", "README.rst", "README"]) {
    try {
      const raw = await getText(`https://raw.githubusercontent.com/${slug}/HEAD/${name}`, {
        timeoutMs: 12_000,
        retries: 0,
      });
      return stripMarkdown(raw).slice(0, MAX_BODY_CHARS);
    } catch {
      continue;
    }
  }
  return undefined;
}

async function fetchArticleText(url: string): Promise<string | undefined> {
  // Text posts on HN/Reddit already carry their body in `summary`.
  if (/news\.ycombinator\.com|reddit\.com/.test(url)) return undefined;

  const html = await getText(url, {
    headers: { accept: "text/html" },
    timeoutMs: 15_000,
    retries: 1,
    escalateIfBlocked: true,
  });
  return extractReadableText(html).slice(0, MAX_BODY_CHARS);
}

function extractReadableText(html: string): string {
  let text = html;

  // Drop everything that is markup or chrome rather than prose.
  text = text.replace(/<(script|style|noscript|svg|nav|header|footer|form)[\s\S]*?<\/\1>/gi, " ");
  text = text.replace(/<!--[\s\S]*?-->/g, " ");

  // Keep paragraph and heading boundaries so the model sees structure.
  text = text.replace(/<\/(p|div|h[1-6]|li|section|article|tr)>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");

  return decodeEntities(text)
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .split("\n")
    // Drop nav fragments and one-word list items; keep real sentences.
    .filter((line) => line.trim().length > 40)
    .join("\n")
    .trim();
}

function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ") // fenced code adds noise, not meaning
    .replace(/<[^>]+>/g, " ") // README badges are raw HTML
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → their text
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/[*_`>]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&hellip;/g, "…");
}
