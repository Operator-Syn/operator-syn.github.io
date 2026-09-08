---
title: API Routes
tags:
  - api
  - architecture
role: catalog
---

# API Routes

The route source is
[`workers/portfolio-api/src/entrypoint.ts`](../../workers/portfolio-api/src/entrypoint.ts).
CORS is applied to all
routes, `OPTIONS /api/*` handles preflight requests, and API responses default
to `no-store` unless a route overrides the cache headers.

The implementation boundary is documented in
[[architecture/controllers|the controller map]] and
[[architecture/layer-boundaries|the layer assessment]].

The public portfolio MCP is a separate Worker, not an additional `/api/*`
route in this Hono application. It calls the public GET contracts below
through a Service Binding to `portfolio-api`; see
[[architecture/portfolio-mcp|Public Portfolio MCP (Streamable HTTP)]] for its
tool/resource contract.

## Public routes

These GET routes are registered before the private auth middleware:

| Area | Routes |
| --- | --- |
| Projects | `GET /api/projects`, `GET /api/project/:id`, `GET /api/project/:projectId/gallery` |
| Projects archive v2 | `GET /api/v2/projects/archive` |
| Certificate archive v2 | `GET /api/v2/certificates/archive` |
| Snippets | `GET /api/snippets`, `GET /api/snippets/:id`, `GET /api/snippets/:id/content` |
| Snippets document v2 | `GET /api/v2/snippets/:id`, `GET /api/v2/snippets/:id/preview`, `GET /api/v2/snippets/:id/content` |
| Home content | `GET /api/settings`, `GET /api/profile`, `GET /api/sections`, `GET /api/sections/:sectionId/items` |
| Project media | `GET /api/projects/media`, `GET /api/projects/media/:key{.+}` |
| Certificate media | `GET /api/certificates/media`, `GET /api/certificates/media/:key{.+}` |
| Certificates (legacy/public) | `GET /api/certificates`, `GET /api/certificates/:id`, `GET /api/certificates/:certId/items` |

## Private routes

All routes below are private writes accepted only from the Eury admin gateway with
the server-held `X-Admin-Internal-Key`. Browser-origin writes, including the
legacy `auth_token` cookie path, are retired: configured admin origins return
`410 LEGACY_ROUTE_RETIRED`, while missing or untrusted origins return `403`.
Browser callers must not send the internal header.

| Area | Routes |
| --- | --- |
| Project media | `POST /api/projects/media`, `PUT /api/projects/media/:key{.+}`, `DELETE /api/projects/media/:key{.+}`, `POST /api/projects/media/presign` |
| Certificate media | `POST /api/certificates/media`, `PUT /api/certificates/media/:key{.+}`, `DELETE /api/certificates/media/:key{.+}`, `POST /api/certificates/media/presign` |
| Projects | `POST /api/project`, `PUT /api/project/:id`, `DELETE /api/project/:id` |
| Gallery | `POST /api/gallery`, `PUT /api/gallery/:id`, `DELETE /api/gallery/:id` |
| Certificates | `POST /api/certificates`, `PUT /api/certificates/:id`, `DELETE /api/certificates/:id` |
| Certificate items | `POST /api/certificates/items`, `PUT /api/certificates/items/:id`, `DELETE /api/certificates/items/:id` |
| Snippets | `POST /api/snippets`, `PATCH /api/snippets/:id`, `DELETE /api/snippets/:id` |
| Home content | `POST`, `PUT`, `DELETE` routes for settings, profile, sections, and section items |

Keep this note aligned with `workers/portfolio-api/src/entrypoint.ts`; route behavior belongs in the source
and tests, not in a duplicated implementation.

## Project archive pagination

`GET /api/v2/projects/archive` is the cursor-backed read contract used by the
Projects archive. It accepts `limit` (default `4`, maximum `12`) and an
opaque `cursor`; it does not accept offset pagination. The response contains
`data` with nested gallery items and a `pagination` object with `total`,
`has_more`, and `next_cursor`. The existing `GET /api/projects` array
response remains unchanged for Home and compatibility with existing clients.

## Certificate archive pagination

`GET /api/v2/certificates/archive` is the cursor-backed read contract used by the
Certificates archive. It accepts `limit` (default `6`, maximum `12`) and an
opaque `cursor`; it rejects `offset`. Its `data` rows preserve certificate
fields and include batched `items`, while `pagination` contains `limit`,
`total`, `has_more`, and `next_cursor`. The unversioned
`/api/certificates`, `/api/certificates/:id`, and
`/api/certificates/:certId/items` contracts remain unchanged for older
portfolio clients.

## Snippets document reads

The v2 snippet reads are additive contracts for the public archive and its
canonical document pages:

- `GET /api/v2/snippets/:id` returns stable file metadata, the derived parent
  path segments, and the current document identity used to build a shareable
  URL.
- `GET /api/v2/snippets/:id/preview` returns metadata plus a bounded Markdown
  excerpt and `truncated` state. The model chooses a paragraph, line, or hard
  boundary and closes an open fenced block before marking the excerpt.
- `GET /api/v2/snippets/:id/content` streams the full file inline for the
  dedicated document route. The legacy `/api/snippets/:id/content` download
  route remains unchanged for existing clients.

The document URL is `/snippets/document/<id>/<slug>/`; the slug is derived
from the current file name and is normalized when a stale name is requested.
No offset or cursor parameter is involved in snippet document reads, and no
D1 migration is required because path and excerpt values are derived at read
time.

## Admin gateway ordering and profile contracts

The admin gateway uses two additive ordering/profile contracts during the
dashboard parity rollout:

- `PUT /api/projects/order` and `PUT /api/certificates/order` accept
  `{ items: [{ id, display_order }] }` and update the complete order as one D1
  batch.
- `PUT /api/profile/:id` and `DELETE /api/profile/:id` address profile rows by
  their stable numeric ID. The label-based routes remain for older clients.

These writes also accept the server-held `X-Admin-Internal-Key` from the
private Eury admin gateway. Browser callers must not send that header.
