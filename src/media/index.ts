import { config } from "../config.ts";
import { log } from "../util/log.ts";
import { downloadImage, fetchOpenGraphImage } from "./opengraph.ts";
import type { ImageAsset } from "./opengraph.ts";

export type { ImageAsset } from "./opengraph.ts";

/**
 * Decides whether this post should carry an image, and produces one.
 *
 * The important subtlety: X gives attached media precedence over the link
 * card. When the source URL is in the main post, X already renders the page's
 * og:image as a card for free — attaching that same image *replaces* the card
 * and loses the headline and domain chrome. So og-mode deliberately declines
 * in that situation rather than trading down.
 */
export async function selectImage(pageUrl: string): Promise<ImageAsset | undefined> {
  const { mode, maxBytes, screenshotUrlTemplate } = config.media;
  if (mode === "off") return undefined;

  const linkIsInMainPost = config.editorial.linkMode === "main";

  if (mode === "screenshot" || mode === "auto") {
    const shot = await fetchScreenshot(pageUrl, maxBytes, screenshotUrlTemplate);
    // A screenshot is genuinely different from the card, so it's worth
    // overriding the card even when the link is in the main post.
    if (shot) return shot;
    if (mode === "screenshot") return undefined;
  }

  if (linkIsInMainPost) {
    log.info("media: skipping og image — X already renders it as a link card", { pageUrl });
    return undefined;
  }

  return fetchOpenGraphImage(pageUrl, maxBytes);
}

/**
 * Renders the page via an external screenshot service so no headless browser
 * ships in this image. Any service that returns raw image bytes for a GET
 * works — browserless, a Cloud Run shim, urlbox, etc.
 */
async function fetchScreenshot(
  pageUrl: string,
  maxBytes: number,
  template: string | undefined,
): Promise<ImageAsset | undefined> {
  if (!template) {
    log.warn("media: screenshot mode requested but SCREENSHOT_URL_TEMPLATE is unset");
    return undefined;
  }
  const endpoint = template.replace("{url}", encodeURIComponent(pageUrl));
  return downloadImage(endpoint, maxBytes, "screenshot");
}
