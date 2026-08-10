import { config } from "../config.ts";
import { completeJson } from "../llm/index.ts";
import { AI_TELLS, gateSystem } from "../prompts.ts";
import { readHistory } from "../state/store.ts";
import { log } from "../util/log.ts";
import { stripWrappingQuotes, titleSimilarity, tweetLength } from "../util/text.ts";
import { buildMaterial } from "./material.ts";
import type { Draft, QualityScores, ScoredCandidate, Verdict } from "../types.ts";

const SCORE_FIELDS: Array<keyof QualityScores> = [
  "understandable",
  "funny",
  "interesting",
  "concise",
  "human",
  "accurate",
  "memorable",
];

const GATE_SCHEMA = {
  type: "object",
  properties: {
    scores: {
      type: "object",
      properties: Object.fromEntries(
        SCORE_FIELDS.map((f) => [f, { type: "number", description: "1-10" }]),
      ),
      required: SCORE_FIELDS,
      additionalProperties: false,
    },
    approved: { type: "boolean" },
    reasons: { type: "array", items: { type: "string" } },
    revised: {
      type: "string",
      description: "Optional corrected post. Omit if no change is needed.",
    },
  },
  // Scores first: forcing the rubric before the verdict stops the model
  // rationalising a decision it has already made.
  required: ["scores", "approved", "reasons"],
  additionalProperties: false,
};

/**
 * Three layers, cheapest first. Hard rules are deterministic and free; only
 * drafts that survive them cost a model call. Anything that fails is dropped
 * rather than patched — publishing nothing is always an acceptable outcome.
 */
export async function gate(draft: Draft, candidate: ScoredCandidate): Promise<Verdict> {
  const hard = applyHardRules(draft);

  // Fatal problems are cheap to detect and not worth a model call. Fixable ones
  // (almost always "a few characters too long") are exactly what the editor's
  // revision path is for — binning an otherwise good post over 4 characters
  // was throwing away most of the pipeline's output.
  if (hard.fatal.length > 0) {
    log.info("gate rejected (hard rules)", { reasons: hard.fatal });
    return { approved: false, reasons: hard.fatal };
  }
  if (hard.fixable.length > 0) {
    log.info("gate: fixable issues, asking the editor to revise", { reasons: hard.fixable });
  }

  // Deterministic dedupe only catches the *same* story. Two different repos
  // making the same point, or the same joke told about a new subject, need
  // judgement — so the editor sees what was recently published and rules on it.
  const recent = readHistory().slice(-10);
  const recentBlock = recent.length
    ? [
        "",
        "RECENTLY PUBLISHED (most recent last) — the account must not repeat itself:",
        ...recent.map((h) => `- [${h.title.slice(0, 60)}] ${h.post.replace(/\n+/g, " / ")}`),
      ].join("\n")
    : "";

  const material = [
    "SOURCE MATERIAL (this is exactly what the writer was given — judge accuracy against it):",
    buildMaterial(candidate),
    "",
    "DRAFTED POST:",
    draft.post,
    "",
    `THE WRITER'S STATED ANGLE: ${draft.angle}`,
    recentBlock,
    hard.fixable.length
      ? [
          "",
          `MECHANICAL PROBLEMS YOU MUST FIX: ${hard.fixable.join("; ")}.`,
          "Return a `revised` version that resolves these while keeping the argument intact.",
          "Cut hedges, qualifiers, and scene-setting before cutting substance.",
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  let verdict: Verdict;
  try {
    verdict = await completeJson<Verdict>({
      system: gateSystem(),
      messages: [{ role: "user", content: material }],
      maxTokens: config.llm.maxTokens,
      temperature: config.llm.temperature,
      jsonSchema: GATE_SCHEMA,
    });
  } catch (err) {
    // A gate we cannot run is a gate that failed. Never fall through to publish.
    log.error("gate call failed, rejecting", { err: String(err) });
    return { approved: false, reasons: [`gate unavailable: ${String(err)}`] };
  }

  const scores = normalizeScores(verdict.scores);
  const reasons = Array.isArray(verdict.reasons) ? verdict.reasons.map(String) : [];

  // Enforce the threshold in code rather than trusting the model's own
  // arithmetic against it.
  const failing = scores
    ? SCORE_FIELDS.filter((f) => scores[f] < config.editorial.qualityThreshold)
    : [];

  let approved = Boolean(verdict.approved) && failing.length === 0;
  if (failing.length > 0) {
    reasons.push(
      `below threshold (${config.editorial.qualityThreshold}): ` +
        failing.map((f) => `${f}=${scores?.[f]}`).join(", "),
    );
  }

  const revised = verdict.revised ? stripWrappingQuotes(verdict.revised) : undefined;

  // A revision has to clear every rule, fixable ones included — this is the
  // last chance to catch a still-too-long post.
  if (approved && revised) {
    const recheck = applyHardRules({ ...draft, post: revised });
    const problems = [...recheck.fatal, ...recheck.fixable];
    if (problems.length > 0) {
      log.info("gate revision still fails hard rules", { reasons: problems });
      approved = false;
      reasons.push(...problems);
    }
  }

  // Fixable problems were flagged to the editor; if it approved without
  // actually returning a fix, the original is still broken.
  if (approved && hard.fixable.length > 0 && !revised) {
    log.info("gate approved but returned no fix for mechanical problems", {
      reasons: hard.fixable,
    });
    approved = false;
    reasons.push(...hard.fixable);
  }

  log.info("gate verdict", { approved, scores, revised: Boolean(revised), reasons });
  return { approved, reasons, revised: approved ? revised : undefined, scores };
}

function normalizeScores(raw: unknown): QualityScores | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const source = raw as Record<string, unknown>;
  const out = {} as QualityScores;
  for (const field of SCORE_FIELDS) {
    const value = Number(source[field]);
    // A missing or unparseable score must not read as a pass.
    out[field] = Number.isFinite(value) ? value : 0;
  }
  return out;
}

type HardRuleResult = {
  /** Not worth a model call — discard the candidate. */
  fatal: string[];
  /** Mechanical and repairable — hand to the editor for a revision. */
  fixable: string[];
};

function applyHardRules(draft: Draft): HardRuleResult {
  const fatal: string[] = [];
  const fixable: string[] = [];
  const post = draft.post;

  if (!post || post.trim().length < 20) fatal.push("post is empty or too short");

  const reserved = config.editorial.linkMode === "main" ? config.x.tcoLength + 2 : 0;
  const projected = tweetLength(post) + reserved;
  if (projected > config.x.maxPostLength) {
    const over = projected - config.x.maxPostLength;
    fixable.push(
      `${over} characters too long (${projected}/${config.x.maxPostLength}` +
        `${reserved ? `, including ${reserved} reserved for the link` : ""})`,
    );
  }

  const hashtags = post.match(/#\w+/g) ?? [];
  if (hashtags.length > config.editorial.maxHashtags) {
    fixable.push(`too many hashtags: ${hashtags.length}/${config.editorial.maxHashtags}`);
  }
  if (/(^|\s)@\w/.test(post)) fixable.push("contains an @-mention");

  // The phrases that make an account read as generated. Deterministic, so
  // there's no reason to spend a model call deciding — but they're a rewrite,
  // not a reason to bin an otherwise good observation.
  // A wall of prose reads as generated no matter how good the observation is.
  // Short posts can legitimately be one line; longer ones need beats.
  if (post.length > 120 && !post.includes("\n")) {
    fixable.push("single block of prose — needs 2-4 short beats separated by blank lines");
  }

  const tells = AI_TELLS.filter((p) => post.toLowerCase().includes(p));
  if (tells.length) {
    fixable.push(`uses AI-sounding phrasing: ${tells.map((t) => `"${t}"`).join(", ")}`);
  }
  if (/https?:\/\//.test(post)) fixable.push("contains a URL (the link is appended separately)");
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(post)) fixable.push("contains emoji");

  // These are judgements about the post's substance, not its surface — a
  // rewrite cannot rescue them.
  if (draft.confidence < 0.4) fatal.push(`writer confidence too low (${draft.confidence})`);

  const blocked = config.editorial.blockedTerms.filter((t) =>
    post.toLowerCase().includes(t.toLowerCase()),
  );
  if (blocked.length) fatal.push(`contains blocked terms: ${blocked.join(", ")}`);

  // 0.55 was too permissive: two posts about the same repo worded differently
  // scored well under it and both went out.
  const recentPosts = readHistory().slice(-20);
  const similar = recentPosts.find((h) => titleSimilarity(h.post, post) >= 0.4);
  if (similar) fatal.push(`too similar to a recent post: "${similar.post.slice(0, 60)}..."`);

  return { fatal, fixable };
}
