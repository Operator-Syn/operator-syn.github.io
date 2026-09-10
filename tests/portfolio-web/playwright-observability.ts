import assert from "node:assert/strict";
import type { CDPSession, Page } from "playwright/test";

const JWT_PATTERN = /(?:^|[^A-Za-z0-9_-])eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
const SENSITIVE_QUERY_PARAMETER = /^(?:token|access_token|id_token|authorization|jwt)$/i;
const PREMATURE_WEBSOCKET_CLOSE = /WebSocket is closed before the connection is established/i;
const CLOUDFLARE_INSIGHTS_BLOCKED =
  /static\.cloudflareinsights\.com\/beacon\.min\.js[\s\S]*ERR_BLOCKED_BY_CLIENT/i;

export type BrowserAuditEvent = {
  kind:
    | "console-error"
    | "page-error"
    | "request-failed"
    | "websocket-created"
    | "websocket-closed"
    | "websocket-error"
    | "websocket-premature-close"
    | "websocket-frame"
    | "http-response";
  url?: string;
  status?: number;
  direction?: "sent" | "received";
  frameType?: string;
  closeCode?: number;
  closeReason?: string;
};

export type BrowserUrlInspection = {
  credentialExposed: boolean;
  safeUrl: string;
};

/**
 * Vite's development HMR socket carries a random token for the local dev
 * server. It is not the assistant credential; keep this allowlist exact so a
 * real token on the public-auth or agent gateway still fails the audit.
 */
export function isLocalViteHmrWebSocket(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  return (
    parsed.protocol === "ws:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") &&
    parsed.port === "5173" &&
    parsed.pathname === "/" &&
    [...parsed.searchParams.keys()].length === 1 &&
    parsed.searchParams.has("token")
  );
}

export function inspectBrowserUrl(rawUrl: string): BrowserUrlInspection {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { credentialExposed: JWT_PATTERN.test(rawUrl), safeUrl: "<invalid-url>" };
  }

  const parameterNames = [
    ...new Set([...parsed.searchParams.keys()].map((name) => name.toLowerCase())),
  ];
  const credentialExposed =
    JWT_PATTERN.test(rawUrl) || parameterNames.some((name) => SENSITIVE_QUERY_PARAMETER.test(name));
  const query = parameterNames.sort().join("&");
  return {
    credentialExposed,
    safeUrl: `${parsed.origin}${parsed.pathname}${query ? `?${query}` : ""}`,
  };
}

function isAllowedTelemetryRequest(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.origin === "https://static.cloudflareinsights.com" &&
      parsed.pathname.startsWith("/beacon.min.js")
    );
  } catch {
    return false;
  }
}

function getSafeWebSocketFrameType(payload: string | Buffer): string | null {
  const text = typeof payload === "string" ? payload : payload.toString("utf8");
  try {
    const type = (JSON.parse(text) as { type?: unknown }).type;
    return typeof type === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(type) ? type : "unknown";
  } catch {
    return null;
  }
}

function safeCloseReason(reason: unknown): string {
  if (typeof reason !== "string" || reason.trim().length === 0) return "empty";
  if (/capacity|allocation|quota|limit/i.test(reason)) return "capacity";
  if (/abort|cancel|close/i.test(reason)) return "aborted";
  if (/error|fail|exception/i.test(reason)) return "error";
  return "other";
}

async function installChromiumWebSocketAudit(
  page: Page,
  events: BrowserAuditEvent[],
): Promise<void> {
  let session: CDPSession | null = null;
  try {
    session = await page.context().newCDPSession(page);
    await session.send("Network.enable");
  } catch {
    return;
  }
  if (!session) return;
  const urls = new Map<string, string>();
  session.on("Network.webSocketCreated", (event: { requestId: string; url: string }) => {
    urls.set(event.requestId, inspectBrowserUrl(event.url).safeUrl);
  });
  session.on(
    "Network.webSocketClosed",
    (event: { requestId: string; code?: number; reason?: string }) => {
      events.push({
        kind: "websocket-closed",
        url: urls.get(event.requestId),
        closeCode: event.code,
        closeReason: safeCloseReason(event.reason),
      });
      urls.delete(event.requestId);
    },
  );
  session.on("Network.webSocketFrameError", (event: { requestId: string }) => {
    events.push({ kind: "websocket-error", url: urls.get(event.requestId) });
  });
}

export function installAssistantBrowserAudit(page: Page): {
  events: BrowserAuditEvent[];
  assertClean: () => void;
} {
  const events: BrowserAuditEvent[] = [];
  let credentialExposure = false;
  let prematureWebSocketClose = false;

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (JWT_PATTERN.test(text)) credentialExposure = true;
    if (CLOUDFLARE_INSIGHTS_BLOCKED.test(text)) return;
    if (PREMATURE_WEBSOCKET_CLOSE.test(text)) {
      prematureWebSocketClose = true;
      events.push({ kind: "websocket-premature-close" });
      return;
    }
    events.push({ kind: "console-error" });
  });

  page.on("pageerror", (error) => {
    if (JWT_PATTERN.test(error.message)) credentialExposure = true;
    events.push({ kind: "page-error" });
  });

  page.on("requestfailed", (request) => {
    if (isAllowedTelemetryRequest(request.url())) return;
    const inspection = inspectBrowserUrl(request.url());
    credentialExposure ||= inspection.credentialExposed;
    events.push({ kind: "request-failed", url: inspection.safeUrl });
  });

  page.on("response", (response) => {
    if (isAllowedTelemetryRequest(response.url())) return;
    const inspection = inspectBrowserUrl(response.url());
    credentialExposure ||= inspection.credentialExposed;
    events.push({ kind: "http-response", status: response.status(), url: inspection.safeUrl });
  });

  page.on("websocket", (websocket) => {
    const inspection = inspectBrowserUrl(websocket.url());
    credentialExposure ||=
      !isLocalViteHmrWebSocket(websocket.url()) && inspection.credentialExposed;
    events.push({ kind: "websocket-created", url: inspection.safeUrl });
    websocket.on("close", () => events.push({ kind: "websocket-closed", url: inspection.safeUrl }));
    websocket.on("socketerror", () =>
      events.push({ kind: "websocket-error", url: inspection.safeUrl }),
    );
    websocket.on("framesent", ({ payload }) => {
      const frameType = getSafeWebSocketFrameType(payload);
      if (frameType)
        events.push({
          kind: "websocket-frame",
          direction: "sent",
          frameType,
          url: inspection.safeUrl,
        });
    });
    websocket.on("framereceived", ({ payload }) => {
      const frameType = getSafeWebSocketFrameType(payload);
      if (frameType)
        events.push({
          kind: "websocket-frame",
          direction: "received",
          frameType,
          url: inspection.safeUrl,
        });
    });
  });

  void installChromiumWebSocketAudit(page, events);

  return {
    events,
    assertClean() {
      assert.equal(
        credentialExposure,
        false,
        "browser telemetry exposed a credential in a URL or error",
      );
      assert.equal(
        prematureWebSocketClose,
        false,
        "browser reported a WebSocket closed before the connection was established",
      );
      const unexpectedEvents = events.filter(({ kind }) =>
        [
          "console-error",
          "page-error",
          "request-failed",
          "websocket-error",
          "websocket-premature-close",
        ].includes(kind),
      );
      assert.deepEqual(
        unexpectedEvents,
        [],
        "browser assistant audit reported unexpected failures",
      );
    },
  };
}
