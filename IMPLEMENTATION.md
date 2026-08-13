# BuzzEngine — How I Built It

A first-person account of building an autonomous X posting agent: the brief I set myself, how I made each decision, the technical work, the six times testing proved me wrong, and what I took away from it.

---

## Contents

1. [What I set out to build](#1-what-i-set-out-to-build)
2. [How I approached it](#2-how-i-approached-it)
3. [Research: what I found before writing code](#3-research-what-i-found-before-writing-code)
4. [The architecture I chose](#4-the-architecture-i-chose)
5. [What I built, component by component](#5-what-i-built-component-by-component)
6. [Decisions I made and why](#6-decisions-i-made-and-why)
7. [Six times testing proved me wrong](#7-six-times-testing-proved-me-wrong)
8. [How I make decisions](#8-how-i-make-decisions)
9. [Operations](#9-operations)
10. [What I shipped](#10-what-i-shipped)
11. [What I learned](#11-what-i-learned)
12. [What I'd do next](#12-what-id-do-next)
13. [Appendix: configuration reference](#13-appendix-configuration-reference)

---

## 1. What I set out to build

I wanted a technology account that posts several times a day without me touching it — in a voice that reads human, about things that are actually interesting, and that never publishes something I'd have to delete.

The brief I set myself:

| Constraint | Why it mattered |
|---|---|
| **Zero running cost** | Hard requirement. This shaped the architecture more than anything else. |
| **No approval step** | If I have to review each post, I've built a worse version of writing them myself. |
| **Publishes under my real name** | Makes accuracy failures asymmetric — a dull post is free, a fabricated one costs reputation. |
| **Provider-agnostic LLM** | I didn't want to be locked to whatever I picked on day one. |
| **Deployable anywhere** | Not tied to a single host. |

The first two constraints pull against each other. Free tools tend to be manual; automated tools tend to be paid. Most of my research went into finding the seam between them.

**Result:** 4,054 lines of TypeScript, **zero runtime dependencies**, running on GitHub Actions at **$0/month**.

---

## 2. How I approached it

I worked in a deliberate order, and it mattered:

1. **Research the constraints before designing.** I didn't write a line until I knew exactly what posting cost and what was allowed. Two hours of reading saved me from building the wrong thing.
2. **Build the cheapest verifiable slice first.** Sources and scoring before any LLM call — I could see whether the ranking was sensible without spending a token.
3. **Test every stage against live data, not fixtures.** This is where all six real defects came from.
4. **Fix causes, not symptoms.** When the gate kept rejecting drafts, my first instinct was to loosen the gate. That would have been wrong — the actual fault was upstream.

That last habit was the difference between a bot that posts and a bot that posts things worth reading.

---

## 3. Research: what I found before writing code

### 3.1 X killed free posting

X replaced tiered pricing with pay-per-use on **6 February 2026** and discontinued the free tier for new developers.

| Action | Cost |
|---|---|
| Post created | $0.015 |
| **Post created containing a link** | **$0.20** |
| Post read | $0.005 (capped at 2M/month) |

No subscription, no minimum — you buy credits and they drain. At 3 posts/day with links that's **~$18/month**; without links, **~$1.35**.

**My first real mistake.** I proposed putting the link in a self-reply — clean post at $0.015, link underneath — and claimed a ~93% saving. Wrong. *A reply is also a post, and it contains a link*, so it bills at $0.20 too. Link-in-reply costs **$0.215 per story — more** than putting the link in the main post.

I'd spent an hour optimising the wrong axis because I never checked what "post" meant to the biller. I record it here because catching it required saying the plan out loud, not reading the docs again.

### 3.2 Trends data was priced out

The official trends endpoint sits behind Pro-tier access (~$5,000/month minimum). Third-party search APIs expose equivalent data at ~$0.15 per 1,000 tweets — 1–3% of official cost. I made that an optional source rather than a dependency.

### 3.3 I evaluated seven publishing routes

The insight that unlocked everything: **some services hold their own X API relationship and absorb that cost as part of their product.** Publishing through one means never touching X's API at all.

| Route | Cost | Automatic | My verdict |
|---|---|---|---|
| **Buffer free plan** | **$0** | **Yes** | **Chosen** |
| X API direct | $0.015–$0.20/post | Yes | Works, breaks constraint 1 |
| X Web Intent + notification | $0 | No — one tap | Kept as a fallback mode |
| dlvr.it free | $0 | Yes | Sources disagreed on limits (10/month vs 5/day) — too uncertain to build on |
| IFTTT free | $0 | Yes | Applet cap, 1–2 hour polling |
| Zapier | Paid | Yes | Restored X in Feb 2026, now needs your own credentials |
| Make.com | — | — | Killed its X integration in May 2025 |
| Browser automation | $0 | Yes | **Rejected on principle** |

I rejected browser automation deliberately. It's free and it works, but X's rules explicitly prohibit unofficial clients and enforce with bans — and the account at risk would be my real one. A free solution that can get my identity suspended isn't free.

### 3.4 Why I chose Buffer

Buffer's free plan includes the one thing every other free scheduler lacks: **API access**.

| Buffer free plan | Limit |
|---|---|
| Channels | 3 (X supported) |
| Scheduled posts | 10 per channel, refillable |
| **API requests/month** | **3,000** |
| Cost | $0, permanent — not a trial |

Three posts a day uses ~90 requests — **3% of quota**.

I checked one risk before committing: Buffer stopped accepting new OAuth app registrations, which kills third-party integrations. But the GraphQL API supports **personal API keys**, generated from settings with no registration or approval. That's exactly what a personal agent needs.

Two risks I accepted knowingly: dependency on a third party whose free tier could change, and posts entering a queue rather than firing instantly.

### 3.5 I checked the automation rules

X permits **scheduled original posting and AI-assisted drafting**. What's prohibited is automating *social* actions — likes, follows, retweets, DMs — and scraping or unofficial clients. My bot only publishes original posts through an authorised partner, so it's on the permitted side.

I also confirmed X removed per-post source labels in late 2022, so an API-published post is visually identical to one typed by hand. That mattered because I wanted it on my personal account, not a labelled bot account.

---

## 4. The architecture I chose

```
                 ┌───────────────────────────────────────────┐
   Hacker News ──┤  DISCOVERY                                │
   GitHub    ────┤  4 sources, each isolated —               │
   Reddit    ────┤  one failing contributes zero, not a crash│
   X         ────┤                                           │
                 └────────────────────┬──────────────────────┘
                                      │  ~80 candidates
                 ┌────────────────────▼──────────────────────┐
                 │  DEDUPE   3 layers, all deterministic     │
                 │  canonical URL · fuzzy title · subject key│
                 └────────────────────┬──────────────────────┘
                 ┌────────────────────▼──────────────────────┐
                 │  SCORE    velocity × topic fit ×           │
                 │           source weight × discussion bonus │
                 └────────────────────┬──────────────────────┘
                 ┌────────────────────▼──────────────────────┐
                 │  Per candidate, up to 6 attempts:          │
                 │    RESEARCH → DRAFT → GATE                 │
                 │                  ↓ fail → next candidate   │
                 └────────────────────┬──────────────────────┘
                                      │ pass
                 ┌────────────────────▼──────────────────────┐
                 │  PUBLISH via Buffer → X                    │
                 │  RECORD seen.json + history.jsonl          │
                 └───────────────────────────────────────────┘
```

The shape I was aiming for: **cheap deterministic work first, expensive judgement last.** Roughly 80 candidates get filtered and ranked by code before a single token is spent. The loop exits on the first candidate that clears the gate, and a run that publishes nothing is a valid outcome.

```
src/
  index.ts          268  orchestration, cadence, daemon loop
  config.ts         262  every setting, environment-driven
  prompts.ts        242  editorial doctrine
  pipeline/gate.ts  236  three-layer quality gate
  publish/buffer.ts 169  Buffer GraphQL client
  media/urls.ts     158  card-aware image selection
  pipeline/enrich.ts 123 primary-source research
  ...                    43 files, 4,054 lines total
```

---

## 5. What I built, component by component

### 5.1 Sources

| Source | Access | The gotcha I hit |
|---|---|---|
| Hacker News | Algolia API, no key | None — cleanest API of the four |
| GitHub Trending | HTML scrape | No official API exists |
| Reddit | OAuth app-only, or public JSON | **Blocks datacenter IPs unauthenticated** |
| X | twitterapi.io | Optional; I group topics into OR-queries to cut billed requests |

I wrapped every source in `Promise.allSettled` so a failing source contributes zero candidates rather than taking down the run. That decision paid off immediately — GitHub returned nothing on my first live test and the pipeline carried on with HN alone.

**The Reddit trap** is worth calling out because it fails *silently*: Reddit blocks unauthenticated JSON from datacenter IPs, which is exactly where the bot runs. From my laptop it worked perfectly; from GitHub Actions it would have returned nothing forever without erroring. I defaulted `SOURCES` to `hn,github` and documented that Reddit needs a free script app in production.

### 5.2 Deduplication — I needed three layers, not one

```
Layer 1  Canonical URL   strip tracking params, normalise host/protocol,
                         sort query, drop trailing slash
Layer 2  Fuzzy title     Jaccard overlap of significant tokens ≥ 0.6
Layer 3  Subject key     repo:owner/name · org:owner · site:domain
                         blocked for SUBJECT_COOLDOWN_DAYS (7)
```

I built the first two upfront and thought I was done. Then the account posted about the same repository twice.

The problem: URL dedupe answers *"is this the same page?"* — but the question that matters is *"is this the same thing?"* A different repo from the same lab, a second announcement from the same company, the same story via another outlet: all pass a URL check and all read as repetition.

```
github.com/labX/agent   →  repo:labx/agent  +  org:labx
docker.com/blog/thing   →  site:docker.com
hn → arstechnica.com/x  →  site:arstechnica.com
```

**The subtlety I had to get right:** aggregators are containers, not subjects. Keying on the domain would make `github.com` a subject and block every repository on earth. So GitHub, HN, Reddit, X and Medium are excluded, resolving instead to the *linked* article's domain.

I made the org-level key deliberately aggressive — three repos from one lab in a week reads as sponsored, even though each is technically a distinct story.

### 5.3 Scoring — velocity, not popularity

```
normalized      = engagement / SOURCE_SCALE[source]
velocity        = normalized / (ageHours + 2) ** 0.8
topicFit        = matched === 0 ? 0.35 : min(1.5, 0.8 + matched × 0.25)
discussionBonus = 1 + min(0.3, (comments / engagement) × 0.5)

score = velocity × topicFit × SOURCE_WEIGHT[source] × discussionBonus
```

The core idea is the gravity curve. Raw scores favour old, peaked stories; I wanted things while they were still climbing. On live data this worked exactly as intended — a 2.4-hour-old story at 135 points correctly outranked a 13-hour-old one at 613.

Engagement units aren't comparable across sources, so each gets a divisor set to "what a genuinely notable item looks like":

| Source | Scale | Weight | My reasoning |
|---|---|---|---|
| Hacker News | 300 pts | 1.00 | Best signal-to-noise for this audience |
| GitHub | 800 stars/day | 0.90 | Strong signal, no discussion context |
| Reddit | 1,000 upvotes | 0.75 | Noisier |
| X | 3,000 (likes + 2×RT) | 0.70 | Noisiest — engagement ≠ importance |

I calibrated these against live data rather than guessing. My first attempt used 200 for GitHub, which made a 2,356-star repo score **1.348** against Hacker News's **0.462** — GitHub dominated every ranking.

The **discussion bonus** rewards stories people argue about over press releases that get silently upvoted. Capped at +30% so it tilts rather than dominates. **Topic fit** is a multiplier, not a filter — off-topic stories start at 0.35× but a big enough one still surfaces.

### 5.4 Research before drafting

Before writing, I fetch the primary source: a repo's README via `raw.githubusercontent.com`, or an article's body with scripts and chrome stripped and paragraph boundaries preserved.

I added this step to fix a design failure (see §7.2). It turned out to be the single highest-value change in the project.

**Excerpt cap: 3,500 characters** — tuned empirically. A ~3.8K excerpt produced a clean draft; ~5K sent a reasoning model into 18,000+ characters of deliberation and blew the token budget. **More context is not monotonically better**, which surprised me.

### 5.5 The gate — three layers

```
Layer 1  Deterministic, fatal     reject before spending a model call
Layer 2  Deterministic, fixable   hand to the editor with instructions
Layer 3  LLM judgement            7 criteria, two thresholds
```

| Fatal | Fixable |
|---|---|
| Empty or too short | Too long (with exact overage) |
| Confidence < 0.4 | Stray hashtag or @-mention |
| Blocked terms | Contains a URL |
| Near-duplicate of a recent post | Emoji |
| | AI-tell phrases |
| | Single block of prose |

The fatal/fixable split came from watching a run discard three good posts for being 4, 27 and 46 characters too long. Length is *mechanical* — exactly what the editor's revision path exists for. Fixable problems go back with explicit instructions and are then **re-checked against the full rule set**; a revision that still fails is rejected.

**Two thresholds, not one:**

| Criterion | Floor | Why I set it there |
|---|---|---|
| `accurate` | **8** | It publishes under my name — the cost is asymmetric |
| `understandable`, `funny`, `interesting`, `concise`, `human`, `memorable` | **5** | A flat post costs nothing |

Two implementation details I'm glad I got right:

- **The gate fails closed.** If the LLM call errors, the post is rejected rather than published unchecked.
- **Scores before verdict.** The JSON schema requires `scores` before `approved`, forcing the rubric to be completed before a decision is committed to — and the threshold comparison happens **in code**, not in the model's arithmetic.

### 5.6 Publishing

Buffer's GraphQL API, authenticated with a personal key. Three things I learned the hard way:

- **GraphQL fails with HTTP 200.** Errors arrive in the body, and `createPost` returns a union — a `MutationError` is a successful HTTP response. I check both paths; a naive status check silently swallows rejected posts.
- **Custom ID scalars.** `organizationId` is typed `OrganizationId!`, not `String!`.
- **I introspected the live schema** rather than trusting docs, which is how I confirmed `ShareMode` accepts `addToQueue`, `customScheduled`, `shareNext`, `shareNow`.

### 5.7 Media — where I nearly got it backwards

My instinct was that attaching an image is always an upgrade. It isn't, for a platform-specific reason: **X gives attached media precedence over the link card.**

When a post carries a link, X already renders the page's og:image *with the headline and domain attached*, for free. Upload that same image and you **replace** that card with a bare picture — strictly worse.

So the rule I built: only attach an image the card wouldn't already show.

| Page | Attached |
|---|---|
| GitHub repository | nothing — the card already shows it |
| Product page with a screenshot | the screenshot |

Then my first test attached `gray.png`. Body images arrive in document order and page furniture comes first, so I added filtering (logo, banner, avatar, spacer, background) and ranking by dimensions parsed from the filename — width ≥1000 scores +3, screenshot-shaped aspect ratios +2, wide decorative strips −4.

### 5.8 LLM abstraction

Three adapters behind one interface, all raw HTTP, no SDK:

| Provider | Endpoint | Auth |
|---|---|---|
| `anthropic` | `/v1/messages` | `x-api-key` |
| `openai` | `{base}/chat/completions` | `Authorization: Bearer` |
| `gemini` | `{model}:generateContent` | `x-goog-api-key` |

The `openai` adapter covers OpenAI, Groq, OpenRouter, Together, DeepSeek, Azure AI Foundry, vLLM, Ollama and LM Studio through `LLM_BASE_URL` alone.

I enforce **structured output at the prompt level** rather than through provider-specific JSON modes, with a tolerant extractor handling code fences and prose preambles. Native JSON mode is used opportunistically but nothing depends on it — that's what makes smaller and self-hosted models usable.

---

## 6. Decisions I made and why

### D1 · Publish through Buffer, not the X API
The only route that's free, fully automatic, and within platform rules. **Tradeoff:** third-party dependency, and posts queue rather than fire instantly. **Rejected:** browser automation — free and automatic, but prohibited and enforced with bans on my real account.

### D2 · Zero runtime dependencies
A provider-agnostic layer can't use a vendor SDK anyway, so raw `fetch` cost me little. **Tradeoff:** I hand-wrote retry, timeout and multipart handling — 107 lines. **Gained:** tiny container, no supply-chain surface, no build step.

### D3 · Deterministic rules over prompt instructions
Anything definable goes in code; the LLM gets judgement only. I validated this the hard way — see §7.6. **Applies to:** dedupe, length, hashtags, emoji, AI-tell phrases, post structure, cadence.

### D4 · Split accuracy from taste
I reviewed every rejection and found four of five were invented facts, not weak jokes. The failures are asymmetric, so I gave them different thresholds. **Tradeoff:** more mediocre posts published — accepted deliberately.

### D5 · Research before drafting
"Add insight" and "never assert unsupported facts" are contradictory when the only input is a headline. **Cost:** one HTTP request per candidate. Highest-value change in the project.

### D6 · One shared material builder
Draft and gate both call `buildMaterial()`. Not for tidiness — to make a whole class of bug *structurally impossible*.

### D7 · Fatal vs fixable classification
Split hard rules by whether a rewrite can repair them, with revisions re-checked against the full rule set.

### D8 · Never log the endpoint or model
Omitted entirely rather than redacted, because CI secret-masking only covers values registered as secrets. I also stopped the connectivity probe asking the model to identify itself, which was echoing the model name into stdout.

### D9 · Velocity ranking over raw popularity
Gravity curve with per-source normalisation. Validated against live data.

### D10 · State committed by CI
Actions gives each run a clean filesystem, so dedupe memory must persist or the bot re-posts. **Tradeoff:** history is public unless the repo is private. The alternative — Actions cache — risks eviction and silent dedupe loss.

---

## 7. Six times testing proved me wrong

I found six real defects. **None were visible by reading the code.** All came from running it against live data and reading the output carefully.

### 7.1 The scraper silently returned zero
GitHub's repo anchor carries a wall of analytics attributes before `href`; my regex assumed adjacency. Fixed by matching the heading region first, then finding the href inside it.
*Class: brittle parsing of markup I don't control.*

### 7.2 I wrote two prompts that couldn't both be satisfied
The gate kept rejecting drafts for unsupported claims. I assumed the writer was careless. It wasn't — I was handing it a headline and asking it to say something the headline doesn't. The only available move is speculation, which the gate then correctly refused.
*Class: unsatisfiable specification. My fault, twice over.*

### 7.3 The gate was judging blind
It flagged "858 stars" as unsupported — a number sitting in the source material. I'd built the two prompts separately and the gate's copy was missing the engagement figures. Three candidates rejected in a row, no error logged.
*Class: verifier with less context than the verified.*

### 7.4 I discarded good work over four characters
```
gate rejected  too long: 326/280
gate rejected  too long: 284/280   ← four characters
gate rejected  too long: 307/280
run complete — outcome: skipped
```
*Class: over-broad failure classification.*

### 7.5 HTTP 200 with nothing inside it
21,568 characters of reasoning against an 8,000-token cap, producing a valid response with empty content — surfacing three layers up as "no JSON value found".
*Class: success status, failed outcome.*

### 7.6 I tried to solve duplicates with judgement, and it failed
I first fixed repetition by showing the editor the last ten posts and telling it to reject repeats. Then I replayed a real near-duplicate against real history.

**It approved — scoring 7–9 across the board, flagging nothing.** Repetition lost to seven positive criteria.

That test is why §D3 exists. One instruction among many is not a constraint. I rebuilt it deterministically with subject keys:

```
✅ vercel/ai-sdk                  kept — genuinely new subject
🚫 PrimeIntellect-ai/prime-agent  already posted
🚫 PrimeIntellect-ai/other-thing  different repo, same org
🚫 Docker ships another feature   different story, same company
```
*Class: judgement used where a rule was needed.*

---

## 8. How I make decisions

Looking back, the same few patterns drove most of my choices.

**I verify before I build.** I introspected Buffer's live GraphQL schema rather than trusting its docs, which is how I found `ShareMode` and the `OrganizationId!` scalar before writing the client. I checked X's automation rules before designing around them. Two hours of reading kept me from building the wrong thing twice.

**I ask what the failure costs, not just how likely it is.** This is why accuracy and taste have different thresholds. A dull post costs nothing and I'll take a hundred of them; a fabricated claim under my name is unrecoverable. When costs are asymmetric, thresholds should be too.

**I prefer the boring mechanism.** Given a choice between a rule and a prompt, I take the rule — it doesn't drift, doesn't get argued out of position, and costs nothing to run. I only reach for the model where the task genuinely needs judgement.

**I fix causes, not symptoms.** When the gate kept rejecting drafts, loosening the gate was the obvious move and the wrong one. The fault was upstream in the brief. I've learned to distrust the component that's *reporting* a problem.

**I make risk explicit rather than avoiding it.** I rejected browser automation not because it wouldn't work but because the downside — my real account suspended — was disproportionate. I accepted Buffer's third-party dependency because the downside is a migration, not a loss.

**I test the boring things first.** The pricing model, the response shape, the identifier. Every assumption that bit me was in infrastructure, not algorithms.

---

## 9. Operations

### 9.1 Deployment

GitHub Actions is the primary target. Buffer made this viable: with no X credentials there's no rotating refresh token, which had previously forced the workflow to hold a PAT with `secrets:write` just to persist it.

```yaml
schedule:
  - cron: "0 4,8,12,16,20 * * *"   # 5 attempts/day, UTC
```

Every setting is a repository **secret**, never a variable, so no configuration appears in plain text. The manual trigger has three toggles — dry run, publish-now, ignore-cadence. I added the last one after a manual run exited silently on the spacing rule and looked broken.

Also supported: Docker with `SCHEDULE=1`, a Kubernetes CronJob with a PVC, or any external scheduler running `node src/index.ts`.

### 9.2 Cadence

| Control | Default | Enforced by |
|---|---|---|
| Scheduled attempts | 5/day | cron |
| Posts | 3/day | code, from post history |
| Minimum spacing | 180 min | code, from post history |
| Candidates per run | 6 | code |
| Subject cooldown | 7 days | code |

I decoupled attempts from output on purpose: five triggers for three posts means two runs can find nothing and I still hit the target. A capped-out run exits **before any LLM call**, so it costs nothing.

### 9.3 Cost

| Component | Cost |
|---|---|
| X API | $0 — not used |
| Buffer | $0 — ~3% of free request quota |
| GitHub Actions | $0 — unlimited public, ~270 of 2,000 min private |
| HN / GitHub / Reddit | $0 |
| LLM | 2 calls/post |

### 9.4 Failure modes

| Failure | Behaviour |
|---|---|
| A source errors | Zero candidates from it; run continues |
| Enrichment fails | Draft proceeds thinner; gate catches speculation |
| Draft or gate call fails | Candidate skipped, next one tried |
| **Gate call errors** | **Post rejected** — fails closed |
| Buffer rejects | Run fails, state not recorded, story retried |
| Media resolution fails | Publishes without an image |

---

## 10. What I shipped

Working end to end in production:

```
status : sent
link   : https://x.com/i/status/2086783660578029792
error  : None
```

> Docker built a cage so AI agents can run 'YOLO mode' safely. That's the actual name for `--dangerously-skip-permissions`.
>
> Your bot gets root on a fake computer where it can delete files freely. We gave robots autonomy, then immediately grounded them.

*understandable 9 · accurate 9 · human 8*

The gate demonstrably earns its place:

- *"States specific timeframe 'hours' not supported by source"* — rejected
- *"Mentions 'benchmark scores' not referenced in the source"* — rejected
- *"Changed 'We built' to 'An' — source does not indicate the poster is the repo creator"* — revised, then published

That last one is my favourite result: unprompted, the editor caught an implicit false claim of authorship I wouldn't have noticed myself.

**Throughput:** 1–3 posts/day. Quiet days are intended, not a bug.

---

## 11. What I learned

**1 · Test the boring thing first.** Pricing models, response shapes, identifiers. Every assumption that bit me was infrastructure, not algorithms.

**2 · Prefer code to prompts for anything definable.** Dedupe, length, banned phrases, structure — all began as instructions and only worked once they became rules. A model weighing one instruction against seven others will trade it away.

**3 · A verifier needs the verified's full context.** Give a checker less information than the thing it checks and it invents failures — which then look like a fault in the wrong component.

**4 · Contradictory requirements produce garbage indefinitely.** When a model keeps failing a check, suspect the brief before the model. I lost time assuming the model was careless when I'd written two rules that couldn't both hold.

**5 · A successful status code is not a successful outcome.** Check the shape of what came back, and make the error name the cause rather than the symptom.

**6 · Classify failures by whether they're repairable.** Throwing away good work over four characters is a classification bug, not quality control.

**7 · "Quality" isn't one number.** Separate the failures that cost something from the ones that are merely disappointing, and give them different thresholds.

**8 · The unit a price applies to is part of the price.** I optimised the wrong axis for an hour because I never checked what "post" meant to the biller.

**9 · More context is not monotonically better.** A 5,000-character excerpt made a reasoning model deliberate itself out of a token budget that 3,800 characters handled comfortably.

**10 · Fail closed on the asymmetric risk.** Silence is cheap. A fabrication under my name isn't.

---

## 12. What I'd do next

**Known limitations, stated plainly:**

- **No threads.** Multi-post drafting isn't implemented; Buffer's API thread support is unverified.
- **The system is open-loop.** `history.jsonl` records everything needed, but nothing reads engagement back from X, so topic selection doesn't improve over time. This is the largest gap against my original spec.
- **GitHub Trending is scraped** — no official API exists, so markup changes will break it (it fails soft).
- **Third-party dependency** on Buffer's free tier.
- **Subject cooldown is coarse** — org-level blocking may be too aggressive if I want to follow specific labs closely.
- **The LLM repetition check is weak.** I kept it because it costs nothing and may catch reused jokes that subject keys can't, but it isn't load-bearing.

**Next, in value order:**

1. **Performance feedback loop.** Poll post metrics, correlate against topic, hook shape, length and time of day, feed back into scoring. Closes the loop and is the biggest gap.
2. **Threads** for stories that genuinely warrant 4–7 posts.
3. **Semantic dedupe via embeddings** — catches "same point, different subject", which neither subject keys nor the LLM check handle reliably.
4. **Multi-platform publishing.** Bluesky and Mastodon have free, officially-supported APIs, and my pipeline is already platform-agnostic up to the publish step.
5. **Source expansion** — engineering blogs, arXiv, changelogs.

---

## 13. Appendix: configuration reference

**LLM**

| Variable | Default | Notes |
|---|---|---|
| `LLM_PROVIDER` | `anthropic` | `anthropic` · `openai` · `gemini` |
| `LLM_MODEL` | — | Never logged |
| `LLM_BASE_URL` | — | For OpenAI-compatible gateways. Never logged. |
| `LLM_API_KEY` | — | Falls back to provider-specific vars |
| `LLM_MAX_TOKENS` | `8000` | Raise for reasoning models |
| `LLM_TEMPERATURE` | unset | Some models reject it outright |

**Publishing**

| Variable | Default |
|---|---|
| `PUBLISH_MODE` | `buffer` — also `notify`, `api` |
| `BUFFER_API_KEY` / `BUFFER_CHANNEL_ID` | — |
| `BUFFER_SCHEDULE_AT` / `BUFFER_PUBLISH_NOW` | queue / `false` |
| `LINK_MODE` | `main` — also `none`, `reply` |

**Editorial**

| Variable | Default |
|---|---|
| `QUALITY_THRESHOLD` | `5` |
| `ACCURACY_THRESHOLD` | `8` |
| `TOPICS` | 14 technology topics |
| `BLOCKED_TERMS` | politics, election, crypto pump, nsfw, lawsuit drama |
| `MAX_HASHTAGS` | `0` |
| `RESEARCH` | `true` |

**Cadence and dedupe**

| Variable | Default |
|---|---|
| `MAX_POSTS_PER_DAY` | `3` |
| `MIN_MINUTES_BETWEEN_POSTS` | `180` |
| `DRAFT_ATTEMPTS` | `6` |
| `SUBJECT_COOLDOWN_DAYS` | `7` |
| `SEEN_RETENTION_DAYS` | `45` |

**Sources**

| Variable | Default |
|---|---|
| `SOURCES` | `hn,github,reddit,x` |
| `HN_MIN_POINTS` / `HN_LOOKBACK_HOURS` | `40` / `30` |
| `GITHUB_MIN_STARS_TODAY` | `60` |
| `REDDIT_SUBREDDITS` / `REDDIT_MIN_UPVOTES` | programming, LocalLLaMA, MachineLearning / `150` |
| `TRAWL_URL` | unset — scrape fallback, only on 403/429 |

**Media**

| Variable | Default |
|---|---|
| `MEDIA_MODE` | `off` — also `og`, `screenshot`, `auto` |
| `MEDIA_MAX_IMAGES` | `1` |
| `MEDIA_MAX_BYTES` | 5 MB |
