import { config } from "../config.ts";
import { listChannels, resolveChannelId } from "../publish/buffer.ts";

/**
 * Verifies the Buffer key works and shows which channels are connected, so you
 * can confirm the X channel is found before the agent tries to publish.
 *
 *   npm run probe:buffer
 */
async function main(): Promise<void> {
  if (!config.buffer.apiKey) {
    console.error(
      "BUFFER_API_KEY is not set.\n" +
        "Generate one at https://publish.buffer.com/settings/api and add it to .env",
    );
    process.exit(1);
  }

  const channels = await listChannels();

  if (channels.length === 0) {
    console.log("No channels connected. Connect your X account at https://publish.buffer.com");
    return;
  }

  console.log("Connected channels:\n");
  for (const c of channels) {
    const isX = c.service === "twitter" || c.service === "x";
    console.log(`  ${isX ? "→" : " "} ${c.service.padEnd(12)} ${c.name.padEnd(24)} ${c.id}`);
  }

  const channelId = await resolveChannelId();
  console.log(`\nWill publish to channel: ${channelId}`);
  console.log(
    config.buffer.channelId
      ? "(from BUFFER_CHANNEL_ID)"
      : "(auto-resolved — pin it as BUFFER_CHANNEL_ID to skip this lookup each run)",
  );
}

main().catch((err) => {
  console.error("\nBuffer probe failed:\n", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
