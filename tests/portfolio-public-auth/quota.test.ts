import assert from "node:assert/strict";
import { test } from "node:test";
import { app } from "../../workers/portfolio-public-auth/src/index.ts";

const ORIGIN = "http://localhost:5173";
const SESSION_COOKIE = "__Host-portfolio_session";
const SESSION_VALUE = "test-session-value";
const NOW = Date.parse("2026-08-31T00:00:00.000Z");

class QuotaDatabase {
  readonly queries: Array<{ sql: string; args: unknown[] }> = [];

  constructor(
    private readonly usage: {
      used_tokens: number | null;
      settled_tokens?: number | null;
      provisional_tokens?: number | null;
      oldest_created_at: number | null;
    },
  ) {}

  prepare(sql: string) {
    return {
      bind: (...args: unknown[]) => {
        this.queries.push({ sql, args });
        return {
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
                email: "owner@example.com",
                display_name: "Portfolio Owner",
                quota_epoch: 0,
                disabled_at: null,
              } as T;
            }
            if (sql.includes("FROM rolling_token_usage")) return this.usage as T;
            return null;
          },
          run: async () => ({ meta: { changes: 1 } }),
        };
      },
    };
  }
}

function environment(database: QuotaDatabase) {
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

function quotaRequest() {
  return new Request("https://public-auth.syn-forge.com/quota", {
    headers: {
      Origin: ORIGIN,
      Cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`,
    },
  });
}

test("returns only the signed-in user's active rolling quota", async () => {
  const oldestCreatedAt = NOW - 5 * 60_000;
  const database = new QuotaDatabase({
    used_tokens: 125_000,
    settled_tokens: 100_000,
    provisional_tokens: 25_000,
    oldest_created_at: oldestCreatedAt,
  });
  const response = await app.fetch(quotaRequest(), environment(database) as never);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    usedTokens: 125_000,
    settledTokens: 100_000,
    provisionalTokens: 25_000,
    budgetTokens: 1_000_000,
    remainingTokens: 875_000,
    resetAt: oldestCreatedAt + 60 * 60_000,
  });
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const usageQuery = database.queries.find(({ sql }) => sql.includes("FROM rolling_token_usage"));
  assert.equal(usageQuery?.args[0], "google-sub");
  assert.equal(typeof usageQuery?.args[1], "number");
  assert.match(usageQuery?.sql ?? "", /actual_input_tokens/);
  assert.match(usageQuery?.sql ?? "", /actual_output_tokens/);
});

test("reports no pending refresh when the rolling window is empty", async () => {
  const database = new QuotaDatabase({
    used_tokens: 0,
    settled_tokens: 0,
    provisional_tokens: 0,
    oldest_created_at: null,
  });
  const response = await app.fetch(quotaRequest(), environment(database) as never);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    usedTokens: 0,
    settledTokens: 0,
    provisionalTokens: 0,
    budgetTokens: 1_000_000,
    remainingTokens: 1_000_000,
    resetAt: null,
  });
});

test("does not disclose quota data without a valid session", async () => {
  const database = new QuotaDatabase({ used_tokens: 125_000, oldest_created_at: NOW });
  const response = await app.fetch(
    new Request("https://public-auth.syn-forge.com/quota", { headers: { Origin: ORIGIN } }),
    environment(database) as never,
  );

  assert.equal(response.status, 401);
  assert.equal(database.queries.length, 0);
});

test("fails closed when the quota store is unavailable", async () => {
  const database = new QuotaDatabase({ used_tokens: 0, oldest_created_at: null });
  const originalPrepare = database.prepare.bind(database);
  database.prepare = (sql: string) => {
    if (sql.includes("FROM rolling_token_usage")) {
      return {
        bind: () => ({
          first: async () => {
            throw new Error("quota store unavailable");
          },
        }),
      } as unknown as ReturnType<QuotaDatabase["prepare"]>;
    }
    return originalPrepare(sql);
  };

  const response = await app.fetch(quotaRequest(), environment(database) as never);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: {
      code: "QUOTA_UNAVAILABLE",
      message: "The assistant budget is temporarily unavailable.",
    },
  });
});
