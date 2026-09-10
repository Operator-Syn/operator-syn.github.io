import type { Ai, D1Database, DurableObjectNamespace } from "@cloudflare/workers-types";

export const AGENT_CLASS_NAME = "PortfolioAgent";
export const MODEL_ID = "@cf/zai-org/glm-4.7-flash" as const;
export const MCP_SERVER_NAME = "portfolio";
export const MCP_DISCOVERY_TIMEOUT_MS = 60_000;
export const MCP_CONNECTION_MAX_ATTEMPTS = 3;
export const MCP_CONNECTION_RETRY_BASE_DELAY_MS = 250;
export const MCP_CONNECTION_RETRY_MAX_DELAY_MS = 2_000;
export const ROLLING_TOKEN_BUDGET = 1_000_000;
export const ROLLING_TOKEN_WINDOW_MS = 60 * 60 * 1_000;
export const MODEL_CAPACITY_MESSAGE =
  "The model is temporarily at capacity. Please try again later.";
export const MODEL_ALLOCATION_MESSAGE =
  "The provider's daily Workers AI allocation has been used up. Try again after 00:00 UTC.";

export type AgentProps = {
  sub: string;
  sid: string;
  tid: string;
  q: number;
  requestId?: string;
};

export type PortfolioAgentEnvironment = {
  AI: Ai;
  AUTH_DB: D1Database;
  PortfolioAgent: DurableObjectNamespace;
  PORTFOLIO_MCP_URL: string;
  BROWSER_ORIGINS: string;
  [name: string]: unknown;
};

export type AgentIdentityRow = {
  sub: string;
  sid: string;
  tid: string;
  q: number;
};

export function getConfigString(
  environment: PortfolioAgentEnvironment,
  ...segments: string[]
): string {
  const value = environment[segments.join("_")];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Required runtime configuration is missing.");
  }
  return value;
}
