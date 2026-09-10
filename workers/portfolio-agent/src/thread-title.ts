import type { D1Database } from "@cloudflare/workers-types";
import type { ModelMessage } from "ai";
import type { AgentProps } from "./config.ts";
import { emitPortfolioAgentDiagnostic, type PortfolioAgentDiagnosticSink } from "./diagnostics.ts";
import { isRefundableModelCapacityFailure } from "./errors.ts";
import {
  buildThreadTitlePrompt,
  estimateModelTokens,
  firstUserQuestion,
  formatThreadTitle,
  THREAD_TITLE_OUTPUT_TOKEN_LIMIT,
  THREAD_TITLE_PROVISIONAL_OUTPUT_TOKEN_ALLOWANCE,
  THREAD_TITLE_SYSTEM_PROMPT,
} from "./limits.ts";
import {
  type ActualTokenUsage,
  consumeRollingQuota,
  estimateQuotaUnits,
  releaseRollingTokenReservation,
  settleRollingTokenUsage,
} from "./quota.ts";

export type ThreadTitleGenerationRequest = {
  system: typeof THREAD_TITLE_SYSTEM_PROMPT;
  messages: ModelMessage[];
  maxOutputTokens: typeof THREAD_TITLE_OUTPUT_TOKEN_LIMIT;
  reasoning: "none";
  abortSignal?: AbortSignal;
};

export type ThreadTitleGenerationResult = {
  text: string;
  usage: ActualTokenUsage;
};

export type ThreadTitleGenerator = (
  request: ThreadTitleGenerationRequest,
) => Promise<ThreadTitleGenerationResult>;

export type ThreadTitleSkipReason =
  | "missing-identity"
  | "missing-question"
  | "missing-answer"
  | "aborted"
  | "thread-not-untitled"
  | "rolling-limit"
  | "paused"
  | "configuration"
  | "empty-output"
  | "not-updated";

export type ThreadTitlePersistenceResult =
  | { outcome: "updated" }
  | { outcome: "skipped"; reason: ThreadTitleSkipReason }
  | { outcome: "failed"; reason: "provider-error" | "database-update" };

export type PersistGeneratedThreadTitleOptions = {
  database: D1Database;
  identity: Pick<AgentProps, "sub" | "tid"> | null;
  messages: readonly unknown[];
  answer: string;
  abortSignal?: AbortSignal;
  requestId?: string;
  diagnosticSink?: PortfolioAgentDiagnosticSink;
  generateTitle: ThreadTitleGenerator;
  reserveQuota?: typeof consumeRollingQuota;
  releaseQuota?: typeof releaseRollingTokenReservation;
  settleUsage?: typeof settleRollingTokenUsage;
};

function emitTitleDiagnostic(
  options: PersistGeneratedThreadTitleOptions,
  outcome: "started" | "succeeded" | "failed" | "skipped",
  startedAt: number,
  reason?: string,
): void {
  emitPortfolioAgentDiagnostic(options.diagnosticSink, {
    phase: "thread-title",
    outcome,
    reason,
    elapsedMs: Date.now() - startedAt,
    requestId: options.requestId,
  });
}

function skipped(
  options: PersistGeneratedThreadTitleOptions,
  startedAt: number,
  reason: ThreadTitleSkipReason,
): ThreadTitlePersistenceResult {
  emitTitleDiagnostic(options, "skipped", startedAt, reason);
  return { outcome: "skipped", reason };
}

/**
 * A title is eligible only when the model produced a visible, non-error answer.
 * Evidence success is tracked separately because a completed fallback answer is
 * still a visible turn that should receive a first-writer-wins title attempt.
 */
export function isThreadTitleEligible(
  finishReason: string,
  answer: string,
  aborted = false,
): boolean {
  return finishReason !== "error" && answer.trim().length > 0 && !aborted;
}

/**
 * Generate and persist the first successful title for a thread.
 *
 * The model adapter is injected so this orchestration can be tested without
 * reaching Workers AI. The SQL predicates remain the authorization and
 * first-writer-wins boundary.
 */
export async function persistGeneratedThreadTitle(
  options: PersistGeneratedThreadTitleOptions,
): Promise<ThreadTitlePersistenceResult> {
  const startedAt = Date.now();
  const identity = options.identity;
  if (!identity) return skipped(options, startedAt, "missing-identity");

  const question = firstUserQuestion(options.messages);
  if (!question) return skipped(options, startedAt, "missing-question");
  if (!options.answer.trim()) return skipped(options, startedAt, "missing-answer");
  if (options.abortSignal?.aborted) return skipped(options, startedAt, "aborted");

  emitTitleDiagnostic(options, "started", startedAt);

  try {
    const thread = await options.database
      .prepare(
        "SELECT title FROM threads WHERE id = ?1 AND sub = ?2 AND deleted_at IS NULL AND (title IS NULL OR title = '')",
      )
      .bind(identity.tid, identity.sub)
      .first<{ title: string | null }>();
    if (!thread) return skipped(options, startedAt, "thread-not-untitled");

    const titleMessages: ModelMessage[] = [
      {
        role: "user",
        content: buildThreadTitlePrompt(question, options.answer),
      },
    ];
    const reserveQuota = options.reserveQuota ?? consumeRollingQuota;
    const titleQuota = await reserveQuota(
      options.database,
      identity.sub,
      estimateQuotaUnits(
        estimateModelTokens(THREAD_TITLE_SYSTEM_PROMPT, titleMessages),
        THREAD_TITLE_PROVISIONAL_OUTPUT_TOKEN_ALLOWANCE,
      ),
    );
    if (!titleQuota.allowed) {
      return skipped(options, startedAt, titleQuota.reason);
    }

    let titleResult: ThreadTitleGenerationResult;
    try {
      titleResult = await options.generateTitle({
        system: THREAD_TITLE_SYSTEM_PROMPT,
        messages: titleMessages,
        maxOutputTokens: THREAD_TITLE_OUTPUT_TOKEN_LIMIT,
        reasoning: "none",
        abortSignal: options.abortSignal,
      });
    } catch (error) {
      if (options.abortSignal?.aborted) return skipped(options, startedAt, "aborted");
      if (isRefundableModelCapacityFailure(error, false)) {
        const releaseQuota = options.releaseQuota ?? releaseRollingTokenReservation;
        await releaseQuota(options.database, titleQuota.reservationId).catch(() => false);
      }
      emitTitleDiagnostic(options, "failed", startedAt, "provider-error");
      return { outcome: "failed", reason: "provider-error" };
    }

    const settleUsage = options.settleUsage ?? settleRollingTokenUsage;
    try {
      const settled = await settleUsage(
        options.database,
        titleQuota.reservationId,
        titleResult.usage,
      );
      if (!settled) {
        emitTitleDiagnostic(options, "failed", startedAt, "settlement-failed");
      }
    } catch {
      emitTitleDiagnostic(options, "failed", startedAt, "settlement-failed");
    }

    const title = formatThreadTitle(titleResult.text);
    if (!title) return skipped(options, startedAt, "empty-output");

    const update = await options.database
      .prepare(
        "UPDATE threads SET title = ?1, updated_at = ?2 WHERE id = ?3 AND sub = ?4 AND deleted_at IS NULL AND (title IS NULL OR title = '')",
      )
      .bind(title, Date.now(), identity.tid, identity.sub)
      .run();
    if (update.meta.changes !== 1) return skipped(options, startedAt, "not-updated");

    emitTitleDiagnostic(options, "succeeded", startedAt, "completed");
    return { outcome: "updated" };
  } catch {
    emitTitleDiagnostic(options, "failed", startedAt, "database-update");
    return { outcome: "failed", reason: "database-update" };
  }
}
