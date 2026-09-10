import type { ExportedHandler } from "@cloudflare/workers-types";
import { getAgentByName, routeAgentRequest } from "agents";
import { getConfigString, type PortfolioAgentEnvironment } from "./config.ts";
import {
  AGENT_IDENTITY_HEADER,
  AGENT_REQUEST_ID_HEADER,
  normalizeAgentRequestId,
  parseAgentIdentity,
} from "./identity.ts";
import { isValidThreadId } from "./validation.ts";

const DEFAULT_THREAD_MESSAGE_PAGE_SIZE = 24;
const MAX_THREAD_MESSAGE_PAGE_SIZE = 50;

async function internalAgentWebSocketRequest(
  request: Request,
  environment: PortfolioAgentEnvironment,
): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  let threadId = "";
  try {
    threadId = decodeURIComponent(parts[3] ?? "");
  } catch {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (!isValidThreadId(threadId)) return Response.json({ error: "Not found" }, { status: 404 });
  if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return Response.json({ error: "A WebSocket connection is required." }, { status: 426 });
  }
  const identity = parseAgentIdentity(request.headers.get(AGENT_IDENTITY_HEADER), threadId);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const requestId = normalizeAgentRequestId(request.headers.get(AGENT_REQUEST_ID_HEADER));
  const targetUrl = new URL(request.url);
  targetUrl.pathname = `/agents/portfolio-agent/${encodeURIComponent(threadId)}`;
  targetUrl.search = "";
  const connectionId = url.searchParams.get("_pk");
  if (connectionId && connectionId.length <= 128) targetUrl.searchParams.set("_pk", connectionId);

  const headers = new Headers(request.headers);
  headers.delete("Authorization");
  headers.delete("Cookie");
  headers.delete(AGENT_REQUEST_ID_HEADER);
  const response = await routeAgentRequest(
    new Request(targetUrl, { method: "GET", headers }),
    environment,
    { props: requestId ? { ...identity, requestId } : identity },
  );
  return response ?? Response.json({ error: "Not found" }, { status: 404 });
}

async function internalRequest(
  request: Request,
  environment: PortfolioAgentEnvironment,
): Promise<Response | null> {
  const url = new URL(request.url);
  const isInternalAgentRoute = url.pathname.startsWith("/internal/agents/portfolio-agent/");
  const isInternalThreadRoute = url.pathname.startsWith("/internal/threads/");
  if (!isInternalAgentRoute && !isInternalThreadRoute) return null;
  const expected = `Bearer ${getConfigString(environment, "AGENT", "INTERNAL", "KEY")}`;
  if (request.headers.get("Authorization") !== expected)
    return Response.json({ error: "Forbidden" }, { status: 403 });
  if (isInternalAgentRoute) {
    return internalAgentWebSocketRequest(request, environment);
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const threadId = parts[2] ?? "";
  const action = parts[3] ?? "delete";
  if (
    threadId.length < 16 ||
    (action !== "delete" && action !== "export" && action !== "messages")
  ) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const limitParam = url.searchParams.get("limit");
  const beforeParam = url.searchParams.get("before");
  const paged = limitParam !== null || beforeParam !== null;
  let pageOptions: { before?: string; limit: number } | undefined;
  if (paged) {
    const limit = limitParam === null ? DEFAULT_THREAD_MESSAGE_PAGE_SIZE : Number(limitParam);
    const before = beforeParam?.trim();
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_THREAD_MESSAGE_PAGE_SIZE) {
      return Response.json({ error: "Invalid thread message page size." }, { status: 400 });
    }
    if (beforeParam !== null && (!before || before.length > 256)) {
      return Response.json({ error: "Invalid thread message cursor." }, { status: 400 });
    }
    pageOptions = { limit, ...(before ? { before } : {}) };
  }

  const stub = (await getAgentByName(environment.PortfolioAgent as never, threadId)) as unknown as {
    deleteThread: () => Promise<{ deleted: true }>;
    exportThread: () => Promise<Record<string, unknown>>;
    getThreadMessages: (options?: {
      before?: string;
      limit?: number;
    }) => Promise<unknown[] | { messages: unknown[]; nextCursor: string | null; hasMore: boolean }>;
  };
  if (action === "messages" && request.method === "GET") {
    try {
      const result = await stub.getThreadMessages(pageOptions);
      return Response.json(paged ? result : { messages: result });
    } catch (error) {
      if (error instanceof Error && error.message === "Invalid thread message cursor.") {
        return Response.json({ error: "Invalid thread message cursor." }, { status: 400 });
      }
      throw error;
    }
  }
  if (action === "export" && request.method === "GET") {
    return Response.json(await stub.exportThread());
  }
  if (action === "delete" && request.method === "DELETE") {
    try {
      return Response.json(await stub.deleteThread());
    } catch (error) {
      if (error instanceof Error && error.message === "THREAD_BUSY") {
        return Response.json(
          {
            error: {
              code: "THREAD_BUSY",
              message: "Finish the active assistant response before deleting this thread.",
            },
          },
          { status: 409 },
        );
      }
      throw error;
    }
  }
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}

type WorkerFetchHandler = NonNullable<ExportedHandler<PortfolioAgentEnvironment>["fetch"]>;
type WorkerRequest = Parameters<WorkerFetchHandler>[0];
type WorkerEnvironment = Parameters<WorkerFetchHandler>[1];

const worker = {
  fetch(request: WorkerRequest, environment: WorkerEnvironment) {
    const typedRequest = request as unknown as Request;
    const typedEnvironment = environment as unknown as PortfolioAgentEnvironment;
    return (async () => {
      const internal = await internalRequest(typedRequest, typedEnvironment);
      if (internal) return internal;
      return Response.json({ error: "Not found" }, { status: 404 });
    })() as unknown as ReturnType<WorkerFetchHandler>;
  },
} satisfies ExportedHandler<PortfolioAgentEnvironment>;

export { PortfolioAgent } from "./agent.ts";
export default worker;
