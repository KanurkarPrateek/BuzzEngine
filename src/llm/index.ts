import { config } from "../config.ts";
import { log } from "../util/log.ts";
import { createAnthropicClient } from "./anthropic.ts";
import { createGeminiClient } from "./gemini.ts";
import { createOpenAiClient } from "./openai.ts";
import { extractJson } from "./json.ts";
import type { CompleteRequest, LlmClient } from "./types.ts";

export type { LlmClient, CompleteRequest } from "./types.ts";

function nativeJsonDefault(provider: string): boolean {
  const override = process.env.LLM_NATIVE_JSON;
  if (override !== undefined && override !== "") {
    return override === "1" || override.toLowerCase() === "true";
  }
  // Anthropic's structured-output surface varies by model generation, and the
  // prompt-level contract works on every one, so leave it off there by default.
  return provider !== "anthropic";
}

let cached: LlmClient | undefined;

export function getLlm(): LlmClient {
  if (cached) return cached;

  const { provider, model, baseUrl, apiKey, timeoutMs } = config.llm;
  const nativeJson = nativeJsonDefault(provider);

  if (!apiKey && !baseUrl) {
    throw new Error(
      "No LLM credentials. Set LLM_API_KEY (or ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY), " +
        "or set LLM_BASE_URL if you're pointing at a local keyless server.",
    );
  }

  switch (provider) {
    case "anthropic":
      cached = createAnthropicClient({ apiKey, model, baseUrl, timeoutMs });
      break;
    case "openai":
      cached = createOpenAiClient({ apiKey, model, baseUrl, timeoutMs, nativeJson });
      break;
    case "gemini":
      cached = createGeminiClient({ apiKey, model, baseUrl, timeoutMs, nativeJson });
      break;
    default:
      throw new Error(
        `Unknown LLM_PROVIDER "${provider}". Use "anthropic", "openai" (any OpenAI-compatible endpoint), or "gemini".`,
      );
  }

  // Deliberately logs neither the model nor the endpoint: both identify a
  // private resource, and a log line is the easiest place for one to leak.
  log.info("llm ready", { provider: cached.name, nativeJson });
  return cached;
}

/**
 * Ask the model for a JSON object and parse it. Retries once on unparseable
 * output, feeding the failure back so the model can correct itself — weaker
 * and self-hosted models need this and stronger ones never hit it.
 */
export async function completeJson<T>(
  req: CompleteRequest & { jsonSchema: Record<string, unknown> },
): Promise<T> {
  const llm = getLlm();
  const first = await llm.complete(req);

  try {
    return extractJson(first.text) as T;
  } catch (err) {
    log.warn("llm returned unparseable JSON, retrying once", { err: String(err) });
  }

  const retry = await llm.complete({
    ...req,
    messages: [
      ...req.messages,
      { role: "assistant", content: first.text },
      {
        role: "user",
        content:
          "That was not valid JSON. Reply again with only the JSON object — no prose, no code fence.",
      },
    ],
  });

  return extractJson(retry.text) as T;
}
