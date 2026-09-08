import assert from "node:assert/strict";
import { test } from "node:test";
import { app } from "../../workers/portfolio-public-auth/src/index.ts";

const THREAD_ID = "ThreadGateway123";
const SESSION_COOKIE = "__Host-portfolio_session";
const SESSION_VALUE = "test-session-value";
const ORIGIN = "http://localhost:5173";

type GatewayOptions = {
  authenticated?: boolean;
  ownsThread?: boolean;
  turnstileVerified?: boolean;
  paused?: boolean;
};

class GatewayDatabase {
  private readonly options: Required<GatewayOptions>;

  constructor(options: GatewayOptions = {}) {
    this.options = {
      authenticated: true,
      ownsThread: true,
      turnstileVerified: true,
      paused: false,
      ...options,
    };
  }

  prepare(sql: string) {
    const first = async <T>() => {
      if (sql.includes("FROM sessions")) {
        if (!this.options.authenticated) return null;
        return {
          id_hash: "session-hash",
          sub: "google-sub",
          created_at: 1,
          expires_at: Date.now() + 60_000,
          last_seen_at: Date.now(),
          revoked_at: null,
          turnstile_verified_at: this.options.turnstileVerified ? 1 : null,
        } as T;
      }
      if (sql.includes("FROM users")) {
        return {
          sub: "google-sub",
          email: "owner@example.test",
          display_name: "Portfolio Owner",
          picture_url: null,
          quota_epoch: 0,
          disabled_at: null,
        } as T;
      }
      if (sql.includes("FROM agent_control")) {
        return {
          paused: this.options.paused ? 1 : 0,
          pause_reason: this.options.paused ? "manual" : null,
          estimated_neurons: 0,
          utc_day: "2026-09-04",
        } as T;
      }
      if (sql.includes("FROM threads")) {
        if (!this.options.ownsThread) return null;
        return {
          id: THREAD_ID,
          sub: "google-sub",
          created_at: 1,
          updated_at: 1,
          title: null,
        } as T;
      }
      return null;
    };
    const run = async () => ({ meta: { changes: 1 } });
    return {
      first,
      bind: (...args: unknown[]) => {
        void args;
        return { first, run };
      },
    };
  }
}

function environment(
  database: GatewayDatabase,
  agentWorker: { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> },
) {
  return {
    AUTH_DB: database,
    AGENT_WORKER: agentWorker,
    PUBLIC_AUTH_ORIGIN: "https://public-auth.syn-forge.com",
    PORTFOLIO_ORIGIN: "https://syn-forge.com",
    AGENT_ORIGIN: "https://assistant.syn-forge.com",
    BROWSER_ORIGINS: "https://syn-forge.com,https://www.syn-forge.com,http://localhost:5173",
    SESSION_COOKIE_SAME_SITE: "None",
    GOOGLE_REDIRECT_URI: "https://public-auth.syn-forge.com/oauth/google/callback",
    AGENT_AUDIENCE: "portfolio-agent",
    AGENT_INTERNAL_KEY: "test-internal-key",
  };
}

function browserHeaders(upgrade = false): HeadersInit {
  return {
    Origin: ORIGIN,
    Cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`,
    ...(upgrade ? { Upgrade: "websocket" } : {}),
  };
}

test("prepares a browser connection without returning a bearer credential", async () => {
  const response = await app.fetch(
    new Request("https://public-auth.syn-forge.com/agent/prepare", {
      method: "POST",
      headers: { ...browserHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: THREAD_ID }),
    }),
    environment(new GatewayDatabase(), { fetch: async () => Response.json({}) }) as never,
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as Record<string, unknown>;
  assert.deepEqual(payload.ready, true);
  assert.equal(payload.threadId, THREAD_ID);
  assert.equal(typeof payload.attemptId, "string");
  assert.doesNotMatch(JSON.stringify(payload), /eyJ|token|authorization/i);
});

test("forwards only a trusted identity over the internal WebSocket route", async () => {
  let capturedInput: RequestInfo | URL | undefined;
  let capturedInit: RequestInit | undefined;
  const agentWorker = {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedInput = input;
      capturedInit = init;
      return new Response("forwarded", { status: 200 });
    },
  };

  const response = await app.fetch(
    new Request(
      `https://public-auth.syn-forge.com/agents/portfolio-agent/${THREAD_ID}?rid=attempt_123456789012`,
      {
        headers: {
          ...browserHeaders(true),
          Authorization: "Bearer browser-forged-value",
          "x-portfolio-agent-identity": "browser-forged-identity",
        },
      },
    ),
    environment(new GatewayDatabase(), agentWorker) as never,
  );

  assert.equal(response.status, 200);
  assert.equal(
    String(capturedInput),
    `https://portfolio-agent.internal/internal/agents/portfolio-agent/${THREAD_ID}`,
  );
  const forwardedHeaders = new Headers(capturedInit?.headers);
  assert.equal(forwardedHeaders.get("Authorization"), "Bearer test-internal-key");
  assert.equal(forwardedHeaders.get("Cookie"), null);
  assert.equal(forwardedHeaders.get("x-portfolio-agent-request-id"), "attempt_123456789012");
  assert.deepEqual(JSON.parse(forwardedHeaders.get("x-portfolio-agent-identity") ?? ""), {
    sub: "google-sub",
    sid: "session-hash",
    tid: THREAD_ID,
    q: 0,
  });
  assert.doesNotMatch(String(capturedInput), /token=|eyJ/);
});

test("rejects unauthenticated, unverified, paused, foreign, and non-upgrade connections", async () => {
  const agentWorker = { fetch: async () => new Response("unexpected", { status: 200 }) };
  const cases: Array<{ name: string; database: GatewayDatabase; expected: number }> = [
    {
      name: "unauthenticated",
      database: new GatewayDatabase({ authenticated: false }),
      expected: 401,
    },
    {
      name: "turnstile",
      database: new GatewayDatabase({ turnstileVerified: false }),
      expected: 403,
    },
    { name: "paused", database: new GatewayDatabase({ paused: true }), expected: 503 },
    { name: "foreign", database: new GatewayDatabase({ ownsThread: false }), expected: 404 },
  ];

  for (const item of cases) {
    const response = await app.fetch(
      new Request(`https://public-auth.syn-forge.com/agents/portfolio-agent/${THREAD_ID}`, {
        headers: browserHeaders(true),
      }),
      environment(item.database, agentWorker) as never,
    );
    assert.equal(response.status, item.expected, item.name);
  }

  const noUpgrade = await app.fetch(
    new Request(`https://public-auth.syn-forge.com/agents/portfolio-agent/${THREAD_ID}`, {
      headers: browserHeaders(),
    }),
    environment(new GatewayDatabase(), agentWorker) as never,
  );
  assert.equal(noUpgrade.status, 426);
});

test("maps an agent service-binding failure to a bounded connection error", async () => {
  const response = await app.fetch(
    new Request(`https://public-auth.syn-forge.com/agents/portfolio-agent/${THREAD_ID}`, {
      headers: browserHeaders(true),
    }),
    environment(new GatewayDatabase(), {
      fetch: async () => {
        throw new Error("binding unavailable");
      },
    }) as never,
  );

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: {
      code: "AGENT_UNAVAILABLE",
      message: "The assistant connection is temporarily unavailable. Please try again.",
    },
  });
});

test("rejects an untrusted browser origin before reading session state", async () => {
  const response = await app.fetch(
    new Request(`https://public-auth.syn-forge.com/agents/portfolio-agent/${THREAD_ID}`, {
      headers: { Origin: "https://evil.example", Upgrade: "websocket" },
    }),
    environment(new GatewayDatabase(), { fetch: async () => Response.json({}) }) as never,
  );

  assert.equal(response.status, 403);
});
