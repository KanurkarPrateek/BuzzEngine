import { config } from "../config.ts";
import { getText } from "../util/http.ts";
import { log } from "../util/log.ts";
import type { Candidate } from "../types.ts";

/**
 * GitHub has no official trending API, so this parses the public trending page.
 * The parse is deliberately forgiving: if GitHub reshuffles its markup the
 * source degrades to zero candidates instead of taking the run down.
 */
export async function fetchGitHubTrending(): Promise<Candidate[]> {
  let html: string;
  try {
    html = await getText("https://github.com/trending?since=daily", {
      headers: { accept: "text/html" },
      escalateIfBlocked: true,
    });
  } catch (err) {
    log.warn("github trending fetch failed", { err: String(err) });
    return [];
  }

  const candidates: Candidate[] = [];
  // Each repo lives in an <article class="Box-row"> block.
  const blocks = html.split('<article class="Box-row"');

  for (const block of blocks.slice(1)) {
    // The repo anchor carries a pile of analytics attributes before `href`, so
    // match the heading first and then pull the owner/name pair out of it.
    const heading = matchOne(block, /<h2[^>]*>([\s\S]*?)<\/h2>/);
    const slug = heading ? matchOne(heading, /href="\/([^"/]+\/[^"/?#]+)"/) : undefined;
    if (!slug) continue;

    const starsToday = parseCount(
      matchOne(block, /([\d,]+)\s+stars?\s+today/) ?? "0",
    );
    if (starsToday < config.sources.github.minStarsToday) continue;

    const description = matchOne(block, /<p class="col-9[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/p>/);
    const language = matchOne(block, /<span itemprop="programmingLanguage">\s*([^<]+)\s*<\/span>/);
    const totalStars = parseCount(
      matchOne(block, /stargazers"[^>]*>\s*([\d,]+)/) ?? "0",
    );

    candidates.push({
      id: `github:${slug}`,
      source: "github",
      title: slug,
      url: `https://github.com/${slug}`,
      summary: [description ? decodeHtml(description) : undefined, language ? `Language: ${language}` : undefined, totalStars ? `${totalStars} total stars` : undefined]
        .filter(Boolean)
        .join(" · "),
      engagement: starsToday,
      comments: 0,
      // Trending is a daily snapshot; treat it as fresh so velocity scoring is fair.
      createdAt: Date.now() - 12 * 3_600_000,
    });
  }

  log.info("github collected", { count: candidates.length });
  return candidates;
}

function matchOne(text: string, pattern: RegExp): string | undefined {
  const m = text.match(pattern);
  return m?.[1]?.trim();
}

function parseCount(raw: string): number {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function decodeHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
