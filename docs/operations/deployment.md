---
title: Production Deployment
aliases:
  - Deployment
  - Production release
tags:
  - operations
  - deployment
  - cloudflare
role: runbook
---

# Production Deployment

This runbook coordinates the five runtime surfaces in this repository:

1. the React/Vite portfolio on Cloudflare Pages at https://syn-forge.com;
2. the Hono portfolio API Worker at https://personal-portfolio.syn-forge.com;
3. the public-auth Worker at https://public-auth.syn-forge.com;
4. the stateful portfolio-agent Worker at https://assistant.syn-forge.com; and
5. the stateless public Portfolio MCP Worker at https://mcp.syn-forge.com/mcp.

The repository is an npm monorepo. Use the surface-specific procedures below.

## Deployment topology

This release spans five runtime surfaces plus their storage dependencies:

1. the React/Vite portfolio on Cloudflare Pages at https://syn-forge.com;
2. the Hono portfolio API Worker at https://personal-portfolio.syn-forge.com;
3. the public-auth Worker at https://public-auth.syn-forge.com;
4. the stateful portfolio-agent Worker at https://assistant.syn-forge.com; and
5. the stateless public Portfolio MCP Worker at https://mcp.syn-forge.com/mcp.

| Surface | Source | Production target | Deployment path |
| --- | --- | --- | --- |
| Portfolio web | apps/portfolio-web/ | Cloudflare Pages, syn-forge.com | Pages Git integration |
| Portfolio API | workers/portfolio-api/ | Worker, personal-portfolio.syn-forge.com | GitHub Actions on main (Wrangler) |
| Public auth | workers/portfolio-public-auth/ | Worker, public-auth.syn-forge.com | GitHub Actions on main (Wrangler) |
| Portfolio MCP | workers/portfolio-mcp/ | Worker, mcp.syn-forge.com | GitHub Actions on main (Wrangler) |
| Portfolio agent | workers/portfolio-agent/ | Worker, assistant.syn-forge.com | GitHub Actions on main (Wrangler) |
| Portfolio data | workers/portfolio-api/migrations/ | D1 my-personal-portfolio + R2 personal-portfolio | Explicit, separately authorized operations |
| Assistant state | workers/portfolio-public-auth/migrations/ | D1 portfolio-agent-auth + Durable Objects | Explicit D1 migration; DO schema ships with the agent |

The API Worker must be available before the MCP Worker because its service
binding depends on that runtime surface. The portfolio agent is deployed after
the MCP Worker, and public-auth follows the agent because its service binding
targets `portfolio-agent`. For the cookie-authenticated WebSocket gateway, keep
that order: agent (internal route and hibernation behavior), public-auth (cookie
and service-binding gateway), then Pages (browser host and connection query).
Pages remains a separate Git-integrated deployment from the same main-branch
push. CP5 retirement is deployed: portfolio-agent version
`dcab1312-ae9b-4f0b-ac70-c16ef69b6b7c` is followed by public-auth version
`31f80f41-efe2-4be1-875b-5d9c98cdf9b0`; `/agent/token` and the direct public
agent route return `404`, while unauthenticated `/agent/prepare` returns `401`.
Rollback to a pre-gateway release is a separately authorized compatibility
action.

Local assistant testing uses the `env.local` profiles in the public-auth and
portfolio-agent Wrangler files plus the explicit Vite `VITE_PUBLIC_AUTH_URL`
value. The agent is reached through the public-auth service binding; local
values are not production deployment inputs. See
[[operations/local-development|Local Development]] for the local D1, OAuth
callback, and ignored `.dev.vars` setup.

## Before a production release

### Required access and resources

Confirm access to the Cloudflare account that owns the syn-forge.com zone:

~~~bash
npx wrangler --version
npx wrangler login
npx wrangler whoami
~~~

The repository pins Wrangler 4.125.0 in its workspace manifests. Run commands
from the repository root after installing dependencies with the lockfile:

~~~bash
npm ci
~~~

The following resources must already exist or be provisioned in the same
Cloudflare account:

- the syn-forge.com zone and DNS/certificate eligibility;
- the auth-worker used by the Eury administration gateway;
- the my-personal-portfolio D1 database and personal-portfolio R2 bucket;
- the portfolio-agent-auth D1 database for public-auth;
- the Cloudflare Pages project for the web application; and
- the custom domains and service bindings declared by the four Worker
  configurations.

The checked-in Worker configurations are authoritative for names and bindings:

- workers/portfolio-api/wrangler.toml declares portfolio-api, its API DB/R2
  bindings, and the personal-portfolio.syn-forge.com custom domain.
- workers/portfolio-public-auth/wrangler.toml declares public-auth, the auth
  D1 binding, the portfolio-agent service binding, and
  public-auth.syn-forge.com.
- workers/portfolio-mcp/wrangler.toml declares syn-forge-portfolio-mcp, the
  PORTFOLIO_API service binding, and mcp.syn-forge.com.
- workers/portfolio-agent/wrangler.toml declares portfolio-agent, Workers AI,
  the auth D1 binding, the PortfolioAgent Durable Object, and
  assistant.syn-forge.com.

### API Worker secrets

The API Worker reads these values from its bindings type:

- ACCOUNT_ID;
- R2_ACCESS_KEY_ID; and
- R2_SECRET_ACCESS_KEY.

Set them as Worker secrets. Never put their values in wrangler.toml, .env,
committed documentation, shell history, or logs:

~~~bash
npx wrangler secret put ACCOUNT_ID \
  --config workers/portfolio-api/wrangler.toml
npx wrangler secret put R2_ACCESS_KEY_ID \
  --config workers/portfolio-api/wrangler.toml
npx wrangler secret put R2_SECRET_ACCESS_KEY \
  --config workers/portfolio-api/wrangler.toml
~~~

The API uses the R2 S3-compatible endpoint and creates short-lived presigned
upload URLs. Create or use an R2 S3 API token scoped to the personal-portfolio
bucket with Object Read & Write permission, then place its Access Key ID and
Secret Access Key into the two corresponding Worker secrets. Keep the R2
token itself out of the repository.

The non-secret API values are already declared in
workers/portfolio-api/wrangler.toml:

- VITE_CDN_URL points to the public media hostname;
- R2_BUCKET_NAME is personal-portfolio;
- DB targets my-personal-portfolio; and
- BUCKET targets personal-portfolio.

The server-held `ADMIN_INTERNAL_KEY` is provisioned as a Worker secret and is
the only write credential accepted from the Eury gateway; it is not part of
these non-secret values.

Do not add the API secrets to the MCP Worker. The MCP Worker only needs its
PORTFOLIO_API Service Binding in production.

## Public-auth runtime provisioning

Complete these steps once before the first public-auth deploy. They are
manual, reviewed operations and are not performed by GitHub Actions.

1. Create the D1 database named portfolio-agent-auth and record its
   database ID in both the public-auth and portfolio-agent Wrangler
   configurations.
2. Review workers/portfolio-public-auth/migrations/0000_portfolio_agent_auth.sql,
   workers/portfolio-public-auth/migrations/0001_add_rolling_token_usage.sql,
   workers/portfolio-public-auth/migrations/0002_add_actual_token_usage.sql, and
   workers/portfolio-public-auth/migrations/0003_add_google_profile_picture.sql.
   Before the first deploy, run npm run migrate:public-auth; it applies pending
   remote auth migrations with one affirmative Wrangler prompt response and stops
   on failure. All migrations through 0003 must be applied before deploying
   the assistant Workers: the agent settles actual input plus output usage for
   the 1,000,000-token budget, and public-auth returns the validated profile
   image URL.
3. Register the Google OAuth client with the exact callback
   https://public-auth.syn-forge.com/oauth/google/callback and the scopes
   openid, email, and profile.
4. Create a Turnstile widget for syn-forge.com. If local Vite development will
   use the production Workers, allow `localhost` in that widget's hostname
   list; expose only its site key as the frontend build variable
   VITE_TURNSTILE_SITE_KEY.
5. Set the shared internal service-binding key in both Workers. Keep all
   runtime values out of committed .env files, logs, and workflow YAML. The
   production Wrangler variables also parameterize `BROWSER_ORIGINS` (including
   the exact localhost development origin) and set
   `SESSION_COOKIE_SAME_SITE = "None"` for credentialed local-Vite requests.

The exact runtime key labels are listed as fragments in
[[architecture/portfolio-public-auth|Public Portfolio Authentication]] so they
remain readable without placing credential-like strings in source scans. Do
not pass any of these runtime values through GitHub Actions; Wrangler deploys
the already configured Worker bindings only.

## GitHub Actions Worker deployment

The checked-in [production Worker workflow](../../.github/workflows/deploy-production-workers.yml)
runs only for pushes to main. Its validation job installs the lockfile
dependencies and runs typecheck, lint, Biome, the frontend/API/MCP/public-auth/
agent test suites, deployment-path assertions, documentation validation, and
both MCP configuration checks.

After validation succeeds, the jobs run in this order:

1. portfolio-api;
2. portfolio-mcp;
3. portfolio-agent; and
4. portfolio-public-auth after the agent exists for its service binding.

Every Worker job uses actions/checkout@v6, actions/setup-node@v6 with Node 22,
and cloudflare/wrangler-action@v3 pinned to Wrangler 4.125.0. Each Worker
deploy explicitly selects the top-level production Wrangler environment with
`--env=""`; the checked-in `env.local` profiles are never deployment targets.
The workflow
passes only the repository secrets CLOUDFLARE_API_TOKEN and
CLOUDFLARE_ACCOUNT_ID. Use an account-scoped token based on Cloudflare's
Edit Cloudflare Workers template and restrict it to this account.

The workflow does not upload Pages, deploy auth-worker, pass runtime Google/
Turnstile/service-binding values, or apply any D1 migration. A dry run
validates the selected Wrangler configuration; it is not live verification.

Cloudflare Pages remains on its existing Git integration and starts its own
production build for the same main push. The Pages build and the Worker graph
are coordinated by the commit but are not atomic.

The current `main` release deliberately publishes the portfolio assistant as a
coming-soon teaser. Continue active assistant development on the separate
`agent-development` branch; the Worker workflow remains restricted to `main`,
and the production Pages branch must not be changed to that development branch.
If Pages preview builds are enabled for branches, treat them as development
surfaces and verify their Vite endpoint variables before testing authentication.

### Root npm script for the assistant Workers

From the repository root, the assistant-only script runs both production dry
runs first, applies pending public-auth migrations, then deploys
`portfolio-agent` before `portfolio-public-auth`:

~~~bash
npm run deploy:portfolio-assistant
~~~

The script is equivalent to the explicit commands below, with `--env=""`
selecting each top-level production configuration:

~~~bash
npm run deploy:portfolio-agent -- --dry-run
npm run deploy:public-auth -- --dry-run
npm run migrate:public-auth
npm run deploy:portfolio-agent
npm run deploy:public-auth -- --skip-migration
~~~

A direct `npm run deploy:public-auth` also applies pending remote auth
migrations before deploying. Its `--dry-run` mode skips migration, and
`--skip-migration` is intended only when an earlier command in the same
release already applied it. The wrapper supplies Wrangler's confirmation input;
Wrangler 4.125.0 does not provide a `-y` flag. It does not deploy Pages or pass
runtime secrets.

## Preflight verification

Run the same checks locally before changing production:

~~~bash
npm ci
npm run typecheck
npm run lint
npm run check:biome
npm run build
npm run test --workspace=@syn-forge/portfolio-web --
npm run test --workspace=@syn-forge/portfolio-api --
npm run public-auth:check
npm run test:public-auth
npm run portfolio-agent:check
npm run test:portfolio-agent
npm run test:portfolio-mcp
npm run docs:check
npm run mcp:check
npm run mcp:portfolio:check
~~~

Review the complete diff and confirm that generated output, secrets, local
configuration, and unrelated work are not included:

~~~bash
git diff --check
git status --short
git diff --stat
~~~

Refresh the code graph after source changes:

~~~bash
pipenv run graphify update . --no-cluster
~~~

Do not treat a successful build or dry run as proof that a deployed service is
live. Continue with the deployment and post-deployment checks below.

## Database migration release

A raw Worker deployment command never applies D1 migrations. The public-auth
release wrapper is an explicit exception: it applies pending migrations for the
portfolio-agent-auth database before the public-auth deploy, unless `--dry-run`
or `--skip-migration` is supplied. Generic portfolio-API migration commands
remain separately reviewed and operator-authorized.

Generate a migration only after changing the Drizzle schema:

~~~bash
npm run db:migration:generate -- --name=add_descriptive_change
npm run db:migration:check
git diff -- workers/portfolio-api/src/db/schema.ts \
  workers/portfolio-api/migrations/ \
  workers/portfolio-api/drizzle.config.ts \
  workers/portfolio-api/wrangler.toml
~~~

For a reviewed custom SQL change, use the repository script:

~~~bash
npm run db:migration:custom -- --name=backfill_descriptive_change
npm run db:migration:check
~~~

Apply and inspect the database in this order:

~~~bash
npm run db:migrations:list:local
npm run db:migrations:apply:local
npm run db:migrations:list:remote
~~~

Only after reviewing the SQL, local result, and remote pending list may an
authorized operator apply the remote migration:

~~~bash
npm run db:migrations:apply:remote
~~~

Do not replay Initial-Seed.sql as migration history. Do not edit an applied
migration or files under migrations/meta/; use a new forward migration for
corrections. If there are no pending migrations, record that the remote list was
checked and continue. Migration application is a production-data operation:
the generic API workflow and GitHub Actions do not perform it automatically,
while the public-auth wrapper applies only the reviewed auth migration set when
an operator explicitly invokes the release command.

## Deploy the portfolio API Worker

Deploy the API before the MCP Worker.

First run the Wrangler dry run:

~~~bash
npx wrangler deploy --dry-run \
  --config workers/portfolio-api/wrangler.toml
~~~

The portfolio-api workspace has no deploy npm script. The production deploy is
the explicit Wrangler command without --dry-run:

~~~bash
npx wrangler deploy \
  --config workers/portfolio-api/wrangler.toml
~~~

Alternatively:

~~~bash
cd workers/portfolio-api
npx wrangler deploy
~~~

Confirm that the deployment reports the expected Worker and custom domain. A
successful upload does not prove that D1, R2, the auth binding, or public routes
work.

## Deploy the public-auth Worker

The public-auth Worker is deployed after the portfolio-agent Worker because its
`AGENT_WORKER` Service Binding targets that Worker. The gateway accepts only the
same-origin browser session and WebSocket upgrade, then forwards through the
binding to the agent's internal route; it strips cookies, browser authorization,
and arbitrary query values before forwarding. Run the dry run first:

~~~bash
npx wrangler deploy --dry-run \
  --env="" \
  --config workers/portfolio-public-auth/wrangler.toml
~~~

The production deploy uses the same configuration:

~~~bash
npx wrangler deploy \
  --env="" \
  --config workers/portfolio-public-auth/wrangler.toml
~~~

Confirm the custom domain and the auth D1 binding in Wrangler output. This
does not prove Google OAuth, Turnstile, or the service binding works live.

## Configure and deploy Cloudflare Pages

### Pages project settings

Use Cloudflare Pages Git integration for this repository. Configure the
project with:

| Setting | Value |
| --- | --- |
| Repository | Operator-Syn/operator-synaciel |
| Root directory | apps/portfolio-web |
| Build command | npm run build |
| Build output directory | dist |
| Production branch | The branch selected for production in Pages |
| Production custom domain | syn-forge.com |

Set these production Pages environment variables. They are public build-time
values, not secrets:

~~~text
VITE_API_URL=https://personal-portfolio.syn-forge.com/api
VITE_TURNSTILE_SITE_KEY=<existing Turnstile site key>
~~~

If preview deployments are enabled, set `VITE_TURNSTILE_SITE_KEY` in the
Preview environment too. The Vite configuration loads environment values from
the repository root and the frontend requests routes beneath VITE_API_URL. Do
not set this to the MCP endpoint.

`VITE_TURNSTILE_SITE_KEY` is safe to expose in the browser bundle because it is
the public widget identifier. Keep the paired `TURNSTILE_SECRET_KEY` only as a
secret binding on the `portfolio-public-auth` Worker; never put that secret in
Pages variables, `.env`, Wrangler `vars`, source, or workflow YAML. The Vite
configuration fails a Cloudflare Pages production-mode build when the public
site key is absent, preventing an unconfigured assistant gate from being
published silently.

Pages discovers apps/portfolio-web/functions/. The checked-in
apps/portfolio-web/public/_routes.json is copied into the build output and
keeps static assets, llms.txt, robots.txt, and the sitemap outside the Pages
middleware where configured. Do not replace this Functions deployment with a
static-only upload.

On first setup, choose Save and Deploy in the Pages dashboard. Subsequent
production pushes to the selected branch trigger Git-integrated builds. Review
the build log and production deployment URL before checking the custom domain.

### Local Pages checks

Build and inspect the same output locally:

~~~bash
npm run build
npm run pages:dev
~~~

The root preview script builds the frontend and serves dist locally:

~~~bash
npm run preview
~~~

### Direct Upload alternative

Use Direct Upload only if the Pages project was created for Direct Upload.
Git-integrated Pages projects cannot be switched to Direct Upload later:

~~~bash
npm run build
npx wrangler pages deploy apps/portfolio-web/dist \
  --project-name <PAGES_PROJECT_NAME>
~~~

The project name is a Cloudflare account setting and is intentionally not
hardcoded here. Confirm the Pages project mode before using this alternative.

## Deploy the public Portfolio MCP Worker

The API Worker must already exist so the PORTFOLIO_API Service Binding can
resolve.

Validate the production bundle:

~~~bash
npx wrangler deploy --dry-run --env="" \
  --config workers/portfolio-mcp/wrangler.toml
~~~

Deploy through the checked-in npm script:

~~~bash
npm run mcp:portfolio:deploy
~~~

The script uses the top-level production configuration. The env.local block is
for local development only. Production uses the PORTFOLIO_API Service Binding
and mcp.syn-forge.com custom domain.

The MCP Worker is public and unauthenticated. Its public data reads are cached
for six hours at the portfolio API transport boundary. Cache entries are local
to the data center that fills them, and content updates may remain visible for
up to six hours. Deployment does not purge already-warmed cache entries.

## Deploy the portfolio agent Worker

Deploy this Worker after portfolio-mcp and before public-auth:

~~~bash
npx wrangler deploy --dry-run \
  --env="" \
  --config workers/portfolio-agent/wrangler.toml
npx wrangler deploy \
  --env="" \
  --config workers/portfolio-agent/wrangler.toml
~~~

The agent uses the Workers AI binding, the auth D1 binding, and the
PortfolioAgent Durable Object migration declared in its Wrangler file. Do not
apply the Durable Object migration manually. Confirm the assistant custom
domain and binding names in the dry-run output before deploying.

The agent opts into Durable Object WebSocket hibernation and keeps `onStart`
local: it rehydrates SQLite identity but does not wait on MCP or other network
I/O. MCP is an evidence dependency rather than a WebSocket prerequisite and is
connected lazily for the first model turn with bounded recovery. If recovery
fails, the authenticated socket remains available and the next turn returns a
bounded evidence-unavailable response. This prevents an upstream MCP outage
from surfacing as a socket that closes before establishment or from locking a
thread. The helper logs only allowlisted lifecycle data. After deploying an
agent fix, inspect the Worker version and logs without copying tokens, cookies,
model prompts, or MCP payloads.

The history endpoint may initialize a thread before its first WebSocket
connection. The agent release therefore includes a Worker-only identity
handoff on authenticated WebSocket connect; this repopulates the verified
thread identity instead of returning repeated `This assistant session is not
authenticated.` messages for an otherwise valid session.

## Deploy the persisted-thread and rolling-budget fix

The selected-thread history fix spans both assistant Workers. The rolling
budget uses the reviewed public-auth D1 migrations
`workers/portfolio-public-auth/migrations/0001_add_rolling_token_usage.sql` and
`workers/portfolio-public-auth/migrations/0002_add_actual_token_usage.sql`;
the current public-auth identity payload also requires
`workers/portfolio-public-auth/migrations/0003_add_google_profile_picture.sql`.
Apply migrations through 0003 before deploying the assistant Workers. The
agent version settles actual input plus output usage. `portfolio-agent` reads
the Durable Object's persisted
`AIChatAgent` UI messages through its private
`/internal/threads/:id/messages` action. `portfolio-public-auth` checks the
session and D1 thread ownership, then proxies
`/threads/:id/messages` over the service binding. Deploy both Workers as one
reviewed release; deploying only one side leaves the browser with a stale
contract.

The preferred production path is a reviewed commit merged or pushed to `main`.
The workflow validates the repository, then deploys
`portfolio-api → portfolio-mcp → portfolio-agent → portfolio-public-auth`.
Pages starts its own Git-integrated deployment from the same push. The current
`main` branch intentionally keeps the assistant as a teaser, while
`agent-development` enables the active frontend; inspect that release gate
before merging a development branch into production.

If the API and MCP are already healthy and an explicitly authorized Worker-only
hotfix is needed, run these commands from the repository root after the
preflight checks. The empty environment selector targets the top-level
production configuration; do not use `env.local` for this release:

~~~bash
npx wrangler deploy --dry-run --env="" \
  --config workers/portfolio-agent/wrangler.toml
npx wrangler deploy --env="" \
  --config workers/portfolio-agent/wrangler.toml

npx wrangler deploy --dry-run --env="" \
  --config workers/portfolio-public-auth/wrangler.toml
npx wrangler deploy --env="" \
  --config workers/portfolio-public-auth/wrangler.toml
~~~

The former fixed 8,000-neuron estimate is not a provider usage meter and is no
longer an admission gate. The auth Worker clears its legacy
`daily-neuron-budget` marker once before authorizing an assistant connection;
the marker is not a provider meter or an independent access block. An
`AGENT_PAUSED` response now means an explicit administrator pause or missing
control configuration. If Workers AI itself reports out-of-capacity, the agent
returns: **The model is at its maximum daily capacity. Please try again at
00:00 UTC.**

Do not pass runtime secrets on the command line. Wrangler uses the secrets and
variables already provisioned on each Worker. The history route itself remains
read-only and independent of the WebSocket connection; the rolling
reservations are only written when an agent model turn starts.

Check the route boundary before opening an authenticated browser session:

~~~bash
curl --include --silent --show-error \
  -H 'Origin: http://localhost:5173' \
  https://public-auth.syn-forge.com/threads/<owned-thread-id>/messages
~~~

Without a session cookie, `401 AUTH_REQUIRED` confirms that the new route is
deployed. A generic `404 NOT_FOUND` means public-auth is still on the old
version. A `502 AGENT_UNAVAILABLE` means public-auth is updated but the agent
action or service binding is not. With a valid browser session, select an
existing thread from local Vite or production Pages and confirm its persisted
messages render before sending a new message. Keep cookies, tokens, and
transcript contents out of shell history and logs.

## Post-deployment verification

### API smoke checks

~~~bash
curl --fail --silent --show-error \
  https://personal-portfolio.syn-forge.com/api/settings
curl --fail --silent --show-error \
  https://personal-portfolio.syn-forge.com/api/profile
curl --fail --silent --show-error \
  'https://personal-portfolio.syn-forge.com/api/v2/projects/archive?limit=1'
curl --fail --silent --show-error \
  'https://personal-portfolio.syn-forge.com/api/v2/certificates/archive?limit=1'
curl --fail --silent --show-error \
  https://personal-portfolio.syn-forge.com/api/snippets
~~~

Verify that public reads return data or expected empty collections, and that
browser-origin content writes are retired:

~~~bash
curl --include --silent --request POST \
  -H 'Origin: https://atelier.syn-forge.com' \
  -H 'Cookie: auth_token=retirement-probe-only' \
  --data '{}' \
  https://personal-portfolio.syn-forge.com/api/project
~~~

An allowed browser origin should receive `410 LEGACY_ROUTE_RETIRED`; missing
or untrusted origins should receive `403`. The private Eury gateway sends the
server-held internal key instead. Do not paste cookies, tokens, presigned URLs,
or private response contents into logs or issue reports.

### Pages checks

~~~bash
curl --fail --silent --show-error --head https://syn-forge.com/
curl --fail --silent --show-error https://syn-forge.com/llms.txt
curl --fail --silent --show-error --head https://syn-forge.com/robots.txt
curl --fail --silent --show-error --head https://syn-forge.com/sitemap.xml
~~~

Open representative routes in a browser and confirm the home, projects,
certificates, snippets, and AI pages load; route-specific metadata is present
for crawler HTML requests; static files are not rewritten by Pages middleware;
and the browser console has no deployment-specific errors.

### MCP checks

Register https://mcp.syn-forge.com/mcp in an MCP-capable client and confirm:

- the endpoint initializes;
- tools/list exposes the eight public tools;
- resources/list exposes the four portfolio resources;
- get_portfolio_overview returns the current public overview;
- search_portfolio returns bounded results;
- list_projects and list_certificates support documented limits and cursors;
- list_snippets and read_snippet return expected metadata/content behavior; and
- an untrusted browser Origin is rejected.

Inspect live logs while making a representative request:

~~~bash
npx wrangler tail syn-forge-portfolio-mcp
~~~

The Worker configuration enables invocation logs. Do not log portfolio document
contents or credentials.

### Public-auth and agent checks

Verify the public-auth health endpoint and the agent's protected boundary
without copying cookies or tokens into logs:

~~~bash
curl --fail --silent --show-error https://public-auth.syn-forge.com/health
curl --include --silent --request GET https://assistant.syn-forge.com/health
~~~

Then perform one interactive browser smoke flow: Google sign-in, one Turnstile
verification, create/select a thread, ask a grounded portfolio question through
the cookie-authenticated public-auth gateway, observe a citation, export the
sanitized transcript (including the bounded public reasoning trace and tool-call
audit), create a new thread, and delete the old thread. Confirm an unrelated or
unsafe request is refused, the automatic context compaction is not applied, and
a full rolling 1-hour budget leaves the full thread readable while deferring
only the next model turn. Confirm the async `useAgent` connection shows its
loading fallback, does not emit the React async-client-component crash, and
contains a rejected gateway/WebSocket attempt inside the assistant panel with a
retry action. Run the redacted Playwright audit for this flow and record live
results separately from source/build checks; never retain traces, HAR files,
cookies, authorization headers, or raw WebSocket URLs.

## Deployment records

Record the deployment version, commit, time, and verification result. Wrangler
and the Cloudflare dashboard expose Worker versions and deployments. Pages
exposes the production deployment and associated commit.

## Rollback and recovery

### Worker rollback

List recent deployments before selecting a target:

~~~bash
npx wrangler deployments list --name portfolio-api
npx wrangler deployments list --name syn-forge-portfolio-mcp
npx wrangler deployments list --name portfolio-public-auth
npx wrangler deployments list --name portfolio-agent
~~~

Rollback the affected Worker using a reviewed version ID or the previous version:

~~~bash
npx wrangler rollback --name portfolio-api
npx wrangler rollback --name syn-forge-portfolio-mcp
npx wrangler rollback --name portfolio-public-auth
npx wrangler rollback --name portfolio-agent
~~~

A Worker rollback immediately creates a new deployment across its routes and
domains. It does not roll back D1 or R2 state. If code and storage schema are
incompatible, restore service with a forward-compatible change instead of
blindly rolling back.

For Pages, use the Pages dashboard deployment history to retry or roll back
the production deployment. Confirm the custom domain remains attached. For a
gateway rollback, roll Pages back to the last compatible client, then roll
public-auth back, and finally roll the agent back if its internal route or
hibernation change must be removed. Keep the shared internal key and D1 schema
compatible throughout. A rollback to a pre-gateway release may re-enable the
legacy token flow; treat any resulting short-lived credentials as potentially
valid until expiry and follow the auth incident procedure.

### Database recovery

Do not reverse an applied D1 migration by editing its SQL. Review remote
migration state and use a new forward migration or an approved backup recovery
procedure. Coordinate code rollback with the actual D1 schema and R2 object
state.

## Complete release checklist

- [ ] Cloudflare account access verified with npx wrangler whoami.
- [ ] auth-worker exists and is reachable through the API Worker binding.
- [ ] D1 database and R2 bucket names match wrangler.toml.
- [ ] API Worker secrets exist and are scoped appropriately.
- [ ] Public-auth D1, Google OAuth, Turnstile, and internal key
      provisioning is complete.
- [ ] npm ci completed from the repository root.
- [ ] GitHub Actions secrets are configured for Worker deployment.
- [ ] The main-branch validation job passed before Worker deployment.
- [ ] Repository checks and targeted tests passed.
- [ ] Any D1 migration was reviewed, tested locally, listed remotely, and
      explicitly authorized before application.
- [ ] portfolio-api dry run passed.
- [ ] portfolio-api deployed before portfolio-mcp.
- [ ] portfolio-mcp deployed before portfolio-agent.
- [ ] portfolio-agent deployed before public-auth so its Service Binding target
      exists.
- [ ] Pages root, build command, output directory, production branch, and
      VITE_API_URL are correct.
- [ ] Pages production deployment and custom domain verified.
- [ ] portfolio-mcp dry run passed.
- [ ] portfolio-mcp deployed with its Service Binding.
- [ ] portfolio-agent deployed with Workers AI, auth D1, and Durable Object
      bindings.
- [ ] API, Pages, and MCP smoke checks passed.
- [ ] Live logs were checked without exposing secrets or portfolio contents.
- [ ] Deployment version and commit recorded.
- [ ] Rollback target identified.

## Source references

Repository sources:

- [Production Worker deployment workflow](../../.github/workflows/deploy-production-workers.yml)
- [Portfolio agent architecture](../architecture/portfolio-agent.md)
- [Public portfolio authentication](../architecture/portfolio-public-auth.md)
- [Root scripts](../../package.json)
- [Portfolio web manifest](../../apps/portfolio-web/package.json)
- [Portfolio web Vite configuration](../../apps/portfolio-web/vite.config.ts)
- [Pages Functions middleware](../../apps/portfolio-web/functions/_middleware.ts)
- [Pages route configuration](../../apps/portfolio-web/public/_routes.json)
- [Portfolio API manifest](../../workers/portfolio-api/package.json)
- [Portfolio API Wrangler configuration](../../workers/portfolio-api/wrangler.toml)
- [Portfolio API bindings](../../workers/portfolio-api/src/bindings.ts)
- [Portfolio MCP manifest](../../workers/portfolio-mcp/package.json)
- [Portfolio MCP Wrangler configuration](../../workers/portfolio-mcp/wrangler.toml)
- [Public-auth manifest](../../workers/portfolio-public-auth/package.json)
- [Public-auth Wrangler configuration](../../workers/portfolio-public-auth/wrangler.toml)
- [Public-auth base migration](../../workers/portfolio-public-auth/migrations/0000_portfolio_agent_auth.sql)
- [Public-auth rolling-usage migration](../../workers/portfolio-public-auth/migrations/0001_add_rolling_token_usage.sql)
- [Public-auth actual-token-usage migration](../../workers/portfolio-public-auth/migrations/0002_add_actual_token_usage.sql)
- [Public-auth Google profile migration](../../workers/portfolio-public-auth/migrations/0003_add_google_profile_picture.sql)
- [Portfolio agent manifest](../../workers/portfolio-agent/package.json)
- [Portfolio agent Wrangler configuration](../../workers/portfolio-agent/wrangler.toml)
- [D1 migration workflow](../database/migrations.md)
- [Architecture overview](../architecture/overview.md)
- [Public Portfolio MCP](../architecture/portfolio-mcp.md)

Current Cloudflare references:

- [Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/)
- [Pages monorepos](https://developers.cloudflare.com/pages/configuration/monorepos/)
- [Pages Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/)
- [Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)
- [Pages Functions routing](https://developers.cloudflare.com/pages/functions/routing/)
- [Worker deploy command](https://developers.cloudflare.com/workers/wrangler/commands/workers/)
- [GitHub Actions deployment](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Worker configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
- [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [R2 Worker API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [R2 S3 authentication](https://developers.cloudflare.com/r2/get-started/s3/)
- [Worker versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/)
- [Worker rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
- [Real-time Worker logs](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/)
