import { config } from "../config.ts";
import { createWhatsAppNotifier } from "./whatsapp.ts";
import type { Notifier } from "./types.ts";

export type { Notification, Notifier } from "./types.ts";

/**
 * Delivery channel for review-and-tap publishing. The interface is deliberately
 * one method, so adding Telegram, Discord, or email later is a single file.
 */
export function getNotifier(): Notifier {
  const { channel, whatsapp } = config.notify;

  switch (channel) {
    case "whatsapp": {
      if (!whatsapp.baseUrl || !whatsapp.apiKey || !whatsapp.to) {
        throw new Error(
          "WhatsApp delivery needs WHATSAPP_BASE_URL, WHATSAPP_API_KEY and WHATSAPP_TO.",
        );
      }
      return createWhatsAppNotifier({
        baseUrl: whatsapp.baseUrl,
        apiKey: whatsapp.apiKey,
        masterKey: whatsapp.masterKey,
        to: whatsapp.to,
      });
    }
    default:
      throw new Error(`Unknown NOTIFY_CHANNEL "${channel}". Supported: "whatsapp".`);
  }
}
