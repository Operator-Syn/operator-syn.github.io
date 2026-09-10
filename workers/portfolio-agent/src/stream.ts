import type { UIMessageChunk } from "ai";
import type { PortfolioSource } from "./evidence.ts";

type ToolInputDelta = Extract<UIMessageChunk, { type: "tool-input-delta" }>;

function isToolInputDelta(chunk: UIMessageChunk): chunk is ToolInputDelta {
  return chunk.type === "tool-input-delta";
}

/**
 * Identify chunks that prove the provider emitted model output. Control, error,
 * and local tool-result chunks must not make a pre-output capacity rejection
 * non-refundable.
 */
export function isModelOutputChunkType(type: string): boolean {
  return (
    type === "text-start" ||
    type === "text-delta" ||
    type === "text-end" ||
    type === "reasoning-start" ||
    type === "reasoning-delta" ||
    type === "reasoning-end" ||
    type === "tool-call" ||
    type === "tool-input-start" ||
    type === "tool-input-delta" ||
    type === "tool-input-end" ||
    type === "tool-approval-request" ||
    type === "source-url" ||
    type === "source-document" ||
    type === "file" ||
    type === "reasoning-file"
  );
}

export function coalesceToolInputDeltas(
  stream: ReadableStream<UIMessageChunk>,
): ReadableStream<UIMessageChunk> {
  let pending: ToolInputDelta | undefined;

  return stream.pipeThrough(
    new TransformStream<UIMessageChunk, UIMessageChunk>({
      transform(chunk, controller) {
        if (!isToolInputDelta(chunk)) {
          if (pending) {
            controller.enqueue(pending);
            pending = undefined;
          }
          controller.enqueue(chunk);
          return;
        }

        if (pending?.toolCallId === chunk.toolCallId) {
          pending = {
            ...pending,
            inputTextDelta: pending.inputTextDelta + chunk.inputTextDelta,
          };
          return;
        }

        if (pending) controller.enqueue(pending);
        pending = { ...chunk };
      },
      flush(controller) {
        if (pending) controller.enqueue(pending);
      },
    }),
  );
}

type PortfolioAnswerStreamOptions = {
  hasEvidence: () => boolean;
  sources: () => readonly PortfolioSource[];
  fallbackMessage: string;
};

function textPartId(chunk: UIMessageChunk): string | null {
  if (chunk.type !== "text-start" && chunk.type !== "text-delta" && chunk.type !== "text-end") {
    return null;
  }
  return chunk.id;
}

/**
 * Preserve native model tool activity while preventing unsupported text from
 * becoming the accepted answer. Canonical sources are emitted only after the
 * model/tool loop has produced usable portfolio evidence.
 */
export function boundPortfolioAnswerStream(
  stream: ReadableStream<UIMessageChunk>,
  options: PortfolioAnswerStreamOptions,
): ReadableStream<UIMessageChunk> {
  const suppressedTextIds = new Set<string>();

  return stream.pipeThrough(
    new TransformStream<UIMessageChunk, UIMessageChunk>({
      transform(chunk, controller) {
        if (chunk.type === "finish") return;

        const id = textPartId(chunk);
        if (id) {
          if (!options.hasEvidence()) suppressedTextIds.add(id);
          if (suppressedTextIds.has(id)) return;
        }
        controller.enqueue(chunk);
      },
      flush(controller) {
        if (options.hasEvidence()) {
          options.sources().forEach((source, index) => {
            controller.enqueue({
              type: "source-url",
              sourceId: `portfolio-source-${String(index)}`,
              url: source.url,
              title: source.title,
            });
          });
        } else {
          const id = crypto.randomUUID();
          controller.enqueue({ type: "text-start", id });
          controller.enqueue({ type: "text-delta", id, delta: options.fallbackMessage });
          controller.enqueue({ type: "text-end", id });
        }
        controller.enqueue({ type: "finish", finishReason: "stop" });
      },
    }),
  );
}
