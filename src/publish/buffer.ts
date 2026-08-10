import { config } from "../config.ts";
import { request } from "../util/http.ts";
import { log } from "../util/log.ts";

/**
 * Publishes through Buffer's GraphQL API.
 *
 * Buffer holds the X API relationship and absorbs its per-post cost, so this
 * path publishes to X without any X credentials, credits, or billing on your
 * side. Buffer's free plan covers it: 3 channels, a 10-deep refillable queue,
 * and 3,000 API requests a month — roughly 30x what three posts a day needs.
 *
 * Auth is a personal API key from publish.buffer.com/settings/api. No OAuth
 * app registration is involved (Buffer stopped issuing those, which only
 * affects third-party SaaS integrations, not personal keys).
 */

const ENDPOINT = "https://api.buffer.com";

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

export type BufferChannel = {
  id: string;
  name: string;
  service: string;
};

async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const apiKey = config.buffer.apiKey;
  if (!apiKey) {
    throw new Error("BUFFER_API_KEY is not set. Generate one at publish.buffer.com/settings/api");
  }

  const res = await request(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, variables }),
    timeoutMs: 30_000,
    retryOn: (s) => s >= 500,
  });

  const raw = await res.text();
  if (!res.ok) {
    const hint = res.status === 401 ? " (check BUFFER_API_KEY)" : "";
    throw new Error(`buffer api ${res.status}${hint}: ${raw.slice(0, 300)}`);
  }

  const parsed = JSON.parse(raw) as GraphQLResponse<T>;
  // GraphQL reports failures in the body with a 200, so status alone is not enough.
  if (parsed.errors?.length) {
    throw new Error(`buffer graphql: ${parsed.errors.map((e) => e.message).join("; ")}`);
  }
  if (!parsed.data) throw new Error(`buffer returned no data: ${raw.slice(0, 300)}`);

  return parsed.data;
}

export async function getOrganizationId(): Promise<string> {
  const data = await graphql<{ account?: { organizations?: Array<{ id: string; name: string }> } }>(
    `query GetOrganizations { account { organizations { id name } } }`,
  );
  const org = data.account?.organizations?.[0];
  if (!org) throw new Error("no Buffer organization found for this API key");
  return org.id;
}

export async function listChannels(): Promise<BufferChannel[]> {
  const organizationId = await getOrganizationId();
  const data = await graphql<{ channels?: BufferChannel[] }>(
    // Buffer uses custom ID scalars, not String — `String!` is rejected here.
    `query GetChannels($organizationId: OrganizationId!) {
       channels(input: { organizationId: $organizationId }) { id name service }
     }`,
    { organizationId },
  );
  return data.channels ?? [];
}

/**
 * Resolves the X channel once and caches it for the process. Configuring
 * BUFFER_CHANNEL_ID explicitly skips the lookup entirely and saves a request.
 */
let cachedChannelId: string | undefined;

export async function resolveChannelId(): Promise<string> {
  if (config.buffer.channelId) return config.buffer.channelId;
  if (cachedChannelId) return cachedChannelId;

  const channels = await listChannels();
  // Buffer has called this service "twitter" through the rename; accept both.
  const x = channels.find((c) => c.service === "twitter" || c.service === "x");
  if (!x) {
    const available = channels.map((c) => `${c.service}:${c.name}`).join(", ") || "none";
    throw new Error(
      `No X channel connected to Buffer. Connect one at publish.buffer.com. Available: ${available}`,
    );
  }

  cachedChannelId = x.id;
  log.info("buffer channel resolved", { id: x.id, name: x.name, service: x.service });
  return x.id;
}

export type BufferPostResult = {
  id: string;
  dueAt?: string;
};

export async function createPost(
  text: string,
  imageUrls: string[] = [],
): Promise<BufferPostResult> {
  const channelId = await resolveChannelId();

  const input: Record<string, unknown> = { text, channelId };

  // Buffer attaches images by public URL — there is no upload step. X caps a
  // post at 4 images, so anything beyond that is dropped rather than rejected.
  if (imageUrls.length > 0) {
    input.assets = imageUrls.slice(0, 4).map((url) => ({ image: { url } }));
  }
  if (config.buffer.publishNow) {
    // Goes out to X immediately, bypassing the queue. No review window.
    input.mode = "shareNow";
    input.schedulingType = "automatic";
  } else if (config.buffer.scheduleAt) {
    input.mode = "customScheduled";
    input.dueAt = config.buffer.scheduleAt;
    input.schedulingType = "automatic";
  } else {
    // Buffer publishes from the queue at the posting times set on the channel.
    input.mode = "addToQueue";
    input.schedulingType = "automatic";
  }

  const data = await graphql<{
    createPost?: { post?: { id: string; text: string; dueAt?: string }; message?: string };
  }>(
    `mutation CreatePost($input: CreatePostInput!) {
       createPost(input: $input) {
         ... on PostActionSuccess { post { id text dueAt } }
         ... on MutationError { message }
       }
     }`,
    { input },
  );

  const result = data.createPost;
  // The mutation returns a union: a MutationError still arrives as a 200.
  if (result?.message && !result.post) {
    throw new Error(`buffer rejected the post: ${result.message}`);
  }
  if (!result?.post?.id) {
    throw new Error(`buffer returned an unexpected createPost payload: ${JSON.stringify(data)}`);
  }

  log.info("queued in buffer", {
    postId: result.post.id,
    dueAt: result.post.dueAt,
    images: imageUrls.length,
  });
  return { id: result.post.id, dueAt: result.post.dueAt };
}
