# BuzzEngine

### Finds what's breaking in tech, writes about it like a person, and posts it — without you.

An autonomous X account that runs itself. It reads Hacker News, GitHub Trending, Reddit and X every few hours, works out which story is actually gaining traction, researches it, writes a post in your voice, judges its own draft, and publishes — with no approval step anywhere in the loop.

It runs on GitHub Actions and costs **nothing** to operate.

```
COLLECT ──▶ DEDUPE ──▶ SCORE ──▶ RESEARCH ──▶ DRAFT ──▶ GATE ──▶ PUBLISH
 HN,GitHub   subject +  velocity   fetch the     LLM      LLM +    Buffer
 Reddit, X   URL + text + topic    primary                7 checks  ──▶ X
                                   source                + rules
```

## What it does

**Writes original posts.** Picks the story with the most momentum, pulls the actual README or article behind it, finds an angle, and writes 2–4 short beats that read like someone typed them on a phone.

**Quote-posts other people's takes.** Watches 43 curated tech accounts plus open topic search, and adds a real response above a tweet worth amplifying. Replies aren't possible — X restricted programmatic replies on every paid tier in February 2026 — so quoting is the one engagement path that's both permitted and automatable.

**Judges its own work.** Every draft is scored by a second model against seven criteria and a set of deterministic rules. Most drafts don't survive. That's the point: silence beats a bad post under your name.

**Never repeats itself.** Three dedupe layers — canonical URL, fuzzy title, and *subject* keys — so "another repo from the same lab" doesn't go out twice in a week.

**Knows when a picture helps.** X gives attached media precedence over the link card, so attaching a repo's og:image actively makes the post worse. It only attaches an image the card wouldn't already show.

## What it costs

| | |
|---|---|
| Hosting | **$0** — GitHub Actions free tier |
| Publishing | **$0** — Buffer's free plan holds the X relationship |
| LLM | Your key. ~15 calls/day; pennies on a cheap model, free on a local one |
| X buzz (optional) | ~$1–3/month via third-party search — the only paid piece |

X killed its free API tier in February 2026: posting now costs $0.015, or $0.20 with a link. BuzzEngine never touches X's API.

## Why it doesn't read as a bot

Posts are written as short beats with line breaks, not paragraphs. A fixed list of AI tells is stripped deterministically. No hashtags, no emoji, no engagement bait. Output is capped at **3 posts a day** with 3 hours of spacing, because volume is what makes an account look automated.

## Built on

**Any LLM** — Anthropic, OpenAI, Gemini, or anything OpenAI-compatible: Groq, OpenRouter, Together, Azure AI Foundry, vLLM, Ollama. Two environment variables to switch, every adapter raw HTTP, no SDK, no lock-in.

**Zero runtime dependencies** — Node 24+ runs the TypeScript directly. No build step, no bundler, nothing to install.

**Runs anywhere** — GitHub Actions, cron, Docker, or a Kubernetes CronJob. One process, one cycle, exits.

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

| Source | Cost | Notes |
|---|---|---|
| Hacker News | free | Front page + rising stories, no key |
| GitHub Trending | free | HTML scrape — no official API exists. Fails soft. |
| Reddit | free | **Needs a script app** on any server — see below |
| X | ~$0.15/1k tweets | Via twitterapi.io. Omit `XSEARCH_API_KEY` to disable. |

Reddit blocks unauthenticated JSON from datacenter IPs, which is exactly where this runs. Without `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET` (free, from [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps)) the source works from a laptop and silently returns nothing from GitHub Actions. `SOURCES` defaults to `hn,github` for that reason.

If GitHub Trending or Reddit start returning 403/429 from your host, set `TRAWL_URL` to a [TRAWL](https://trawl.germondai.com) instance. It is consulted **only** after a direct request comes back blocked — leave it unset and the code path never runs.

The official X trends endpoint sits behind a five-figure monthly tier, which is why the buzz signal comes from a third-party search API instead.

**Dedupe** — three layers. Canonical URL, fuzzy title match, and *subject* keys: `repo:owner/name`, `org:owner`, `site:domain`. The last one is what stops "another repo from the same lab" or "a second Docker announcement" going out in the same week. Aggregator hosts are excluded, since keying on `github.com` would block every repository.

**Score** — velocity, not raw popularity. A 3-hour-old story at 135 points beats a 13-hour-old one at 613, because the first is still climbing. Per-source divisors normalise HN points against GitHub stars-today against X likes.

**Research** — fetches the primary source (a repo's README, an article's text) before writing. Without this the writer only has a headline, is asked to add insight, and can only speculate — which the gate then correctly rejects. This step is what makes "be interesting" and "never assert unsupported facts" compatible.

**Draft** — one LLM call. Picks an angle *before* writing to it.

**Gate** — a second LLM call scoring seven criteria (understandable, funny, interesting, concise, human, accurate, memorable), plus deterministic rules. Fails **closed**: if the call errors, the post is rejected rather than published unchecked.

### Originals and quotes

A candidate's source decides what kind of post it becomes: anything from X becomes a **quote post**, everything else an **original**. The two have separate daily budgets — `MAX_POSTS_PER_DAY` (1) and `MAX_QUOTES_PER_DAY` (2) — and an exhausted budget skips those candidates rather than ending the run.

They're budgeted separately on purpose. Sharing one pool would let a busy timeline turn a whole day's output into reposts, and X treats bulk reposting as spam. Amplification can never crowd out original writing.

Quote posts skip the link and the image — the embedded tweet *is* the visual — and the writer is told explicitly that its text appears *above* someone else's post, which readers can already see. Without that framing a model summarises the tweet, which is the classic bad quote post.

`FOLLOW_HANDLES` is a discovery source, not a targeting list. Curated accounts clear a lower engagement bar (`XSEARCH_HANDLE_MIN_LIKES`, default 60) because *who said it* is the signal — but every candidate still faces the same gate. Systematically quote-posting a fixed set of accounts for reach is the engagement farming X prohibits.

To quote a specific tweet by hand:

```bash
node src/scripts/quote.ts <tweet-url-or-id> "<what the tweet says>"
```

**Replies are not supported, by design.** X restricted programmatic replies on Free, Basic, Pro and Pay-Per-Use in February 2026 — an automated app can only reply if the author @mentions or quote-posts it first. No amount of credentials changes this.

### How posts are shaped

Posts are written as **2–4 short beats separated by blank lines**, not as a paragraph:

```
An AI that codes,
learns from its own mistakes,
and runs unsupervised for hours.

It's basically a junior dev that doesn't quit.
```

A wall of prose reads as generated no matter how good the observation is, and the break before the last line is what makes a punchline land. This is enforced deterministically — anything over 120 characters with no line break is sent back to the editor to restructure rather than being discarded.

The same layer strips the phrases that mark an account as AI-written ("this isn't just…", "the future of…", "let that sink in…"), since a fixed list is cheaper and more reliable than asking a model to police itself.

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

`.github/workflows/run.yml` runs five times daily — 04:00, 08:00, 12:00, 16:00 and 20:00 UTC — and commits its dedupe memory back to the repo. Five attempts for three slots, so a run that finds nothing publishable doesn't cost you the day's output.

Add these as repository **secrets** (Settings → Secrets and variables → Actions). The workflow reads everything as a secret, nothing as a variable, so no configuration appears in plain text:

```
BUFFER_API_KEY      BUFFER_CHANNEL_ID
LLM_API_KEY         LLM_BASE_URL         LLM_MODEL
```

Everything else has a working default. Optional: `LLM_MAX_TOKENS`, `SOURCES`, `TOPICS`, `QUALITY_THRESHOLD`, `MAX_POSTS_PER_DAY`, `MAX_QUOTES_PER_DAY`, `MEDIA_MODE`, `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`.

**Quote posts need `XSEARCH_API_KEY`.** Without it the X source returns nothing, no quote candidates ever reach the pipeline, and the two quote slots go unused every day — you get the single original and nothing else.

**Manual trigger:** Actions → buzzengine → **Run workflow**, with three toggles:

| Toggle | Default | Effect |
|---|---|---|
| Dry run | on | Drafts and gates, publishes nothing |
| Publish straight to X | off | Skips Buffer's queue — goes live immediately |
| Ignore cadence | off | Lifts **both** daily budgets *and* the 3-hour spacing |

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
| `MAX_POSTS_PER_DAY` / `MAX_QUOTES_PER_DAY` | Separate daily budgets for originals and quotes |
| `MIN_MINUTES_BETWEEN_POSTS` | Spacing across *both* kinds, enforced from real post history |
| `SUBJECT_COOLDOWN_DAYS` | Days before the same repo, org or company can appear again |
| `QUALITY_THRESHOLD` / `ACCURACY_THRESHOLD` | Minimum score per category — accuracy is held to a higher bar (8) than taste (5) |
| `BLOCKED_TERMS` | Drops candidates and rejects drafts containing these |
| Deterministic rules | Length (URL-aware), no hashtags, no emoji, no @-mentions, no invented URLs, no AI-tell phrases, no wall-of-prose |

Problems are split into **fatal** (fabrication, blocked terms, duplicates — reject before spending a model call) and **fixable** (too long, stray hashtag, no line breaks — hand to the editor to revise, then re-check). Binning a good post over four characters was throwing away most of the pipeline's output.

---

## Tuning

The personality lives in `src/prompts.ts`, not in config — mission, voice, the angle ladder, hook shapes, and the banned-phrase list. `VOICE` in `.env` appends extra notes on top.

`TOPICS` does double duty: topic-fit scoring, and building the X search queries. Off-topic stories aren't banned, just heavily penalised.

`npm run probe:sources` shows the ranking without spending a token.

Expect **1–2 posts a day**, not 3. The gate is strict, the subject cooldown is strict, and silence is preferred to filler. Three is a ceiling, never a quota.

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
  scripts/          manual quote-post entry point
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
