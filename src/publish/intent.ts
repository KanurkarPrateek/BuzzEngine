import { config } from "../config.ts";

/**
 * Builds an X Web Intent URL — X's own official share mechanism.
 *
 * Opening it presents the post composer with the text pre-filled; the human
 * taps Post. Nothing is published without that tap, so this path needs no API
 * credentials, costs nothing, and raises none of the automation questions that
 * posting through the API or a session cookie does.
 *
 * Limitation: intents carry text only. Images cannot be pre-attached, so
 * MEDIA_MODE has no effect on this path.
 */
export function buildIntentUrl(text: string, sourceUrl: string): string {
  const body = config.editorial.linkMode === "main" ? `${text}\n\n${sourceUrl}` : text;
  // encodeURIComponent leaves !'()* alone, which X's parser can mishandle.
  const encoded = encodeURIComponent(body).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `https://x.com/intent/post?text=${encoded}`;
}
