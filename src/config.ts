import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** Minimal .env loader so the app runs identically on a laptop, a VM, or in a container. */
function loadDotEnv() {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv();

function str(key: string, fallback: string): string {
  const v = process.env[key];
  return v === undefined || v === "" ? fallback : v;
}
function num(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) ? v : fallback;
}
function bool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes";
}
function list(key: string, fallback: string[]): string[] {
  const v = process.env[key];
  if (!v) return fallback;
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

export type LlmProvider = "anthropic" | "openai" | "gemini";

export const config = {
  dryRun: bool("DRY_RUN", false),
  stateDir: resolve(str("STATE_DIR", "./state")),

  /** Daemon mode: stay resident and run on an interval instead of exiting after one pass. */
  schedule: bool("SCHEDULE", false),
  scheduleIntervalMinutes: num("SCHEDULE_INTERVAL_MINUTES", 240),

  llm: {
    provider: str("LLM_PROVIDER", "anthropic") as LlmProvider,
    model: str("LLM_MODEL", "claude-opus-5"),
    /** Override for OpenAI-compatible gateways: Groq, OpenRouter, Together, vLLM, Ollama, LM Studio. */
    baseUrl: process.env.LLM_BASE_URL || undefined,
    apiKey:
      process.env.LLM_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.GEMINI_API_KEY ||
      "",
    // Generous by default: reasoning models spend this budget on their
    // scratchpad before writing a single character of the answer, and a few
    // thousand characters of source material can trigger far more of it.
    maxTokens: num("LLM_MAX_TOKENS", 8000),
    temperature: process.env.LLM_TEMPERATURE ? Number(process.env.LLM_TEMPERATURE) : undefined,
    timeoutMs: num("LLM_TIMEOUT_MS", 120_000),
  },

  x: {
    clientId: str("X_CLIENT_ID", ""),
    clientSecret: process.env.X_CLIENT_SECRET || undefined,
    redirectUri: str("X_REDIRECT_URI", "http://127.0.0.1:8723/callback"),
    /** Seed refresh token. After the first run the rotated token lives in the state dir. */
    refreshToken: process.env.X_REFRESH_TOKEN || undefined,
    /** X renders every URL as a 23-char t.co link regardless of real length. */
    tcoLength: num("X_TCO_LENGTH", 23),
    maxPostLength: num("X_MAX_POST_LENGTH", 280),
  },

  /**
   * How an approved post reaches X.
   *
   *   notify — send it to your phone with a one-tap X composer link. Free:
   *            no X API credentials, no per-post charge, nothing published
   *            until you tap Post. This is the default.
   *   api    — publish autonomously via the X API (~$0.015/post, or ~$0.20
   *            with a link). Requires `npm run authorize`.
   */
  publishMode: str("PUBLISH_MODE", "buffer") as "buffer" | "notify" | "api",

  buffer: {
    /** Personal API key from publish.buffer.com/settings/api. */
    apiKey: process.env.BUFFER_API_KEY ?? "",
    /** Optional. Resolved automatically from your connected X channel if unset. */
    channelId: process.env.BUFFER_CHANNEL_ID || undefined,
    /**
     * ISO 8601 UTC timestamp to publish at. Left unset, the post is appended to
     * Buffer's queue and goes out at the channel's next configured slot.
     */
    scheduleAt: process.env.BUFFER_SCHEDULE_AT || undefined,
    /**
     * Publish straight to X instead of queueing. Skips the review window that
     * the queue otherwise gives you, so leave it off for normal operation.
     */
    publishNow: bool("BUFFER_PUBLISH_NOW", false),
  },

  notify: {
    channel: str("NOTIFY_CHANNEL", "whatsapp") as "whatsapp",
    whatsapp: {
      /** Your self-hosted Simple-WhatsApp-API instance. */
      baseUrl: str("WHATSAPP_BASE_URL", "http://localhost:3000"),
      apiKey: process.env.WHATSAPP_API_KEY ?? "",
      masterKey: process.env.WHATSAPP_MASTER_KEY || undefined,
      /** International format, no '+' — e.g. 919876543210. */
      to: process.env.WHATSAPP_TO ?? "",
    },
  },

  media: {
    /**
     * off        — text only (default)
     * og         — reuse the page's OpenGraph image, but only when the link is
     *              NOT in the main post (otherwise X's own link card is better)
     * screenshot — render the page via SCREENSHOT_URL_TEMPLATE
     * auto       — screenshot if configured, else fall back to og
     */
    mode: str("MEDIA_MODE", "off") as "off" | "og" | "screenshot" | "auto",
    /** X caps still images at 5MB. */
    maxBytes: num("MEDIA_MAX_BYTES", 5 * 1024 * 1024),
    /** Any service returning raw image bytes for a GET. `{url}` is substituted. */
    screenshotUrlTemplate: process.env.SCREENSHOT_URL_TEMPLATE || undefined,
    altText: bool("MEDIA_ALT_TEXT", true),
  },

  sources: {
    enabled: list("SOURCES", ["hn", "github", "reddit", "x"]),
    hn: {
      minPoints: num("HN_MIN_POINTS", 40),
      lookbackHours: num("HN_LOOKBACK_HOURS", 30),
    },
    github: {
      minStarsToday: num("GITHUB_MIN_STARS_TODAY", 60),
    },
    reddit: {
      subreddits: list("REDDIT_SUBREDDITS", ["programming", "LocalLLaMA", "MachineLearning"]),
      minUpvotes: num("REDDIT_MIN_UPVOTES", 150),
      clientId: process.env.REDDIT_CLIENT_ID || undefined,
      clientSecret: process.env.REDDIT_CLIENT_SECRET || undefined,
    },
    x: {
      /** twitterapi.io (or any drop-in with the same shape). Omitted key disables the source. */
      apiKey: process.env.XSEARCH_API_KEY || undefined,
      baseUrl: str("XSEARCH_BASE_URL", "https://api.twitterapi.io"),
      minLikes: num("XSEARCH_MIN_LIKES", 400),
      lookbackHours: num("XSEARCH_LOOKBACK_HOURS", 18),
      maxQueries: num("XSEARCH_MAX_QUERIES", 3),
    },
  },

  editorial: {
    /** Drives topic-fit scoring and the search queries sent to the X source. */
    topics: list("TOPICS", [
      "ai",
      "agents",
      "big tech",
      "startups",
      "apps",
      "social media",
      "gadgets",
      "internet culture",
      "cybersecurity",
      "robots",
      "space",
      "open source",
      "developer tools",
      "research",
    ]),
    blockedTerms: list("BLOCKED_TERMS", [
      "politics",
      "election",
      "crypto pump",
      "nsfw",
      "lawsuit drama",
    ]),
    /**
     * Optional extra voice notes, appended to the doctrine in prompts.ts.
     * Empty by default — the full personality now lives in the prompt itself,
     * and a second voice description here would just fight it.
     */
    voice: str("VOICE", ""),
    /**
     * Where the source link goes — the single biggest cost lever.
     *
     * X bills a post containing a URL at ~$0.20 versus ~$0.015 without one,
     * and a reply is itself a post: "reply" therefore costs MORE than "main"
     * ($0.015 + $0.20), not less. Only "none" reaches the cheap tier.
     *
     *   none  — name the source in prose, no URL anywhere  (~$1.35/mo @ 3/day)
     *   main  — link appended to the post                  (~$18/mo)
     *   reply — link in a self-reply                       (~$19/mo)
     */
    linkMode: (() => {
      const explicit = process.env.LINK_MODE;
      if (explicit) return explicit as "none" | "main" | "reply";
      // Back-compat with the older boolean.
      if (process.env.INCLUDE_LINK_IN_POST !== undefined) {
        return bool("INCLUDE_LINK_IN_POST", false) ? "main" : "reply";
      }
      return "none";
    })(),
    /** 0 keeps the account clean. Raise to 1–2 if you want discovery tags. */
    maxHashtags: num("MAX_HASHTAGS", 0),
    /**
     * Minimum score (1–10) required in EVERY editorial category to publish.
     * 8 is the strict reading of "silence beats low quality" and will post
     * rarely; 7 posts regularly while still rejecting filler.
     */
    qualityThreshold: num("QUALITY_THRESHOLD", 7),
    /** Fetch the primary source (README, article text) before writing. */
    research: bool("RESEARCH", true),
  },

  limits: {
    maxPostsPerDay: num("MAX_POSTS_PER_DAY", 3),
    minMinutesBetweenPosts: num("MIN_MINUTES_BETWEEN_POSTS", 180),
    /** Number of ranked candidates handed to the drafting stage before we give up. */
    draftAttempts: num("DRAFT_ATTEMPTS", 3),
    /** How long a story stays in the dedupe memory. */
    seenRetentionDays: num("SEEN_RETENTION_DAYS", 45),
  },
} as const;

export type Config = typeof config;
