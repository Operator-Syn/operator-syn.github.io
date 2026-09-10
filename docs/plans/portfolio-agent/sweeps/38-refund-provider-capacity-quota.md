---
title: Sweep 38 — Refund provider-capacity quota reservations
aliases:
  - Portfolio Agent Sweep 38
  - Failed provider attempt refunds
tags:
  - plan
  - agents
  - quota
  - verification
role: project-plan-sweep
status: complete
plan_id: portfolio-agent-reliability
owner: Operator-Syn
last_reviewed: 2026-09-10
risk: high
---

# Sweep 38 — Refund provider-capacity quota reservations

Back to [[plans/portfolio-agent/README|the Portfolio Agent Reliability Plan]],
[[plans/portfolio-agent/implementation-sweeps/README|the implementation sweep index]],
or [[architecture/portfolio-agent|the assistant architecture]].

## Objective

Do not charge a user’s rolling quota for a known Workers AI allocation or
capacity rejection that occurs before the provider emits model output. Preserve
provisional accounting for generic, partial-output, network, and aborted turns
when provider usage cannot be safely recovered. Apply the same boundary to the
automatic thread-title call.

## Locked behavior

- `reserved` and `in-flight` rows are released only for a classified capacity
  failure with no model-output chunk observed.
- A provider error after text, reasoning, or tool output remains on the existing
  settlement/`unknown` path.
- The bounded provider error messages and the public `/quota` response shape do
  not change; released rows are already excluded from quota totals.
- No migration, Pages release, historical-row cleanup, or live reset is part of
  this sweep.

## Checkpoint ledger

### Checkpoint 0 / M0 — Baseline and red repro (complete)

The installed AI SDK fixture reproduced the original failure: a provider throw
produced `start/error`, called `onError`, and skipped `onEnd`. Existing agent and
public-auth checks passed before the source change. The visible 3.7k value is the
provisional estimate, not settled provider usage.

### Checkpoint 1 / M1 — Regression tests first (complete)

Added tests for pre-output provider throws, partial-output failures, capacity
classification, idempotent lifecycle wiring, generic title failures, and title
capacity-release injection. The new tests were red before the runtime change.

### Checkpoint 2 / M2 — Scoped runtime fix (complete)

`PortfolioAgent` now tracks output chunks, releases known pre-output capacity
failures from `streamText.onError`, and prevents a later `onEnd` from settling a
released row. Automatic title generation releases its reservation on the same
classified failure boundary.

### Checkpoint 3 / M3 — Repository verification (complete)

The fixed repository profile passed all 100 checks, including agent/public-auth
typechecks and tests, docs and skills validation, MCP checks, API and web tests,
Biome, lint, migration checks, and the production build. Graphify was updated
successfully. The final diff contains only the scoped source/tests/docs paths;
no debug instrumentation remains.

Pass milestone: source and repository evidence are complete. Deployment and live
behavior remain separate approval-gated checkpoints.

### Checkpoint 4 / M4 — Production deployment and live replay (approval gate)

If separately authorized, dry-run and deploy `portfolio-agent` only. No database
migration or Pages release is required. Use one redacted authenticated browser
attempt at most, compare `/quota` before and after, and confirm a naturally
occurring pre-output capacity failure leaves no new provisional usage. Do not
force exhaustion or retry repeatedly.

### Checkpoint 5 / M5 — Historical-row handoff

The existing 3.7k row has no request/error marker and is not safely identifiable.
It remains untouched and rolls off through the normal one-hour window. Any
production-data reset requires a separate explicit authorization.

## Stop rules

Stop before deployment or live data changes without explicit approval. Stop if a
capacity-classified failure has emitted model output, if release cannot be
confirmed by the D1 update, if generic or aborted failures begin releasing, or if
diagnostics expose raw provider details.
