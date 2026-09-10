import type { UIMessage } from "ai";
import { portfolioAssistantConfig } from "./portfolioAssistantConfig.ts";

export type PublicSession = {
  authenticated: boolean;
  user?: {
    sub: string;
    email: string;
    displayName: string | null;
    pictureUrl: string | null;
  };
  sessionExpiresAt?: number;
  turnstileVerified?: boolean;
};

export type AssistantThread = {
  id: string;
  createdAt: number;
  updatedAt: number;
  title: string | null;
};

export type AssistantMessagePage = {
  messages: UIMessage[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type AssistantMessagePageOptions = {
  before?: string;
  limit?: number;
};

export type AssistantConnectionPreparation = {
  ready: true;
  threadId: string;
  attemptId: string;
};

export type PortfolioAssistantQuota = {
  usedTokens: number;
  settledTokens: number;
  provisionalTokens: number;
  budgetTokens: number;
  remainingTokens: number;
  resetAt: number | null;
};

export class PortfolioAssistantRequestError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly retryAfterSeconds: number | null;

  constructor({
    code,
    message,
    retryAfterSeconds,
    status,
  }: {
    code: string | null;
    message: string;
    retryAfterSeconds: number | null;
    status: number;
  }) {
    super(message);
    this.name = "PortfolioAssistantRequestError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    this.status = status;
  }
}

export function getPublicAuthOrigin(): string {
  const origin = portfolioAssistantConfig.publicAuthOrigin;
  if (!origin) {
    throw new Error(
      "The local portfolio assistant is not configured. Set VITE_PUBLIC_AUTH_URL in the repository root .env.",
    );
  }
  return origin;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getPublicAuthOrigin()}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    const retryAfter = Number.parseInt(response.headers.get("Retry-After") ?? "", 10);
    throw new PortfolioAssistantRequestError({
      code: payload?.error?.code ?? null,
      message: payload?.error?.message ?? "The assistant service could not complete that request.",
      retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : null,
      status: response.status,
    });
  }
  return (await response.json()) as T;
}

export async function getSession(): Promise<PublicSession> {
  try {
    return await requestJson<PublicSession>("/session");
  } catch (error) {
    // `/session` uses 401 with `{ authenticated: false }` for a missing or
    // expired browser cookie. Treat that expected state as signed out so the
    // assistant can show its Google sign-in prompt; preserve coded 401s for
    // genuine service/auth failures.
    if (error instanceof PortfolioAssistantRequestError && error.status === 401 && !error.code) {
      return { authenticated: false };
    }
    throw error;
  }
}

export async function getAssistantQuota(): Promise<PortfolioAssistantQuota> {
  const result = await requestJson<Partial<PortfolioAssistantQuota>>("/quota", {
    cache: "no-store",
  });
  const { budgetTokens, remainingTokens, resetAt, usedTokens } = result;
  const provisionalTokens = result.provisionalTokens ?? 0;
  const settledTokens = result.settledTokens ?? Math.max(0, (usedTokens ?? 0) - provisionalTokens);
  if (
    typeof usedTokens !== "number" ||
    !Number.isFinite(usedTokens) ||
    typeof budgetTokens !== "number" ||
    !Number.isFinite(budgetTokens) ||
    typeof remainingTokens !== "number" ||
    !Number.isFinite(remainingTokens) ||
    usedTokens < 0 ||
    budgetTokens <= 0 ||
    remainingTokens < 0 ||
    typeof settledTokens !== "number" ||
    !Number.isFinite(settledTokens) ||
    settledTokens < 0 ||
    typeof provisionalTokens !== "number" ||
    !Number.isFinite(provisionalTokens) ||
    provisionalTokens < 0 ||
    (resetAt !== null && (typeof resetAt !== "number" || !Number.isFinite(resetAt) || resetAt < 0))
  ) {
    throw new Error("The assistant budget could not be loaded.");
  }
  return {
    usedTokens,
    settledTokens,
    provisionalTokens,
    budgetTokens,
    remainingTokens,
    resetAt,
  };
}

export function verifyTurnstile(token: string): Promise<{ verified: boolean }> {
  return requestJson<{ verified: boolean }>("/turnstile/verify", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export function listThreads(): Promise<{ threads: AssistantThread[] }> {
  return requestJson<{ threads: AssistantThread[] }>("/threads", {
    cache: "no-store",
  });
}

export async function getThreadMessages(threadId: string): Promise<UIMessage[]> {
  const result = await requestJson<{ messages: UIMessage[] }>(
    `/threads/${encodeURIComponent(threadId)}/messages`,
  );
  if (!Array.isArray(result.messages)) {
    throw new Error("Thread history could not be loaded.");
  }
  return result.messages;
}

export async function getThreadMessagesPage(
  threadId: string,
  options: AssistantMessagePageOptions = {},
): Promise<AssistantMessagePage> {
  const params = new URLSearchParams();
  if (typeof options.limit === "number" && Number.isFinite(options.limit)) {
    params.set("limit", String(Math.trunc(options.limit)));
  }
  if (options.before) params.set("before", options.before);
  const query = params.toString();
  const result = await requestJson<Partial<AssistantMessagePage>>(
    `/threads/${encodeURIComponent(threadId)}/messages${query ? `?${query}` : ""}`,
  );
  if (!Array.isArray(result.messages)) {
    throw new Error("Thread history could not be loaded.");
  }

  // Keep rollout compatibility with an older public-auth Worker that still
  // returns the legacy full-transcript shape while the paged route propagates.
  const nextCursor = result.nextCursor === undefined ? null : result.nextCursor;
  const hasMore = result.hasMore === undefined ? false : result.hasMore;
  if ((nextCursor !== null && typeof nextCursor !== "string") || typeof hasMore !== "boolean") {
    throw new Error("Thread history could not be loaded.");
  }
  return { messages: result.messages, nextCursor, hasMore };
}

export function createThread(): Promise<AssistantThread> {
  return requestJson<AssistantThread>("/threads", {
    method: "POST",
    body: "{}",
  });
}

export function deleteThread(threadId: string): Promise<{ deleted: boolean }> {
  return requestJson<{ deleted: boolean }>(`/threads/${encodeURIComponent(threadId)}`, {
    method: "DELETE",
    body: "{}",
  });
}

export function exportThread(threadId: string): Promise<Record<string, unknown>> {
  return requestJson<Record<string, unknown>>(`/threads/${encodeURIComponent(threadId)}/export`);
}

export async function prepareAgentConnection(
  threadId: string,
): Promise<AssistantConnectionPreparation> {
  const result = await requestJson<Partial<AssistantConnectionPreparation>>("/agent/prepare", {
    method: "POST",
    body: JSON.stringify({ threadId }),
  });
  if (
    result.ready !== true ||
    result.threadId !== threadId ||
    typeof result.attemptId !== "string" ||
    !/^[A-Za-z0-9_-]{16,64}$/.test(result.attemptId)
  ) {
    throw new Error("The assistant connection could not be prepared.");
  }
  return {
    ready: true,
    threadId: result.threadId,
    attemptId: result.attemptId,
  };
}

export function signInUrl(returnTo: string): string {
  return `${getPublicAuthOrigin()}/oauth/google/start?returnTo=${encodeURIComponent(returnTo)}`;
}

export async function signOut(): Promise<void> {
  await requestJson("/logout", { method: "POST", body: "{}" });
}
