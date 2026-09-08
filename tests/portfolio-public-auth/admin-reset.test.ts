import assert from "node:assert/strict";
import { test } from "node:test";
import { app } from "../../workers/portfolio-public-auth/src/index.ts";

type Query = { sql: string; args: unknown[] };

class RecordingDatabase {
  readonly queries: Query[] = [];

  prepare(sql: string) {
    const record = (args: unknown[]) => {
      this.queries.push({ sql, args });
      return { meta: { changes: 1 } };
    };
    return {
      bind: (...args: unknown[]) => ({
        first: async () => ({ sub: "google-sub" }),
        run: async () => record(args),
      }),
      run: async () => record([]),
    };
  }

  async batch(statements: Array<{ run: () => Promise<unknown> }>) {
    await Promise.all(statements.map((statement) => statement.run()));
    return [];
  }
}

function environment(database: RecordingDatabase, browserOrigins = "https://syn-forge.com") {
  return {
    AUTH_DB: database,
    AGENT_WORKER: { fetch: async () => new Response(null, { status: 200 }) },
    PUBLIC_AUTH_ORIGIN: "https://public-auth.syn-forge.com",
    PORTFOLIO_ORIGIN: "https://syn-forge.com",
    AGENT_ORIGIN: "https://assistant.syn-forge.com",
    BROWSER_ORIGINS: browserOrigins,
    SESSION_COOKIE_SAME_SITE: "Lax",
    GOOGLE_REDIRECT_URI: "https://public-auth.syn-forge.com/oauth/google/callback",
    AGENT_AUDIENCE: "portfolio-agent",
    ADMIN_INTERNAL_KEY: "test-internal-key",
  };
}

async function postPublicAdmin(
  database: RecordingDatabase,
  path: "/admin/reset" | "/admin/control",
  origin: string | null = "https://syn-forge.com",
  browserOrigins = "https://syn-forge.com",
) {
  const headers = new Headers({
    Cookie: "auth_token=legacy-provider-token",
    "Content-Type": "application/json",
  });
  if (origin) headers.set("Origin", origin);
  const request = new Request(`https://public-auth.syn-forge.com${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
  return app.fetch(request, environment(database, browserOrigins) as never);
}

async function postInternalReset(database: RecordingDatabase, body: Record<string, unknown>) {
  const path =
    typeof body.sub === "string"
      ? `/internal/admin/agent/users/${encodeURIComponent(body.sub)}/reset`
      : "/internal/admin/agent/reset";
  const request = new Request(`https://public-auth.syn-forge.com${path}`, {
    method: "POST",
    headers: {
      "X-Admin-Internal-Key": "test-internal-key",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return app.fetch(request, environment(database) as never);
}

test("retired public agent admin routes fail closed without auth lookup or mutation", async () => {
  const database = new RecordingDatabase();
  let authCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    authCalls += 1;
    return new Response(null, { status: 200 });
  };
  try {
    for (const path of ["/admin/reset", "/admin/control"] as const) {
      const response = await postPublicAdmin(database, path);
      assert.equal(response.status, 410);
      assert.deepEqual(await response.json(), {
        error: {
          code: "LEGACY_ROUTE_RETIRED",
          message: "Use the Eury admin gateway.",
        },
      });
    }
    const forbiddenResponse = await postPublicAdmin(
      database,
      "/admin/reset",
      "https://evil.example",
    );
    assert.equal(forbiddenResponse.status, 403);
    const noOriginResponse = await postPublicAdmin(database, "/admin/reset", null);
    assert.equal(noOriginResponse.status, 403);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(database.queries.length, 0);
  assert.equal(authCalls, 0);
});

test("user reset preserves the global neuron control row", async () => {
  const database = new RecordingDatabase();
  const response = await postInternalReset(database, { sub: "google-sub" });
  assert.equal(response.status, 200);
  assert.equal(
    database.queries.some(({ sql }) => sql.includes("UPDATE agent_control")),
    false,
  );
  assert.equal(
    database.queries.some(({ sql }) => sql.includes("DELETE FROM rolling_token_usage")),
    true,
  );
});

test("global reset clears the global neuron control row", async () => {
  const database = new RecordingDatabase();
  const response = await postInternalReset(database, {});
  assert.equal(response.status, 200);
  assert.equal(
    database.queries.some(({ sql }) => sql.includes("UPDATE agent_control")),
    true,
  );
  assert.equal(
    database.queries.some(({ sql }) => sql.includes("DELETE FROM rolling_token_usage")),
    true,
  );
});
