import { config } from "../config.ts";
import { readStoredRefreshToken, writeRefreshToken } from "../state/store.ts";
import { request } from "../util/http.ts";
import { log } from "../util/log.ts";

const TOKEN_URL = "https://api.x.com/2/oauth2/token";

// `media.write` is requested unconditionally so enabling MEDIA_MODE later never
// requires a second trip through the browser. Posting text works without it.
export const REQUIRED_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "media.write",
  "offline.access",
];

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

/** Confidential clients authenticate with Basic; public (PKCE-only) clients send client_id in the body. */
function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  if (config.x.clientSecret) {
    const basic = Buffer.from(`${config.x.clientId}:${config.x.clientSecret}`).toString("base64");
    headers.authorization = `Basic ${basic}`;
  }
  return headers;
}

/**
 * Exchanges the stored refresh token for a fresh access token.
 *
 * X rotates the refresh token on every exchange, so the new one must be
 * persisted immediately — losing it means re-running the browser authorization.
 */
export async function getAccessToken(): Promise<string> {
  const refreshToken = readStoredRefreshToken() ?? config.x.refreshToken;
  if (!refreshToken) {
    throw new Error(
      "No X refresh token. Run `npm run authorize` once, or set X_REFRESH_TOKEN in the environment.",
    );
  }
  if (!config.x.clientId) throw new Error("X_CLIENT_ID is not set.");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  if (!config.x.clientSecret) body.set("client_id", config.x.clientId);

  const res = await request(TOKEN_URL, {
    method: "POST",
    headers: authHeaders(),
    body: body.toString(),
    // A rotated-away refresh token returns 400; retrying that just burns time.
    retryOn: (s) => s >= 500,
  });

  const text = await res.text();
  const parsed = JSON.parse(text) as TokenResponse;

  if (!res.ok || !parsed.access_token) {
    throw new Error(
      `X token refresh failed (${res.status}): ${parsed.error_description ?? parsed.error ?? text.slice(0, 300)}. ` +
        "If this says the token is invalid, re-run `npm run authorize`.",
    );
  }

  if (parsed.refresh_token && parsed.refresh_token !== refreshToken) {
    writeRefreshToken(parsed.refresh_token);
    log.info("x refresh token rotated and persisted");
  }

  return parsed.access_token;
}

/** Exchange an authorization code for the initial token pair (used by the setup script). */
export async function exchangeCode(code: string, codeVerifier: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.x.redirectUri,
    code_verifier: codeVerifier,
  });
  if (!config.x.clientSecret) body.set("client_id", config.x.clientId);

  const res = await request(TOKEN_URL, {
    method: "POST",
    headers: authHeaders(),
    body: body.toString(),
    retryOn: (s) => s >= 500,
  });

  const text = await res.text();
  const parsed = JSON.parse(text) as TokenResponse;
  if (!res.ok || !parsed.access_token) {
    throw new Error(
      `Code exchange failed (${res.status}): ${parsed.error_description ?? parsed.error ?? text.slice(0, 300)}`,
    );
  }
  return parsed;
}
