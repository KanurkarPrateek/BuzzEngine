# BuzzEngine

An autonomous tech trend scout that finds what's gaining traction, works out why it's interesting, writes a post a normal person would enjoy, and publishes it to X.

It runs on GitHub Actions and costs **nothing**.

```
COLLECT ──▶ DEDUPE ──▶ SCORE ──▶ RESEARCH ──▶ DRAFT ──▶ GATE ──▶ PUBLISH
 HN,GitHub   subject +  velocity   fetch the     LLM      LLM +    Buffer
 Reddit, X   URL + text + topic    primary                7 checks  ──▶ X
                                   source                + rules
```

- **$0 to run.** X killed its free API tier in February 2026 — posting through it now costs $0.015 a post, or $0.20 with a link. BuzzEngine publishes through Buffer's free plan instead, so no X credentials and no per-post charge.
- **Any LLM.** Anthropic, OpenAI, Gemini, or anything OpenAI-compatible — Groq, OpenRouter, Together, Azure AI Foundry, vLLM, Ollama. Two environment variables to switch.
- **Won't embarrass you.** A seven-criteria editorial gate, deterministic content rules, subject-level deduplication, cadence caps, and a kill switch.
- **Zero runtime dependencies.** Node 24+ runs the TypeScript directly. No build step, no bundler, nothing to install.

---

## Quick start

```bash
cp .env.example .env
npm install            # dev-only: TypeScript for the typecheck

npm run probe:llm      # is the model reachable and returning valid JSON?
npm run probe:buffer   # is the Buffer key working, and is the X channel found?
npm run probe:sources  # what does today's ranking look like? (no LLM, no posting)
npm run dry            # full pipeline, publishes nothing
npm start              # for real
```

### Setting up Buffer (this is what makes it free)

1. Connect your X account at [publish.buffer.com](https://publish.buffer.com)
2. Generate a personal API key at [publish.buffer.com/settings/api](https://publish.buffer.com/settings/api)
3. Put it in `.env` as `BUFFER_API_KEY`

Buffer's free plan gives 3 channels, a 10-deep refillable queue, and **3,000 API requests a month**. Three posts a day uses about 90 of them. Buffer holds the X API relationship and absorbs its cost — you never touch X's API.

Your X channel is found automatically; pin `BUFFER_CHANNEL_ID` to skip the lookup.

---

## How it decides what to post

**Collect** — Hacker News (Algolia API), GitHub Trending, Reddit, and optionally X buzz via a third-party search API.

**Dedupe** — three layers. Canonical URL, fuzzy title match, and *subject* keys: `repo:owner/name`, `org:owner`, `site:domain`. The last one is what stops "another repo from the same lab" or "a second Docker announcement" going out in the same week. Aggregator hosts are excluded, since keying on `github.com` would block every repository.

**Score** — velocity, not raw popularity. A 3-hour-old story at 135 points beats a 13-hour-old one at 613, because the first is still climbing. Per-source divisors normalise HN points against GitHub stars-today against X likes.

**Research** — fetches the primary source (a repo's README, an article's text) before writing. Without this the writer only has a headline, is asked to add insight, and can only speculate — which the gate then correctly rejects. This step is what makes "be interesting" and "never assert unsupported facts" compatible.

**Draft** — one LLM call. Picks an angle *before* writing to it.

**Gate** — a second LLM call scoring seven criteria (understandable, funny, interesting, concise, human, accurate, memorable), plus deterministic rules. Fails **closed**: if the call errors, the post is rejected rather than published unchecked.

---

## Publishing

| `PUBLISH_MODE` | Cost | Hands-off? |
|---|---|---|
| **`buffer`** (default) | **$0** | **Yes** |
| `notify` | $0 | No — sends an X composer link to WhatsApp, you tap Post |
| `api` | $0.015–$0.20/post | Yes — direct X API, needs `npm run authorize` |

Posts land in Buffer's queue by default, which doubles as a review window. `BUFFER_SCHEDULE_AT` sets an exact time; `BUFFER_PUBLISH_NOW=1` skips the queue entirely.

---

## Images

Off by default. Set `MEDIA_MODE=og` to enable.

The rule that matters: **X gives attached media precedence over the link card.** When the post carries its link, X already renders the page's og:image with the headline and domain attached — for free. Uploading that same image *replaces* the card with a bare picture, which is worse.

So BuzzEngine only attaches an image the card wouldn't already show:

- A GitHub repo → **nothing attached**, since its only image is the card
- An article with a product screenshot → **the screenshot**, because that's additive

Body images are filtered for page furniture (logos, banners, avatars, spacers) and ranked by size and aspect ratio — document order otherwise puts a brand background ahead of the real screenshot. Screenshots via `SCREENSHOT_URL_TEMPLATE` must be publicly reachable, since Buffer fetches the URL itself.

---

## Running it

### GitHub Actions (recommended)

`.github/workflows/run.yml` runs three times daily — 04:00, 12:00 and 17:00 UTC — and commits its dedupe memory back to the repo.

Add these as repository **secrets** (Settings → Secrets and variables → Actions). The workflow reads everything as a secret, nothing as a variable, so no configuration appears in plain text:

```
BUFFER_API_KEY      BUFFER_CHANNEL_ID
LLM_API_KEY         LLM_BASE_URL         LLM_MODEL
```

Everything else has a working default. Optional: `LLM_MAX_TOKENS`, `SOURCES`, `TOPICS`, `QUALITY_THRESHOLD`, `MAX_POSTS_PER_DAY`, `MEDIA_MODE`, `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`.

**Manual trigger:** Actions → buzzengine → **Run workflow**, with three toggles:

| Toggle | Default | Effect |
|---|---|---|
| Dry run | on | Drafts and gates, publishes nothing |
| Publish straight to X | off | Skips Buffer's queue — goes live immediately |
| Ignore cadence | off | Lifts the daily cap *and* the 3-hour spacing |

Tick **ignore cadence** whenever you want a post on demand. Without it, a manual run within 3 hours of a post exits with `cadence: too soon` and does nothing.

> Note: state must be committed for dedupe to survive between runs, which means `state/history.jsonl` is visible if the repo is public. A **private** repo keeps both — dedupe works and history stays yours, still within the free Actions tier.

### Anywhere else

`node src/index.ts` runs one cycle and exits — point cron, systemd, Nomad or ECS at it. `SCHEDULE=1` turns it into a resident process that paces itself. A `Dockerfile` and a Kubernetes CronJob manifest (`deploy/k8s/`) are included; the CronJob needs a PVC for `STATE_DIR`.

---

## Choosing an LLM

| Provider | `LLM_PROVIDER` | `LLM_BASE_URL` |
|---|---|---|
| Anthropic / OpenAI / Gemini | matching name | — |
| Azure AI Foundry | `openai` | `https://<resource>.services.ai.azure.com/openai/v1` |
| Groq / OpenRouter / Together / DeepSeek | `openai` | their `/v1` URL |
| Ollama / vLLM / LM Studio | `openai` | your `/v1` URL |

Every adapter is raw HTTP — no SDK, no lock-in. Structured output is enforced at the prompt level and parsed by a tolerant extractor that copes with code fences and chatty preambles, which is what makes smaller and self-hosted models usable.

Three gotchas:

- Some newer models **reject `LLM_TEMPERATURE` outright** — leave it unset unless yours accepts it.
- If a gateway rejects `response_format`, set `LLM_NATIVE_JSON=0`.
- **Reasoning models** (Kimi, DeepSeek-R1, o-series) spend the budget on an internal scratchpad *before* writing. Too small a `LLM_MAX_TOKENS` returns a successful HTTP 200 with empty content; the adapter detects this and says so rather than failing as "no JSON found". Default is 8000; raise it if you see the message.

The endpoint and model name are never logged — both identify a private resource, and CI masking only covers registered secrets.

---

## Guardrails

| Control | What it does |
|---|---|
| `DRY_RUN=1` | Full pipeline, logs the post, publishes nothing |
| `state/PAUSED` | Create this file and the bot halts before doing anything |
| `MAX_POSTS_PER_DAY` / `MIN_MINUTES_BETWEEN_POSTS` | Enforced in code from real post history |
| `SUBJECT_COOLDOWN_DAYS` | Days before the same repo, org or company can appear again |
| `QUALITY_THRESHOLD` | Minimum score (1–10) required in **every** category |
| `BLOCKED_TERMS` | Drops candidates and rejects drafts containing these |
| Deterministic rules | Length (URL-aware), no hashtags, no emoji, no @-mentions, no invented URLs, no AI-tell phrases, no wall-of-prose |

Problems are split into **fatal** (fabrication, blocked terms, duplicates — reject before spending a model call) and **fixable** (too long, stray hashtag, no line breaks — hand to the editor to revise, then re-check). Binning a good post over four characters was throwing away most of the pipeline's output.

---

## Tuning

The personality lives in `src/prompts.ts`, not in config — mission, voice, the angle ladder, hook shapes, and the banned-phrase list. `VOICE` in `.env` appends extra notes on top.

`TOPICS` does double duty: topic-fit scoring, and building the X search queries. Off-topic stories aren't banned, just heavily penalised.

`npm run probe:sources` shows the ranking without spending a token.

Expect **1–2 posts a day**, not 3. The gate is strict, the subject cooldown is strict, and silence is preferred to filler.

---

## Layout

```
src/
  index.ts          orchestration, cadence, daemon loop
  config.ts         all configuration, env-driven
  prompts.ts        the editorial doctrine
  llm/              provider adapters + tolerant JSON extraction
  sources/          hn, github, reddit, xsearch
  pipeline/         collect → dedupe → score → enrich → draft → gate
  publish/          buffer, X web intent
  notify/           WhatsApp delivery for the review-and-tap mode
  media/            image selection
  x/                OAuth + media upload, for the direct API mode
  state/            atomic file-backed state
```

State lives in `STATE_DIR`: `seen.json` (dedupe memory), `history.jsonl` (every post with its scores), `PAUSED` (kill switch).

---

## Not built yet

- **Threads** — multi-post drafting and sequential publishing
- **Performance learning** — `history.jsonl` records everything needed, but nothing reads engagement metrics back from X, so topic selection doesn't improve on its own
