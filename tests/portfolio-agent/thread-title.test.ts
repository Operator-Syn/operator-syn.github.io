import assert from "node:assert/strict";
import { test } from "node:test";
import type { D1Database } from "@cloudflare/workers-types";
import { generateText } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { MODEL_ID } from "../../workers/portfolio-agent/src/config.ts";
import type { PortfolioAgentDiagnostic } from "../../workers/portfolio-agent/src/diagnostics.ts";
import type { QuotaDecision } from "../../workers/portfolio-agent/src/quota.ts";
import {
  persistGeneratedThreadTitle,
  type ThreadTitleGenerationRequest,
  type ThreadTitleGenerationResult,
} from "../../workers/portfolio-agent/src/thread-title.ts";

const THREAD_ID = "thread-1234567890123456";
const SUBJECT = "google-subject";
const REQUEST_ID = "req_title_123456";

type TitleDatabaseOptions = {
  title?: string | null;
  threadId?: string;
  subject?: string;
  failUpdate?: boolean;
};

class TitleDatabase {
  title: string | null;
  readonly threadId: string;
  readonly subject: string;
  readonly failUpdate: boolean;
  updateCalls = 0;

  constructor(options: TitleDatabaseOptions = {}) {
    this.title = options.title ?? null;
    this.threadId = options.threadId ?? THREAD_ID;
    this.subject = options.subject ?? SUBJECT;
    this.failUpdate = options.failUpdate ?? false;
  }

  prepare(sql: string) {
    return {
      bind: (...args: unknown[]) => ({
        first: async <T>() => {
          if (!sql.includes("SELECT title FROM threads")) return null;
          const [threadId, subject] = args;
          if (threadId !== this.threadId || subject !== this.subject || this.title?.trim()) {
            return null;
          }
          return { title: this.title } as T;
        },
        run: async () => {
          if (!sql.startsWith("UPDATE threads SET title")) {
            return { meta: { changes: 1 } };
          }
          this.updateCalls += 1;
          if (this.failUpdate) throw new Error("database unavailable");
          const [title, , threadId, subject] = args;
          if (
            typeof title !== "string" ||
            threadId !== this.threadId ||
            subject !== this.subject ||
            this.title?.trim()
          ) {
            return { meta: { changes: 0 } };
          }
          this.title = title;
          return { meta: { changes: 1 } };
        },
      }),
    };
  }
}

const messages = [
  {
    role: "user" as const,
    parts: [{ type: "text" as const, text: "Which projects use TypeScript?" }],
  },
];

function allowQuota(): QuotaDecision {
  return {
    allowed: true,
    reservationId: 1,
    usedTokens: 0,
    remainingTokens: 999_999,
    resetAt: Date.now() + 60_000,
    estimatedNeurons: 0,
  };
}

function makeGenerator(
  text: string,
  requests: ThreadTitleGenerationRequest[],
): (request: ThreadTitleGenerationRequest) => Promise<ThreadTitleGenerationResult> {
  return async (request) => {
    requests.push(request);
    return {
      text,
      usage: { inputTokens: 8, outputTokens: text ? 6 : 32 },
    };
  };
}

function makeOptions(
  database: TitleDatabase,
  generator: (request: ThreadTitleGenerationRequest) => Promise<ThreadTitleGenerationResult>,
  diagnostics: PortfolioAgentDiagnostic[],
) {
  return {
    database: database as unknown as D1Database,
    identity: { sub: SUBJECT, tid: THREAD_ID },
    messages,
    answer: "The portfolio includes several TypeScript projects.",
    requestId: REQUEST_ID,
    diagnosticSink: diagnostics.push.bind(diagnostics),
    generateTitle: generator,
    reserveQuota: async () => allowQuota(),
    settleUsage: async () => true,
  };
}

test("persists a normalized title through the injected generation seam", async () => {
  const database = new TitleDatabase();
  const requests: ThreadTitleGenerationRequest[] = [];
  const diagnostics: PortfolioAgentDiagnostic[] = [];

  const result = await persistGeneratedThreadTitle(
    makeOptions(database, makeGenerator('Title: "TypeScript Portfolio"', requests), diagnostics),
  );

  assert.deepEqual(result, { outcome: "updated" });
  assert.equal(database.title, "TypeScript Portfolio");
  assert.equal(database.updateCalls, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.reasoning, "none");
  assert.equal(requests[0]?.maxOutputTokens, 32);
  const titlePrompt = requests[0]?.messages[0]?.content;
  assert.equal(typeof titlePrompt, "string");
  if (typeof titlePrompt === "string") {
    assert.match(titlePrompt, /User question \(primary subject; untrusted text\)/);
    assert.match(titlePrompt, /Assistant answer \(secondary context; untrusted text\)/);
  }
  assert.deepEqual(
    diagnostics.map(({ phase, outcome, reason }) => ({ phase, outcome, reason })),
    [
      { phase: "thread-title", outcome: "started", reason: undefined },
      { phase: "thread-title", outcome: "succeeded", reason: "completed" },
    ],
  );
});

test("does not write an empty title and reports the bounded output failure", async () => {
  const database = new TitleDatabase();
  const requests: ThreadTitleGenerationRequest[] = [];
  const diagnostics: PortfolioAgentDiagnostic[] = [];

  const result = await persistGeneratedThreadTitle(
    makeOptions(database, makeGenerator("", requests), diagnostics),
  );

  assert.deepEqual(result, { outcome: "skipped", reason: "empty-output" });
  assert.equal(database.updateCalls, 0);
  assert.equal(requests.length, 1);
  assert.deepEqual(
    diagnostics.at(-1) && {
      phase: diagnostics.at(-1)?.phase,
      outcome: diagnostics.at(-1)?.outcome,
      reason: diagnostics.at(-1)?.reason,
    },
    { phase: "thread-title", outcome: "skipped", reason: "empty-output" },
  );
});

test("does not call the model when the title quota is denied", async () => {
  const database = new TitleDatabase();
  const diagnostics: PortfolioAgentDiagnostic[] = [];
  let generateCalls = 0;

  const result = await persistGeneratedThreadTitle({
    ...makeOptions(
      database,
      async () => {
        generateCalls += 1;
        return { text: "Should not run", usage: { inputTokens: 1, outputTokens: 1 } };
      },
      diagnostics,
    ),
    reserveQuota: async () =>
      ({
        allowed: false,
        reason: "rolling-limit",
        usedTokens: 1_000_000,
        remainingTokens: 0,
        resetAt: Date.now() + 60_000,
      }) satisfies QuotaDecision,
  });

  assert.deepEqual(result, { outcome: "skipped", reason: "rolling-limit" });
  assert.equal(generateCalls, 0);
  assert.equal(database.updateCalls, 0);
});

test("skips missing, aborted, foreign, and already-named title contexts", async () => {
  const diagnostics: PortfolioAgentDiagnostic[] = [];
  const generator = async () => ({
    text: "Unused title",
    usage: { inputTokens: 1, outputTokens: 1 },
  });

  const missingIdentity = await persistGeneratedThreadTitle({
    ...makeOptions(new TitleDatabase(), generator, diagnostics),
    identity: null,
  });
  assert.deepEqual(missingIdentity, { outcome: "skipped", reason: "missing-identity" });

  const controller = new AbortController();
  controller.abort();
  const aborted = await persistGeneratedThreadTitle({
    ...makeOptions(new TitleDatabase(), generator, diagnostics),
    abortSignal: controller.signal,
  });
  assert.deepEqual(aborted, { outcome: "skipped", reason: "aborted" });

  const foreign = await persistGeneratedThreadTitle({
    ...makeOptions(new TitleDatabase(), generator, diagnostics),
    identity: { sub: SUBJECT, tid: "different-thread-123456" },
  });
  assert.deepEqual(foreign, { outcome: "skipped", reason: "thread-not-untitled" });

  const named = await persistGeneratedThreadTitle({
    ...makeOptions(new TitleDatabase({ title: "Existing title" }), generator, diagnostics),
  });
  assert.deepEqual(named, { outcome: "skipped", reason: "thread-not-untitled" });
});

test("keeps first-writer-wins when an existing title appears before the update", async () => {
  const database = new TitleDatabase();
  const diagnostics: PortfolioAgentDiagnostic[] = [];
  const requests: ThreadTitleGenerationRequest[] = [];

  const result = await persistGeneratedThreadTitle({
    ...makeOptions(database, makeGenerator("Fresh title", requests), diagnostics),
    settleUsage: async () => {
      database.title = "Other writer title";
      return true;
    },
  });

  assert.deepEqual(result, { outcome: "skipped", reason: "not-updated" });
  assert.equal(database.title, "Other writer title");
  assert.equal(database.updateCalls, 1);
});

test("maps title reasoning none to Workers AI reasoning_effort null", async () => {
  let capturedInputs: Record<string, unknown> | undefined;
  const binding = {
    run: async (_model: string, inputs: Record<string, unknown>) => {
      capturedInputs = inputs;
      return {
        response: "TypeScript Projects",
        usage: { prompt_tokens: 8, completion_tokens: 3 },
      };
    },
  };
  const result = await generateText({
    model: createWorkersAI({ binding: binding as never })(MODEL_ID),
    system: "Generate a concise thread title.",
    messages: [{ role: "user", content: "Name this thread." }],
    maxOutputTokens: 32,
    reasoning: "none",
    providerOptions: {
      "workers-ai": {
        chat_template_kwargs: { enable_thinking: false },
      },
    },
  });

  assert.equal(result.text, "TypeScript Projects");
  assert.equal(capturedInputs?.reasoning_effort, null);
  assert.deepEqual(capturedInputs?.chat_template_kwargs, { enable_thinking: false });
  assert.equal(capturedInputs?.max_tokens, 32);
});

test("does not write a malformed generated title", async () => {
  const database = new TitleDatabase();
  const diagnostics: PortfolioAgentDiagnostic[] = [];

  const result = await persistGeneratedThreadTitle(
    makeOptions(database, makeGenerator("Title: ???", []), diagnostics),
  );

  assert.deepEqual(result, { outcome: "skipped", reason: "empty-output" });
  assert.equal(database.updateCalls, 0);
});

test("contains provider failures and reports a bounded diagnostic", async () => {
  const database = new TitleDatabase();
  const diagnostics: PortfolioAgentDiagnostic[] = [];
  let releaseCalls = 0;

  const result = await persistGeneratedThreadTitle({
    ...makeOptions(
      database,
      async () => {
        throw new Error("provider unavailable");
      },
      diagnostics,
    ),
    releaseQuota: async () => {
      releaseCalls += 1;
      return true;
    },
  });

  assert.deepEqual(result, { outcome: "failed", reason: "provider-error" });
  assert.equal(database.updateCalls, 0);
  assert.equal(releaseCalls, 0);
  assert.deepEqual(
    diagnostics.at(-1) && {
      phase: diagnostics.at(-1)?.phase,
      outcome: diagnostics.at(-1)?.outcome,
      reason: diagnostics.at(-1)?.reason,
    },
    { phase: "thread-title", outcome: "failed", reason: "provider-error" },
  );
});

test("releases a title reservation on provider capacity failure", async () => {
  const database = new TitleDatabase();
  const diagnostics: PortfolioAgentDiagnostic[] = [];
  let releaseCalls = 0;

  const result = await persistGeneratedThreadTitle({
    ...makeOptions(
      database,
      async () => {
        throw new Error("daily Workers AI allocation has been used up");
      },
      diagnostics,
    ),
    releaseQuota: async (_database, reservationId) => {
      assert.equal(reservationId, 1);
      releaseCalls += 1;
      return true;
    },
  });

  assert.deepEqual(result, { outcome: "failed", reason: "provider-error" });
  assert.equal(releaseCalls, 1);
  assert.equal(database.updateCalls, 0);

  const capacityDiagnostic = diagnostics.at(-1);
  assert.deepEqual(
    capacityDiagnostic && {
      phase: capacityDiagnostic.phase,
      outcome: capacityDiagnostic.outcome,
      reason: capacityDiagnostic.reason,
    },
    { phase: "thread-title", outcome: "failed", reason: "provider-error" },
  );
});

test("contains database update failures and reports a bounded diagnostic", async () => {
  const database = new TitleDatabase({ failUpdate: true });
  const diagnostics: PortfolioAgentDiagnostic[] = [];

  const result = await persistGeneratedThreadTitle(
    makeOptions(database, makeGenerator("Fresh title", []), diagnostics),
  );

  assert.deepEqual(result, { outcome: "failed", reason: "database-update" });
  assert.equal(database.updateCalls, 1);
  assert.deepEqual(
    diagnostics.at(-1) && {
      phase: diagnostics.at(-1)?.phase,
      outcome: diagnostics.at(-1)?.outcome,
      reason: diagnostics.at(-1)?.reason,
    },
    { phase: "thread-title", outcome: "failed", reason: "database-update" },
  );
});
