import { getText } from "../util/http.ts";
import { log } from "../util/log.ts";

/**
 * Collects public image URLs from a page.
 *
 * Buffer attaches images by URL rather than by upload, so unlike the X API
 * path there is nothing to download — we just need addresses Buffer's servers
 * can reach. That also means a locally-hosted screenshot service will not work
 * here: the URL has to be publicly resolvable.
 */
export type PageImages = {
  /** og:image / twitter:image — exactly what X renders in its own link card. */
  social: string[];
  /** Images from the page body: screenshots, diagrams, photos. Additive. */
  content: string[];
};

/**
 * Picks images worth attaching, given that X already renders a link card.
 *
 * When the post carries its link, X shows the page's og:image for free with
 * the headline and domain attached. Uploading that same image *replaces* that
 * card with a bare picture — strictly worse. So a social image is only used
 * when no card will appear; otherwise we look for a genuinely different image
 * (a screenshot, a diagram) and attach nothing if there isn't one.
 */
export async function selectAttachableImages(
  pageUrl: string,
  max: number,
  linkRendersCard: boolean,
): Promise<string[]> {
  const { social, content } = await resolvePageImages(pageUrl, max + 4);

  if (!linkRendersCard) {
    // No card will render, so the social image is the best thing available.
    return [...social, ...content].slice(0, max);
  }

  // A card is coming. Only attach images the card would not already show.
  const socialSet = new Set(social);
  const distinct = content.filter((url) => !socialSet.has(url) && isWorthAttaching(url));

  if (distinct.length === 0) {
    log.info("media: nothing to add beyond X's own link card", { pageUrl });
    return [];
  }

  // Document order puts page furniture first, so rank before slicing.
  distinct.sort((a, b) => imageScore(b) - imageScore(a));
  return distinct.slice(0, max);
}

/** Page furniture: logos, backgrounds, avatars, icons, spacers, tracking pixels. */
const JUNK = /logo|icon|avatar|sprite|spacer|pixel|badge|background|\bbg[-_]|[-_]bgs?[-_.]|banner|header|footer|favicon|placeholder/i;

function isWorthAttaching(url: string): boolean {
  return !JUNK.test(url);
}

/**
 * Prefers images that look like real content. Dimensions in the filename are
 * the most reliable signal available without downloading anything: a
 * 2320x1205 screenshot is content, a 1110x326 strip is a page banner.
 */
function imageScore(url: string): number {
  let score = 0;

  const dims = url.match(/(\d{3,4})\s*[x×]\s*(\d{3,4})/);
  if (dims) {
    const w = Number(dims[1]);
    const h = Number(dims[2]);
    const ratio = w / h;
    if (w >= 1000) score += 3;
    if (w >= 1600) score += 2;
    // Very wide, short images are almost always decorative strips.
    if (ratio > 3) score -= 4;
    if (ratio >= 1.2 && ratio <= 2.2) score += 2; // typical screenshot shape
  }

  if (/screenshot|screen|demo|diagram|chart|preview|product/i.test(url)) score += 3;
  // Deep paths tend to be article assets; shallow ones tend to be theme assets.
  if (/\/(uploads|assets|media|images)\/\d{4}\//.test(url)) score += 1;

  return score;
}

async function resolvePageImages(pageUrl: string, max: number): Promise<PageImages> {
  let html: string;
  try {
    html = await getText(pageUrl, {
      headers: { accept: "text/html" },
      timeoutMs: 15_000,
      escalateIfBlocked: true,
    });
  } catch (err) {
    log.warn("image urls: page fetch failed", { pageUrl, err: String(err) });
    return { social: [], content: [] };
  }

  const social: string[] = [];
  const content: string[] = [];
  const seen = new Set<string>();

  const absolute = (raw: string): string | undefined => {
    try {
      return new URL(decodeEntities(raw), pageUrl).toString();
    } catch {
      return undefined;
    }
  };

  // Social-card images: exactly what X would render on its own.
  for (const tag of html.slice(0, 200_000).match(/<meta\s[^>]*>/gi) ?? []) {
    const name = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (!name) continue;
    if (name !== "og:image" && name !== "og:image:url" && name !== "twitter:image") continue;
    const raw = tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1];
    const abs = raw ? absolute(raw) : undefined;
    // A publisher-declared social image is an image by definition, even with
    // no file extension (GitHub's card CDN, Cloudinary, image proxies).
    if (abs && !seen.has(abs)) {
      seen.add(abs);
      social.push(abs);
    }
  }

  // Body images: only these can add anything a link card does not already show.
  for (const tag of html.match(/<img\s[^>]*>/gi) ?? []) {
    if (content.length >= max) break;
    const raw = tag.match(/\ssrc\s*=\s*["']([^"']+)["']/i)?.[1];
    const abs = raw ? absolute(raw) : undefined;
    if (!abs || seen.has(abs) || !looksLikeImage(abs)) continue;
    seen.add(abs);
    content.push(abs);
  }

  log.info("page images resolved", { pageUrl, social: social.length, content: content.length });
  return { social, content };
}

/** X accepts jpeg/png/webp/gif; anything else would be rejected downstream. */
function looksLikeImage(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (/\.(jpe?g|png|webp|gif)$/.test(path)) return true;
    // Many CDNs serve images from extensionless paths; accept those but skip
    // the obvious non-images so we don't hand Buffer a tracking pixel.
    if (/\.(svg|ico|css|js|json|xml|woff2?|ttf)$/.test(path)) return false;
    return /image|photo|media|cdn|img/.test(url);
  } catch {
    return false;
  }
}

function decodeEntities(text: string): string {
  return text.replace(/&amp;/g, "&").replace(/&#38;/g, "&").replace(/&quot;/g, '"');
}
