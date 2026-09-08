import assert from "node:assert/strict";
import { test } from "node:test";
import { app } from "../../workers/portfolio-public-auth/src/index.ts";

const THREAD_ID = "ThreadHistory123456";
const SESSION_COOKIE = "__Host-portfolio_session";
const SESSION_VALUE = "test-session-value";
const ORIGIN = "http://localhost:5173";

type Message = {
  id: string;
  role: "user" | "assistant";
  parts: Array<{ type: "text"; text: string }>;
};

const messages: Message[] = [
  {
    id: "message-1",
    role: "user",
    parts: [{ type: "text", text: "Which projects use TypeScript?" }],
  },
  {
    id: "message-2",
    role: "assistant",
    parts: [{ type: "text", text: "The portfolio includes several TypeScript projects." }],
  },
];

class ThreadDatabase {
  constructor(
    private readonly ownsThread: boolean,
    private readonly emptyThread = ownsThread,
  ) {}

  prepare(sql: string) {
    return {
      bind: (...args: unknown[]) => ({
        first: async <T>() => {
          if (sql.includes("FROM sessions")) {
            return {
              id_hash: "session-hash",
              sub: "google-sub",
              created_at: 1,
              expires_at: Date.now() + 60_000,
              last_seen_at: Date.now(),
              revoked_at: null,
              turnstile_verified_at: 1,
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
          if (sql.includes("FROM threads")) {
            if (!this.ownsThread) return null;
            if (sql.includes("title IS NULL") && !this.emptyThread) return null;
            return {
              id: THREAD_ID,
              sub: "google-sub",
              created_at: 1,
              updated_at: 1,
              title: this.emptyThread ? null : "Existing thread",
            } as T;
          }
          return null;
        },
        all: async <T>() => {
          if (sql.includes("FROM threads") && sql.includes("title IS NULL")) {
            if (!this.ownsThread) return { results: [] as T[] };
            return {
              results: [
                {
                  id: THREAD_ID,
                  sub: "google-sub",
                  created_at: 1,
                  updated_at: 1,
                  title: null,
                } as T,
              ],
            };
          }
          return { results: [] as T[] };
        },
        run: async () => ({ meta: { changes: 1 }, args }),
      }),
    };
  }
}

function environment(
  database: ThreadDatabase,
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

function historyRequest() {
  return new Request(`https://public-auth.syn-forge.com/threads/${THREAD_ID}/messages`, {
    headers: {
      Origin: ORIGIN,
      Cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`,
    },
  });
}

test("returns an explicit null title for a newly created thread", async () => {
  const response = await app.fetch(
    new Request("https://public-auth.syn-forge.com/threads", {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        Cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`,
      },
    }),
    environment(new ThreadDatabase(false), {
      fetch: async () => Response.json({ messages: [] }),
    }) as never,
  );

  assert.equal(response.status, 201);
  const body = (await response.json()) as { title: string | null };
  assert.equal(body.title, null);
});

test("does not cache authenticated thread metadata", async () => {
  const response = await app.fetch(
    new Request("https://public-auth.syn-forge.com/threads", {
      headers: {
        Origin: ORIGIN,
        Cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`,
      },
    }),
    environment(new ThreadDatabase(false), {
      fetch: async () => Response.json({ messages: [] }),
    }) as never,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("blocks another thread while the existing thread is empty", async () => {
  let internalRequest: Request | undefined;
  const response = await app.fetch(
    new Request("https://public-auth.syn-forge.com/threads", {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        Cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`,
      },
    }),
    environment(new ThreadDatabase(true), {
      fetch: async (input, init) => {
        internalRequest = new Request(input, init);
        return Response.json({ messages: [] });
      },
    }) as never,
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: {
      code: "EMPTY_THREAD_ACTIVE",
      message: "Ask a question in your current thread before creating another thread.",
    },
  });
  assert.equal(
    internalRequest?.url,
    `https://portfolio-agent.internal/internal/threads/${THREAD_ID}/messages?limit=1`,
  );
  assert.equal(internalRequest?.headers.get("Authorization"), "Bearer test-internal-key");
});

test("fails closed when the empty-thread state cannot be checked", async () => {
  const response = await app.fetch(
    new Request("https://public-auth.syn-forge.com/threads", {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        Cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`,
      },
    }),
    environment(new ThreadDatabase(true), {
      fetch: async () => Response.json({ messages: "malformed" }),
    }) as never,
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: {
      code: "THREAD_STATE_UNAVAILABLE",
      message: "The current thread state could not be checked. Please try again.",
    },
  });
});

test("allows another thread after the existing thread has messages", async () => {
  const response = await app.fetch(
    new Request("https://public-auth.syn-forge.com/threads", {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        Cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`,
      },
    }),
    environment(new ThreadDatabase(true), {
      fetch: async () => Response.json({ messages: [messages[0]] }),
    }) as never,
  );

  assert.equal(response.status, 201);
});

test("returns an owned thread's persisted messages through the public-auth seam", async () => {
  let internalRequest: Request | undefined;
  const agentWorker = {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      internalRequest = new Request(input, init);
      return Response.json({ messages });
    },
  };

  const response = await app.fetch(
    historyRequest(),
    environment(new ThreadDatabase(true), agentWorker) as never,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { messages });
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal(
    internalRequest?.url,
    `https://portfolio-agent.internal/internal/threads/${THREAD_ID}/messages`,
  );
  assert.equal(internalRequest?.method, "GET");
  assert.equal(internalRequest?.headers.get("Authorization"), "Bearer test-internal-key");
});

test("forwards a cursor page through the ownership-checked public-auth seam", async () => {
  let internalRequest: Request | undefined;
  const agentWorker = {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      internalRequest = new Request(input, init);
      return Response.json({
        messages: [messages[1]],
        nextCursor: "message-1",
        hasMore: true,
      });
    },
  };

  const response = await app.fetch(
    new Request(
      `https://public-auth.syn-forge.com/threads/${THREAD_ID}/messages?limit=1&before=message-2`,
      {
        headers: {
          Origin: ORIGIN,
          Cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`,
        },
      },
    ),
    environment(new ThreadDatabase(true), agentWorker) as never,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    messages: [messages[1]],
    nextCursor: "message-1",
    hasMore: true,
  });
  assert.equal(
    internalRequest?.url,
    `https://portfolio-agent.internal/internal/threads/${THREAD_ID}/messages?limit=1&before=message-2`,
  );
});

test("rejects invalid cursor page parameters before calling the agent", async () => {
  let calls = 0;
  const agentWorker = {
    fetch: async () => {
      calls += 1;
      return Response.json({ messages });
    },
  };

  const response = await app.fetch(
    new Request(`https://public-auth.syn-forge.com/threads/${THREAD_ID}/messages?limit=0`, {
      headers: {
        Origin: ORIGIN,
        Cookie: `${SESSION_COOKIE}=${SESSION_VALUE}`,
      },
    }),
    environment(new ThreadDatabase(true), agentWorker) as never,
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: {
      code: "INVALID_MESSAGE_CURSOR",
      message: "That history page is not valid.",
    },
  });
  assert.equal(calls, 0);
});

test("does not reveal history for an unauthenticated or foreign thread", async () => {
  let calls = 0;
  const agentWorker = {
    fetch: async () => {
      calls += 1;
      return Response.json({ messages });
    },
  };

  const unauthenticated = await app.fetch(
    new Request(`https://public-auth.syn-forge.com/threads/${THREAD_ID}/messages`, {
      headers: { Origin: ORIGIN },
    }),
    environment(new ThreadDatabase(true), agentWorker) as never,
  );
  assert.equal(unauthenticated.status, 401);

  const foreign = await app.fetch(
    historyRequest(),
    environment(new ThreadDatabase(false), agentWorker) as never,
  );
  assert.equal(foreign.status, 404);
  assert.equal(calls, 0);
});

test("fails closed when the agent history payload is malformed", async () => {
  const response = await app.fetch(
    historyRequest(),
    environment(new ThreadDatabase(true), {
      fetch: async () => Response.json({ messages: "not-an-array" }),
    }) as never,
  );

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: {
      code: "AGENT_UNAVAILABLE",
      message: "Thread history is temporarily unavailable.",
    },
  });
});
