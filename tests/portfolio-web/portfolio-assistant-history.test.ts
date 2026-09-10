import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  createThread,
  getAssistantQuota,
  getSession,
  getThreadMessages,
  getThreadMessagesPage,
  PortfolioAssistantRequestError,
  prepareAgentConnection,
} from "../../apps/portfolio-web/src/components/portfolioAssistant/portfolioAssistantApi.ts";

const repositoryRoot = resolve(import.meta.dirname, "../../");
const fabPath = resolve(
  repositoryRoot,
  "apps/portfolio-web/src/components/portfolioAssistant/PortfolioAssistantFab.tsx",
);

const threadId = "ThreadHistory123456";

test("accepts an explicitly nullable title when creating a new thread", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ id: threadId, createdAt: 1, updatedAt: 1, title: null });

  try {
    assert.deepEqual(await createThread(), {
      id: threadId,
      createdAt: 1,
      updatedAt: 1,
      title: null,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("loads persisted messages through public-auth without reusing the WebSocket token", async () => {
  const expectedMessages = [
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
  let captured:
    | {
        credentials: RequestCredentials | undefined;
        url: string;
        authorization: string | null;
      }
    | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    captured = {
      credentials: init?.credentials,
      url: String(input),
      authorization: headers.get("Authorization"),
    };
    return Response.json({ messages: expectedMessages });
  };

  try {
    const messages = await getThreadMessages(threadId);
    assert.deepEqual(messages, expectedMessages);
    assert.equal(captured?.url, `https://public-auth.syn-forge.com/threads/${threadId}/messages`);
    assert.equal(captured?.credentials, "include");
    assert.equal(captured?.authorization, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("requests a bounded recent history page with a cursor", async () => {
  const expectedPage = {
    messages: [
      {
        id: "message-2",
        role: "assistant",
        parts: [{ type: "text", text: "The portfolio includes several TypeScript projects." }],
      },
    ],
    nextCursor: "message-1",
    hasMore: true,
  };
  let capturedUrl = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    capturedUrl = String(input);
    return Response.json(expectedPage);
  };

  try {
    assert.deepEqual(
      await getThreadMessagesPage(threadId, { before: "message-2", limit: 1 }),
      expectedPage,
    );
    assert.equal(
      capturedUrl,
      `https://public-auth.syn-forge.com/threads/${threadId}/messages?limit=1&before=message-2`,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("loads the authenticated rolling quota through public-auth", async () => {
  let captured:
    | { cache: RequestCache | undefined; credentials: RequestCredentials | undefined; url: string }
    | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    captured = { cache: init?.cache, credentials: init?.credentials, url: String(input) };
    return Response.json({
      usedTokens: 125_000,
      settledTokens: 125_000,
      provisionalTokens: 0,
      budgetTokens: 1_000_000,
      remainingTokens: 875_000,
      resetAt: Date.parse("2026-08-31T00:25:00.000Z"),
    });
  };

  try {
    assert.deepEqual(await getAssistantQuota(), {
      usedTokens: 125_000,
      settledTokens: 125_000,
      provisionalTokens: 0,
      budgetTokens: 1_000_000,
      remainingTokens: 875_000,
      resetAt: Date.parse("2026-08-31T00:25:00.000Z"),
    });
    assert.equal(captured?.url, "https://public-auth.syn-forge.com/quota");
    assert.equal(captured?.credentials, "include");
    assert.equal(captured?.cache, "no-store");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects malformed rolling quota payloads", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ usedTokens: "125000" });

  try {
    await assert.rejects(getAssistantQuota(), /assistant budget could not be loaded/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("treats a missing session response as a normal signed-out state", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ authenticated: false }, { status: 401 });

  try {
    assert.deepEqual(await getSession(), { authenticated: false });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not hide coded session failures as signed-out state", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json(
      { error: { code: "SESSION_STORE_UNAVAILABLE", message: "Session store unavailable." } },
      { status: 401 },
    );

  try {
    await assert.rejects(getSession(), (error: unknown) => {
      assert.ok(error instanceof PortfolioAssistantRequestError);
      assert.equal(error.status, 401);
      assert.equal(error.code, "SESSION_STORE_UNAVAILABLE");
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hydrates each selected thread through the ownership-checked history loader", async () => {
  const fabSource = await readFile(fabPath, "utf8");

  assert.match(fabSource, /getInitialMessages: loadInitialMessages/);
  assert.match(fabSource, /getThreadMessagesPage\(threadId/);
  assert.match(fabSource, /ASSISTANT_HISTORY_PAGE_SIZE/);
  assert.match(fabSource, /useThreadHistory\(threadId\)/);
  assert.match(fabSource, /AssistantHistoryState/);
  assert.match(fabSource, /The saved conversation could not be loaded/);
  assert.doesNotMatch(fabSource, /getInitialMessages:\s*null/);

  const assistantChatSource = fabSource.slice(
    fabSource.indexOf("function AssistantChat("),
    fabSource.indexOf("function AssistantChatBoundary("),
  );
  assert.match(assistantChatSource, /getAttemptId/);
  assert.doesNotMatch(assistantChatSource, /issueAgentToken/);
});

test("prepares a cookie-authenticated assistant connection without returning a bearer token", async () => {
  let captured:
    | { body: string | null; credentials: RequestCredentials | undefined; url: string }
    | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    captured = {
      body: typeof init?.body === "string" ? init.body : null,
      credentials: init?.credentials,
      url: String(input),
    };
    return Response.json({
      ready: true,
      threadId,
      attemptId: "attempt_123456789012",
    });
  };

  try {
    assert.deepEqual(await prepareAgentConnection(threadId), {
      ready: true,
      threadId,
      attemptId: "attempt_123456789012",
    });
    assert.equal(captured?.url, "https://public-auth.syn-forge.com/agent/prepare");
    assert.equal(captured?.credentials, "include");
    assert.deepEqual(JSON.parse(captured?.body ?? "{}"), { threadId });
    assert.doesNotMatch(captured?.body ?? "", /token|authorization|eyJ/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects an assistant connection preparation for another thread", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      ready: true,
      threadId: "OtherThread123456",
      attemptId: "attempt_123456789012",
    });

  try {
    await assert.rejects(prepareAgentConnection(threadId), /connection could not be prepared/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preserves rate-limit details for a user-facing assistant error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json(
      {
        error: {
          code: "ROLLING_LIMIT",
          message: "The rolling 1-hour assistant budget is full.",
        },
      },
      { status: 429, headers: { "Retry-After": "3600" } },
    );

  try {
    await assert.rejects(prepareAgentConnection(threadId), (error: unknown) => {
      assert.ok(error instanceof PortfolioAssistantRequestError);
      assert.equal(error.status, 429);
      assert.equal(error.code, "ROLLING_LIMIT");
      assert.equal(error.retryAfterSeconds, 3_600);
      assert.equal(error.message, "The rolling 1-hour assistant budget is full.");
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
