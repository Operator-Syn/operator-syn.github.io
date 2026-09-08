import assert from "node:assert/strict";
import { test } from "node:test";
import { app } from "../../workers/portfolio-public-auth/src/index.ts";

const ORIGIN = "http://localhost:5173";
const SESSION_COOKIE = "__Host-portfolio_session";
const SESSION_VALUE = "test-session-value";
const NOW = Date.parse("2026-08-31T00:00:00.000Z");

class SessionDatabase {
  constructor(private readonly pictureUrl: string | null) {}

  prepare(sql: string) {
    return {
      bind: () => ({
        first: async <T>() => {
          if (sql.includes("FROM sessions")) {
            return {
              id_hash: "session-hash",
              sub: "google-sub",
              created_at: NOW - 60_000,
              expires_at: NOW + 60_000,
              last_seen_at: NOW - 30_000,
              revoked_at: null,
              turnstile_verified_at: NOW - 30_000,
            } as T;
          }
          if (sql.includes("FROM users")) {
            return {
              sub: "google-sub",
              email: "reader@example.com",
              display_name: "John-Ronan Beira",
              picture_url: this.pictureUrl,
              quota_epoch: 0,
              disabled_at: null,
            } as T;
          }
          return null;
        },
        run: async () => ({ meta: { changes: 1 } }),
      }),
    };
  }
}

function environment(database: SessionDatabase) {
  return {
    AUTH_DB: database,
    AGENT_WORKER: { fetch: async () => new Response(null, { status: 200 }) },
    PUBLIC_AUTH_ORIGIN: "https://public-auth.syn-forge.com",
    PORTFOLIO_ORIGIN: "https://syn-forge.com",
    AGENT_ORIGIN: "https://assistant.syn-forge.com",
    BROWSER_ORIGINS: "https://syn-forge.com,http://localhost:5173",
    SESSION_COOKIE_SAME_SITE: "Lax",
    GOOGLE_REDIRECT_URI: "https://public-auth.syn-forge.com/oauth/google/callback",
    AGENT_AUDIENCE: "portfolio-agent",
  };
}

function sessionRequest() {
  return new Request("https://public-auth.syn-forge.com/session", {
    headers: {
      Origin: ORIGIN,
      Cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`,
    },
  });
}

test("returns the signed-in Google profile image URL from the session", async () => {
  const pictureUrl = "https://lh3.googleusercontent.com/a/profile=s96-c";
  const response = await app.fetch(
    sessionRequest(),
    environment(new SessionDatabase(pictureUrl)) as never,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    authenticated: true,
    user: {
      sub: "google-sub",
      email: "reader@example.com",
      displayName: "John-Ronan Beira",
      pictureUrl,
    },
    sessionExpiresAt: NOW + 60_000,
    turnstileVerified: true,
  });
});

test("does not return an untrusted profile image URL", async () => {
  const response = await app.fetch(
    sessionRequest(),
    environment(new SessionDatabase("https://avatars.example/profile.png")) as never,
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as { user: { pictureUrl: string | null } };
  assert.equal(body.user.pictureUrl, null);
});

test("does not disclose a session without a valid cookie", async () => {
  const response = await app.fetch(
    new Request("https://public-auth.syn-forge.com/session", { headers: { Origin: ORIGIN } }),
    environment(new SessionDatabase(null)) as never,
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { authenticated: false });
});
