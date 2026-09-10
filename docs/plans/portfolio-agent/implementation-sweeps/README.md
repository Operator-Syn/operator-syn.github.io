---
title: Portfolio Agent Implementation Sweep Index
aliases:
  - Portfolio agent sweeps
  - Portfolio agent implementation ledger
tags:
  - index
  - plan
  - agents
  - verification
role: project-plan-index
status: in_progress
plan_id: portfolio-agent-public-assistant
owner: Operator-Syn
last_reviewed: 2026-09-02
risk: high
---

# Portfolio Agent Implementation Sweep Index

This directory keeps one focused note per historical implementation sweep for
the public portfolio assistant. The notes preserve source/build evidence,
approval-gated provisioning and deployment work, and representative live
checks without reloading a monolithic ledger.

Back to [[plans/portfolio-agent/README|the Portfolio Agent Reliability Plan]].

## How to use this index

Create the next numbered note when a bounded implementation change is recorded.
Keep its scope, date, changed contracts, exact checks, and evidence boundary in
that note. Source or build output must not be used to claim deployment or live
behavior.

## Historical implementation sweeps

| Sweep | Responsibility | Status |
| --- | --- | --- |
| 1 | [[plans/portfolio-agent/implementation-sweeps/01-source-implementation-and-hard-limits|Sweep 1 — source implementation and hard limits]] | in progress |
| 2 | [[plans/portfolio-agent/implementation-sweeps/02-reconnect-and-csrf-boundary-hardening|Sweep 2 — reconnect and CSRF boundary hardening]] | complete |
| 3 | [[plans/portfolio-agent/implementation-sweeps/03-quota-reset-boundary-and-provisioning-documentation-audit|Sweep 3 — quota reset boundary and provisioning-documentation audit]] | complete |
| 4 | [[plans/portfolio-agent/implementation-sweeps/04-first-deploy-service-binding-order|Sweep 4 — first-deploy service-binding order]] | complete |
| 5 | [[plans/portfolio-agent/implementation-sweeps/05-auth-d1-database-provisioning|Sweep 5 — auth D1 database provisioning]] | complete |
| 6 | [[plans/portfolio-agent/implementation-sweeps/06-remote-secret-and-deployment-verification|Sweep 6 — remote secret and deployment verification]] | in progress |
| 7 | [[plans/portfolio-agent/implementation-sweeps/07-wrangler-custom-domain-declaration|Sweep 7 — Wrangler Custom Domain declaration]] | in progress |
| 8 | [[plans/portfolio-agent/implementation-sweeps/08-live-protected-boundary-check|Sweep 8 — live protected-boundary check]] | in progress |
| 9 | [[plans/portfolio-agent/implementation-sweeps/09-ipv4-live-health-and-client-network-diagnosis|Sweep 9 — IPv4 live health and client-network diagnosis]] | in progress |
| 10 | [[plans/portfolio-agent/implementation-sweeps/10-post-restart-auth-health-confirmation|Sweep 10 — post-restart auth health confirmation]] | in progress |
| 11 | [[plans/portfolio-agent/implementation-sweeps/11-oauth-configuration-boundary|Sweep 11 — OAuth configuration boundary]] | in progress |
| 12 | [[plans/portfolio-agent/implementation-sweeps/12-oauth-authorization-start-verification|Sweep 12 — OAuth authorization-start verification]] | in progress |
| 13 | [[plans/portfolio-agent/implementation-sweeps/13-local-versus-production-configuration-audit|Sweep 13 — local versus production configuration audit]] | in progress |
| 14 | [[plans/portfolio-agent/implementation-sweeps/14-environment-aware-local-assistant-configuration|Sweep 14 — environment-aware local assistant configuration]] | complete |
| 15 | [[plans/portfolio-agent/implementation-sweeps/15-production-worker-access-from-local-vite|Sweep 15 — production Worker access from local Vite]] | complete |
| 16 | [[plans/portfolio-agent/implementation-sweeps/16-async-agent-connection-render-guard|Sweep 16 — async agent connection render guard]] | in progress |
| 17 | [[plans/portfolio-agent/implementation-sweeps/17-main-teaser-release-gate-and-agent-development-branch|Sweep 17 — main teaser release gate and agent-development branch]] | in progress |
| 18 | [[plans/portfolio-agent/implementation-sweeps/18-rolling-token-budget-and-readable-exhausted-threads|Sweep 18 — rolling token budget and readable exhausted threads]] | complete |
| 19 | [[plans/portfolio-agent/implementation-sweeps/19-unauthenticated-first-visit-prompt|Sweep 19 — unauthenticated first-visit prompt]] | complete |
| 20 | [[plans/portfolio-agent/implementation-sweeps/20-explicit-capacity-pause-diagnostics|Sweep 20 — explicit capacity-pause diagnostics]] | complete |
| 21 | [[plans/portfolio-agent/implementation-sweeps/21-provider-authoritative-capacity-messaging|Sweep 21 — provider-authoritative capacity messaging]] | complete |
| 22 | [[plans/portfolio-agent/implementation-sweeps/22-production-capacity-diagnostics-deployment|Sweep 22 — production capacity-diagnostics deployment]] | in progress |
| 23 | [[plans/portfolio-agent/implementation-sweeps/23-expanded-rolling-allowance-with-independent-hard-limits|Sweep 23 — expanded rolling allowance with independent hard limits]] | complete |
| 24 | [[plans/portfolio-agent/implementation-sweeps/24-contact-link-grounding-and-same-thread-continuity|Sweep 24 — contact-link grounding and same-thread continuity]] | complete |
| 25 | [[plans/portfolio-agent/implementation-sweeps/25-full-thread-context-mode|Sweep 25 — full-thread context mode]] | complete |
| 26 | [[plans/portfolio-agent/implementation-sweeps/26-remove-application-request-caps|Sweep 26 — remove application request caps]] | complete |
| 27 | [[plans/portfolio-agent/implementation-sweeps/27-eager-mcp-tool-discovery-before-preflight|Sweep 27 — eager MCP tool discovery before preflight]] | complete |
| 28 | [[plans/portfolio-agent/implementation-sweeps/28-settle-rolling-quota-on-actual-model-usage|Sweep 28 — settle rolling quota on actual model usage]] | complete |
| 29 | [[plans/portfolio-agent/implementation-sweeps/29-bounded-mcp-recovery-and-quota-admission-before-grounding|Sweep 29 — bounded MCP recovery and quota admission before grounding]] | complete |

## Current reliability follow-ons

The reliability program continues in the focused notes below. They are linked
from the historical sequence so the implementation record and current
reliability work remain navigable without copying their evidence.

- [[plans/portfolio-agent/sweeps/31-non-destructive-mcp-rediscovery|Sweep 31 — non-destructive catalog rediscovery]]
- [[plans/portfolio-agent/sweeps/32-shared-mcp-discovery-deadline|Sweep 32 — shared MCP discovery deadline]]
- [[plans/portfolio-agent/sweeps/33-structured-diagnostics|Sweep 33 — structured diagnostics]]
- [[plans/portfolio-agent/sweeps/34-cross-record-evidence-grounding|Sweep 34 — cross-record evidence grounding]]
- [[plans/portfolio-agent/sweeps/38-refund-provider-capacity-quota|Sweep 38 — refundable provider-capacity quota reservations]]

## Related notes

- [[plans/portfolio-agent/README|Portfolio Agent Reliability Plan]]
- [[plans/portfolio-agent/audit|Audit and decision record]]
- [[plans/portfolio-agent/deferred|Deferred reliability work]]
- [[architecture/portfolio-agent|Portfolio Assistant Agent architecture]]
- [[operations/local-development|Local development and fixed checks]]
- [[operations/deployment|Production deployment]]

The plan index links back to this directory, and every sweep note links here
plus its neighboring or superseding sweeps.
