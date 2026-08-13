---
title: "Everything I got wrong building an autonomous X bot"
published: false
description: "It writes a tech post three times a day and publishes without me. The code took an afternoon. The interesting part was the six times testing proved a design I was confident about was wrong."
tags: ai, typescript, automation, showdev
---

# Everything I got wrong building an autonomous X bot

It writes a tech post three times a day and publishes without me. The code took an afternoon. The interesting part was the six times testing proved a design I was confident about was wrong.

| | |
|---|---|
| **Running cost** | $0.00 |
| **Runtime dependencies** | 0 |
| **TypeScript** | 4,054 lines |
| **Bugs found by testing** | 6 |

BuzzEngine watches Hacker News and GitHub Trending, works out what's actually gaining traction, fetches the primary source, writes a post about it, judges its own work, and publishes to X. On a schedule. Without anyone approving anything.

```
COLLECT ──▶ DEDUPE ──▶ SCORE ──▶ RESEARCH ──▶ DRAFT ──▶ GATE ──▶ PUBLISH
 HN,GitHub   subject +  velocity   fetch the     LLM      LLM +    Buffer
 Reddit, X   URL + text + topic    primary                7 checks  ──▶ X
                                   source                + rules
                                                            │
                                                     fail ──┘
                                                   (try next candidate)
```

That diagram is the boring part. Every box in it works. What follows is the story of the six times a box *looked* like it worked and didn't — because that's where all the actual engineering was.

---

## 01 · The wall you hit before writing any code

X shut down its free API tier in February 2026. Posting now costs **$0.015 a post** — or **$0.20** if the post contains a link. No subscription, no monthly minimum; you buy credits and they drain.

Three posts a day with links is about $18 a month. Not much, but the brief was zero.

So I proposed putting the link in a self-reply instead: a clean main post at $0.015, link underneath. About 93% cheaper.

That was wrong, and it took saying it out loud to notice. **A reply is also a post, and it contains a link.** So it bills at $0.20 too — meaning link-in-reply costs $0.215 per story, *more* than putting the link in the main post.

> **Lesson:** The unit a price applies to is part of the price. I'd optimised the wrong axis for an hour before checking what "post" meant to the biller.

The only genuinely cheap option was omitting links entirely. Which is a content decision disguised as a billing one, and a bad one for a bot whose job is pointing at things.

---

## 02 · The way out was someone else's API relationship

The unlock wasn't a cheaper tier. It was noticing that social schedulers hold *their own* X API access and absorb that cost as part of their product.

Most had closed up. Zapier restored its X integration but now requires your own developer credentials. Make.com killed theirs outright in 2025. IFTTT still works but throttles hard on free.

Buffer's free plan turned out to include the one thing that mattered:

| Buffer free plan | Limit |
|---|---|
| Channels | 3 |
| Queued posts | 10, refillable |
| **API requests / month** | **3,000** |
| Cost | $0, permanent |

Three posts a day uses about 90 of those 3,000 requests — 3% of the quota. Buffer talks to X; we never touch X's API, never hold X credentials, never see a bill.

There was one scare: Buffer stopped accepting new OAuth app registrations, which kills third-party integrations. But the new GraphQL API uses **personal API keys**, which is exactly what a personal bot needs. No app registration, no approval queue.

```
status : sent
link   : https://x.com/i/status/2086783660578029792
error  : None
```

First real post, published through Buffer, $0 spent.

---

## 03 · Two prompts that couldn't both be satisfied

The first version produced posts like this:

> Persona-based prompt packaging claiming proven deliverables. Shell language suggests text templates, not runtime agents. The value is in the process documentation, not automation.

The gate kept rejecting drafts for asserting things the source didn't support. I assumed the writer was being careless. It wasn't.

I was handing the writer a headline and a one-line blurb, then instructing it to "say something the headline doesn't." There is no honest way to satisfy both. The only moves available are speculation — which the gate then correctly refused.

**The prompts were in direct contradiction and I'd written both.**

The fix was a step I'd left out: fetch the actual primary source before writing. A repo's README, an article's body. Suddenly there was real material to be interesting *about*.

**Before research:**
> Persona-based prompt packaging claiming proven deliverables…

**After research:**
> Docker Sandboxes wrap agents in microVMs so you can safely run `--dangerously-skip-permissions`. Everyone reads this as security; it's really about removing the approval bottleneck.

> **Lesson:** When a model keeps failing a check, suspect the brief before the model. Two instructions that can't both hold will produce garbage forever.

---

## 04 · The judge was reading a redacted copy

Then the gate started rejecting *accurate* posts. It flagged "858 stars" as an unsupported claim — a number sitting right there in the source material.

Because I'd built the two prompts separately, and the gate's version of the material was missing the engagement figures the writer had been given.

The gate was doing its job perfectly. It was judging against a strictly smaller context than the writer had, so genuinely-sourced facts looked invented. Three candidates rejected in a row; the run produced nothing and logged no error.

Both stages now build their material from one shared function. Not because it's tidier — because it makes the mismatch *structurally impossible* rather than merely unlikely.

> **Lesson:** If one component checks another's work, they must see identical inputs. A verifier with less context than the thing it verifies invents failures.

---

## 05 · Binning good work over four characters

A run rejected all three candidates:

```
gate rejected  too long: 326/280
gate rejected  too long: 284/280
gate rejected  too long: 307/280
run complete — outcome: skipped
```

One of those missed by **four characters**.

Length was in the same bucket as fabrication: hard fail, discard, move on. But "slightly too long" is a *mechanical* problem — exactly what the editor's revision path exists for.

Rules are now split by whether a rewrite can fix them:

| | Examples | Action |
|---|---|---|
| **Fatal** | Invented facts, duplicates, blocked terms | Reject before spending a model call |
| **Fixable** | Too long, stray hashtag, wall of prose | Send back to the editor, then re-check |

The next run showed it working: *"33 characters too long"* → the editor cut hedges, kept the argument, and the re-check passed. That post published.

---

## 06 · HTTP 200, and nothing inside it

The bot runs on Kimi K2.5 through Azure. Early on, calls came back successful and empty:

```
HTTP 200
content          : ""
reasoning_content: "The user wants me to say OK. This is a very sim…"
finish_reason    : length
```

Reasoning models spend the token budget on an internal scratchpad *before* writing anything. Run out mid-thought and you get a valid 200 with an empty answer. One request produced **21,568 characters of reasoning** and no output.

Three layers up, that surfaced as `no JSON value found in model output` — an error pointing nowhere near the cause.

The adapter now detects the exact shape (empty content + `finish_reason: length`) and says what actually happened, naming the fix. The guard fired on its very first real run, which is the only reason I found the next bug.

> **Lesson:** A successful status code is not a successful outcome. Check the shape of what came back, and make the error message name the cause, not the symptom.

---

## 07 · A URL is not a subject

The account posted about the same repository twice.

Dedupe existed — canonical URL matching, fuzzy title similarity, a 45-day memory. It just answers a narrower question than the one that matters. Different repo from the same lab? Passes. Second Docker announcement that week? Passes. Same story from a different outlet? Passes.

I tried fixing it with judgement first: show the editor the last ten posts, tell it to reject repetition. Then I replayed a near-duplicate against real history.

It approved. Scores of 7–9 across the board, flagging nothing.

**Repetition lost to seven positive criteria.** One instruction among many is not a constraint.

So candidates now carry subject keys, and anything matching one used in the last seven days is dropped before a model ever sees it:

```
github.com/labX/agent          ──▶  repo:labx/agent
                               ──▶  org:labx

docker.com/blog/thing          ──▶  site:docker.com

news.ycombinator.com  ──▶  arstechnica.com/x  ──▶  site:arstechnica.com
```

The subtlety is granularity. Keying on the domain would make `github.com` a subject and block every repository on earth. Aggregators — GitHub, HN, Reddit, X — are containers, not subjects, so they resolve to the *linked* article's domain instead.

Verified against the real failure:

```
✅ vercel/ai-sdk                    kept — genuinely new subject
🚫 PrimeIntellect-ai/prime-agent    already posted
🚫 PrimeIntellect-ai/other-thing    different repo, same org
🚫 Docker ships another feature     different story, same company
```

> **Lesson:** Deterministic rules don't drift, don't get talked round, and cost nothing to run. Use judgement for taste; use code for anything you can define.

---

## 08 · Attaching an image can be a downgrade

Images seemed like a straightforward win. They aren't, for a reason specific to the platform: **X gives attached media precedence over the link card.**

When a post carries a link, X already renders the page's og:image — with the headline and domain attached, for free. Upload that same image and you *replace* that card with a bare picture. Strictly worse.

So the rule became: only attach an image the card wouldn't already show.

| Source | Attached |
|---|---|
| GitHub repo | nothing — the card already shows it |
| Product page with a screenshot | the screenshot |

Then the first test attached `gray.png`. Body images arrive in document order, and page furniture comes first — logos, banners, background textures. They're now filtered and ranked, using dimensions in the filename as the signal: a 2320×1205 screenshot is content, a 1110×326 strip is decoration.

---

## 09 · What "quality bar" actually meant

The last change came from a question I didn't have a good answer to at first: *why not just post whatever it finds?*

So I read back every rejection. Four of five were invented facts — benchmark scores that don't exist, a timeframe the source never gave, a draft saying *"We built"* about someone else's repository. One was mechanical.

None were "not funny enough." The gate had never been fussy about taste — but the *threshold* was, because a single number governed all seven criteria. An honest, unremarkable post got binned for scoring 6 on humour.

| Criterion | Floor | Why |
|---|---|---|
| Accuracy | **8** | Publishes under a real name |
| Funny, interesting, memorable, human, clear, concise | **5** | A flat post costs nothing |

Two bars, not one. A merely-decent post publishes. A fabrication never does — and never trades against "we need something today."

> **Lesson:** "Quality" isn't one number. Separate the failures that cost something from the ones that are just disappointing.

---

## 10 · What it writes now

> Docker built a cage so AI agents can run 'YOLO mode' safely. That's the actual name for `--dangerously-skip-permissions`.
>
> Your bot gets root on a fake computer where it can delete files freely. We gave robots autonomy, then immediately grounded them.

*Published · understandable 9 · accurate 9 · human 8*

> Someone built a staffing agency for AI coding tools. Hire a frontend wizard or Reddit ninja through an app. Each agent has a personality and KPIs.
>
> We finally automated the jobs, then immediately recreated the corporate structure to manage them.

*Published · found on GitHub Trending*

The formatting matters more than it looks. Early drafts came out as one block of prose, which reads as machine-written regardless of how good the observation is. Posts are now 2–4 short beats separated by blank lines — enforced in code, because the break before the last line is what makes a punchline land.

---

## 11 · The throughline

Six bugs, and five of them share a shape: **a design that was reasonable in the abstract and wrong against reality.** None were caught by reading the code. All were caught by running it and looking hard at the output.

**What I'd carry to the next one:**

- **Test the boring thing first.** The pricing model, the response shape, the identifier you invented. That's where the assumptions hide.
- **Prefer code to prompts for anything definable.** Dedupe, length, banned phrases, structure — all started as instructions and all worked properly only once they became rules.
- **A verifier needs the verified's full context.** Otherwise it manufactures failures and you debug the wrong component.
- **Fail closed on the thing that costs something.** If the gate errors, the post is rejected. Silence is cheap; a fabrication under your name isn't.
- **An error message should name the cause.** "No JSON found" sent me three layers from the actual problem.

The bot has been running since. It publishes up to three times a day, skips days when there's nothing worth saying, and hasn't yet posted anything I'd want to delete.

That last part is the gate doing its job — which mostly means refusing to publish things a more eager system happily would.

---

**Stack:** TypeScript with zero runtime dependencies · GitHub Actions · Buffer free tier
**Sources:** Hacker News, GitHub Trending, Reddit, X
**Model:** provider-agnostic — Anthropic, OpenAI, Gemini, or any OpenAI-compatible endpoint
