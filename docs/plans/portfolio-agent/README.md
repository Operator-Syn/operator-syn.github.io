---
title: Portfolio Agent Reliability Plan
aliases:
  - Portfolio assistant reliability
tags:
  - plan
  - agents
  - mcp
  - verification
role: project-plan-index
status: in_progress
plan_id: portfolio-agent-reliability
owner: Operator-Syn
last_reviewed: 2026-09-02
risk: high
---

# Portfolio Agent Reliability Plan

This small index routes the sustained three-sweep goal. Each linked note keeps
one responsibility so later work can be discovered progressively without
reloading a monolithic plan. The historical record remains in
[[plans/portfolio-agent/implementation-sweeps/README|the implementation ledger]].

## Sequence

1. [[plans/portfolio-agent/audit|Audit and decision record]] — complete.
2. [[plans/portfolio-agent/sweeps/31-non-destructive-mcp-rediscovery|Sweep 31 — non-destructive catalog rediscovery]] — complete.
3. [[plans/portfolio-agent/sweeps/32-shared-mcp-discovery-deadline|Sweep 32 — shared MCP discovery deadline]] — complete.
4. [[plans/portfolio-agent/sweeps/33-structured-diagnostics|Sweep 33 — structured diagnostics]] — complete.
5. [[plans/portfolio-agent/sweeps/34-cross-record-evidence-grounding|Sweep 34 — cross-record evidence grounding]] — source implementation complete; deployment and live replay pending.
6. [[plans/portfolio-agent/sweeps/35-conversational-evidence-grounding|Sweep 35 — conversational evidence grounding]] — source implementation complete; deployment and live replay pending.
7. [[plans/portfolio-agent/sweeps/36-mobile-assistant-responsive-surface|Sweep 36 — mobile assistant responsive surface]] — implementation in progress; browser and real-device gates pending.
8. [[plans/portfolio-agent/sweeps/37-cookie-authenticated-websocket-gateway|Sweep 37 — cookie-authenticated WebSocket gateway]] — complete; production retirement and saved-auth live verification recorded.
9. [[plans/portfolio-agent/sweeps/38-refund-provider-capacity-quota|Sweep 38 — refundable provider-capacity quota reservations]] — source implementation and repository verification complete; deployment/live replay remains approval-gated.

Reliability work is implemented incrementally in focused sweeps. Each sweep
has its own acceptance gate and records source/test evidence separately from
deployment or live behavior.

## Deferred

[[plans/portfolio-agent/deferred|Deferred reliability work]] contains the
remaining recommendations without mixing them into the active sweep notes.

## Related source and architecture

- [[architecture/portfolio-agent|Portfolio Assistant Agent architecture]]
- [[operations/local-development|Local development and fixed checks]]
- [[operations/repository-mcp|Local Repository MCP change workflow]]

This index is the backlink target for each current sweep and the audit.
