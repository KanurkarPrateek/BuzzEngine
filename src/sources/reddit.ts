import { config } from "../config.ts";
import { getJson, request, userAgent } from "../util/http.ts";
import { log } from "../util/log.ts";
import type { Candidate } from "../types.ts";

type RedditListing = {
  data?: {
    children?: Array<{
      data?: {
        id?: string;
        title?: string;
        url?: string;
        permalink?: string;
        score?: number;
        num_comments?: number;
        created_utc?: number;
        author?: string;
        selftext?: string;
        stickied?: boolean;
        over_18?: boolean;
        is_self?: boolean;
      };
    }>;
  };
};

let cachedToken: { token: string; expiresAt: number } | undefined;

/**
 * Reddit blocks unauthenticated JSON from most datacenter IPs, which is exactly
 * where this bot runs. With REDDIT_CLIENT_ID/SECRET set we use the app-only
 * OAuth endpoint (free, no user account); without them we fall back to the
 * public endpoint, which works from a laptop but usually 403s from a cluster.
 */
async function getAppToken(): Promise<string | undefined> {
  const { clientId, clientSecret } = config.sources.reddit;
  if (!clientId || !clientSecret) return undefined;

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await request("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": userAgent(),
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
  });

  const text = await res.text();
  if (!res.ok) {
    log.warn("reddit token request failed", { status: res.status, body: text.slice(0, 200) });
    return undefined;
  }

  const parsed = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!parsed.access_token) return undefined;

  cachedToken = {
    token: parsed.access_token,
    expiresAt: Date.now() + (parsed.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

export async function fetchReddit(): Promise<Candidate[]> {
  const token = await getAppToken();
  const out: Candidate[] = [];

  for (const sub of config.sources.reddit.subreddits) {
    const url = token
      ? `https://oauth.reddit.com/r/${sub}/hot?limit=25&raw_json=1`
      : `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`;

    try {
      const listing = await getJson<RedditListing>(url, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        // Only the unauthenticated path gets blocked; an OAuth 403 is a real
        // permissions error and escalating it would just hide the problem.
        escalateIfBlocked: !token,
      });

      for (const child of listing.data?.children ?? []) {
        const post = child.data;
        if (!post?.id || !post.title || post.stickied || post.over_18) continue;
        if ((post.score ?? 0) < config.sources.reddit.minUpvotes) continue;

        const permalink = post.permalink
          ? `https://www.reddit.com${post.permalink}`
          : `https://www.reddit.com/r/${sub}/comments/${post.id}`;

        out.push({
          id: `reddit:${post.id}`,
          source: "reddit",
          title: post.title,
          // Self-posts have no external link; the thread itself is the artifact.
          url: post.is_self || !post.url ? permalink : post.url,
          discussionUrl: permalink,
          summary: post.selftext?.slice(0, 600) || undefined,
          engagement: post.score ?? 0,
          comments: post.num_comments ?? 0,
          createdAt: (post.created_utc ?? Date.now() / 1000) * 1000,
          author: post.author,
        });
      }
    } catch (err) {
      log.warn("reddit subreddit fetch failed", { sub, authed: Boolean(token), err: String(err) });
    }
  }

  log.info("reddit collected", { count: out.length, authed: Boolean(token) });
  return out;
}
