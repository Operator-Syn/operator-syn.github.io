import assert from "node:assert/strict";
import { test } from "node:test";
import type { D1Database } from "@cloudflare/workers-types";
import { streamText } from "ai";
import { isRefundableModelCapacityFailure } from "../../workers/portfolio-agent/src/errors.ts";
import type { QuotaDecision } from "../../workers/portfolio-agent/src/quota.ts";
import { isModelOutputChunkType } from "../../workers/portfolio-agent/src/stream.ts";
import {
  isThreadTitleEligible,
  persistGeneratedThreadTitle,
} from "../../workers/portfolio-agent/src/thread-title.ts";

const THREAD_ID = "thread-stream-title-1234";
const SUBJECT = "stream-title-subject";
const QUESTION = "Which projects use TypeScript?";
const ANSWER = "The completed answer does not need evidence metadata to be visible.";

function usage() {
  return {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  };
}

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

test("persists a title from a completed visible stream without evidence success", async () => {
  let title: string | null = null;
  const database = {
    prepare(sql: string) {
      return {
        bind: (...args: unknown[]) => ({
          first: async <T>() =>
            sql.includes("SELECT title FROM threads") ? ({ title } as T) : null,
          run: async () => {
            if (sql.startsWith("UPDATE threads SET title")) {
              title = args[0] as string;
            }
            return { meta: { changes: 1 } };
          },
        }),
      };
    },
  } as unknown as D1Database;
  let titleCalls = 0;
  const model = {
    specificationVersion: "v3",
    provider: "portfolio-title-stream-fixture",
    modelId: "completed-visible-answer",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("The regression harness uses streaming only.");
    },
    async doStream() {
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: "answer" });
            controller.enqueue({ type: "text-delta", id: "answer", delta: ANSWER });
            controller.enqueue({ type: "text-end", id: "answer" });
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: usage(),
            });
            controller.close();
          },
        }),
      };
    },
  };

  const result = streamText({
    model: model as never,
    messages: [{ role: "user", content: QUESTION }],
    onEnd: async ({ finishReason, text }) => {
      if (!isThreadTitleEligible(finishReason, text)) return;
      titleCalls += 1;
      const persistence = await persistGeneratedThreadTitle({
        database,
        identity: { sub: SUBJECT, tid: THREAD_ID },
        messages: [
          {
            role: "user",
            parts: [{ type: "text", text: QUESTION }],
          },
        ],
        answer: text,
        generateTitle: async () => ({
          text: "TypeScript Portfolio",
          usage: { inputTokens: 1, outputTokens: 2 },
        }),
        reserveQuota: async () => allowQuota(),
        settleUsage: async () => true,
      });
      assert.deepEqual(persistence, { outcome: "updated" });
    },
  });

  await result.consumeStream();
  assert.equal(titleCalls, 1);
  assert.equal(title, "TypeScript Portfolio");
  assert.equal(await result.text, ANSWER);
});

test("refunds a pre-output provider capacity stream failure", async () => {
  let modelOutputObserved = false;
  let releaseCalls = 0;
  let onEndCalls = 0;
  const model = {
    specificationVersion: "v4",
    provider: "portfolio-capacity-fixture",
    modelId: "pre-output-capacity-failure",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("unused");
    },
    async doStream() {
      throw new Error("daily Workers AI allocation has been used up");
    },
  };

  const result = streamText({
    model: model as never,
    messages: [{ role: "user", content: QUESTION }],
    onChunk: ({ chunk }) => {
      if (isModelOutputChunkType(chunk.type)) modelOutputObserved = true;
    },
    onError: async ({ error }) => {
      if (isRefundableModelCapacityFailure(error, modelOutputObserved)) releaseCalls += 1;
    },
    onEnd: () => {
      onEndCalls += 1;
    },
  });

  const chunks: string[] = [];
  for await (const chunk of result.fullStream) chunks.push(chunk.type);
  assert.deepEqual(chunks, ["start", "error"]);
  assert.equal(modelOutputObserved, false);
  assert.equal(releaseCalls, 1);
  assert.equal(onEndCalls, 0);
});

test("keeps a partial provider failure provisional", async () => {
  let modelOutputObserved = false;
  let releaseCalls = 0;
  let onEndCalls = 0;
  const model = {
    specificationVersion: "v4",
    provider: "portfolio-capacity-fixture",
    modelId: "partial-capacity-failure",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("unused");
    },
    async doStream() {
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: "partial" });
            controller.enqueue({ type: "text-delta", id: "partial", delta: "partial" });
            controller.enqueue({ type: "error", error: new Error("out of capacity") });
            controller.close();
          },
        }),
      };
    },
  };

  const result = streamText({
    model: model as never,
    messages: [{ role: "user", content: QUESTION }],
    onChunk: ({ chunk }) => {
      if (isModelOutputChunkType(chunk.type)) modelOutputObserved = true;
    },
    onError: async ({ error }) => {
      if (isRefundableModelCapacityFailure(error, modelOutputObserved)) releaseCalls += 1;
    },
    onEnd: () => {
      onEndCalls += 1;
    },
  });

  for await (const chunk of result.fullStream) void chunk;
  assert.equal(modelOutputObserved, true);
  assert.equal(releaseCalls, 0);
  assert.equal(onEndCalls, 1);
});
