import { config } from "../config.ts";
import { completeJson, getLlm } from "../llm/index.ts";

/**
 * Verifies the configured LLM can be reached and returns parseable JSON.
 * Run this first when swapping providers or pointing at a self-hosted model.
 *
 *   npm run probe:llm
 */
async function main(): Promise<void> {
  const llm = getLlm();
  console.log(`Provider: ${llm.name}`);
  // The model and endpoint are never printed — they identify a private resource.

  const result = await completeJson<{ ok: boolean; note: string }>({
    system: "You are a connectivity check. Answer briefly and honestly.",
    messages: [
      {
        role: "user",
        content:
          // Deliberately does not ask the model to identify itself — that would
          // print the model name straight back into stdout.
          'Reply with {"ok": true, "note": "connectivity verified"}.',
      },
    ],
    // Use the configured budget, not a token nub: reasoning models spend most
    // of it thinking before they write anything at all.
    maxTokens: config.llm.maxTokens,
    temperature: config.llm.temperature,
    jsonSchema: {
      type: "object",
      properties: { ok: { type: "boolean" }, note: { type: "string" } },
      required: ["ok", "note"],
      additionalProperties: false,
    },
  });

  console.log("Structured output round-trip succeeded:");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("\nLLM probe failed:\n", err instanceof Error ? err.message : String(err));
  console.error(
    "\nCheck LLM_PROVIDER, LLM_MODEL, LLM_API_KEY, and LLM_BASE_URL. " +
      "Note that some models reject LLM_TEMPERATURE entirely — try unsetting it.",
  );
  process.exit(1);
});
