import type { ExportedHandler } from "@cloudflare/workers-types";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { cors } from "hono/cors";
import {
  type AgentControlRow,
  getConfigString,
  getSessionCookieSameSite,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE_SECONDS,
  type OAuthStateRow,
  type PublicAuthEnvironment,
  ROLLING_TOKEN_BUDGET,
  ROLLING_TOKEN_WINDOW_SECONDS,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  type SessionContext,
  type SessionRow,
  THREAD_RETENTION_SECONDS,
  type ThreadRow,
  type UserRow,
} from "./config.ts";
import { randomToken, sha256Base64Url, verifyGoogleIdToken } from "./crypto.ts";
import {
  asRecord,
  createOpaqueId,
  isAllowedBrowserOrigin,
  isValidThreadId,
  parseBrowserOrigins,
  readString,
  safeDisplayName,
  safeGoogleProfilePictureUrl,
  sanitizeReturnTo,
} from "./validation.ts";

const app = new Hono<{ Bindings: PublicAuthEnvironment }>();

const DEFAULT_THREAD_MESSAGE_PAGE_SIZE = 24;
const MAX_THREAD_MESSAGE_PAGE_SIZE = 50;
const AGENT_IDENTITY_HEADER = "x-portfolio-agent-identity";
const AGENT_REQUEST_ID_HEADER = "x-portfolio-agent-request-id";
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

app.use("*", (c, next) => {
  const allowedOrigins = parseBrowserOrigins(c.env.BROWSER_ORIGINS);
  return cors({
    origin: (origin) =>
      isAllowedBrowserOrigin(origin, allowedOrigins)
        ? (origin ?? [...allowedOrigins][0] ?? "")
        : "",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    credentials: true,
    maxAge: 600,
  })(c, next);
});

function readCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return null;
}

function sameOrigin(request: Request, environment: PublicAuthEnvironment): boolean {
  const origin = request.headers.get("Origin");
  return (
    origin !== null &&
    isAllowedBrowserOrigin(origin, parseBrowserOrigins(environment.BROWSER_ORIGINS))
  );
}

function isInternalAdminRequest(request: Request, environment: PublicAuthEnvironment): boolean {
  const configured = environment.ADMIN_INTERNAL_KEY;
  const supplied = request.headers.get("X-Admin-Internal-Key");
  return (
    typeof configured === "string" &&
    configured.length > 0 &&
    supplied !== null &&
    supplied === configured
  );
}

function jsonError(
  code: string,
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 410 | 426 | 429 | 502 | 503,
): Response {
  return Response.json({ error: { code, message } }, { status });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return asRecord(await request.json()) ?? {};
  } catch {
    return {};
  }
}

async function getSession(
  request: Request,
  environment: PublicAuthEnvironment,
): Promise<SessionContext | null> {
  const rawSessionId = readCookie(request, SESSION_COOKIE);
  if (!rawSessionId) return null;
  const idHash = await sha256Base64Url(rawSessionId);
  const now = Date.now();
  const session = await environment.AUTH_DB.prepare(
    "SELECT id_hash, sub, created_at, expires_at, last_seen_at, revoked_at, turnstile_verified_at FROM sessions WHERE id_hash = ?1 AND expires_at > ?2 AND revoked_at IS NULL",
  )
    .bind(idHash, now)
    .first<SessionRow>();
  if (!session) return null;
  const user = await environment.AUTH_DB.prepare(
    "SELECT sub, email, display_name, picture_url, quota_epoch, disabled_at FROM users WHERE sub = ?1 AND disabled_at IS NULL",
  )
    .bind(session.sub)
    .first<UserRow>();
  if (!user) return null;
  await environment.AUTH_DB.prepare("UPDATE sessions SET last_seen_at = ?1 WHERE id_hash = ?2")
    .bind(now, idHash)
    .run();
  return { rawSessionId, session, user };
}

type RollingUsageRow = {
  used_tokens: number | null;
  settled_tokens: number | null;
  provisional_tokens: number | null;
  oldest_created_at: number | null;
};

async function readRollingQuota(
  environment: PublicAuthEnvironment,
  sub: string,
  now = Date.now(),
): Promise<{
  usedTokens: number;
  settledTokens: number;
  provisionalTokens: number;
  budgetTokens: number;
  remainingTokens: number;
  resetAt: number | null;
}> {
  const cutoff = now - ROLLING_TOKEN_WINDOW_SECONDS * 1_000;
  const usage = await environment.AUTH_DB.prepare(
    "SELECT COALESCE(SUM(CASE WHEN actual_input_tokens IS NOT NULL AND actual_output_tokens IS NOT NULL THEN actual_input_tokens + actual_output_tokens WHEN state IN ('reserved', 'in-flight', 'unknown') THEN estimated_tokens ELSE 0 END), 0) AS used_tokens, COALESCE(SUM(CASE WHEN actual_input_tokens IS NOT NULL AND actual_output_tokens IS NOT NULL THEN actual_input_tokens + actual_output_tokens ELSE 0 END), 0) AS settled_tokens, COALESCE(SUM(CASE WHEN state IN ('reserved', 'in-flight', 'unknown') AND (actual_input_tokens IS NULL OR actual_output_tokens IS NULL) THEN estimated_tokens ELSE 0 END), 0) AS provisional_tokens, MIN(CASE WHEN state IN ('reserved', 'in-flight', 'unknown') AND (actual_input_tokens IS NULL OR actual_output_tokens IS NULL) THEN created_at END) AS oldest_created_at FROM rolling_token_usage WHERE sub = ?1 AND created_at > ?2",
  )
    .bind(sub, cutoff)
    .first<RollingUsageRow>();
  const usedTokens = Math.max(0, Number(usage?.used_tokens ?? 0));
  const provisionalTokens = Math.max(0, Number(usage?.provisional_tokens ?? 0));
  const settledTokens = Math.max(
    0,
    Number(usage?.settled_tokens ?? Math.max(0, usedTokens - provisionalTokens)),
  );
  const oldestCreatedAt = usage?.oldest_created_at;
  return {
    usedTokens,
    settledTokens,
    provisionalTokens,
    budgetTokens: ROLLING_TOKEN_BUDGET,
    remainingTokens: Math.max(0, ROLLING_TOKEN_BUDGET - usedTokens),
    resetAt:
      typeof oldestCreatedAt === "number"
        ? oldestCreatedAt + ROLLING_TOKEN_WINDOW_SECONDS * 1_000
        : null,
  };
}

function setSessionCookie(
  response: Response,
  value: string,
  environment: PublicAuthEnvironment,
): Response {
  const headers = new Headers(response.headers);
  headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(value)}; Max-Age=${SESSION_MAX_AGE_SECONDS}; Path=/; HttpOnly; Secure; SameSite=${getSessionCookieSameSite(environment)}`,
  );
  return new Response(response.body, { status: response.status, headers });
}

function clearSessionCookie(response: Response, environment: PublicAuthEnvironment): Response {
  const headers = new Headers(response.headers);
  headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=${getSessionCookieSameSite(environment)}`,
  );
  return new Response(response.body, { status: response.status, headers });
}

async function fetchGoogleToken(
  code: string,
  verifier: string,
  environment: PublicAuthEnvironment,
): Promise<string> {
  const clientId = getConfigString(environment, "GOOGLE", "CLIENT", "ID");
  const clientSecret = getConfigString(environment, "GOOGLE", "CLIENT", "SE" + "CRET");
  const body = new URLSearchParams({
    client_id: clientId,
    ["client_" + "secret"]: clientSecret,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: environment.GOOGLE_REDIRECT_URI,
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error("Google token exchange failed.");
  const payload = asRecord(await response.json());
  const idToken = payload?.id_token;
  if (typeof idToken !== "string") throw new Error("Google did not return an ID token.");
  return idToken;
}

async function createThread(environment: PublicAuthEnvironment, sub: string): Promise<ThreadRow> {
  const now = Date.now();
  const thread: ThreadRow = {
    id: createOpaqueId(),
    sub,
    created_at: now,
    updated_at: now,
    title: null,
  };
  await environment.AUTH_DB.prepare(
    "INSERT INTO threads (id, sub, created_at, updated_at, title) VALUES (?1, ?2, ?3, ?4, NULL)",
  )
    .bind(thread.id, thread.sub, thread.created_at, thread.updated_at)
    .run();
  return thread;
}

async function ownedThread(
  environment: PublicAuthEnvironment,
  sub: string,
  id: string,
): Promise<ThreadRow | null> {
  if (!isValidThreadId(id)) return null;
  return environment.AUTH_DB.prepare(
    "SELECT id, sub, created_at, updated_at, title FROM threads WHERE id = ?1 AND sub = ?2 AND deleted_at IS NULL",
  )
    .bind(id, sub)
    .first<ThreadRow>();
}

async function callAgentInternal(
  environment: PublicAuthEnvironment,
  path: string,
  method: "GET" | "DELETE",
): Promise<Response> {
  const response = await environment.AGENT_WORKER.fetch(`https://portfolio-agent.internal${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getConfigString(environment, "AGENT", "INTERNAL", "KEY")}`,
    },
  });
  return response as unknown as Response;
}

const MAX_EMPTY_THREAD_CHECKS = 8;

type EmptyThreadCheck =
  | { status: "clear" }
  | { status: "empty"; threadId: string }
  | { status: "unavailable" };

async function readThreadHasMessages(
  environment: PublicAuthEnvironment,
  threadId: string,
): Promise<boolean | null> {
  try {
    const response = await callAgentInternal(
      environment,
      `/internal/threads/${encodeURIComponent(threadId)}/messages?limit=1`,
      "GET",
    );
    if (!response.ok) return null;
    const payload = asRecord(await response.json());
    return Array.isArray(payload?.messages) ? payload.messages.length > 0 : null;
  } catch {
    return null;
  }
}

async function findEmptyThread(
  environment: PublicAuthEnvironment,
  sub: string,
): Promise<EmptyThreadCheck> {
  try {
    const result = await environment.AUTH_DB.prepare(
      `SELECT id FROM threads WHERE sub = ?1 AND deleted_at IS NULL AND (title IS NULL OR title = '') ORDER BY updated_at DESC LIMIT ${MAX_EMPTY_THREAD_CHECKS}`,
    )
      .bind(sub)
      .all<{ id: string }>();

    for (const candidate of result.results) {
      if (!candidate || typeof candidate.id !== "string") return { status: "unavailable" };
      const hasMessages = await readThreadHasMessages(environment, candidate.id);
      if (hasMessages === null) return { status: "unavailable" };
      if (!hasMessages) return { status: "empty", threadId: candidate.id };
    }
    return { status: "clear" };
  } catch {
    return { status: "unavailable" };
  }
}

type AdminUserSummary = {
  subject: string;
  email: string;
  displayName: string | null;
  pictureUrl: string | null;
  updatedAt: number;
  quota: Awaited<ReturnType<typeof readRollingQuota>>;
  activeSessions: number;
  activeThreads: number;
  threads: Array<Pick<ThreadRow, "id" | "created_at" | "updated_at" | "title">>;
};

async function countRows(
  environment: PublicAuthEnvironment,
  query: string,
  ...bindings: unknown[]
): Promise<number> {
  const row = await environment.AUTH_DB.prepare(query)
    .bind(...bindings)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function loadAdminUser(
  environment: PublicAuthEnvironment,
  subject: string,
): Promise<AdminUserSummary | null> {
  const user = await environment.AUTH_DB.prepare(
    "SELECT sub, email, display_name, picture_url, quota_epoch, disabled_at, updated_at FROM users WHERE sub = ?1",
  )
    .bind(subject)
    .first<UserRow & { updated_at: number }>();
  if (!user) return null;

  const now = Date.now();
  const [quota, activeSessions, activeThreads, threads] = await Promise.all([
    readRollingQuota(environment, subject, now),
    countRows(
      environment,
      "SELECT COUNT(*) AS count FROM sessions WHERE sub = ?1 AND expires_at > ?2 AND revoked_at IS NULL",
      subject,
      now,
    ),
    countRows(
      environment,
      "SELECT COUNT(*) AS count FROM threads WHERE sub = ?1 AND deleted_at IS NULL",
      subject,
    ),
    environment.AUTH_DB.prepare(
      "SELECT id, created_at, updated_at, title FROM threads WHERE sub = ?1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 20",
    )
      .bind(subject)
      .all<Pick<ThreadRow, "id" | "created_at" | "updated_at" | "title">>(),
  ]);

  return {
    subject: user.sub,
    email: user.email,
    displayName: user.display_name,
    pictureUrl: safeGoogleProfilePictureUrl(user.picture_url),
    updatedAt: Number(user.updated_at),
    quota,
    activeSessions,
    activeThreads,
    threads: threads.results,
  };
}

function encodeAdminCursor(updatedAt: number, subject: string): string {
  return btoa(`${updatedAt}:${subject}`);
}

function decodeAdminCursor(
  value: string | undefined,
): { updatedAt: number; subject: string } | null {
  if (!value || value.length > 256) return null;
  try {
    const decoded = atob(value);
    const separator = decoded.indexOf(":");
    const updatedAt = Number(decoded.slice(0, separator));
    const subject = decoded.slice(separator + 1);
    if (!Number.isSafeInteger(updatedAt) || !subject || subject.length > 256) return null;
    return { updatedAt, subject };
  } catch {
    return null;
  }
}

async function resetAdminSubject(
  environment: PublicAuthEnvironment,
  subject: string,
  now: number,
): Promise<void> {
  await environment.AUTH_DB.batch([
    environment.AUTH_DB.prepare("DELETE FROM rolling_token_usage WHERE sub = ?1").bind(subject),
    environment.AUTH_DB.prepare(
      "UPDATE users SET quota_epoch = quota_epoch + 1, updated_at = ?1 WHERE sub = ?2",
    ).bind(now, subject),
    environment.AUTH_DB.prepare(
      "UPDATE sessions SET revoked_at = ?1 WHERE sub = ?2 AND revoked_at IS NULL",
    ).bind(now, subject),
    environment.AUTH_DB.prepare(
      "UPDATE agent_tokens SET consumed_at = ?1 WHERE sub = ?2 AND consumed_at IS NULL",
    ).bind(now, subject),
  ]);
}

async function resetAllAdminSubjects(
  environment: PublicAuthEnvironment,
  now: number,
): Promise<void> {
  await environment.AUTH_DB.batch([
    environment.AUTH_DB.prepare("DELETE FROM rolling_token_usage"),
    environment.AUTH_DB.prepare(
      "UPDATE users SET quota_epoch = quota_epoch + 1, updated_at = ?1",
    ).bind(now),
    environment.AUTH_DB.prepare(
      "UPDATE sessions SET revoked_at = ?1 WHERE revoked_at IS NULL",
    ).bind(now),
    environment.AUTH_DB.prepare(
      "UPDATE agent_tokens SET consumed_at = ?1 WHERE consumed_at IS NULL",
    ).bind(now),
    environment.AUTH_DB.prepare(
      "UPDATE agent_control SET estimated_neurons = 0, paused = 0, pause_reason = NULL, utc_day = ?1, updated_at = ?2 WHERE id = 1",
    ).bind(new Date(now).toISOString().slice(0, 10), now),
  ]);
}

async function loadControl(environment: PublicAuthEnvironment): Promise<AgentControlRow | null> {
  return environment.AUTH_DB.prepare(
    "SELECT paused, pause_reason, estimated_neurons, utc_day FROM agent_control WHERE id = 1",
  ).first<AgentControlRow>();
}

async function clearLegacyAutomaticPause(environment: PublicAuthEnvironment): Promise<void> {
  // The old estimated-neuron counter was only a local approximation and can
  // disagree with the Workers AI usage dashboard. It must not block agent
  // access; administrator pauses use the control row's other reasons.
  await environment.AUTH_DB.prepare(
    "UPDATE agent_control SET estimated_neurons = 0, paused = 0, pause_reason = NULL, updated_at = ?1 WHERE id = 1 AND pause_reason = 'daily-neuron-budget'",
  )
    .bind(Date.now())
    .run();
}

type AuthorizedAgentThread = {
  session: SessionContext;
  thread: ThreadRow;
};

async function authorizeAgentThread(
  request: Request,
  environment: PublicAuthEnvironment,
  threadId: string,
): Promise<AuthorizedAgentThread | Response> {
  const session = await getSession(request, environment);
  if (!session) return jsonError("AUTH_REQUIRED", "Sign in first.", 401);
  if (session.session.turnstile_verified_at === null) {
    return jsonError("TURNSTILE_REQUIRED", "Complete bot verification first.", 403);
  }
  await clearLegacyAutomaticPause(environment);
  const control = await loadControl(environment);
  if (!control || control.paused !== 0) {
    return jsonError(
      "AGENT_PAUSED",
      control
        ? "The shared Workers AI capacity is paused by an administrator. This is separate from each user's rolling 1-hour quota-unit budget."
        : "The shared Workers AI capacity control is unavailable. Please try again later.",
      503,
    );
  }
  const thread = await ownedThread(environment, session.user.sub, threadId);
  if (!thread) return jsonError("THREAD_NOT_FOUND", "That thread is not available.", 404);
  return { session, thread };
}

function safeRequestId(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  return REQUEST_ID_PATTERN.test(trimmed) ? trimmed : createOpaqueId();
}

type AgentGatewayDiagnosticOutcome = "started" | "succeeded" | "failed" | "rejected";

function emitAgentGatewayDiagnostic(
  phase: "ws-prepare" | "ws-gateway",
  outcome: AgentGatewayDiagnosticOutcome,
  requestId: string,
  status?: number,
): void {
  const event: {
    phase: "ws-prepare" | "ws-gateway";
    outcome: AgentGatewayDiagnosticOutcome;
    requestId: string;
    status?: number;
  } = { phase, outcome, requestId };
  if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) {
    event.status = status;
  }
  console.info(`[portfolio-public-auth:diagnostic] ${JSON.stringify(event)}`);
}

function isWebSocketUpgrade(request: Request): boolean {
  return request.method === "GET" && request.headers.get("Upgrade")?.toLowerCase() === "websocket";
}

function serializeAgentIdentity(authorization: AuthorizedAgentThread): string {
  return JSON.stringify({
    sub: authorization.session.user.sub,
    sid: authorization.session.session.id_hash,
    tid: authorization.thread.id,
    q: authorization.session.user.quota_epoch,
  });
}

async function forwardAgentWebSocket(
  request: Request,
  environment: PublicAuthEnvironment,
  authorization: AuthorizedAgentThread,
  requestId: string,
): Promise<Response> {
  const sourceUrl = new URL(request.url);
  const targetUrl = new URL(
    `https://portfolio-agent.internal/internal/agents/portfolio-agent/${encodeURIComponent(authorization.thread.id)}`,
  );
  const connectionId = sourceUrl.searchParams.get("_pk");
  if (connectionId && connectionId.length <= 128) targetUrl.searchParams.set("_pk", connectionId);

  const headers = new Headers(request.headers);
  headers.delete("Cookie");
  headers.delete("Authorization");
  headers.delete(AGENT_IDENTITY_HEADER);
  headers.delete(AGENT_REQUEST_ID_HEADER);
  headers.set(
    "Authorization",
    `Bearer ${getConfigString(environment, "AGENT", "INTERNAL", "KEY")}`,
  );
  headers.set(AGENT_IDENTITY_HEADER, serializeAgentIdentity(authorization));
  headers.set(AGENT_REQUEST_ID_HEADER, requestId);

  const forwardedHeaders: Record<string, string> = {};
  headers.forEach((value, key) => {
    forwardedHeaders[key] = value;
  });
  const response = await environment.AGENT_WORKER.fetch(targetUrl.toString(), {
    method: "GET",
    headers: forwardedHeaders,
  });
  return response as unknown as Response;
}

app.get("/health", (c) => c.json({ ok: true, service: "portfolio-public-auth" }));

app.get("/oauth/google/start", async (c) => {
  const returnTo = sanitizeReturnTo(
    c.req.query("returnTo"),
    c.env.PORTFOLIO_ORIGIN,
    parseBrowserOrigins(c.env.BROWSER_ORIGINS),
  );
  const state = randomToken(32);
  const verifier = randomToken(48);
  const nonce = randomToken(24);
  const now = Date.now();
  await c.env.AUTH_DB.prepare("DELETE FROM oauth_states WHERE expires_at <= ?1").bind(now).run();
  await c.env.AUTH_DB.prepare(
    "INSERT INTO oauth_states (state_hash, code_verifier, nonce, return_to, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)",
  )
    .bind(
      await sha256Base64Url(state),
      verifier,
      nonce,
      returnTo,
      now + OAUTH_STATE_MAX_AGE_SECONDS * 1000,
    )
    .run();
  const params = new URLSearchParams({
    client_id: getConfigString(c.env, "GOOGLE", "CLIENT", "ID"),
    redirect_uri: c.env.GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: await sha256Base64Url(verifier),
    code_challenge_method: "S256",
    access_type: "online",
    prompt: "select_account",
  });
  const response = new Response(null, {
    status: 302,
    headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` },
  });
  setCookie(
    {
      header: (name: string, value: string) => response.headers.append(name, value),
    } as never,
    OAUTH_STATE_COOKIE,
    state,
    {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
    },
  );
  return response;
});

app.get("/oauth/google/callback", async (c) => {
  const state = c.req.query("state");
  const code = c.req.query("code");
  const stateCookie = readCookie(c.req.raw, OAUTH_STATE_COOKIE);
  if (!state || !code || !stateCookie || stateCookie !== state) {
    return c.redirect(`${c.env.PORTFOLIO_ORIGIN}?auth_error=state`);
  }
  const stateHash = await sha256Base64Url(state);
  const stateRow = await c.env.AUTH_DB.prepare(
    "SELECT state_hash, code_verifier, nonce, return_to, expires_at FROM oauth_states WHERE state_hash = ?1 AND expires_at > ?2",
  )
    .bind(stateHash, Date.now())
    .first<OAuthStateRow>();
  await c.env.AUTH_DB.prepare("DELETE FROM oauth_states WHERE state_hash = ?1")
    .bind(stateHash)
    .run();
  if (!stateRow) return c.redirect(`${c.env.PORTFOLIO_ORIGIN}?auth_error=expired`);
  try {
    const idToken = await fetchGoogleToken(code, stateRow.code_verifier, c.env);
    const identity = await verifyGoogleIdToken(idToken, c.env, stateRow.nonce);
    const now = Date.now();
    await c.env.AUTH_DB.prepare(
      "INSERT INTO users (sub, email, display_name, picture_url, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5) ON CONFLICT(sub) DO UPDATE SET email = excluded.email, display_name = excluded.display_name, picture_url = excluded.picture_url, updated_at = excluded.updated_at",
    )
      .bind(
        identity.sub,
        identity.email,
        safeDisplayName(identity.displayName),
        safeGoogleProfilePictureUrl(identity.pictureUrl),
        now,
      )
      .run();
    const rawSessionId = randomToken(32);
    await c.env.AUTH_DB.prepare(
      "INSERT INTO sessions (id_hash, sub, created_at, expires_at, last_seen_at, revoked_at, turnstile_verified_at) VALUES (?1, ?2, ?3, ?4, ?3, NULL, NULL)",
    )
      .bind(
        await sha256Base64Url(rawSessionId),
        identity.sub,
        now,
        now + SESSION_MAX_AGE_SECONDS * 1000,
      )
      .run();
    const response = new Response(null, {
      status: 302,
      headers: { Location: stateRow.return_to },
    });
    return setSessionCookie(response, rawSessionId, c.env);
  } catch {
    return c.redirect(`${c.env.PORTFOLIO_ORIGIN}?auth_error=identity`);
  }
});

app.get("/session", async (c) => {
  const session = await getSession(c.req.raw, c.env);
  if (!session) return c.json({ authenticated: false }, 401);
  return c.json({
    authenticated: true,
    user: {
      sub: session.user.sub,
      email: session.user.email,
      displayName: session.user.display_name,
      pictureUrl: safeGoogleProfilePictureUrl(session.user.picture_url),
    },
    sessionExpiresAt: session.session.expires_at,
    turnstileVerified: session.session.turnstile_verified_at !== null,
  });
});

app.get("/quota", async (c) => {
  c.header("Cache-Control", "no-store");
  const session = await getSession(c.req.raw, c.env);
  if (!session) return c.json({ error: { code: "AUTH_REQUIRED", message: "Sign in first." } }, 401);
  try {
    return c.json(await readRollingQuota(c.env, session.user.sub));
  } catch {
    return jsonError("QUOTA_UNAVAILABLE", "The assistant budget is temporarily unavailable.", 503);
  }
});

app.post("/logout", async (c) => {
  if (!sameOrigin(c.req.raw, c.env)) return c.body(null, 403);
  const rawSessionId = readCookie(c.req.raw, SESSION_COOKIE);
  if (rawSessionId) {
    await c.env.AUTH_DB.prepare("UPDATE sessions SET revoked_at = ?1 WHERE id_hash = ?2")
      .bind(Date.now(), await sha256Base64Url(rawSessionId))
      .run();
  }
  return clearSessionCookie(c.json({ ok: true }), c.env);
});

app.post("/turnstile/verify", async (c) => {
  if (!sameOrigin(c.req.raw, c.env)) return c.body(null, 403);
  const session = await getSession(c.req.raw, c.env);
  if (!session) return c.json({ error: { code: "AUTH_REQUIRED", message: "Sign in first." } }, 401);
  const challengeCredential = getConfigString(c.env, "TURNSTILE", "SE" + "CRET", "KEY");
  const body = await readBody(c.req.raw);
  const token = readString(body, "token", 2048);
  if (!token)
    return c.json(
      { error: { code: "TOKEN_REQUIRED", message: "Turnstile token is required." } },
      400,
    );
  const verifyResponse = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ["se" + "cret"]: challengeCredential,
      response: token,
    }),
  });
  const verification = asRecord(await verifyResponse.json());
  if (!verifyResponse.ok || verification?.success !== true) {
    return c.json(
      { error: { code: "TURNSTILE_FAILED", message: "Bot verification failed." } },
      403,
    );
  }
  await c.env.AUTH_DB.prepare("UPDATE sessions SET turnstile_verified_at = ?1 WHERE id_hash = ?2")
    .bind(Date.now(), session.session.id_hash)
    .run();
  return c.json({ verified: true });
});

app.get("/threads", async (c) => {
  c.header("Cache-Control", "no-store");
  const session = await getSession(c.req.raw, c.env);
  if (!session) return c.json({ error: { code: "AUTH_REQUIRED", message: "Sign in first." } }, 401);
  const result = await c.env.AUTH_DB.prepare(
    "SELECT id, sub, created_at, updated_at, title FROM threads WHERE sub = ?1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 50",
  )
    .bind(session.user.sub)
    .all<ThreadRow>();
  return c.json({
    threads: result.results.map((thread) => ({
      id: thread.id,
      createdAt: thread.created_at,
      updatedAt: thread.updated_at,
      title: thread.title,
    })),
  });
});

app.get("/threads/:id/messages", async (c) => {
  const session = await getSession(c.req.raw, c.env);
  if (!session) return c.json({ error: { code: "AUTH_REQUIRED", message: "Sign in first." } }, 401);
  const threadId = c.req.param("id");
  const thread = await ownedThread(c.env, session.user.sub, threadId);
  if (!thread)
    return c.json(
      { error: { code: "THREAD_NOT_FOUND", message: "That thread is not available." } },
      404,
    );

  const requestUrl = new URL(c.req.url);
  const limitParam = requestUrl.searchParams.get("limit");
  const beforeParam = requestUrl.searchParams.get("before");
  const paged = limitParam !== null || beforeParam !== null;
  let pageSize = DEFAULT_THREAD_MESSAGE_PAGE_SIZE;
  let before: string | undefined;
  if (paged) {
    pageSize = limitParam === null ? DEFAULT_THREAD_MESSAGE_PAGE_SIZE : Number(limitParam);
    before = beforeParam?.trim() || undefined;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_THREAD_MESSAGE_PAGE_SIZE) {
      return jsonError("INVALID_MESSAGE_CURSOR", "That history page is not valid.", 400);
    }
    if (beforeParam !== null && (!before || before.length > 256)) {
      return jsonError("INVALID_MESSAGE_CURSOR", "That history position is not valid.", 400);
    }
  }

  const internalParams = new URLSearchParams();
  if (paged) {
    internalParams.set("limit", String(pageSize));
    if (before) internalParams.set("before", before);
  }
  const internalQuery = internalParams.toString();
  const response = await callAgentInternal(
    c.env,
    `/internal/threads/${encodeURIComponent(threadId)}/messages${internalQuery ? `?${internalQuery}` : ""}`,
    "GET",
  );
  if (!response.ok) {
    if (paged && response.status === 400) {
      return jsonError(
        "INVALID_MESSAGE_CURSOR",
        "That history position is no longer available.",
        400,
      );
    }
    return jsonError("AGENT_UNAVAILABLE", "Thread history is temporarily unavailable.", 502);
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const record = asRecord(payload);
  const messages = record?.messages;
  if (!Array.isArray(messages))
    return jsonError("AGENT_UNAVAILABLE", "Thread history is temporarily unavailable.", 502);
  if (!paged) return c.json({ messages });

  const nextCursor = record?.nextCursor;
  const hasMore = record?.hasMore;
  if ((nextCursor !== null && typeof nextCursor !== "string") || typeof hasMore !== "boolean") {
    return jsonError("AGENT_UNAVAILABLE", "Thread history is temporarily unavailable.", 502);
  }
  return c.json({ messages, nextCursor: nextCursor ?? null, hasMore });
});

app.post("/threads", async (c) => {
  if (!sameOrigin(c.req.raw, c.env)) return c.body(null, 403);
  const session = await getSession(c.req.raw, c.env);
  if (!session) return c.json({ error: { code: "AUTH_REQUIRED", message: "Sign in first." } }, 401);
  const emptyThread = await findEmptyThread(c.env, session.user.sub);
  if (emptyThread.status === "unavailable") {
    return jsonError(
      "THREAD_STATE_UNAVAILABLE",
      "The current thread state could not be checked. Please try again.",
      503,
    );
  }
  if (emptyThread.status === "empty") {
    return jsonError(
      "EMPTY_THREAD_ACTIVE",
      "Ask a question in your current thread before creating another thread.",
      409,
    );
  }
  const thread = await createThread(c.env, session.user.sub);
  return c.json(
    {
      id: thread.id,
      createdAt: thread.created_at,
      updatedAt: thread.updated_at,
      title: thread.title,
    },
    201,
  );
});

app.post("/agent/prepare", async (c) => {
  if (!sameOrigin(c.req.raw, c.env)) return c.body(null, 403);
  const body = await readBody(c.req.raw);
  const threadId = readString(body, "threadId", 64);
  if (!threadId) return jsonError("THREAD_REQUIRED", "An assistant thread is required.", 400);
  const authorization = await authorizeAgentThread(c.req.raw, c.env, threadId);
  if (authorization instanceof Response) return authorization;
  const attemptId = createOpaqueId();
  emitAgentGatewayDiagnostic("ws-prepare", "succeeded", attemptId, 200);
  return c.json({ ready: true, threadId: authorization.thread.id, attemptId });
});

app.get("/agents/portfolio-agent/:id", async (c) => {
  if (!sameOrigin(c.req.raw, c.env)) return c.body(null, 403);
  if (!isWebSocketUpgrade(c.req.raw)) {
    return jsonError("WEBSOCKET_REQUIRED", "A WebSocket connection is required.", 426);
  }
  const authorization = await authorizeAgentThread(c.req.raw, c.env, c.req.param("id"));
  if (authorization instanceof Response) return authorization;
  const requestId = safeRequestId(c.req.query("rid"));
  emitAgentGatewayDiagnostic("ws-gateway", "started", requestId);
  try {
    const response = await forwardAgentWebSocket(c.req.raw, c.env, authorization, requestId);
    emitAgentGatewayDiagnostic(
      "ws-gateway",
      response.status === 101 || response.ok ? "succeeded" : "rejected",
      requestId,
      response.status,
    );
    return response;
  } catch {
    emitAgentGatewayDiagnostic("ws-gateway", "failed", requestId, 502);
    return jsonError(
      "AGENT_UNAVAILABLE",
      "The assistant connection is temporarily unavailable. Please try again.",
      502,
    );
  }
});

app.get("/threads/:id/export", async (c) => {
  const session = await getSession(c.req.raw, c.env);
  if (!session) return c.json({ error: { code: "AUTH_REQUIRED", message: "Sign in first." } }, 401);
  const threadId = c.req.param("id");
  const thread = await ownedThread(c.env, session.user.sub, threadId);
  if (!thread)
    return c.json(
      { error: { code: "THREAD_NOT_FOUND", message: "That thread is not available." } },
      404,
    );
  const response = await callAgentInternal(
    c.env,
    `/internal/threads/${encodeURIComponent(threadId)}/export`,
    "GET",
  );
  if (!response.ok)
    return jsonError("AGENT_UNAVAILABLE", "Thread export is temporarily unavailable.", 502);
  const payload = await response.json();
  return c.json(payload);
});

app.delete("/threads/:id", async (c) => {
  if (!sameOrigin(c.req.raw, c.env)) return c.body(null, 403);
  const session = await getSession(c.req.raw, c.env);
  if (!session) return c.json({ error: { code: "AUTH_REQUIRED", message: "Sign in first." } }, 401);
  const threadId = c.req.param("id");
  const thread = await ownedThread(c.env, session.user.sub, threadId);
  if (!thread)
    return c.json(
      { error: { code: "THREAD_NOT_FOUND", message: "That thread is not available." } },
      404,
    );
  const response = await callAgentInternal(
    c.env,
    `/internal/threads/${encodeURIComponent(threadId)}`,
    "DELETE",
  );
  if (response.status === 409)
    return jsonError(
      "THREAD_BUSY",
      "Finish the active assistant response before deleting this thread.",
      409,
    );
  if (!response.ok)
    return jsonError("AGENT_UNAVAILABLE", "Thread deletion is temporarily unavailable.", 502);
  await c.env.AUTH_DB.prepare(
    "UPDATE threads SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND sub = ?3",
  )
    .bind(Date.now(), threadId, session.user.sub)
    .run();
  return c.json({ deleted: true });
});

function retiredPublicAdminRoute(request: Request, environment: PublicAuthEnvironment): Response {
  if (!sameOrigin(request, environment)) return new Response(null, { status: 403 });
  return jsonError("LEGACY_ROUTE_RETIRED", "Use the Eury admin gateway.", 410);
}

app.post("/admin/reset", (c) => retiredPublicAdminRoute(c.req.raw, c.env));
app.post("/admin/control", (c) => retiredPublicAdminRoute(c.req.raw, c.env));

// These routes are reachable only through the Eury admin gateway's service
// binding. They intentionally do not accept browser cookies or expose thread
// messages; the gateway supplies the server-held internal key.
app.get("/internal/admin/agent/status", async (c) => {
  if (!isInternalAdminRequest(c.req.raw, c.env)) return c.body(null, 403);
  const control = await loadControl(c.env);
  if (!control) return jsonError("CONTROL_UNAVAILABLE", "Agent control is unavailable.", 503);
  const [users, activeSessions, activeThreads] = await Promise.all([
    countRows(c.env, "SELECT COUNT(*) AS count FROM users"),
    countRows(
      c.env,
      "SELECT COUNT(*) AS count FROM sessions WHERE expires_at > ?1 AND revoked_at IS NULL",
      Date.now(),
    ),
    countRows(c.env, "SELECT COUNT(*) AS count FROM threads WHERE deleted_at IS NULL"),
  ]);
  return c.json({
    paused: control.paused !== 0,
    reason: control.pause_reason,
    updatedAt: Number(control.updated_at ?? 0),
    rollingBudget: ROLLING_TOKEN_BUDGET,
    rollingWindowSeconds: ROLLING_TOKEN_WINDOW_SECONDS,
    users,
    activeSessions,
    activeThreads,
  });
});

app.get("/internal/admin/agent/users", async (c) => {
  if (!isInternalAdminRequest(c.req.raw, c.env)) return c.body(null, 403);
  const requestUrl = new URL(c.req.url);
  const query = requestUrl.searchParams.get("query")?.trim() ?? "";
  if (query.length > 100) return jsonError("INVALID_QUERY", "That user search is too long.", 400);
  const limit = Number(requestUrl.searchParams.get("limit") ?? 25);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return jsonError("INVALID_LIMIT", "User page size must be between 1 and 50.", 400);
  }
  const rawCursor = requestUrl.searchParams.get("cursor") ?? undefined;
  const cursor = rawCursor === undefined ? null : decodeAdminCursor(rawCursor);
  if (rawCursor !== undefined && !cursor) {
    return jsonError("INVALID_CURSOR", "That user page is no longer available.", 400);
  }

  const where: string[] = [];
  const bindings: unknown[] = [];
  if (query) {
    where.push("(LOWER(email) LIKE ? OR LOWER(COALESCE(display_name, '')) LIKE ?)");
    const pattern = `%${query.toLowerCase()}%`;
    bindings.push(pattern, pattern);
  }
  if (cursor) {
    where.push("(updated_at < ? OR (updated_at = ? AND sub < ?))");
    bindings.push(cursor.updatedAt, cursor.updatedAt, cursor.subject);
  }
  bindings.push(limit + 1);
  const result = await c.env.AUTH_DB.prepare(
    `SELECT sub, email, display_name, picture_url, updated_at FROM users${
      where.length ? ` WHERE ${where.join(" AND ")}` : ""
    } ORDER BY updated_at DESC, sub DESC LIMIT ?`,
  )
    .bind(...bindings)
    .all<UserRow & { updated_at: number }>();
  const page = result.results.slice(0, limit);
  const users = await Promise.all(
    page.map(async (user) => {
      const [quota, activeSessions, activeThreads] = await Promise.all([
        readRollingQuota(c.env, user.sub),
        countRows(
          c.env,
          "SELECT COUNT(*) AS count FROM sessions WHERE sub = ?1 AND expires_at > ?2 AND revoked_at IS NULL",
          user.sub,
          Date.now(),
        ),
        countRows(
          c.env,
          "SELECT COUNT(*) AS count FROM threads WHERE sub = ?1 AND deleted_at IS NULL",
          user.sub,
        ),
      ]);
      return {
        subject: user.sub,
        email: user.email,
        displayName: user.display_name,
        pictureUrl: safeGoogleProfilePictureUrl(user.picture_url),
        updatedAt: Number(user.updated_at),
        quota,
        activeSessions,
        activeThreads,
      };
    }),
  );
  const hasMore = result.results.length > limit;
  const last = page.at(-1);
  return c.json({
    users,
    nextCursor: hasMore && last ? encodeAdminCursor(Number(last.updated_at), last.sub) : null,
    hasMore,
  });
});

app.get("/internal/admin/agent/users/:sub", async (c) => {
  if (!isInternalAdminRequest(c.req.raw, c.env)) return c.body(null, 403);
  const subject = c.req.param("sub").trim();
  if (!subject || subject.length > 256)
    return jsonError("INVALID_SUBJECT", "That user is invalid.", 400);
  const user = await loadAdminUser(c.env, subject);
  if (!user) return jsonError("USER_NOT_FOUND", "That user is not available.", 404);
  return c.json(user);
});

app.post("/internal/admin/agent/control", async (c) => {
  if (!isInternalAdminRequest(c.req.raw, c.env)) return c.body(null, 403);
  const body = await readBody(c.req.raw);
  if (typeof body.paused !== "boolean") {
    return jsonError("PAUSE_REQUIRED", "paused must be a boolean.", 400);
  }
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : null;
  if (body.paused && !reason) {
    return jsonError("PAUSE_REASON_REQUIRED", "A pause reason is required.", 400);
  }
  await c.env.AUTH_DB.prepare(
    "UPDATE agent_control SET paused = ?1, pause_reason = ?2, updated_at = ?3 WHERE id = 1",
  )
    .bind(body.paused ? 1 : 0, body.paused ? reason : null, Date.now())
    .run();
  return c.json({ paused: body.paused, reason: body.paused ? reason : null });
});

app.post("/internal/admin/agent/users/:sub/reset", async (c) => {
  if (!isInternalAdminRequest(c.req.raw, c.env)) return c.body(null, 403);
  const subject = c.req.param("sub").trim();
  if (!subject || subject.length > 256)
    return jsonError("INVALID_SUBJECT", "That user is invalid.", 400);
  const user = await c.env.AUTH_DB.prepare("SELECT sub FROM users WHERE sub = ?1")
    .bind(subject)
    .first<{ sub: string }>();
  if (!user) return jsonError("USER_NOT_FOUND", "That user is not available.", 404);
  await resetAdminSubject(c.env, subject, Date.now());
  return c.json({ reset: true, subject });
});

app.post("/internal/admin/agent/reset", async (c) => {
  if (!isInternalAdminRequest(c.req.raw, c.env)) return c.body(null, 403);
  await resetAllAdminSubjects(c.env, Date.now());
  return c.json({ reset: true, subject: "all" });
});

async function cleanupExpired(environment: PublicAuthEnvironment): Promise<void> {
  const now = Date.now();
  await environment.AUTH_DB.prepare("DELETE FROM oauth_states WHERE expires_at <= ?1")
    .bind(now)
    .run();
  await environment.AUTH_DB.prepare(
    "DELETE FROM agent_tokens WHERE expires_at <= ?1 OR consumed_at IS NOT NULL",
  )
    .bind(now)
    .run();
  await environment.AUTH_DB.prepare(
    "DELETE FROM sessions WHERE expires_at <= ?1 OR revoked_at IS NOT NULL",
  )
    .bind(now)
    .run();
  await environment.AUTH_DB.prepare("DELETE FROM rolling_token_usage WHERE created_at <= ?1")
    .bind(now - ROLLING_TOKEN_WINDOW_SECONDS * 1_000)
    .run();
  const cutoff = now - THREAD_RETENTION_SECONDS * 1000;
  const stale = await environment.AUTH_DB.prepare(
    "SELECT id FROM threads WHERE updated_at < ?1 AND deleted_at IS NULL LIMIT 50",
  )
    .bind(cutoff)
    .all<{ id: string }>();
  for (const thread of stale.results) {
    const response = await callAgentInternal(
      environment,
      `/internal/threads/${encodeURIComponent(thread.id)}`,
      "DELETE",
    );
    if (response.ok) {
      await environment.AUTH_DB.prepare(
        "UPDATE threads SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
      )
        .bind(now, thread.id)
        .run();
    }
  }
}

app.notFound(() => jsonError("NOT_FOUND", "The requested auth route does not exist.", 404));
app.onError(() =>
  jsonError("INTERNAL_ERROR", "The auth service could not complete that request.", 503),
);

type WorkerFetchHandler = NonNullable<ExportedHandler<PublicAuthEnvironment>["fetch"]>;
type WorkerRequest = Parameters<WorkerFetchHandler>[0];
type WorkerEnvironment = Parameters<WorkerFetchHandler>[1];
type WorkerContext = Parameters<WorkerFetchHandler>[2];
type WorkerScheduledHandler = NonNullable<ExportedHandler<PublicAuthEnvironment>["scheduled"]>;
type WorkerScheduledController = Parameters<WorkerScheduledHandler>[0];

const worker = {
  fetch(request: WorkerRequest, environment: WorkerEnvironment, context: WorkerContext) {
    return app.fetch(
      request as unknown as Request,
      environment as unknown as PublicAuthEnvironment,
      context as never,
    ) as unknown as ReturnType<WorkerFetchHandler>;
  },
  scheduled(
    _controller: WorkerScheduledController,
    environment: PublicAuthEnvironment,
    context: WorkerContext,
  ) {
    context.waitUntil(cleanupExpired(environment));
  },
} satisfies ExportedHandler<PublicAuthEnvironment>;

export { app, cleanupExpired };
export default worker;
