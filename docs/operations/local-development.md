---
title: Local Development
tags:
  - operations
  - development
role: guide
---

# Local Development

Operator-Syn uses npm workspaces. Run commands from the repository root for
the stable orchestration aliases, or from a workspace when working directly
on one runtime.

## Install and application development

Install all workspace dependencies and start the portfolio frontend:

```bash
npm install
npm run dev
```

The frontend workspace is `apps/portfolio-web/`. Its Vite entrypoint is
`apps/portfolio-web/src/main.tsx`, its Pages Functions live in
`apps/portfolio-web/functions/`, and its local build output is
`apps/portfolio-web/dist/`.

Useful root checks are:

```bash
npm run typecheck
npm run lint
npm run check:biome
npm run build
npm run preview
```

## Local portfolio assistant

The `main` branch intentionally renders a coming-soon teaser and does not call
the authentication or agent endpoints. Switch to the `agent-development`
branch before exercising the active chat flow; that branch changes only the
release gate, so the endpoint and security instructions below remain the same.

Vite development requires an explicit public-auth endpoint. To use the
deployed Workers from `npm run dev`, put these values in the ignored
repository-root `.env.local` file (the Vite configuration uses that root as
its `envDir`):

```dotenv
VITE_PUBLIC_AUTH_URL=https://public-auth.syn-forge.com
VITE_TURNSTILE_SITE_KEY=<production widget site key>
```

If the public-auth endpoint is missing or malformed in a development build, the
FAB shows a configuration error instead of redirecting to production. Production
builds use the explicit production default only when no production override is
provided. The production Worker `BROWSER_ORIGINS` values are parameterized
in the Wrangler files and include `http://localhost:5173` for this workflow;
they are not wildcard origins.

The production auth Worker uses a `Secure; HttpOnly; SameSite=None` session
cookie for this cross-site local-browser flow, while state-changing routes still
require the exact configured Origin. If Brave or another browser blocks
third-party cookies, allow cookies for `public-auth.syn-forge.com` during local
testing or use the isolated local Worker profile below.

The Google OAuth callback remains the production URI
`https://public-auth.syn-forge.com/oauth/google/callback`; the OAuth state stores
the localhost return target. The production Turnstile widget must allow the
`localhost` hostname, and its production site key must be paired with the
production `TURNSTILE_SECRET_KEY`. Do not use Cloudflare's dummy test keys with
the production Worker secret.

### Authenticated Playwright browser checks

The authenticated browser check targets the active assistant on the
`agent-development` branch. Keep Vite at `http://localhost:5173` and use the
deployed public-auth and agent endpoints from the environment above. The
Playwright configuration starts or reuses that Vite server when the E2E command
runs.

Create the ignored storage directory and start the recorder from the repository
root:

```bash
mkdir -p playwright/.auth
npx playwright codegen \
  --save-storage=playwright/.auth/google.json \
  http://localhost:5173/ai
```

In the opened browser, open the portfolio assistant, choose **Continue with
Google**, and complete Google login, MFA, or CAPTCHA yourself. Wait for the
redirect back to `/ai`, then close the browser so Playwright writes the state
file. Do not automate or record Google username/password entry, bypass MFA or
CAPTCHA, or copy credentials into a generated test.

Run the authenticated browser checks with:

```bash
npm run test:e2e
```

The suite loads `playwright/.auth/google.json`, opens `/ai`, checks that
`/session` returns an authenticated profile, and exercises the active assistant
connection through the public-auth gateway. Every test installs the redacted
browser audit from `tests/portfolio-web/playwright-observability.ts`: it keeps
only event kinds and URL parameter names, detects JWT-shaped values without
retaining them, and flags the premature-close console error. Playwright writes
no trace or HAR; output goes to the ignored `playwright/.artifacts/` directory.
Set `E2E_BASE_URL` to target a local Pages preview instead of Vite.

The grounded model question is intentionally skipped unless the explicit live
gate is enabled:

```bash
npm run test:e2e:live
```

That dedicated smoke creates a real assistant turn and can consume the rolling
Workers AI budget, so run it only at the approval-gated live-smoke checkpoint.
It requires a fresh valid saved Google session and fails if the provider returns
an allocation/capacity message or if the response does not add a new cited
assistant message. A provider allocation failure is distinct from the user's
rolling quota and is reported as an exhausted daily Workers AI allocation.
The normal suite may still open and close an authenticated WebSocket while
checking the panel; it does not send a model question. If the state expires,
repeat the manual recorder flow. Treat the state file as a live session secret
and never commit or share it. Install the Playwright Chromium browser once
with `npx playwright install chromium` if needed.

This application does not use Firebase or IndexedDB for authentication. If a
future auth implementation stores tokens in IndexedDB, save the state with
`context.storageState({ path: authFile, indexedDB: true })` before reusing it.

### Optional Nix shell for Playwright browsers

The repository includes an optional Nix flake for Playwright browser runtime
libraries on Linux and browser-cache policy on macOS. It does not install Node,
npm, Python, or Pipenv; use the host's supported Node.js runtime (Node 22 or
newer, matching CI).

Enter it manually with `nix develop`, or run `direnv allow` to use the guarded
root `.envrc`. If the flake files are still untracked in a working tree, use
`nix develop --impure path:$PWD` until they are added to Git. From the repository
root, install the npm Playwright revisions
explicitly:

```bash
npx playwright install chromium firefox webkit
```

Downloads stay in the ignored `.playwright-browsers/` directory, and
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` prevents dependency installation from
silently downloading a second browser set. Do not use
`npx playwright install-deps` on NixOS; that command targets apt-based hosts.
The shell does not enable system-wide `nix-ld`; Linux hosts need an existing
compatible ELF loader for downloaded WebKit binaries. Authentication storage
remains a manually created local session secret as described above.

Codex's repository-local `SessionStart` and `SubagentStart` hooks perform a
lightweight, read-only check for root Nix shell markers. When Nix is available
and the host system is declared by the flake, the hook suggests `nix develop
--command <command>` for browser/runtime-sensitive checks. If Nix is missing or
compatibility cannot be confirmed, it reports that and leaves commands in the
host environment. It does not run `nix develop`, call `direnv allow`, source
`.envrc`, or provide Node/npm/Python/Pipenv; a child hook cannot change the
parent shell.

### Assistant connection troubleshooting

The Agents SDK resolves an asynchronous opaque request ID during the assistant
connection. The chat component is intentionally rendered under `Suspense` and
uses a short positive query cache so reconnects receive a fresh `/agent/prepare`
result. The browser connects to public-auth with its HttpOnly session cookie;
public-auth rechecks access and forwards the upgrade over the private service
binding, so no bearer token is placed in the WebSocket URL. The per-user
1,000,000-token/1-hour budget is enforced after the WebSocket is authenticated,
so a full rolling window does not hide the saved transcript.

If the browser reports `An unknown Component is an async Client Component` at
`useAgent`, reload the current build and confirm the deployed Pages version
contains the assistant connection boundary. A gateway or WebSocket failure
should remain inside the assistant panel as `The assistant connection could not
be opened`; use its retry action or start a new thread. Chrome's `Fetch finished
loading` messages are informational; inspect the corresponding request status
before treating them as errors. The expected Cloudflare Insights beacon
`ERR_BLOCKED_BY_CLIENT` can be ignored; other request failures and
`WebSocket is closed before the connection is established` events should be
captured by the redacted Playwright audit. Never paste session cookies, agent
tokens, authorization headers, or raw WebSocket URLs into an issue or log.

### Agent diagnostics

Server logs prefixed [portfolio-agent:diagnostic] contain allowlisted JSON events
for MCP, quota, model, and settlement phases. Use the phase and outcome to
separate a skipped/static turn, MCP discovery or grounding failure, provider
stream failure, and completed settlement; question text, raw tool data, and
credentials are intentionally absent. Provider diagnostics may include only
allowlisted capacity classes/codes (`account-allocation`/`3036` or `4006`, and
`out-of-capacity`/`3040`). Quota diagnostics distinguish settled usage from
provisional reservations held after an interrupted provider turn. Use the
opaque request ID to correlate browser and Worker events. See
[[plans/portfolio-agent/sweeps/33-structured-diagnostics|Sweep 33]] for the
event contract.

### Optional: run isolated local Workers

If you do not want local Vite requests to use production authentication and
agent state, set `VITE_PUBLIC_AUTH_URL=http://localhost:8787` in the ignored
`.env.local` file. No browser-facing agent URL is required because public-auth
uses the local service binding. Then run the local Workers and frontend in
separate terminals:

```bash
npx wrangler d1 migrations apply portfolio-agent-auth --local \
  --config workers/portfolio-public-auth/wrangler.toml --env local
npm run portfolio-agent:dev
npm run public-auth:dev
npm run dev
```

The local Wrangler profiles expose public-auth at `localhost:8787` and expose
the agent only through their local service binding; `localhost:8788` is not a
browser endpoint. They also pin the local compatibility date to the newest date
supported by the installed Wrangler runtime; the production compatibility date
remains unchanged. The shared local D1 database is keyed by the checked-in
database ID but is not the remote database when `--local` is used. Do not apply
this command with `--remote` as part of frontend testing.

Create or fill the ignored `.dev.vars` files beside each Worker Wrangler
configuration. This is needed only for the isolated local Worker profile.
Use local-only values for the Google client credentials, Turnstile secret, and
shared internal key. Active Workers do not need an agent-token signing key.
Never copy those values into the frontend `.env` file or commit either
`.dev.vars` file.

For the isolated local Worker profile, the Google OAuth client must allow
`http://localhost:5173` as an authorized JavaScript origin and
`http://localhost:8787/oauth/google/callback` as an authorized redirect URI.
The redirect URI must match that profile exactly. Use a local Turnstile
widget/site key for the localhost build; its secret remains only in
public-auth's `.dev.vars`.

The local profile intentionally points the unused admin-auth check at
`http://localhost:8789`; the existing Atelier/admin auth Worker is not started
by this workflow, so local admin reset endpoints remain unavailable and fail
closed.

Cloudflare Pages should use `apps/portfolio-web` as its project root, `npm run
build` as its build command, and `dist` as its output directory; Pages
Functions are discovered from the `functions/` directory at that workspace
root. Cloudflare Pages' monorepo support and Functions routing require that
project-root arrangement; this repository does not deploy Pages from the
legacy root layout.

## Portfolio API Worker

The Hono API Worker is the `workers/portfolio-api/` workspace. Its entrypoint
is `workers/portfolio-api/src/entrypoint.ts`; D1/R2 models and controllers
remain inside that workspace. Run its local Worker directly with:

```bash
npm run dev --workspace=@syn-forge/portfolio-api
```

The root API aliases delegate to this workspace:

```bash
npm run db:migration:generate -- --name=add_descriptive_change
npm run db:migration:check
npm run db:migrations:list:local
```

The checked-in Wrangler configuration is
`workers/portfolio-api/wrangler.toml`. Database migration application remains
an explicit operation; do not treat typechecks or Worker builds as migration
application.

## Public portfolio MCP — remote Streamable HTTP

The public, read-only portfolio MCP is isolated in `workers/portfolio-mcp/`.
It is a remote stateless Cloudflare Worker using Streamable HTTP at
`https://mcp.syn-forge.com/mcp`; it is not the local stdio repository MCP.
Check and test it with:

```bash
npm run mcp:portfolio:check
npm run test:portfolio-mcp
npm run mcp:portfolio:dev
```

The production deployment wrapper is `npm run mcp:portfolio:deploy`; it
delegates to the workspace's `wrangler.toml`. Deployment and custom-domain
activation are separate from local checks. See
[[architecture/portfolio-mcp|Public Portfolio MCP (Streamable HTTP)]] for its Service Binding and
post-deploy verification contract. See
[[architecture/portfolio-mcp-modules|Public Portfolio MCP module structure]] when changing its
internal Worker modules.

## Local repository MCP — stdio

The local repository-only MCP is the `tools/repository-mcp/` workspace. It is a
stdio subprocess with no public URL. Its root-safe client bridge remains
`scripts/mcp-launcher.mjs` so `.mcp.json` and Codex can resolve a relocated Git
checkout.

Use [[operations/repository-mcp|Local Repository MCP (stdio) and Commit Pipeline]]
for the guarded change and commit workflow. The local checks for repository
tooling are:

```bash
npm run mcp:check
npm run skills:check
npm run mcp:typecheck
npm run test:mcp
npm run setup:git-hooks
```

This MCP is local-only. It does not expose the public portfolio contract, deploy,
access Cloudflare credentials, or apply D1 migrations. Graphify updates remain
an explicit separate step.

## Graphify

Graphify is managed by Pipenv and keeps generated state under
`graphify-out/`:

```bash
pipenv install --dev --deploy
pipenv run graphify query "How does the frontend connect to the Hono API?"
pipenv run graphify update . --no-cluster
```

The repository Graphify configuration is code-only. Use the vault map for
Markdown documentation rather than expecting the code graph to contain notes.

## D1 workflow

Use [[database/drizzle|Drizzle tooling]] and [[database/migrations|the migration guide]] for schema changes. The editable schema and migrations are owned by
`workers/portfolio-api/`:

```bash
npm run db:migration:generate -- --name=add_descriptive_change
npm run db:migration:check
npm run db:migrations:apply:local
```

Inspect SQL and verify the local schema before considering a remote apply.
Existing seed content is not migration history.

Do not put secrets in committed environment files. The frontend preserves the
root `.env` location for local Vite variables through its configured `envDir`;
workspace-specific deployment settings remain in their Wrangler files.
