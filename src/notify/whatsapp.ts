import { request } from "../util/http.ts";
import { log } from "../util/log.ts";
import type { Notification, Notifier } from "./types.ts";

/**
 * Delivery via a self-hosted Simple-WhatsApp-API instance
 * (https://github.com/Codegres-com/Simple-Whatsapp-API), which wraps
 * whatsapp-web.js.
 *
 * Free — no Meta Cloud API billing, no message templates, no 24-hour window.
 * The tradeoff is that it is an unofficial client: it holds a real WhatsApp
 * Web session behind a Chromium instance, needs an occasional QR re-scan, and
 * must run as a long-lived service rather than inside a scheduled job.
 */
export type WhatsAppOptions = {
  baseUrl: string;
  apiKey: string;
  masterKey?: string;
  /** Recipient in international format without '+', e.g. 919876543210. */
  to: string;
};

export function createWhatsAppNotifier(opts: WhatsAppOptions): Notifier {
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");

  return {
    name: "whatsapp",

    async send(n: Notification): Promise<void> {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "X-API-KEY": opts.apiKey,
      };
      if (opts.masterKey) headers["X-MASTER-KEY"] = opts.masterKey;

      const res = await request(`${baseUrl}/api/send-message`, {
        method: "POST",
        headers,
        body: JSON.stringify({ to: opts.to, message: formatMessage(n) }),
        timeoutMs: 30_000,
        retryOn: (s) => s >= 500,
      });

      const raw = await res.text();
      if (!res.ok) {
        throw new Error(
          `whatsapp send failed (${res.status}): ${raw.slice(0, 300)}. ` +
            "Check the session is connected — it may need a QR re-scan.",
        );
      }

      log.info("notification sent", { via: "whatsapp" });
    },
  };
}

/**
 * Plain text: WhatsApp auto-links bare URLs, and the composer link has to
 * survive being tapped from a phone, so no markdown and no shortening.
 */
function formatMessage(n: Notification): string {
  return [
    n.sourceTitle,
    n.origin,
    "",
    "— — —",
    n.post,
    "— — —",
    "",
    "Tap to open X with this ready to post:",
    n.intentUrl,
    "",
    `Source: ${n.sourceUrl}`,
  ].join("\n");
}
