import { request } from "../util/http.ts";
import { log } from "../util/log.ts";
import type { ImageAsset } from "../media/index.ts";

type UploadResponse = {
  data?: { id?: string; media_key?: string };
  media_id_string?: string;
  detail?: string;
  errors?: Array<{ message?: string; detail?: string }>;
};

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Uploads an image and returns its media id.
 *
 * Requires the `media.write` scope on the access token — an app authorized
 * before media support was added will get a 403 here even though posting text
 * works fine. Re-run `npm run authorize` in that case.
 */
export async function uploadImage(image: ImageAsset, accessToken: string): Promise<string> {
  const form = new FormData();
  const ext = EXTENSIONS[image.contentType] ?? "bin";
  form.append(
    "media",
    new Blob([new Uint8Array(image.bytes)], { type: image.contentType }),
    `image.${ext}`,
  );
  form.append("media_category", "tweet_image");

  const res = await request("https://api.x.com/2/media/upload", {
    method: "POST",
    // Let fetch set the multipart boundary; an explicit content-type breaks it.
    headers: { authorization: `Bearer ${accessToken}` },
    body: form,
    timeoutMs: 60_000,
    retryOn: (s) => s >= 500,
    retries: 1,
  });

  const raw = await res.text();
  const parsed = JSON.parse(raw) as UploadResponse;
  const mediaId = parsed.data?.id ?? parsed.media_id_string;

  if (!res.ok || !mediaId) {
    const detail =
      parsed.detail ?? parsed.errors?.map((e) => e.detail ?? e.message).join("; ") ?? raw.slice(0, 300);
    const hint =
      res.status === 403
        ? " (a 403 here usually means the token lacks the `media.write` scope — re-run `npm run authorize`)"
        : "";
    throw new Error(`X media upload failed (${res.status}): ${detail}${hint}`);
  }

  log.info("media uploaded", { mediaId, origin: image.origin });
  return mediaId;
}

/**
 * Attaches alt text. Best-effort: an image without alt text is worse for
 * screen-reader users but still a valid post, so a failure here must not
 * block publishing.
 */
export async function setAltText(
  mediaId: string,
  altText: string,
  accessToken: string,
): Promise<void> {
  try {
    const res = await request("https://api.x.com/2/media/metadata", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      // X caps alt text at 1000 characters.
      body: JSON.stringify({ id: mediaId, metadata: { alt_text: { text: altText.slice(0, 1000) } } }),
      timeoutMs: 20_000,
      retryOn: (s) => s >= 500,
      retries: 1,
    });

    if (!res.ok) {
      log.warn("alt text failed", { status: res.status, body: (await res.text()).slice(0, 200) });
    }
  } catch (err) {
    log.warn("alt text errored", { err: String(err) });
  }
}
