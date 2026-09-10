import assert from "node:assert/strict";
import { test } from "node:test";
import type { D1Database } from "@cloudflare/workers-types";
import {
  ROLLING_TOKEN_BUDGET,
  ROLLING_TOKEN_WINDOW_MS,
} from "../../workers/portfolio-agent/src/config.ts";
import {
  calculateQuotaUnits,
  checkRollingQuotaAvailability,
  consumeRollingQuota,
  estimateQuotaUnits,
  markRollingTokenUsageInFlight,
  markRollingTokenUsageUnknown,
  PROVISIONAL_OUTPUT_TOKEN_ALLOWANCE,
  releaseRollingTokenReservation,
  settleRollingTokenUsage,
} from "../../workers/portfolio-agent/src/quota.ts";

type Event = {
  id: number;
  sub: string;
  created_at: number;
  estimated_tokens: number;
  actual_input_tokens: number | null;
  actual_output_tokens: number | null;
  state?: string;
};

class QuotaDatabase {
  readonly events: Event[] = [];
  private nextId = 1;
  readonly control = {
    estimated_neurons: 0,
    paused: 0,
    pause_reason: null as string | null,
    utc_day: new Date(0).toISOString().slice(0, 10),
  };

  prepare(sql: string) {
    return {
      first: async <T>() => this.first<T>(sql, []),
      bind: (...args: unknown[]) => ({
        run: async () => this.run(sql, args),
        first: async <T>() => this.first<T>(sql, args),
      }),
    };
  }

  private run(sql: string, args: unknown[]): { meta: { changes: number; last_row_id: number } } {
    if (sql.startsWith("UPDATE agent_control SET estimated_neurons = 0, paused = 0")) {
      const [now] = args as [number];
      if (this.control.pause_reason !== "daily-neuron-budget")
        return { meta: { changes: 0, last_row_id: 0 } };
      this.control.estimated_neurons = 0;
      this.control.paused = 0;
      this.control.pause_reason = null;
      this.control.utc_day = new Date(now).toISOString().slice(0, 10);
      void now;
      return { meta: { changes: 1, last_row_id: 0 } };
    }
    if (sql.startsWith("DELETE FROM rolling_token_usage")) {
      const [cutoff] = args as [number];
      const originalLength = this.events.length;
      this.events.splice(
        0,
        this.events.length,
        ...this.events.filter((event) => event.created_at > cutoff),
      );
      return { meta: { changes: originalLength === this.events.length ? 0 : 1, last_row_id: 0 } };
    }
    if (sql.startsWith("UPDATE rolling_token_usage SET actual_input_tokens")) {
      const [inputTokens, outputTokens, id] = args as [number, number, number];
      const event = this.events.find((candidate) => candidate.id === id);
      if (!event) return { meta: { changes: 0, last_row_id: 0 } };
      event.actual_input_tokens = inputTokens;
      event.actual_output_tokens = outputTokens;
      event.state = "settled";
      return { meta: { changes: 1, last_row_id: 0 } };
    }
    if (sql.startsWith("UPDATE rolling_token_usage SET state")) {
      const [id] = args as [number];
      const state = sql.match(/SET state = '([^']+)'/)?.[1] ?? "unknown";
      const event = this.events.find((candidate) => candidate.id === id);
      if (!event) return { meta: { changes: 0, last_row_id: 0 } };
      event.state = state;
      return { meta: { changes: 1, last_row_id: 0 } };
    }
    if (sql.startsWith("INSERT INTO rolling_token_usage")) {
      const [sub, now, requested] = args as [string, number, number];
      const used = this.events
        .filter((event) => event.sub === sub && event.created_at > now - ROLLING_TOKEN_WINDOW_MS)
        .reduce((total, event) => total + this.eventTokens(event), 0);
      if (requested <= ROLLING_TOKEN_BUDGET && used + requested <= ROLLING_TOKEN_BUDGET) {
        const id = this.nextId++;
        this.events.push({
          id,
          sub,
          created_at: now,
          estimated_tokens: requested,
          actual_input_tokens: null,
          actual_output_tokens: null,
          state: "reserved",
        });
        return { meta: { changes: 1, last_row_id: id } };
      }
      return { meta: { changes: 0, last_row_id: 0 } };
    }
    throw new Error(`Unexpected query: ${sql}`);
  }

  private eventTokens(event: Event): number {
    if (event.state === "released") return 0;
    return event.actual_input_tokens !== null && event.actual_output_tokens !== null
      ? event.actual_input_tokens + event.actual_output_tokens
      : event.estimated_tokens;
  }

  private first<T>(sql: string, args: unknown[]): T | null {
    if (sql.startsWith("SELECT paused, pause_reason FROM agent_control")) {
      return {
        paused: this.control.paused,
        pause_reason: this.control.pause_reason,
      } as T;
    }
    if (sql.includes("FROM rolling_token_usage")) {
      const [sub, cutoff] = args as [string, number];
      const matching = this.events.filter(
        (event) => event.sub === sub && event.created_at > cutoff,
      );
      return {
        used_tokens: matching.reduce((total, event) => total + this.eventTokens(event), 0),
        oldest_created_at: matching[0]?.created_at ?? null,
      } as T;
    }
    throw new Error(`Unexpected first query: ${sql}`);
  }
}

test("enforces a per-user rolling 1-hour token budget and expires old usage", async () => {
  assert.equal(ROLLING_TOKEN_BUDGET, 1_000_000);
  assert.equal(ROLLING_TOKEN_WINDOW_MS, 60 * 60 * 1_000);
  const database = new QuotaDatabase();
  const now = Date.parse("2026-08-31T00:00:00.000Z");
  const initialReservation = ROLLING_TOKEN_BUDGET - 6_000;

  const first = await consumeRollingQuota(
    database as unknown as D1Database,
    "user-a",
    initialReservation,
    now,
  );
  assert.equal(first.allowed, true);
  if (first.allowed) {
    assert.equal(first.usedTokens, initialReservation);
    assert.equal(first.remainingTokens, 6_000);
  }

  const denied = await consumeRollingQuota(
    database as unknown as D1Database,
    "user-a",
    6_001,
    now + 1,
  );
  assert.equal(denied.allowed, false);
  if (!denied.allowed) {
    assert.equal(denied.reason, "rolling-limit");
    assert.equal(denied.usedTokens, initialReservation);
  }

  const otherUser = await consumeRollingQuota(
    database as unknown as D1Database,
    "user-b",
    ROLLING_TOKEN_BUDGET,
    now + 2,
  );
  assert.equal(otherUser.allowed, true);

  const afterWindow = await consumeRollingQuota(
    database as unknown as D1Database,
    "user-a",
    ROLLING_TOKEN_BUDGET,
    now + ROLLING_TOKEN_WINDOW_MS + 1,
  );
  assert.equal(afterWindow.allowed, true);
});

test("rejects an exhausted rolling budget before grounding work", async () => {
  const database = new QuotaDatabase();
  const now = Date.parse("2026-08-31T00:00:00.000Z");
  database.events.push({
    id: 1,
    sub: "user-a",
    created_at: now,
    estimated_tokens: ROLLING_TOKEN_BUDGET,
    actual_input_tokens: null,
    actual_output_tokens: null,
  });

  assert.equal(
    await checkRollingQuotaAvailability(database as unknown as D1Database, "user-a", now),
    "rolling-limit",
  );
  assert.equal(
    await checkRollingQuotaAvailability(
      new QuotaDatabase() as unknown as D1Database,
      "user-a",
      now,
    ),
    "available",
  );
});

test("settles provider input and output usage over the provisional reservation", async () => {
  const database = new QuotaDatabase();
  const now = Date.parse("2026-08-31T00:00:00.000Z");

  const reservation = await consumeRollingQuota(
    database as unknown as D1Database,
    "user-a",
    900,
    now,
  );
  assert.equal(reservation.allowed, true);
  if (!reservation.allowed) return;

  assert.equal(
    await settleRollingTokenUsage(database as unknown as D1Database, reservation.reservationId, {
      inputTokens: 120,
      inputTokenDetails: {
        noCacheTokens: 120,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      outputTokens: 80,
    }),
    true,
  );
  assert.deepEqual(database.events[0], {
    id: reservation.reservationId,
    sub: "user-a",
    created_at: now,
    estimated_tokens: 900,
    actual_input_tokens: 30,
    actual_output_tokens: 80,
    state: "settled",
  });

  const next = await consumeRollingQuota(
    database as unknown as D1Database,
    "user-a",
    ROLLING_TOKEN_BUDGET - 200,
    now + 1,
  );
  assert.equal(next.allowed, true);
});

test("releases pre-model reservations and keeps unknown provider usage provisional", async () => {
  const database = new QuotaDatabase();
  const now = Date.parse("2026-08-31T00:00:00.000Z");
  const released = await consumeRollingQuota(database as unknown as D1Database, "user-a", 900, now);
  assert.equal(released.allowed, true);
  if (!released.allowed) return;
  assert.equal(
    await releaseRollingTokenReservation(database as unknown as D1Database, released.reservationId),
    true,
  );
  assert.equal(
    await checkRollingQuotaAvailability(database as unknown as D1Database, "user-a", now),
    "available",
  );

  const unknown = await consumeRollingQuota(
    database as unknown as D1Database,
    "user-a",
    900,
    now + 1,
  );
  assert.equal(unknown.allowed, true);
  if (!unknown.allowed) return;
  assert.equal(
    await markRollingTokenUsageInFlight(database as unknown as D1Database, unknown.reservationId),
    true,
  );
  assert.equal(
    await markRollingTokenUsageUnknown(database as unknown as D1Database, unknown.reservationId),
    true,
  );
  assert.equal(database.events.at(-1)?.state, "unknown");
});

test("weights uncached, cached, and output usage into quota units", () => {
  assert.deepEqual(
    calculateQuotaUnits({
      inputTokens: 1_000,
      inputTokenDetails: {
        noCacheTokens: 800,
        cacheReadTokens: 200,
        cacheWriteTokens: 0,
      },
      outputTokens: 300,
      outputTokenDetails: {
        textTokens: 200,
        reasoningTokens: 100,
      },
    }),
    {
      inputUnits: 200,
      outputUnits: 300,
      totalUnits: 500,
    },
  );

  assert.deepEqual(
    calculateQuotaUnits({
      inputTokens: 500,
      inputTokenDetails: {
        noCacheTokens: undefined,
        cacheReadTokens: 200,
        cacheWriteTokens: 0,
      },
      outputTokens: 100,
    }),
    {
      inputUnits: 75,
      outputUnits: 100,
      totalUnits: 175,
    },
  );

  assert.deepEqual(
    calculateQuotaUnits({
      inputTokens: 500,
      inputTokenDetails: {
        noCacheTokens: 0,
        cacheReadTokens: 500,
        cacheWriteTokens: 0,
      },
      outputTokens: 100,
    }),
    {
      inputUnits: 0,
      outputUnits: 100,
      totalUnits: 100,
    },
  );

  assert.deepEqual(
    calculateQuotaUnits({
      inputTokens: { total: 500, noCache: 300, cacheRead: 200 },
      outputTokens: 100,
    }),
    {
      inputUnits: 75,
      outputUnits: 100,
      totalUnits: 175,
    },
  );
});

test("uses a weighted prompt estimate with a bounded output allowance", () => {
  assert.equal(PROVISIONAL_OUTPUT_TOKEN_ALLOWANCE, 700);
  assert.equal(estimateQuotaUnits(1_200, PROVISIONAL_OUTPUT_TOKEN_ALLOWANCE), 1_000);
  assert.equal(estimateQuotaUnits(120, 80), 110);
  assert.equal(estimateQuotaUnits(0, 0), 1);
});

test("clears a stale legacy estimate but preserves an administrator pause", async () => {
  const database = new QuotaDatabase();
  const now = Date.parse("2026-08-31T00:00:00.000Z");
  database.control.estimated_neurons = 8_050;
  database.control.paused = 1;
  database.control.pause_reason = "daily-neuron-budget";

  const recovered = await consumeRollingQuota(
    database as unknown as D1Database,
    "user-a",
    1_000,
    now,
  );
  assert.equal(recovered.allowed, true);
  assert.equal(database.control.estimated_neurons, 0);
  assert.equal(database.control.paused, 0);
  assert.equal(database.control.pause_reason, null);

  database.control.paused = 1;
  database.control.pause_reason = "operator-maintenance";
  const paused = await consumeRollingQuota(
    database as unknown as D1Database,
    "user-b",
    1_000,
    now + 1,
  );
  assert.equal(paused.allowed, false);
  if (!paused.allowed) assert.equal(paused.reason, "paused");
});
