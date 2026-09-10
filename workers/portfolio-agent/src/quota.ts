import type { D1Database } from "@cloudflare/workers-types";
import type { LanguageModelUsage } from "ai";
import { ROLLING_TOKEN_BUDGET, ROLLING_TOKEN_WINDOW_MS } from "./config.ts";

export const INPUT_TOKEN_WEIGHT = 0.25;
export const OUTPUT_TOKEN_WEIGHT = 1;
export const PROVISIONAL_OUTPUT_TOKEN_ALLOWANCE = 700;

type LegacyInputTokenCounts = {
  total?: number;
  noCache?: number;
  cacheRead?: number;
};

export type ActualTokenUsage = {
  inputTokens: LanguageModelUsage["inputTokens"] | LegacyInputTokenCounts;
  outputTokens: LanguageModelUsage["outputTokens"];
  inputTokenDetails?: LanguageModelUsage["inputTokenDetails"];
  outputTokenDetails?: LanguageModelUsage["outputTokenDetails"];
};

export type WeightedQuotaUsage = {
  inputUnits: number;
  outputUnits: number;
  totalUnits: number;
};

export type RollingTokenReservationState =
  | "reserved"
  | "in-flight"
  | "settled"
  | "released"
  | "unknown";

export type RollingQuotaAvailability = "available" | "rolling-limit" | "paused" | "configuration";

type RollingUsage = {
  used_tokens: number;
  settled_tokens?: number;
  provisional_tokens?: number;
  oldest_created_at: number | null;
};

export type RollingBudgetDecision =
  | {
      allowed: true;
      reservationId: number;
      usedTokens: number;
      settledTokens?: number;
      provisionalTokens?: number;
      remainingTokens: number;
      resetAt: number;
    }
  | {
      allowed: false;
      reason: "rolling-limit" | "configuration";
      usedTokens: number;
      settledTokens?: number;
      provisionalTokens?: number;
      remainingTokens: number;
      resetAt: number;
    };

export type QuotaDecision =
  | (Extract<RollingBudgetDecision, { allowed: true }> & {
      estimatedNeurons: number;
    })
  | Extract<RollingBudgetDecision, { allowed: false }>
  | { allowed: false; reason: "paused" };

type AccountNeuronDecision =
  | { allowed: true; estimatedNeurons: number }
  | { allowed: false; reason: "paused" | "configuration" };

function usageResult(
  usage: RollingUsage | null,
  now: number,
): {
  usedTokens: number;
  settledTokens: number;
  provisionalTokens: number;
  remainingTokens: number;
  resetAt: number;
} {
  const usedTokens = Math.max(0, usage?.used_tokens ?? 0);
  const provisionalTokens = Math.max(0, usage?.provisional_tokens ?? 0);
  const settledTokens = Math.max(
    0,
    usage?.settled_tokens ?? Math.max(0, usedTokens - provisionalTokens),
  );
  const oldestCreatedAt = usage?.oldest_created_at;
  return {
    usedTokens,
    settledTokens,
    provisionalTokens,
    remainingTokens: Math.max(0, ROLLING_TOKEN_BUDGET - usedTokens),
    resetAt:
      typeof oldestCreatedAt === "number"
        ? oldestCreatedAt + ROLLING_TOKEN_WINDOW_MS
        : now + ROLLING_TOKEN_WINDOW_MS,
  };
}

async function readRollingUsage(
  database: D1Database,
  sub: string,
  cutoff: number,
): Promise<RollingUsage | null> {
  return database
    .prepare(
      "SELECT COALESCE(SUM(CASE WHEN actual_input_tokens IS NOT NULL AND actual_output_tokens IS NOT NULL THEN actual_input_tokens + actual_output_tokens WHEN state IN ('reserved', 'in-flight', 'unknown') THEN estimated_tokens ELSE 0 END), 0) AS used_tokens, COALESCE(SUM(CASE WHEN actual_input_tokens IS NOT NULL AND actual_output_tokens IS NOT NULL THEN actual_input_tokens + actual_output_tokens ELSE 0 END), 0) AS settled_tokens, COALESCE(SUM(CASE WHEN state IN ('reserved', 'in-flight', 'unknown') AND (actual_input_tokens IS NULL OR actual_output_tokens IS NULL) THEN estimated_tokens ELSE 0 END), 0) AS provisional_tokens, MIN(CASE WHEN state IN ('reserved', 'in-flight', 'unknown') AND (actual_input_tokens IS NULL OR actual_output_tokens IS NULL) THEN created_at END) AS oldest_created_at FROM rolling_token_usage WHERE sub = ?1 AND created_at > ?2",
    )
    .bind(sub, cutoff)
    .first<RollingUsage>();
}

async function reserveRollingTokens(
  database: D1Database,
  sub: string,
  provisionalTokens: number,
  now: number,
): Promise<RollingBudgetDecision> {
  const requested = Number.isFinite(provisionalTokens)
    ? Math.max(1, Math.ceil(provisionalTokens))
    : ROLLING_TOKEN_BUDGET + 1;
  const cutoff = now - ROLLING_TOKEN_WINDOW_MS;
  await database
    .prepare("DELETE FROM rolling_token_usage WHERE created_at <= ?1")
    .bind(cutoff)
    .run();

  // The conditional INSERT is a single SQLite statement. D1 serializes the
  // statement, so two threads for the same subject cannot both reserve the
  // final tokens based on the same stale SUM.
  const inserted = await database
    .prepare(
      "INSERT INTO rolling_token_usage (sub, created_at, estimated_tokens, state) SELECT ?1, ?2, ?3, 'reserved' WHERE ?3 <= ?4 AND ?3 + COALESCE((SELECT SUM(CASE WHEN actual_input_tokens IS NOT NULL AND actual_output_tokens IS NOT NULL THEN actual_input_tokens + actual_output_tokens WHEN state IN ('reserved', 'in-flight', 'unknown') THEN estimated_tokens ELSE 0 END) FROM rolling_token_usage WHERE sub = ?1 AND created_at > ?5), 0) <= ?4",
    )
    .bind(sub, now, requested, ROLLING_TOKEN_BUDGET, cutoff)
    .run();
  const usage = await readRollingUsage(database, sub, cutoff);
  if (!usage) {
    return { allowed: false, reason: "configuration", ...usageResult(null, now) };
  }
  const result = usageResult(usage, now);
  if (inserted.meta.changes !== 1) {
    return { allowed: false, reason: "rolling-limit", ...result };
  }
  const reservationId = inserted.meta.last_row_id;
  if (!Number.isSafeInteger(reservationId) || reservationId <= 0) {
    return { allowed: false, reason: "configuration", ...result };
  }
  return { allowed: true, reservationId, ...result };
}

function normalizeTokenCount(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.ceil(value)
    : null;
}

function uncachedInputTokenCount(usage: ActualTokenUsage): number | null {
  // AI SDK v7 exposes cache detail under inputTokenDetails; prefer its
  // provider-reported uncached count and derive it only when unavailable.
  const noCacheTokens = normalizeTokenCount(usage.inputTokenDetails?.noCacheTokens);
  if (noCacheTokens !== null) return noCacheTokens;

  if (typeof usage.inputTokens === "object" && usage.inputTokens !== null) {
    const legacyNoCacheTokens = normalizeTokenCount(usage.inputTokens.noCache);
    if (legacyNoCacheTokens !== null) return legacyNoCacheTokens;
    const legacyTotalTokens = normalizeTokenCount(usage.inputTokens.total);
    if (legacyTotalTokens === null) return null;
    const legacyCacheReadTokens = normalizeTokenCount(usage.inputTokens.cacheRead) ?? 0;
    return Math.max(0, legacyTotalTokens - legacyCacheReadTokens);
  }

  const inputTokens = normalizeTokenCount(usage.inputTokens);
  if (inputTokens === null) return null;
  const cacheReadTokens = normalizeTokenCount(usage.inputTokenDetails?.cacheReadTokens) ?? 0;
  return Math.max(0, inputTokens - cacheReadTokens);
}

function weightedQuotaUsage(inputTokens: number, outputTokens: number): WeightedQuotaUsage {
  const inputUnits = Math.ceil(inputTokens * INPUT_TOKEN_WEIGHT);
  const outputUnits = Math.ceil(outputTokens * OUTPUT_TOKEN_WEIGHT);
  return {
    inputUnits,
    outputUnits,
    totalUnits: inputUnits + outputUnits,
  };
}

export function calculateQuotaUnits(usage: ActualTokenUsage): WeightedQuotaUsage | null {
  const inputTokens = uncachedInputTokenCount(usage);
  const outputTokens = normalizeTokenCount(usage.outputTokens);
  if (inputTokens === null || outputTokens === null) return null;
  return weightedQuotaUsage(inputTokens, outputTokens);
}

export function estimateQuotaUnits(
  inputTokens: number,
  outputTokens = PROVISIONAL_OUTPUT_TOKEN_ALLOWANCE,
): number {
  const normalizedInputTokens = normalizeTokenCount(inputTokens);
  const normalizedOutputTokens = normalizeTokenCount(outputTokens);
  if (normalizedInputTokens === null || normalizedOutputTokens === null) {
    return ROLLING_TOKEN_BUDGET + 1;
  }
  return Math.max(1, weightedQuotaUsage(normalizedInputTokens, normalizedOutputTokens).totalUnits);
}

export async function settleRollingTokenUsage(
  database: D1Database,
  reservationId: number,
  usage: ActualTokenUsage,
): Promise<boolean> {
  const normalized = calculateQuotaUnits(usage);
  if (!normalized || !Number.isSafeInteger(reservationId) || reservationId <= 0) return false;
  const result = await database
    .prepare(
      "UPDATE rolling_token_usage SET actual_input_tokens = ?1, actual_output_tokens = ?2, state = 'settled', settled_at = ?4 WHERE id = ?3 AND state IN ('reserved', 'in-flight', 'unknown')",
    )
    .bind(normalized.inputUnits, normalized.outputUnits, reservationId, Date.now())
    .run();
  return result.meta.changes === 1;
}

export async function markRollingTokenUsageInFlight(
  database: D1Database,
  reservationId: number,
): Promise<boolean> {
  if (!Number.isSafeInteger(reservationId) || reservationId <= 0) return false;
  const result = await database
    .prepare(
      "UPDATE rolling_token_usage SET state = 'in-flight' WHERE id = ?1 AND state = 'reserved'",
    )
    .bind(reservationId)
    .run();
  return result.meta.changes === 1;
}

export async function markRollingTokenUsageUnknown(
  database: D1Database,
  reservationId: number,
): Promise<boolean> {
  if (!Number.isSafeInteger(reservationId) || reservationId <= 0) return false;
  const result = await database
    .prepare(
      "UPDATE rolling_token_usage SET state = 'unknown' WHERE id = ?1 AND state IN ('reserved', 'in-flight')",
    )
    .bind(reservationId)
    .run();
  return result.meta.changes === 1;
}

/** Release a reservation only from the pre-provider setup failure path. */
export async function releaseRollingTokenReservation(
  database: D1Database,
  reservationId: number,
): Promise<boolean> {
  if (!Number.isSafeInteger(reservationId) || reservationId <= 0) return false;
  const result = await database
    .prepare(
      "UPDATE rolling_token_usage SET state = 'released' WHERE id = ?1 AND state IN ('reserved', 'in-flight')",
    )
    .bind(reservationId)
    .run();
  return result.meta.changes === 1;
}

async function consumeAccountNeuronBudget(
  database: D1Database,
  now: number,
): Promise<AccountNeuronDecision> {
  // `estimated_neurons` was an old local approximation of provider usage. It
  // is not authoritative and can pause the assistant while the Workers AI
  // dashboard is still well below its daily allocation. Clear only that
  // legacy automatic pause; an administrator pause remains intact.
  await database
    .prepare(
      "UPDATE agent_control SET estimated_neurons = 0, paused = 0, pause_reason = NULL, updated_at = ?1 WHERE id = 1 AND pause_reason = 'daily-neuron-budget'",
    )
    .bind(now)
    .run();
  const control = await database
    .prepare("SELECT paused, pause_reason FROM agent_control WHERE id = 1")
    .first<{ paused: number; pause_reason: string | null }>();
  if (!control) return { allowed: false, reason: "configuration" };
  if (control.paused !== 0) return { allowed: false, reason: "paused" };
  return { allowed: true, estimatedNeurons: 0 };
}

/**
 * Perform the cheap quota gate before MCP catalog and tool work. This can also clear
 * the legacy automatic pause; the final reservation still runs after prompt
 * construction to account for the
 * actual request size and concurrent turns.
 */
export async function checkRollingQuotaAvailability(
  database: D1Database,
  sub: string,
  now = Date.now(),
): Promise<RollingQuotaAvailability> {
  try {
    const account = await consumeAccountNeuronBudget(database, now);
    if (!account.allowed) return account.reason;
    const usage = await readRollingUsage(database, sub, now - ROLLING_TOKEN_WINDOW_MS);
    if (!usage) return "configuration";
    return usageResult(usage, now).remainingTokens > 0 ? "available" : "rolling-limit";
  } catch {
    return "configuration";
  }
}

/**
 * Reserve a provisional weighted prompt estimate for one accepted turn;
 * completed model usage settles it to weighted uncached input plus output quota units.
 * Workers AI is the authority for account-wide capacity; this per-subject
 * rolling budget is the user-facing allocation. The control row remains an
 * administrator pause switch, with a one-time cleanup for its legacy
 * automatic-pause marker.
 */
export async function consumeRollingQuota(
  database: D1Database,
  sub: string,
  provisionalTokens: number,
  now = Date.now(),
): Promise<QuotaDecision> {
  const account = await consumeAccountNeuronBudget(database, now);
  if (!account.allowed) {
    if (account.reason === "paused") return { allowed: false, reason: "paused" };
    return { allowed: false, reason: "configuration", ...usageResult(null, now) };
  }

  try {
    const rolling = await reserveRollingTokens(database, sub, provisionalTokens, now);
    if (!rolling.allowed) return rolling;
    return { ...rolling, estimatedNeurons: account.estimatedNeurons };
  } catch {
    return {
      allowed: false,
      reason: "configuration",
      ...usageResult(null, now),
    };
  }
}
