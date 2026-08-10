# BuzzEngine

An autonomous bot that watches what's buzzing in tech, forms a take on it, and posts to X. Once configured it runs unattended: no approval step, no queue to review.

```
COLLECT ──▶ DEDUPE ──▶ SCORE ──▶ DRAFT ──▶ GATE ──▶ POST ──▶ LOG
 4 sources   history    velocity   LLM      LLM +     X API   state
             + batch    + topic             hard
                        fit                 rules
```

- **Any LLM.** Anthropic, OpenAI, Gemini, or anything OpenAI-compatible — Groq, OpenRouter, Together, vLLM, Ollama, LM Studio. Swap providers with two environment variables.
- **Host anywhere.** Zero runtime dependencies. Ships as a Kubernetes CronJob, a Docker container, a GitHub Actions workflow, or a plain `node src/index.ts` under cron.
- **Won't embarrass you.** Two-stage editorial gate, hard content rules, cross-run deduplication, cadence caps, and a kill switch.

---

## Quick start

```bash
cp .env.example .env      # fill in LLM_API_KEY and X_CLIENT_ID
npm install               # dev-only: TypeScript for the typecheck. No runtime deps.

npm run probe:llm         # confirm the model answers and returns valid JSON
npm run probe:sources     # see what today's ranking looks like — no LLM, no posting
npm run authorize         # one-time browser consent for X, stores a refresh token
npm run dry               # full pipeline, prints the post instead of publishing
npm start                 # for real
```

Node 24+ runs the TypeScript directly — there is no build step.

---

## The five-minute setup

**1. Create an X app.** [developer.x.com](https://developer.x.com) → new project → **User authentication settings**:

- App permissions: **Read and write**
- Type of app: **Web App / Automated App or Bot**
- Callback URI: `http://127.0.0.1:8723/callback`
- Copy the **Client ID** into `X_CLIENT_ID`

**2. Authorize once.** `npm run authorize` prints a URL, you approve in a browser, and the refresh token lands in `state/`. Every later run is unattended.

**3. Add billing to the X developer account.** Posting is pay-per-use with no monthly minimum — $0 if the bot posts nothing.

**4. Reddit (recommended).** Reddit blocks unauthenticated JSON from datacenter IPs, which is where this will run. Create a free "script" app at [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) and set `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET`. Without it, the Reddit source works from a laptop and quietly returns nothing from a server.

**5. Run in dry mode for a week.** `DRY_RUN=1` runs the entire pipeline and logs the post to `state/history.jsonl` without publishing. Read twenty drafts, tune `VOICE`, then flip it off. This is the step that decides whether you keep the bot.

---

## Choosing an LLM

Set two variables. Everything else is defaults.

| Provider | `LLM_PROVIDER` | `LLM_BASE_URL` |
|---|---|---|
| Anthropic | `anthropic` | — |
| OpenAI | `openai` | — |
| Google Gemini | `gemini` | — |
| Groq | `openai` | `https://api.groq.com/openai/v1` |
| OpenRouter | `openai` | `https://openrouter.ai/api/v1` |
| Together / Fireworks / DeepSeek | `openai` | their `/v1` URL |
| Azure AI Foundry (Kimi, Llama, Mistral…) | `openai` | `https://<resource>.services.ai.azure.com/openai/v1` |
| Ollama (local) | `openai` | `http://localhost:11434/v1` |
| vLLM / LM Studio (self-hosted) | `openai` | your `/v1` URL |

Every adapter speaks raw HTTP, so there is no SDK to install and no vendor lock-in. Structured output is enforced at the prompt level and parsed by a tolerant extractor that copes with code fences and chatty preambles — which is what makes smaller and self-hosted models usable here. Run `npm run probe:llm` after any change.

Three gotchas:

- Some newer models **reject `LLM_TEMPERATURE` outright** — leave it unset unless you know yours accepts it.
- If a gateway rejects `response_format`, set `LLM_NATIVE_JSON=0` to fall back to prompt-only JSON.
- **Reasoning models** (Kimi, DeepSeek-R1, o-series) spend the token budget on an internal scratchpad *before* writing the answer. Too small a `LLM_MAX_TOKENS` yields a successful HTTP 200 with empty content. The adapter detects this and says so explicitly instead of failing as "no JSON found"; the fix is always to raise the budget. Default is 4000.

---

## Deployment

### Kubernetes

```bash
docker build -t x-agent:latest .
kubectl apply -f deploy/k8s/x-agent.yaml
kubectl -n x-agent create secret generic x-agent \
  --from-literal=LLM_API_KEY=... \
  --from-literal=X_CLIENT_ID=... \
  --from-literal=X_REFRESH_TOKEN=...
```

A CronJob runs one cycle every four hours; a PVC carries state between runs. `concurrencyPolicy: Forbid` prevents overlapping cycles from racing on the state files.

**The PVC must be durable.** X rotates the refresh token on every run and the new one is written to `STATE_DIR`. Lose the volume and you re-run `npm run authorize`.

### Docker

```bash
docker compose up -d          # long-lived container, paces itself via SCHEDULE=1
```

Or one-shot under the host's cron, which is closer to how the k8s CronJob behaves:

```bash
docker run --rm --env-file .env -v x-agent-state:/data x-agent:latest
```

### GitHub Actions

`.github/workflows/run.yml` runs on a schedule with repo secrets, commits dedupe state back, and writes the rotated refresh token to the `X_REFRESH_TOKEN` secret. That last part needs a PAT in `GH_PAT` with *Secrets: read and write* — if you'd rather not grant it, use Docker or Kubernetes.

### Anything else

`node src/index.ts` runs one cycle and exits. Point systemd, cron, Nomad, ECS, or a Lambda at it. `SCHEDULE=1` turns it into a resident process that paces itself, for platforms with no scheduler of their own.

---

## Publishing to X for free

X killed its free API tier in February 2026 — posting through it now costs $0.015 per post, or $0.20 if the post contains a link. This project avoids that entirely.

| `PUBLISH_MODE` | Cost | Hands-off? | How |
|---|---|---|---|
| **`buffer`** (default) | **$0** | **Yes** | Queues via Buffer's free plan; Buffer holds the X API relationship and absorbs its cost |
| `notify` | $0 | No — one tap | Sends you an X Web Intent link; the composer opens pre-filled |
| `api` | $0.015–$0.20/post | Yes | Direct X API. Needs `npm run authorize` and credits. |

**Buffer's free plan is what makes this work:** 3 channels, a 10-deep refillable queue, and **3,000 API requests/month**. Three posts a day uses about 90 of those — 3% of the quota. No X credentials are involved anywhere.

Setup:

1. Connect your X account at [publish.buffer.com](https://publish.buffer.com)
2. Generate a personal API key at [publish.buffer.com/settings/api](https://publish.buffer.com/settings/api)
3. `BUFFER_API_KEY=...` in `.env`
4. `npm run probe:buffer` — confirms the key works and finds your X channel

The channel is auto-resolved; pin `BUFFER_CHANNEL_ID` to skip that lookup. Leave `BUFFER_SCHEDULE_AT` unset to append to Buffer's queue, or set an ISO 8601 UTC timestamp for exact timing.

Two caveats worth knowing: this is a dependency on a third party whose free tier could change, and posts land in Buffer's queue rather than firing instantly.

## Images

Off by default (`MEDIA_MODE=off`), because attaching one is not automatically an upgrade.

**X gives attached media precedence over the link card.** When the source URL sits in the main post, X already renders the page's og:image as a card — for free, with the headline and domain attached. Uploading that same image *replaces* the card and loses the chrome. So `MEDIA_MODE=og` deliberately declines in that case and logs why.

| `MEDIA_MODE` | Behaviour |
|---|---|
| `off` | Text only. Default. |
| `og` | Reuse the page's OpenGraph image — **only** when `INCLUDE_LINK_IN_POST=false`, so it isn't competing with a card |
| `screenshot` | Render the page via `SCREENSHOT_URL_TEMPLATE`. Genuinely different from the card, so it applies either way. |
| `auto` | Screenshot if configured, else fall back to `og` |

Images pair naturally with `INCLUDE_LINK_IN_POST=false`: the main post gets a picture, the link goes in a reply, and you land on the cheaper pricing tier at the same time.

`SCREENSHOT_URL_TEMPLATE` is any service returning raw image bytes for a GET, with `{url}` substituted — browserless, urlbox, or a small Playwright shim. Keeping it external means no headless Chrome in this image.

Uploads need the **`media.write`** scope. It's requested during `npm run authorize` whether or not media is on, so turning it on later never needs a second browser trip — but an app authorized before this feature existed must re-run `authorize`, and a 403 on upload says so explicitly.

Alt text is set from the page title and host. It describes *where* the image came from rather than inventing a caption, since the bot never sees the image contents. Media failures never block the post — the text goes out regardless.

## Guardrails

| Control | What it does |
|---|---|
| `DRY_RUN=1` | Full pipeline, logs the post, publishes nothing |
| `state/PAUSED` | Create this file and the bot halts before doing anything. Delete to resume. |
| `MAX_POSTS_PER_DAY` | Hard cap in code, not a prompt instruction |
| `MIN_MINUTES_BETWEEN_POSTS` | Minimum spacing, enforced from real post history |
| `BLOCKED_TERMS` | Drops candidates and rejects drafts containing these |
| Hard rules | Length (URL-aware), no hashtags, no emoji, no @-mentions, no fabricated URLs, no near-duplicate of the last 20 posts |
| Editorial gate | A second LLM pass that rejects unsupported facts, headline restatements, and generic commentary |
| Dedupe | Canonical URL + fuzzy title match against a 45-day memory |

The gate fails **closed**: if the LLM call errors, the post is rejected rather than published unchecked.

---

## Where the spec lives

The editorial spec is split by what actually enforces each part. Prose in a prompt is the wrong tool for anything deterministic — code doesn't drift, costs no tokens, and can't be argued out of a rule.

| Spec area | Enforced by |
|---|---|
| Discovery, momentum, source breadth | `src/sources/*` + `src/pipeline/collect.ts` |
| Topic scoring, recency, novelty weighting | `src/pipeline/score.ts` — velocity curve, topic fit, source weights |
| Duplicate detection | `src/pipeline/dedupe.ts` — canonical URL + fuzzy title, 45-day memory |
| Source verification / primary sources | `src/pipeline/enrich.ts` — fetches README or article text |
| Angle, hook, voice, originality | `src/prompts.ts` → `draftSystem()` |
| Quality gate (8-category rubric) | `src/prompts.ts` → `gateSystem()`, threshold enforced in `gate.ts` |
| Never-publish rules, format limits | `applyHardRules()` in `gate.ts` — deterministic, runs before any model call |
| Cadence, diversity, "silence over filler" | `cadenceAllows()` in `index.ts` + recent-post context in the draft prompt |
| Recording (topic, source, post id, score) | `state/history.jsonl` |

**Two deviations worth knowing:**

- **Post length.** The spec's 30–100 words needs ~600 characters; standard X allows 280, which caps you near 40 words. The prompt derives its word target from `X_MAX_POST_LENGTH` automatically, so raising it to 4000 on an X Premium account unlocks the longer format with no code change.
- **Performance learning is not implemented.** Feeding impressions and replies back into topic selection requires polling tweet metrics from the X API (a paid read per post) and a scoring model over the history file. `history.jsonl` records everything needed to add it later, but nothing reads the metrics back today. Treat the account as open-loop until that exists.

## Tuning

`VOICE` is the main knob — free text describing how posts should read, injected into the drafting prompt. Rewrite it, run `npm run dry` a few times, repeat.

`TOPICS` does double duty: it drives topic-fit scoring and builds the X search queries. Off-topic stories aren't banned, just heavily penalized, so a big enough story still gets through.

Ranking favours **velocity over raw score** — a 3-hour-old story at 135 points beats a 13-hour-old one at 613, because the first is still climbing. Per-source divisors in `src/pipeline/score.ts` normalize HN points against GitHub stars-today against X likes; adjust them if one source dominates your rankings.

Use `npm run probe:sources` to see the ranking without spending a single token.

---

## Costs

X charges per post, and **a post containing a link costs about 13× one without** ($0.20 vs $0.015). At 3 posts/day:

| Setup | Roughly |
|---|---|
| Links in the main post (`INCLUDE_LINK_IN_POST=true`) | ~$18/mo |
| Links in a self-reply (`=false`) | ~$1.40/mo |
| LLM (2 calls/post) | $1–5/mo, provider-dependent — $0 self-hosted |
| HN + GitHub + Reddit sourcing | free |
| X buzz signal via twitterapi.io | ~$1–3/mo |

Setting `INCLUDE_LINK_IN_POST=false` is the single biggest cost lever, and the threaded-link format tends to read better on X anyway.

---

## Sources

| Source | Cost | Notes |
|---|---|---|
| Hacker News | free | Algolia API, no key. Front page + rising stories. |
| GitHub Trending | free | HTML scrape (no official API). Fails soft. |
| Reddit | free | Needs a script app for server-side use. |
| X | ~$0.15/1k tweets | Via twitterapi.io. Optional — omit the key to disable. |

The official X trends endpoint is gated behind a five-figure monthly tier, which is why the buzz signal comes from a third-party search API instead.

**If GitHub or Reddit start returning 403/429** from your host's IP, set `TRAWL_URL` to a [TRAWL](https://trawl.germondai.com) instance. It's consulted *only* after a direct request comes back blocked — leave it unset and the code path never runs.

---

## Layout

```
src/
  index.ts              orchestration, cadence rules, daemon loop
  config.ts             all configuration, env-driven
  llm/                  provider adapters + tolerant JSON extraction
  sources/              hn, github, reddit, xsearch
  pipeline/             collect → dedupe → score → draft → gate → post
  x/auth.ts             OAuth 2.0 PKCE + refresh token rotation
  state/store.ts        atomic file-backed state
  scripts/              authorize, probe:llm, probe:sources
```

State lives in `STATE_DIR`: `seen.json` (dedupe memory), `history.jsonl` (audit log of every post), `x-token.json` (rotated refresh token — gitignored), `PAUSED` (kill switch).
