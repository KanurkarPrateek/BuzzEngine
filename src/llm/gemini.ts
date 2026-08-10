import { request } from "../util/http.ts";
import { jsonInstruction } from "./json.ts";
import type { CompleteRequest, CompleteResponse, LlmClient } from "./types.ts";

type GenerateContentResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

export type GeminiOptions = {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs: number;
  nativeJson: boolean;
};

export function createGeminiClient(opts: GeminiOptions): LlmClient {
  const baseUrl = (opts.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(
    /\/+$/,
    "",
  );

  return {
    name: "gemini",
    model: opts.model,

    async complete(req: CompleteRequest): Promise<CompleteResponse> {
      const system = req.jsonSchema
        ? `${req.system}\n\n${jsonInstruction(req.jsonSchema)}`
        : req.system;

      const generationConfig: Record<string, unknown> = {
        maxOutputTokens: req.maxTokens ?? 2000,
      };
      if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
      if (req.jsonSchema && opts.nativeJson) generationConfig.responseMimeType = "application/json";

      const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: req.messages.map((m) => ({
          // Gemini calls the assistant role "model".
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        generationConfig,
      };

      const url = `${baseUrl}/models/${encodeURIComponent(opts.model)}:generateContent`;
      const res = await request(url, {
        method: "POST",
        timeoutMs: opts.timeoutMs,
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": opts.apiKey,
        },
        body: JSON.stringify(body),
      });

      const text = await res.text();
      if (!res.ok) throw new Error(`gemini ${res.status}: ${text.slice(0, 500)}`);

      const parsed = JSON.parse(text) as GenerateContentResponse;
      const candidate = parsed.candidates?.[0];
      if (!candidate) throw new Error("gemini returned no candidates");

      const out = (candidate.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("");

      return {
        text: out,
        model: opts.model,
        inputTokens: parsed.usageMetadata?.promptTokenCount,
        outputTokens: parsed.usageMetadata?.candidatesTokenCount,
      };
    },
  };
}
