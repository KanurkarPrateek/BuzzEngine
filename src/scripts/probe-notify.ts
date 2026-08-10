import { config } from "../config.ts";
import { getNotifier } from "../notify/index.ts";
import { buildIntentUrl } from "../publish/intent.ts";

/**
 * Sends one test message through the configured delivery channel, so you can
 * confirm the WhatsApp session is connected and — more importantly — tap the
 * composer link on your phone to check it opens X correctly.
 *
 *   npm run probe:notify
 */
async function main(): Promise<void> {
  const notifier = getNotifier();
  console.log(`Channel: ${notifier.name}`);
  console.log(`To:      ${config.notify.whatsapp.to || "(unset)"}`);

  const post =
    "Test post from x-agent. If you can tap the link below and land in the X composer " +
    "with this text already filled in, the whole pipeline works.";
  const sourceUrl = "https://github.com/Codegres-com/Simple-Whatsapp-API";

  await notifier.send({
    post,
    intentUrl: buildIntentUrl(post, sourceUrl),
    sourceUrl,
    sourceTitle: "x-agent connectivity test",
    origin: "probe · not a real story",
  });

  console.log("\nSent. Check your phone, then tap the composer link to verify it opens X.");
}

main().catch((err) => {
  console.error("\nDelivery failed:\n", err instanceof Error ? err.message : String(err));
  console.error(
    "\nCheck WHATSAPP_BASE_URL, WHATSAPP_API_KEY and WHATSAPP_TO, and that the " +
      "Simple-WhatsApp-API server is running with a connected session (it may need a QR re-scan).",
  );
  process.exit(1);
});
