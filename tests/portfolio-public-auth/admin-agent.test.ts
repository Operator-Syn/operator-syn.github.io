import assert from "node:assert/strict";
import { test } from "node:test";
import { app } from "../../workers/portfolio-public-auth/src/index.ts";

type Query = { sql: string; args: unknown[] };

class AdminDatabase {
  readonly queries: Query[] = [];
  readonly users = [
    {
      sub: "subject-1",
      email: "one@example.com",
      display_name: "One",
      picture_url: "https://lh3.googleusercontent.com/one",
      updated_at: 1_700_000_000_000,
      quota_epoch: 0,
      disabled_at: null,
    },
  ];

  prepare(sql: string) {
    const run = async (...args: unknown[]) => {
      this.queries.push({ sql, args });
      return { meta: { changes: 1 } };
    };
    const first = async <T>(...args: unknown[]): Promise<T | null> => {
      this.queries.push({ sql, args });
      if (sql.includes("FROM agent_control")) {
        return {
          paused: 0,
          pause_reason: null,
          estimated_neurons: 0,
          utc_day: "2026-09-07",
          updated_at: 1_700_000_000_000,
        } as T;
      }
      if (sql.includes("COUNT(*)") && sql.includes("sessions")) return { count: 1 } as T;
      if (sql.includes("COUNT(*)") && sql.includes("threads")) return { count: 2 } as T;
      if (sql.includes("COUNT(*)") && sql.includes("users")) return { count: 1 } as T;
      if (sql.includes("FROM rolling_token_usage")) {
        return { used_tokens: 250, oldest_created_at: 1_700_000_000_000 } as T;
      }
      if (sql.includes("FROM users WHERE sub")) {
        return this.users[0] as T;
      }
      return null;
    };
    const all = async <T>(...args: unknown[]) => {
      this.queries.push({ sql, args });
      if (sql.includes("FROM users")) return { results: this.users as T[] };
      if (sql.includes("FROM threads")) {
        return {
          results: [
            {
              id: "thread-1",
              created_at: 1_700_000_000_000,
              updated_at: 1_700_000_010_000,
              title: "A recent thread",
            },
          ] as T[],
        };
      }
      return { results: [] as T[] };
    };
    return {
      bind: (...args: unknown[]) => ({
        first: () => first(...args),
        all: () => all(...args),
        run: () => run(...args),
      }),
      first,
      all,
      run,
    };
  }

  async batch(statements: Array<{ run: () => Promise<unknown> }>) {
    await Promise.all(statements.map((statement) => statement.run()));
    return [];
  }
}

function environment(database: AdminDatabase) {
  return {
    AUTH_DB: database,
    AGENT_WORKER: { fetch: async () => new Response(null, { status: 200 }) },
    PUBLIC_AUTH_ORIGIN: "https://public-auth.syn-forge.com",
    PORTFOLIO_ORIGIN: "https://syn-forge.com",
    AGENT_ORIGIN: "https://assistant.syn-forge.com",
    BROWSER_ORIGINS: "https://atelier.syn-forge.com",
    SESSION_COOKIE_SAME_SITE: "Lax",
    GOOGLE_REDIRECT_URI: "https://public-auth.syn-forge.com/oauth/google/callback",
    AGENT_AUDIENCE: "portfolio-agent",
    ADMIN_INTERNAL_KEY: "test-internal-key",
  };
}

function request(path: string, init: RequestInit = {}, key = "test-internal-key") {
  const headers = new Headers(init.headers);
  if (key) headers.set("X-Admin-Internal-Key", key);
  return new Request(`https://public-auth.syn-forge.com${path}`, { ...init, headers });
}

test("internal agent reads require the server-held key and expose metadata only", async () => {
  const database = new AdminDatabase();
  const unauthorized = await app.fetch(
    request("/internal/admin/agent/status", {}, "wrong"),
    environment(database) as never,
  );
  assert.equal(unauthorized.status, 403);

  const status = await app.fetch(
    request("/internal/admin/agent/status"),
    environment(database) as never,
  );
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), {
    paused: false,
    reason: null,
    updatedAt: 1_700_000_000_000,
    rollingBudget: 1_000_000,
    rollingWindowSeconds: 3_600,
    users: 1,
    activeSessions: 1,
    activeThreads: 2,
  });

  const detail = await app.fetch(
    request("/internal/admin/agent/users/subject-1"),
    environment(database) as never,
  );
  assert.equal(detail.status, 200);
  const payload = (await detail.json()) as Record<string, unknown>;
  assert.equal(payload.email, "one@example.com");
  assert.equal("messages" in payload, false);
  assert.deepEqual(payload.threads, [
    {
      id: "thread-1",
      created_at: 1_700_000_000_000,
      updated_at: 1_700_000_010_000,
      title: "A recent thread",
    },
  ]);
});

test("internal agent list bounds search and page size", async () => {
  const database = new AdminDatabase();
  const invalidLimit = await app.fetch(
    request("/internal/admin/agent/users?limit=51"),
    environment(database) as never,
  );
  assert.equal(invalidLimit.status, 400);
  const invalidQuery = await app.fetch(
    request(`/internal/admin/agent/users?query=${"x".repeat(101)}`),
    environment(database) as never,
  );
  assert.equal(invalidQuery.status, 400);
  const page = await app.fetch(
    request("/internal/admin/agent/users?limit=1"),
    environment(database) as never,
  );
  assert.equal(page.status, 200);
  assert.deepEqual(await page.json(), {
    users: [
      {
        subject: "subject-1",
        email: "one@example.com",
        displayName: "One",
        pictureUrl: "https://lh3.googleusercontent.com/one",
        updatedAt: 1_700_000_000_000,
        quota: {
          usedTokens: 250,
          settledTokens: 250,
          provisionalTokens: 0,
          budgetTokens: 1_000_000,
          remainingTokens: 999_750,
          resetAt: 1_700_003_600_000,
        },
        activeSessions: 1,
        activeThreads: 2,
      },
    ],
    nextCursor: null,
    hasMore: false,
  });
});

test("internal agent controls require a bounded pause reason and support resets", async () => {
  const database = new AdminDatabase();
  const missingReason = await app.fetch(
    request("/internal/admin/agent/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused: true }),
    }),
    environment(database) as never,
  );
  assert.equal(missingReason.status, 400);

  const paused = await app.fetch(
    request("/internal/admin/agent/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused: true, reason: "Maintenance" }),
    }),
    environment(database) as never,
  );
  assert.equal(paused.status, 200);

  const reset = await app.fetch(
    request("/internal/admin/agent/users/subject-1/reset", { method: "POST" }),
    environment(database) as never,
  );
  assert.equal(reset.status, 200);
  const globalReset = await app.fetch(
    request("/internal/admin/agent/reset", { method: "POST" }),
    environment(database) as never,
  );
  assert.equal(globalReset.status, 200);
  assert.equal(
    database.queries.some(({ sql }) => sql.includes("DELETE FROM rolling_token_usage")),
    true,
  );
});
