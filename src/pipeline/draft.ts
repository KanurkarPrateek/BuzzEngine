import { config } from "../config.ts";
import { completeJson } from "../llm/index.ts";
import { draftSystem } from "../prompts.ts";
import { readHistory } from "../state/store.ts";
import { log } from "../util/log.ts";
import { stripWrappingQuotes, tweetLength } from "../util/text.ts";
import { buildMaterial } from "./material.ts";
import type { Draft, ScoredCandidate } from "../types.ts";

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    angle: {
      type: "string",
      description:
        "Which angle you chose and what most people are missing. Write this BEFORE the post.",
    },
    post: { type: "string", description: "The post text, without any URL." },
    confidence: { type: "number", description: "0-1 self-assessment of post quality." },
  },
  // `angle` first so the model commits to a thesis before writing to it.
  required: ["angle", "post", "confidence"],
  additionalProperties: false,
};

export async function draft(candidate: ScoredCandidate): Promise<Draft> {
  const recent = readHistory().slice(-15).map((h) => h.post);

  const material = [
    buildMaterial(candidate),
    "",
    recent.length
      ? [
          `Your last ${recent.length} posts. Do not repeat their topic, opener, structure, or framing —`,
          "the account must stay varied in both subject and format:",
          recent.map((p) => `- ${p}`).join("\n"),
        ].join("\n")
      : "This is the account's first post.",
  ].join("\n");

  const result = await completeJson<Draft>({
    system: draftSystem(),
    messages: [{ role: "user", content: material }],
    maxTokens: config.llm.maxTokens,
    temperature: config.llm.temperature,
    jsonSchema: DRAFT_SCHEMA,
  });

  const post = stripWrappingQuotes(String(result.post ?? ""))
    .replace(/[ \t]+\n/g, "\n")
    .trim();

  log.info("drafted", {
    candidate: candidate.id,
    chars: tweetLength(post),
    confidence: result.confidence,
    angle: String(result.angle ?? "").slice(0, 90),
  });

  return {
    post,
    angle: String(result.angle ?? ""),
    confidence: Number(result.confidence ?? 0),
  };
}
