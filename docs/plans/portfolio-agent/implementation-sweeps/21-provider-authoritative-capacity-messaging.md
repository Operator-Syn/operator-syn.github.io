---
title: Sweep 21 — provider-authoritative capacity messaging
aliases:
  - Portfolio Agent Sweep 21
tags:
  - plan
  - agents
  - verification
role: project-plan-sweep
status: complete
plan_id: portfolio-agent-public-assistant
owner: Operator-Syn
last_reviewed: 2026-09-01
risk: high
---

# Sweep 21 — provider-authoritative capacity messaging

Back to [[plans/portfolio-agent/implementation-sweeps/README|the implementation sweep index]].

**Date:** 2026-08-31

**Scope:** false account-wide neuron estimate, provider-capacity errors, and
explicit UTC reset guidance.

- [x] Confirmed the reported false pause against live evidence: the auth D1
      control row held an 8,050-neuron local estimate while the Workers AI
      dashboard showed 554/10,000 neurons for the UTC day.
- [x] Removed the fixed per-turn estimate from the admission path. The control
      row now acts as an administrator pause switch and clears only its legacy
      `daily-neuron-budget` marker.
- [x] Added a provider-capacity classifier for Workers AI account-allocation
      codes `3036`/`4006` and out-of-capacity code `3040`, with safe user-facing
      messages for allocation exhaustion and temporary capacity failures.
- [x] Kept the 22,000-token/30-minute per-user reservation separate from the
      provider's account-wide capacity and added regression coverage for both
      paths.

The source fix is not a provider quota reset and does not change Cloudflare's
actual usage. The stale production control row must be cleared by an
operator-authorized D1 control update or the next token request will clear its
legacy automatic marker; manual administrator pauses remain intact.

## Related sweeps

- Next: [[plans/portfolio-agent/implementation-sweeps/22-production-capacity-diagnostics-deployment|Sweep 22 — production capacity-diagnostics deployment]]
- Supersedes: [[plans/portfolio-agent/implementation-sweeps/20-explicit-capacity-pause-diagnostics|Sweep 20 — explicit capacity-pause diagnostics]]
