import { config } from "../config.ts";
import { selectImage } from "../media/index.ts";
import { request } from "../util/http.ts";
import { log } from "../util/log.ts";
import { getAccessToken } from "../x/auth.ts";
import { setAltText, uploadImage } from "../x/media.ts";

export type PostResult = {
  tweetId: string;
  replyTweetId?: string;
  text: string;
  mediaId?: string;
};

type CreateTweetResponse = {
  data?: { id?: string; text?: string };
  errors?: Array<{ message?: string; detail?: string }>;
  detail?: string;
  title?: string;
};

/**
 * Publishes the post. With INCLUDE_LINK_IN_POST=true the source URL is appended
 * to the main post; with it false the link goes out as a self-reply instead,
 * which is markedly cheaper under X's per-post-with-link pricing.
 */
export async function publish(
  text: string,
  sourceUrl: string,
  altText?: string,
): Promise<PostResult> {
  const accessToken = await getAccessToken();

  // Media is a nice-to-have: if anything about it fails, publish the text
  // rather than losing the post entirely.
  let mediaId: string | undefined;
  try {
    const image = await selectImage(sourceUrl);
    if (image) {
      mediaId = await uploadImage(image, accessToken);
      if (config.media.altText && altText) await setAltText(mediaId, altText, accessToken);
    }
  } catch (err) {
    log.warn("media step failed, posting without an image", { err: String(err) });
    mediaId = undefined;
  }

  const { linkMode } = config.editorial;
  const mainText = linkMode === "main" ? `${text}\n\n${sourceUrl}` : text;
  const main = await createTweet(mainText, accessToken, undefined, mediaId);

  let replyTweetId: string | undefined;
  if (linkMode === "reply") {
    try {
      const reply = await createTweet(sourceUrl, accessToken, main.id);
      replyTweetId = reply.id;
    } catch (err) {
      // The post itself is already live; a failed link reply is not worth
      // failing the whole run over.
      log.warn("link reply failed; main post is published", { err: String(err) });
    }
  }

  log.info("published", { tweetId: main.id, replyTweetId, mediaId });
  return { tweetId: main.id, replyTweetId, text: mainText, mediaId };
}

async function createTweet(
  text: string,
  accessToken: string,
  replyToId?: string,
  mediaId?: string,
): Promise<{ id: string }> {
  const body: Record<string, unknown> = { text };
  if (replyToId) body.reply = { in_reply_to_tweet_id: replyToId };
  if (mediaId) body.media = { media_ids: [mediaId] };

  const res = await request("https://api.x.com/2/tweets", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    // Never retry a 4xx here: a duplicate-content rejection or a bad token
    // won't fix itself, and retrying a partially-applied write risks a double post.
    retryOn: (s) => s >= 500,
    retries: 1,
  });

  const raw = await res.text();
  const parsed = JSON.parse(raw) as CreateTweetResponse;

  if (!res.ok || !parsed.data?.id) {
    const detail =
      parsed.detail ??
      parsed.errors?.map((e) => e.detail ?? e.message).join("; ") ??
      raw.slice(0, 300);
    throw new Error(`X post failed (${res.status}): ${detail}`);
  }

  return { id: parsed.data.id };
}
