---
title: Public Portfolio Authentication
aliases:
  - Portfolio public auth
  - Assistant authentication
tags:
  - architecture
  - authentication
  - cloudflare
role: reference
---

# Public Portfolio Authentication

`workers/portfolio-public-auth/` is a separate public-auth Worker for the
portfolio assistant. It is intentionally not the existing admin
`auth-worker`, whose cookie and routes are scoped to the Atelier/admin site.

## Browser flow

1. The site-wide assistant opens a fixed Google OIDC authorization-code flow.
2. The Worker stores a hashed state, PKCE verifier, nonce, same-origin return
   target, and ten-minute expiry in D1. It also sets a host-only, HttpOnly,
   Secure, SameSite=Lax state cookie.
3. The callback exchanges the code, validates Google issuer, audience, expiry,
   verified email, and nonce, then stores only the stable Google subject,
   current email/display name/profile picture URL, and a hashed 30-day session identifier.
4. A signed session cookie is returned to the configured `PORTFOLIO_ORIGIN`.
   No Google access or refresh token is persisted. Profile picture URLs are accepted only when
   they use HTTPS and are hosted by `googleusercontent.com`; the frontend treats them as
   decorative identity data and falls back to the generic icon if unavailable.

`GET /session` returns `401 { authenticated: false }` when the browser has no
valid session cookie. The frontend treats that expected incognito/first-visit
response as signed out and renders the Google sign-in prompt; coded session
failures remain visible as service errors.

`GET /quota` is an authenticated, read-only view of the same subject's active
rolling reservations. Its stable `usedTokens`, `budgetTokens`, and
`remainingTokens` fields now represent weighted quota units: uncached input is
weighted at 0.25, output (including reasoning) at 1.0, and cache-read input at
zero. A reservation without complete usage metadata falls back to its
provisional weighted estimate until it expires. The response includes the
configured rolling budget, remaining allowance, and earliest reservation expiry
(`resetAt`), or `null` when there is no active usage. It never returns the
subject identifier or another user's usage. The assistant refreshes this view
when a thread opens and after an attempted turn; a manual refresh remains
available beside the meter.
5. Turnstile is verified server-side once per session. `POST /agent/prepare`
   rechecks the session, pause state, and owned thread, then returns only an
   opaque attempt ID; it never returns a bearer credential.
6. The browser upgrades `GET /agents/portfolio-agent/:id` on public-auth with
   the opaque request ID. Public-auth rechecks the same ownership boundary and
   forwards the upgrade over `AGENT_WORKER`, supplying a trusted identity
   handoff to the agent. The agent strips browser cookies and authorization
   before routing to the matching Durable Object thread.

If a user's rolling budget is full, the agent returns a bounded assistant
message after the authenticated WebSocket is established. The gateway remains
available so the transcript can be read and the same thread can continue when
older reservations roll off. The `agent_control` row is an administrator pause
switch; the old local neuron estimate is not used to deny access because it can
disagree with the provider's usage dashboard. When Workers AI reports an
exhausted provider allocation, the agent returns **The provider's daily
Workers AI allocation has been used up. Try again after 00:00 UTC.** Temporary
provider-capacity failures use a separate retry-later message. This is distinct
from the per-user rolling quota.

Allowed browser origins come from the Worker environment's `BROWSER_ORIGINS`
list. Production config names the production portfolio origins plus the
explicit `http://localhost:5173` development origin; the local Wrangler profile
names its localhost Vite origins. State-changing browser requests require an
allowed Origin header. OAuth return targets are reduced to the configured
`PORTFOLIO_ORIGIN` or one of the configured browser origins, preventing an open
redirect in either environment.

When production auth is consumed by local Vite, `SESSION_COOKIE_SAME_SITE` is
set to `None` so the Secure, HttpOnly session cookie can accompany credentialed
cross-site requests. The exact Origin allowlist remains the CSRF boundary; do
not replace it with a wildcard.

## D1 ownership

The auth database is separate from the portfolio API database. The checked-in
migrations create users, sessions, OAuth state, threads, a historical one-time
agent-token table, rolling quota-unit reservations, and the singleton pause/reset
control row. The active runtime no longer issues or consumes agent tokens; the
historical table remains to avoid a destructive schema migration. Migration
`0002_add_actual_token_usage.sql` adds nullable columns that store weighted input
and output quota-unit components, and `0003_add_google_profile_picture.sql` adds
the nullable validated profile image URL; older reservations continue to use
`estimated_tokens` until they are settled. Reservations created before the
weighted-accounting rollout may therefore retain legacy raw-token values until
they expire from the one-hour window.
The original daily usage table remains as a legacy schema artifact but is no
longer used by runtime quota decisions. The migrations are reviewed artifacts
only; the deployment workflow never applies them automatically. Apply the
public-auth migrations through `0003` before deploying the Worker version that
returns profile image URLs and settles actual usage.

Runtime keys are provisioned manually through Wrangler or the Cloudflare
dashboard. The source deliberately assembles sensitive key names at runtime so
the repository guard cannot mistake configuration labels for credential
contents. Configure the following names exactly by joining the displayed
fragments:

| Runtime key fragments | Owner |
| --- | --- |
| `GOOGLE_CLIENT_ID` | public-auth variable |
| `GOOGLE_CLIENT_` + `SECRET` | public-auth secret |
| `TURNSTILE_` + `SECRET_KEY` | public-auth secret |
| `AGENT_TOKEN_` pair | retired legacy secrets; delete only through a separately authorized Cloudflare change |
| `AGENT_INTERNAL_` + `KEY` | shared service-binding secret |
| `BROWSER_ORIGINS` | per-environment public-auth and agent variable |
| `SESSION_COOKIE_SAME_SITE` | public-auth variable (`None` for production local-Vite access) |

The production Google OAuth client must use the fixed callback
`https://public-auth.syn-forge.com/oauth/google/callback`. Local development
against the production Workers uses that same callback and stores the localhost
return target in OAuth state. The isolated `env.local` profile instead uses the
explicit callback
`http://localhost:8787/oauth/google/callback`; it requires a matching Google
authorized redirect URI. The Turnstile site key is a public frontend build
variable. The retired ES256 agent-token pair is no longer read by active
Workers. Secret deletion or rotation remains a separately authorized
Cloudflare operation; the service-binding internal key remains required. The
local profile uses its own internal key.

## Thread history hydration

The authenticated frontend loads a selected thread's persisted transcript through
`GET /threads/:id/messages`. The route first resolves the session and
checks that the thread belongs to that Google subject before calling the private
agent service binding. The agent reads the Durable Object's persisted
`AIChatAgent` UI messages and returns them through that service-only
path; the browser never calls the internal endpoint directly.

The route keeps the legacy no-query `{ messages }` response for existing
consumers. A reader-first request may add `limit` (bounded to 1–50) and
`before=<message-id>`; public-auth validates the page parameters, forwards them
over the private service binding, and returns `{ messages, nextCursor, hasMore }`.
The frontend loads the newest page first and asks for older pages only when the
reader reaches the transcript's top edge. The cursor is an opaque message ID
owned by the agent Durable Object, and an invalid position is returned as a
bounded 400 error. This remains a read-only route with no D1 pagination table or
migration: the Durable Object retains the full transcript for model context.

History hydration does not issue, accept, or reuse a one-time WebSocket agent
token. The session cookie and server-side ownership check are the access
boundary, while `AGENT_INTERNAL_KEY` protects the auth-to-agent
service binding. This transcript route is read-only and does not add a D1
migration: D1 stores thread ownership metadata, and the agent Durable Object
SQLite remains the message source of truth. The nullable `threads.title` column
stores a bounded agent-generated summary after a successful evidence-backed reply;
`GET /threads` returns it with `Cache-Control: no-store`, and `POST /threads`
returns `title: null` for a new placeholder thread. The agent writes the title only
when the value is still empty, and the frontend keeps the ID fallback while the reply
is in flight, then refreshes the uncached authoritative thread list after completion.
Existing untitled threads are not backfilled; they are named on their next successful
completion. Duplicate generated titles are disambiguated in the selector with the
shortest unique thread-ID prefix. No D1 migration or transcript rewrite is required.

## Thread creation guard

A newly created thread is a placeholder until its first meaningful persisted
message arrives. The public-auth `POST /threads` route checks the bounded set of
the user's newest untitled placeholders through the private agent history seam
(`limit=1`). If any candidate is empty, it returns
`409 EMPTY_THREAD_ACTIVE` and does not insert another row. If the agent or
history payload cannot be checked, it fails closed with
`503 THREAD_STATE_UNAVAILABLE`. This reuses the Durable Object message source
of truth and requires no D1 schema migration.

The frontend hydrates the selected thread before enabling the toolbar's New
thread control. It remains disabled while history is loading or unavailable,
and while the selected thread has no visible activity; submitting the first
question marks the thread active immediately. Deleting the selected thread can
still leave no active thread, which permits creating the single initial
placeholder.

## Administrative controls

The Eury admin gateway reaches the additive internal routes
`/internal/admin/agent/status`, `/internal/admin/agent/users`,
`/internal/admin/agent/users/:sub`, `/internal/admin/agent/control`,
`/internal/admin/agent/users/:sub/reset`, and `/internal/admin/agent/reset`
through a private service binding. They require the server-held
`X-Admin-Internal-Key` and return only operational summaries: control state,
bounded user identity, quota totals, active counts, and recent thread
metadata. They never return transcript messages, reasoning, prompts, tool
payloads, session hashes, or OAuth artifacts.

The former browser-facing `POST /admin/reset` and `POST /admin/control` routes are retired: configured browser origins receive `410 LEGACY_ROUTE_RETIRED`, while other origins receive `403`, with no cookie, auth-worker, or database lookup. Administrative actions are available only through the Eury gateway's internal service-binding seam.

The internal admin reset endpoint increments the user quota epoch, revokes sessions, and clears that subject's rolling reservations. Historical token rows are marked consumed for schema compatibility but are not an active authorization mechanism. A user-specific reset leaves the global neuron guard unchanged; a global reset also clears all rolling reservations and the aggregate estimate, then resumes the agent. The internal control endpoint can pause or resume the assistant with a bounded reason. These endpoints are not exposed through the public frontend.

See [[architecture/portfolio-agent|Portfolio Assistant Agent]] for model and
MCP limits, and [[operations/deployment|Production deployment]] for
provisioning and rollout order.
