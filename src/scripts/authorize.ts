import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { config } from "../config.ts";
import { exchangeCode, REQUIRED_SCOPES } from "../x/auth.ts";
import { writeRefreshToken, ensureStateDir } from "../state/store.ts";

/**
 * One-time interactive setup. Runs the OAuth 2.0 authorization-code flow with
 * PKCE, then stores the refresh token so every later run is fully unattended.
 *
 *   npm run authorize
 */

function base64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function main(): Promise<void> {
  if (!config.x.clientId) {
    console.error("X_CLIENT_ID is not set. Add it to .env first.");
    process.exit(1);
  }

  ensureStateDir();

  const codeVerifier = base64Url(randomBytes(64));
  const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
  const state = base64Url(randomBytes(16));

  const authUrl = new URL("https://x.com/i/oauth2/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", config.x.clientId);
  authUrl.searchParams.set("redirect_uri", config.x.redirectUri);
  authUrl.searchParams.set("scope", REQUIRED_SCOPES.join(" "));
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  const redirect = new URL(config.x.redirectUri);
  const port = Number(redirect.port || 80);

  console.log("\nOpen this URL in a browser and approve access:\n");
  console.log(authUrl.toString());
  console.log(`\nWaiting for the redirect on ${config.x.redirectUri} ...\n`);

  const code = await waitForCode(port, redirect.pathname, state);
  const tokens = await exchangeCode(code, codeVerifier);

  if (!tokens.refresh_token) {
    console.error(
      "No refresh token returned. Make sure the app requests the `offline.access` scope " +
        "and that it is enabled in the X developer portal.",
    );
    process.exit(1);
  }

  writeRefreshToken(tokens.refresh_token);

  console.log("Authorized. Refresh token written to the state directory.\n");
  console.log("Granted scopes:", tokens.scope ?? "(not reported)");
  console.log(
    "\nFor a container or Kubernetes deployment, either mount the state directory as a volume,",
  );
  console.log("or copy this value into the X_REFRESH_TOKEN secret for the first boot:\n");
  console.log(tokens.refresh_token);
  console.log(
    "\nNote: X rotates this token on every refresh, so the state directory must be writable and durable.",
  );
}

function waitForCode(port: number, path: string, expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname !== path) {
        res.writeHead(404).end("not found");
        return;
      }

      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");

      const finish = (message: string) => {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(`<html><body style="font-family:system-ui;padding:3rem">${message}</body></html>`);
        server.close();
      };

      if (error) {
        finish(`<h2>Authorization failed</h2><p>${error}</p>`);
        reject(new Error(`authorization denied: ${error}`));
        return;
      }
      if (returnedState !== expectedState) {
        finish("<h2>State mismatch</h2><p>Possible CSRF. Start over.</p>");
        reject(new Error("state mismatch — aborting"));
        return;
      }
      if (!code) {
        finish("<h2>No code in redirect</h2>");
        reject(new Error("no authorization code in redirect"));
        return;
      }

      finish("<h2>Authorized</h2><p>You can close this tab and return to the terminal.</p>");
      resolve(code);
    });

    server.on("error", reject);
    server.listen(port, "127.0.0.1");

    setTimeout(() => {
      server.close();
      reject(new Error("timed out waiting for the browser redirect (5 minutes)"));
    }, 300_000).unref();
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
