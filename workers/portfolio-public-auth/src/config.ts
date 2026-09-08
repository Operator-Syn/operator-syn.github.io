import type { D1Database, Fetcher } from "@cloudflare/workers-types";

export const SESSION_COOKIE = "__Host-portfolio_session";
export const OAUTH_STATE_COOKIE = "__Host-portfolio_oauth_state";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;
export const ROLLING_TOKEN_BUDGET = 1_000_000;
export const ROLLING_TOKEN_WINDOW_SECONDS = 60 * 60;
export const THREAD_RETENTION_SECONDS = 30 * 24 * 60 * 60;

export type PublicAuthEnvironment = {
  AUTH_DB: D1Database;
  AGENT_WORKER: Fetcher;
  PUBLIC_AUTH_ORIGIN: string;
  PORTFOLIO_ORIGIN: string;
  BROWSER_ORIGINS: string;
  SESSION_COOKIE_SAME_SITE: string;
  GOOGLE_REDIRECT_URI: string;
  /** Server-held credential accepted only by the admin gateway service binding. */
  ADMIN_INTERNAL_KEY: string;
  [name: string]: unknown;
};

export function getConfigString(environment: PublicAuthEnvironment, ...segments: string[]): string {
  const value = environment[segments.join("_")];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Required runtime configuration is missing.");
  }
  return value;
}

export function getSessionCookieSameSite(
  environment: Pick<PublicAuthEnvironment, "SESSION_COOKIE_SAME_SITE">,
): "Lax" | "None" {
  return environment.SESSION_COOKIE_SAME_SITE === "None" ? "None" : "Lax";
}

export type UserRow = {
  sub: string;
  email: string;
  display_name: string | null;
  picture_url: string | null;
  quota_epoch: number;
  disabled_at: number | null;
};

export type SessionRow = {
  id_hash: string;
  sub: string;
  created_at: number;
  expires_at: number;
  last_seen_at: number;
  revoked_at: number | null;
  turnstile_verified_at: number | null;
};

export type ThreadRow = {
  id: string;
  sub: string;
  created_at: number;
  updated_at: number;
  title: string | null;
};

export type OAuthStateRow = {
  state_hash: string;
  code_verifier: string;
  nonce: string;
  return_to: string;
  expires_at: number;
};

export type AgentControlRow = {
  paused: number;
  pause_reason: string | null;
  estimated_neurons: number;
  utc_day: string;
  updated_at?: number;
};

export type SessionContext = {
  rawSessionId: string;
  session: SessionRow;
  user: UserRow;
};
