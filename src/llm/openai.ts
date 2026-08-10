import { request } from "../util/http.ts";
import { jsonInstruction } from "./json.ts";
import type { CompleteRequest, CompleteResponse, LlmClient } from "./types.ts";

type ChatCompletion = {
  model?: string;
  choices: Array<{
    message?: {
      content?: string | null;
      /** Reasoning models (Kimi, DeepSeek-R1, ...) put their scratchpad here. */
      reasoning_content?: string | null;
    };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export type OpenAiOptions = {
  apiKey: string;
  model: string;
  /** Anything that speaks /chat/completions: OpenAI, Groq, OpenRouter, Together, vLLM, Ollama, LM Studio. */
  baseUrl?: string;
  timeoutMs: number;
  nativeJson: boolean;
};

export function createOpenAiClient(opts: OpenAiOptions): LlmClient {
  const baseUrl = (opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");

  return {
    name: "openai-compatible",
    model: opts.model,

    async complete(req: CompleteRequest): Promise<CompleteResponse> {
      const system = req.jsonSchema
        ? `${req.system}\n\n${jsonInstruction(req.jsonSchema)}`
        : req.system;

      const body: Record<string, unknown> = {
        model: opts.model,
        max_completion_tokens: req.maxTokens ?? 2000,
        messages: [
          { role: "system", content: system },
          ...req.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      };
      if (req.temperature !== undefined) body.temperature = req.temperature;
      // Some gateways reject response_format entirely; the prompt-level instruction
      // above is what actually guarantees parseable output, so this is opt-out safe.
      if (req.jsonSchema && opts.nativeJson) body.response_format = { type: "json_object" };

      const headers: Record<string, string> = { "content-type": "application/json" };
      if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;

      const res = await request(`${baseUrl}/chat/completions`, {
        method: "POST",
        timeoutMs: opts.timeoutMs,
        headers,
        body: JSON.stringify(body),
      });

      const text = await res.text();
      if (!res.ok) throw new Error(`openai-compatible ${res.status}: ${text.slice(0, 500)}`);

      const parsed = JSON.parse(text) as ChatCompletion;
      const choice = parsed.choices?.[0];
      const content = choice?.message?.content ?? "";

      // Reasoning models spend the token budget on `reasoning_content` first and
      // only then write the answer. If the budget runs out in between you get a
      // 200 with an empty `content`, which would otherwise surface as a baffling
      // "no JSON found" three call-layers up. Name the real cause instead.
      if (!content.trim() && choice?.finish_reason === "length") {
        const reasoned = choice.message?.reasoning_content?.length ?? 0;
        throw new Error(
          `${opts.model} hit the token limit while reasoning and produced no answer ` +
            `(${reasoned} chars of reasoning, ${parsed.usage?.completion_tokens ?? "?"} completion tokens). ` +
            "Raise LLM_MAX_TOKENS.",
        );
      }

      return {
        text: content,
        model: parsed.model ?? opts.model,
        inputTokens: parsed.usage?.prompt_tokens,
        outputTokens: parsed.usage?.completion_tokens,
      };
    },
  };
}
