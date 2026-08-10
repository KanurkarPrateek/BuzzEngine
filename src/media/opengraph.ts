import { getText, request, userAgent } from "../util/http.ts";
import { log } from "../util/log.ts";

export type ImageAsset = {
  bytes: Buffer;
  contentType: string;
  sourceUrl: string;
  origin: "opengraph" | "screenshot";
};

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * Nearly every article, repo, and product page publishes an og:image — it is
 * the same asset X would render in its link card, available for one cheap GET
 * and no headless browser.
 */
export async function fetchOpenGraphImage(
  pageUrl: string,
  maxBytes: number,
): Promise<ImageAsset | undefined> {
  let html: string;
  try {
    html = await getText(pageUrl, {
      headers: { accept: "text/html" },
      timeoutMs: 15_000,
      escalateIfBlocked: true,
    });
  } catch (err) {
    log.warn("og: page fetch failed", { pageUrl, err: String(err) });
    return undefined;
  }

  const imageUrl = extractImageUrl(html, pageUrl);
  if (!imageUrl) {
    log.info("og: no image declared", { pageUrl });
    return undefined;
  }

  return downloadImage(imageUrl, maxBytes, "opengraph");
}

/** Meta tags appear in either attribute order, so match each tag then read its parts. */
function extractImageUrl(html: string, pageUrl: string): string | undefined {
  const head = html.slice(0, 200_000);
  const candidates: string[] = [];

  for (const tag of head.match(/<meta\s[^>]*>/gi) ?? []) {
    const name = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (!name) continue;
    if (name !== "og:image" && name !== "og:image:url" && name !== "twitter:image") continue;

    const content = tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1];
    if (content) candidates.push(decodeEntities(content));
  }

  for (const candidate of candidates) {
    try {
      // og:image is often a relative or protocol-relative path.
      return new URL(candidate, pageUrl).toString();
    } catch {
      continue;
    }
  }
  return undefined;
}

export async function downloadImage(
  imageUrl: string,
  maxBytes: number,
  origin: ImageAsset["origin"],
): Promise<ImageAsset | undefined> {
  try {
    const res = await request(imageUrl, {
      headers: { "user-agent": userAgent(), accept: "image/*" },
      timeoutMs: 20_000,
    });
    if (!res.ok) {
      log.warn("image download failed", { imageUrl, status: res.status });
      return undefined;
    }

    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_TYPES.has(contentType)) {
      log.warn("image rejected: unsupported type", { imageUrl, contentType });
      return undefined;
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0) {
      log.warn("image rejected: empty body", { imageUrl });
      return undefined;
    }
    if (bytes.length > maxBytes) {
      // No image beats a rejected upload or a mangled resize; skip and post text.
      log.warn("image rejected: too large", { imageUrl, bytes: bytes.length, maxBytes });
      return undefined;
    }

    log.info("image ready", { origin, contentType, kb: Math.round(bytes.length / 1024) });
    return { bytes, contentType, sourceUrl: imageUrl, origin };
  } catch (err) {
    log.warn("image download errored", { imageUrl, err: String(err) });
    return undefined;
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&#38;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
