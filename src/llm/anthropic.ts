import { request } from "../util/http.ts";
import { jsonInstruction } from "./json.ts";
import type { CompleteRequest, CompleteResponse, LlmClient } from "./types.ts";

type AnthropicResponse = {
  model: string;
  stop_reason: string | null;
  content: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

export type AnthropicOptions = {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs: number;
};

export function createAnthropicClient(opts: AnthropicOptions): LlmClient {
  const baseUrl = (opts.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "");

  return {
    name: "anthropic",
    model: opts.model,

    async complete(req: CompleteRequest): Promise<CompleteResponse> {
      const system = req.jsonSchema
        ? `${req.system}\n\n${jsonInstruction(req.jsonSchema)}`
        : req.system;

      const body: Record<string, unknown> = {
        model: opts.model,
        max_tokens: req.maxTokens ?? 2000,
        system,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      };
      // Newer Claude models reject sampling parameters outright, so only send one
      // when the operator has explicitly asked for it.
      if (req.temperature !== undefined) body.temperature = req.temperature;

      const res = await request(`${baseUrl}/v1/messages`, {
        method: "POST",
        timeoutMs: opts.timeoutMs,
        headers: {
          "content-type": "application/json",
          "x-api-key": opts.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });

      const text = await res.text();
      if (!res.ok) throw new Error(`anthropic ${res.status}: ${text.slice(0, 500)}`);

      const parsed = JSON.parse(text) as AnthropicResponse;
      if (parsed.stop_reason === "refusal") {
        throw new Error("anthropic declined the request (stop_reason: refusal)");
      }

      const out = parsed.content
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("");

      return {
        text: out,
        model: parsed.model ?? opts.model,
        inputTokens: parsed.usage?.input_tokens,
        outputTokens: parsed.usage?.output_tokens,
      };
    },
  };
}
