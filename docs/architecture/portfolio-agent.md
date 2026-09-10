---
title: Portfolio Assistant Agent
aliases:
  - Portfolio agent
  - Public portfolio assistant
tags:
  - architecture
  - agents
  - cloudflare
role: reference
---

# Portfolio Assistant Agent

The public assistant is a browser-only, site-wide floating assistant for
questions about the Syn-Forge portfolio. It is split into two Worker
workspaces:

- `workers/portfolio-public-auth/` owns Google OIDC sign-in, Turnstile
  verification, sessions, thread ownership, quotas, admin controls, and the
  cookie-authenticated assistant WebSocket gateway.
- `workers/portfolio-agent/` owns the stateful `AIChatAgent` Durable Object,
  Workers AI calls, MCP tool access, and sanitized thread export
  and deletion.

The frontend mounts
[`PortfolioAssistantFab`](../../apps/portfolio-web/src/components/portfolioAssistant/PortfolioAssistantFab.tsx)
from the global application shell. Main intentionally ships the FAB as a
coming-soon teaser: the explicit availability gate in
`portfolioAssistantAvailability.ts` returns before any session or connection
request. The `agent-development` branch switches that gate to `active` for
continued chat work; it is not a production release branch.

When active, the browser first calls the ownership-checked public-auth
`POST /agent/prepare` route with its HttpOnly session cookie. It then mounts
`useAgent` with `public-auth.syn-forge.com` as the WebSocket host and sends only
an opaque `rid` request identifier (plus the SDK's optional `_pk` connection
key). The browser URL never contains a bearer token or JWT. Public-auth
revalidates the session, Turnstile state, control state, and thread ownership on
the WebSocket upgrade, then forwards the upgrade over its private `AGENT_WORKER`
service binding to the agent's internal route. The gateway strips browser
cookies, authorization headers, and arbitrary query parameters before the
agent sees the request; it supplies a trusted identity handoff and bounded
request ID instead.

Production has an explicit public-auth origin; development requires a local
public-auth endpoint override and never falls back to production. The agent
origin is not a browser configuration surface: public-auth reaches it through
the private service binding. Persisted history is loaded independently of the
connection gate, so a visitor can still read an owned thread while chat access
is unavailable. A failed preparation or connection is latched until the
visitor explicitly retries, and `useAgent` has bounded reconnects and a
connection timeout so a stale socket cannot create a request storm.

## Thread history

The agent Durable Object's SQLite-backed `AIChatAgent` message store is
the source of truth for a thread transcript. Its internal
`getThreadMessages` action waits for the object to become stable and
returns the persisted UI message array, including IDs and tool parts needed for
the Agents SDK to reconcile later turns.

For reader-first hydration, the internal action accepts an optional cursor page:
`?limit=24` returns the newest bounded window with `{ messages, nextCursor,
hasMore }`, while `?before=<message-id>` returns the page immediately preceding
that stable message ID. The frontend starts with the newest page and requests
another page only at the transcript's top edge, prepending it while preserving
the reader's scroll anchor. Message IDs are the cursor; an invalid position
returns a bounded 400 response. The Durable Object keeps its complete
`this.messages` transcript for every model turn, so pagination is a presentation
window rather than context compaction. The browser does not synchronize the
partial window back as the server transcript. The legacy no-query `{ messages }`
shape remains available for compatibility.

The frontend requests that action through the ownership-checked public-auth
`GET /threads/:id/messages` route when a user selects a thread. Public
auth verifies the session and D1 thread ownership, then uses the service binding
and shared internal key. The browser does not call the agent's internal route or supply credentials
to it. History remains a read-only path and does not require the rolling-usage
migration.

History can be the first operation for a thread, so the internal RPC may
initialize the Durable Object before a WebSocket connection exists and without
chat claims. The authenticated gateway sends a Worker-created identity handoff
into `onConnect` after public-auth has verified the session, Turnstile state,
pause state, and thread ownership. The agent validates the thread ID again and
rehydrates its in-memory and SQLite identity before accepting chat messages;
the browser cannot supply or override this header.

Each accepted chat turn converts the complete Durable Object transcript into model
messages before each model call. New threads initially display a compact
`Thread <id-prefix>` fallback. After any completed turn produces a non-empty,
non-error, non-aborted visible assistant answer, regardless of evidence success, the
agent asks the same Workers AI model for one bounded plain-text title using the
earliest non-empty user question and the completed assistant answer. The title
prompt treats the user question as the primary subject and the answer as secondary
disambiguation, preferring neutral intent labels and excluding owner identity or
personal facts unless the user asked about them. The title-only call disables model
reasoning so its 32-token output cap is reserved for the title text; its separate
rolling-quota reservation is settled from provider usage. The generated value is
normalized to at most 72 characters and conditionally written to the existing auth-D1
`threads.title` field only when it is still empty. The update is first-writer-wins
and best-effort: title-generation, quota, or metadata failures never interrupt the
completed answer. Rejected, aborted, empty, or error turns leave the ID fallback.
The title lifecycle is awaited before the response stream closes, and the browser
does not preview a title while the answer is streaming; it refreshes the uncached
authoritative thread list after completion. Existing untitled threads are named on
their next successful completion and are not backfilled. When generated titles
collide, the selector appends the shortest unique thread-ID prefix for that title
without changing the stored value. The system prompt identifies the assistant as a
separate narrator, not Operator-Syn or the portfolio owner: portfolio facts are
described in third person, and owner-written first-person source text is
attributed instead of adopted. It treats loaded messages as the current thread
context and prior assistant replies as generated drafts, so a summarize or
continue request does not reset context or inherit an earlier assistant's
incorrect “fresh conversation” claim.

Reasoning parts from Workers AI remain public and the model uses the provider's
default reasoning setting. The stream adapter sets `sendReasoning: true`, and
the frontend renders the trace behind a closed native **Show model reasoning**
disclosure alongside the answer. Before later model calls, the agent removes
persisted assistant reasoning parts from model input while retaining user and
answer text, so a prior trace cannot inflate context or become evidence-like
prose. Older persisted reasoning parts remain in storage and remain available
in the visitor-facing transcript.

Assistant Markdown links pass through a URL boundary before rendering. Known
same-origin portfolio routes are preserved, the encoded-root artifact is
normalized to `/`, punctuation-adjacent root URLs are separated before GFM
autolinking, and unknown same-origin paths render as non-clickable text instead
of navigating to the SPA 404. External HTTP(S) targets remain unchanged. The
agent prompt separately requires exact canonical and `target_url` preservation.

## Grounding and scope

The agent connects only to the existing public, read-only Portfolio MCP at
`https://mcp.syn-forge.com/mcp`. The SDK lifecycle wait is disabled on
`AIChatAgent`; catalog readiness owns one 60-second maximum discovery budget
before model generation. A successful connection or discovery settles
immediately, so this is a timeout rather than a fixed delay. If the catalog is
incomplete, the agent passes only the remaining budget to direct rediscovery of
the existing connection before considering remove/re-add recovery. A failed
rediscovery passes the same absolute deadline to the remove/re-add helper,
which will not begin cleanup, another add attempt, or a retry backoff after the
shared window expires.

Once that bounded phase ends, the agent selects the eight portfolio tools by
capability name: overview, search, project list/detail, certificate list/detail,
and snippet list/read. The four project-linked GitHub tools remain public MCP
capabilities but are not exposed to this portfolio-only assistant. No question
text is inspected to make that decision.

After authentication, question, and safety gates, the agent performs a cheap
quota-availability check for the Google subject before touching MCP. A paused
account, an unavailable quota configuration, or a subject whose rolling window
is already exhausted receives its existing bounded warning without an MCP
call. This is an availability peek, not the authoritative reservation; the
final atomic reservation after model-message conversion handles the exact
request size and concurrent-turn race.

Every turn that reaches generation receives the same eight selected tools in
both `convertToModelMessages` and `streamText`. There is no mandatory search or
overview call, question classifier, stop-word removal, record-kind map,
technology vocabulary, precision pattern, or scope-word catalog. The model
decides whether to search, list, inspect, or read and may chain calls for
follow-ups and comparisons.

The first model step requires a tool call but does not prescribe which tool.
After one usable portfolio result, tool choice becomes automatic and natural
prose can stream. Text emitted before usable evidence is suppressed at the
stream boundary. Empty results and tool failures do not unlock an answer; after
three consecutive unusable results, the turn ends with a brief statement that
the answer could not be verified from public portfolio evidence. This is an
evidence gate, not semantic routing.

Native model tool parts are the activity source of truth. Successful results
are inspected only for their documented public shape and canonical link fields;
the agent does not reinterpret the user's words. Those links are appended to
the same assistant message after the tool loop. Search and tool output remain
untrusted data, and the model is instructed to use returned canonical URLs
rather than inventing citations or IDs.

Scope is enforced conversationally at the model boundary: the system contract
asks the assistant to decline unrelated requests briefly and invite a portfolio
question while remaining helpful for greetings, orientation, and follow-ups.
Transport, authentication, quota, capability selection, the evidence gate, and
the separate unsafe-request security gate
remain deterministic infrastructure checks; they are not portfolio intent
classification. If the MCP catalog or calls are unavailable, the Worker emits a
bounded service-unavailable response instead of pretending that the portfolio is
empty.

The response path is one natural `streamText` conversation with public reasoning
enabled. It does not branch into a deterministic precise renderer or a
JSON-schema answer mode, so questions such as “Show me certificates” and “What
kinds of projects are featured?” reach the same conversational model path as
follow-ups. The server still emits source URLs extracted from successful MCP
results and the frontend keeps bounded, presentation-only working rows for any
provider-style tool marker; markers are never executed as tools.

The assistant never executes code, changes accounts, writes portfolio data, or
performs unrelated general-purpose work. It must not offer to create, host,
publish, send, modify, or execute external artifacts, change accounts or
repositories, send email, or create hosted or downloadable links. Canonical
portfolio URLs may still be cited; unavailable requests receive a clear
read-only limitation and any relevant verified portfolio evidence instead. The
public MCP itself remains independently public; this assistant is one
authenticated consumer of it.

## WebSocket startup and interruption recovery

Portfolio MCP is an evidence dependency, not a prerequisite for opening an
authenticated assistant session. `PortfolioAgent` explicitly opts into Durable
Object WebSocket hibernation with `static options = { hibernate: true,
sendIdentityOnConnect: false }`.
Its `onStart` hook performs only synchronous SQLite schema and identity
rehydration; it does not perform network I/O or wait for MCP discovery. That
keeps a restored or hibernated object from coupling the browser upgrade to an
upstream service.

MCP is connected lazily when the first model turn needs the catalog. The
[`ensurePortfolioMcpConnection`](../../workers/portfolio-agent/src/mcp.ts)
helper uses three total attempts (the initial attempt plus two retries) with
bounded backoff. After a failed add it removes portfolio servers in either
`failed` or `connected` state because discovery errors can leave the transport
marked connected without a usable catalog. If recovery still fails, the socket
remains established and that turn receives the bounded evidence-unavailable
response instead of a failed WebSocket handshake.

This boundary matters because an exception from `onStart` is caught by the
Agents SDK lifecycle as a WebSocket setup failure (close code 1011). Browsers
surface that as “WebSocket is closed before the connection is established,” and
the client may then log stale-socket send warnings while it retries. The
public-auth gateway and agent now emit only allowlisted lifecycle diagnostics
with a bounded opaque request ID; the Playwright audit retains only event types
and query-parameter names. MCP failure
must never be allowed to strand a thread or make a thread look locked. A failed
model stream can still be retried, and a new question uses the complete retained
thread context.

## Full-context requests and external bounds

The agent does not add per-turn ceilings for successful model passes, successful
MCP calls, response output tokens, question length, or stored message count.
The model can make as many post-evidence tool/model passes as the provider
accepts, and the AI SDK's default retry behavior applies because the agent does
not override `maxRetries`. Before evidence succeeds, three unusable tool results
bound an empty/error loop. The public MCP schema and provider/runtime limits
remain authoritative.

Overlapping browser submissions are queued and processed in order. The agent
does not silently drop a user message while another turn is active; the
frontend also disables the composer while a turn is streaming or recovering.
If an older interrupted transcript already contains adjacent user messages,
they are merged only for the next model input; the stored transcript remains
unchanged for history and export.

The Durable Object uses the SDK's normal message persistence without an
application message-count cap. Each accepted turn converts the complete
Durable Object transcript into model messages and sends that full context to
Workers AI after merging adjacent user messages left by interrupted turns.
Automatic context compaction and transient compaction status events are
disabled, so the rolling quota-unit budget is spent on the full thread until the
provider's context limit is reached. A provider context failure receives the
same safe retry path as other stream failures. Legacy `data-compaction` parts
from older threads are not generated, but remain sanitized on export and can
still display as a historical marker.
The Worker still coalesces adjacent `tool-input-delta` chunks for a tool call
before the UI stream is returned, preserving protocol boundaries and limiting
synchronous client updates. This stream safeguard is independent of context
policy.
The frontend's reader snapshot is ref-backed and synchronous; it follows the
AI SDK's existing message cadence without scheduling a second React state
update for every stream frame.
The frontend hides empty assistant placeholders left by an interrupted stream.
A failed stream is shown as an actionable retry while keeping the thread
available. Provider stream failures emit a redacted structured diagnostic keyed
by the SDK request ID; the fallback log retains only the error type.
Workers AI's out-of-capacity signal is surfaced as the explicit UTC reset
message above; other failures receive a safe retry message. A best-effort thread
timestamp update is not allowed to turn an otherwise completed model response
into a stream error.

Exports include answer text, bounded public reasoning traces, legacy context
summaries, citations, available timestamps, and sanitized real model tool
activity. Native model tool parts are normalized to a compact audit shape, and
legacy synthetic activity is omitted. A top-level `toolCalls` index makes the
audit list easy to scan. Tool arguments, raw MCP payloads, provider metadata,
upstream errors, and credentials are never exported. Existing responses that were persisted as ordinary text
before this separation are not rewritten; start a new thread if an older
transcript contains planning notes. Earlier planning text is not a pending task
or user authorization; new turns answer the current question under the
read-only boundary.
The export payload advertises `formatVersion: 2` so downstream audit tooling
can distinguish this reasoning-and-tool-aware shape from older transcript
exports.
Threads are retained for 30 days unless the user deletes them.

## Capacity and controls

Workers AI uses `@cf/zai-org/glm-4.7-flash`. Each Google subject has a rolling
**1,000,000 quota-unit budget over 1 hour** across all of their threads. Before a
model call, the Worker estimates the serialized system prompt and full
non-reasoning model input at four characters per token, weights that input at
0.25 units per token, and adds the bounded 700-unit output allowance before
atomically reserving the provisional quota units in D1. Once `streamText`
completes, the AI SDK's aggregate output count (text plus reasoning) is charged
at full weight. Uncached input is charged at 0.25 units per token; cached input
is charged at zero. The Worker prefers the AI SDK's provider-reported
`inputTokenDetails.noCacheTokens` and otherwise derives uncached input as
`inputTokens - inputTokenDetails.cacheReadTokens`. The existing
`actual_input_tokens` and `actual_output_tokens` columns store the weighted
input and output quota-unit components for compatibility. Reservation rows also
carry a lifecycle state: `reserved` before model execution, `in-flight` while a
provider request is running, `settled` after provider usage is recorded,
`released` for a proven pre-model failure or a classified provider allocation/capacity rejection before any model output, and `unknown` when execution began or usage could not be recovered. The quota endpoint reports settled and provisional usage separately while preserving the combined `usedTokens` total.
A cheap availability check runs before MCP catalog work for already exhausted
subjects, while the post-conversion reservation remains authoritative for exact
prompt size and races. A full rolling budget produces a bounded assistant
message; it does not revoke the session, block the gateway, hide history, or
require a new thread.

Cloudflare's Workers AI usage dashboard and provider response are authoritative
for account-wide capacity. The previous 8,000-neuron local estimate was only an
approximation; it could pause the assistant even when the provider was still
well below its 10,000-neuron daily free allocation, so it is no longer an
admission gate. The `agent_control` row remains an administrator pause switch.
When Workers AI reports an exhausted provider allocation, the agent surfaces
**The provider's daily Workers AI allocation has been used up. Try again after
00:00 UTC.** Temporary provider-capacity failures use a separate retry-later
message. A classified allocation or capacity rejection that produces no model
output releases its provisional reservation; partial-output, generic stream, and
aborted failures remain provisional or `unknown` because provider usage may exist.
These provider limits are distinct from the per-user rolling budget. The
implementation records bounded provisional reservations and settled token
totals without charging a failed pre-output capacity attempt; user identity is
not sent to the model and Google access tokens are not stored.

The Cloudflare dashboard reports provider usage in Neurons. Its "today" value
uses the UTC day boundary, while a "last 24 hours" chart can include the prior
UTC day. The assistant's quota meter reports application quota units and may
include provisional reservations from interrupted turns; the two meters are
not interchangeable.

Local source and checks establish the implementation only. D1 creation,
migration application, runtime-key provisioning, Worker deployment, and live
smoke checks remain separate approval-gated operations. See
[[architecture/portfolio-public-auth|Public portfolio authentication]] and
[[operations/deployment|Production deployment]] for those boundaries.

## References

- [Agent Worker configuration](../../workers/portfolio-agent/wrangler.toml)
- [Agent implementation](../../workers/portfolio-agent/src/agent.ts)
- [Agent export sanitizer](../../workers/portfolio-agent/src/export.ts)
- [Agent diagnostics](../../workers/portfolio-agent/src/diagnostics.ts)
- [Agent evidence boundary](../../workers/portfolio-agent/src/evidence.ts)
- [Agent limits](../../workers/portfolio-agent/src/limits.ts)
- [Agent stream boundary](../../workers/portfolio-agent/src/stream.ts)
- [Public MCP architecture](./portfolio-mcp.md)
- [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/)
- [Workers AI pricing and limits](https://developers.cloudflare.com/workers-ai/platform/pricing/)
