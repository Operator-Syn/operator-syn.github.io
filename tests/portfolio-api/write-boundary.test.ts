import assert from "node:assert/strict";
import { test } from "node:test";
import app from "../../workers/portfolio-api/src/entrypoint.ts";

const INTERNAL_KEY = "test-internal-key";
const ADMIN_ORIGIN = "https://atelier.syn-forge.com";
const RETIRED_ERROR = {
  error: { code: "LEGACY_ROUTE_RETIRED", message: "Use the Eury admin gateway." },
};

type WriteProbe = {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
};

const PRIVATE_WRITE_PROBES: WriteProbe[] = [
  { method: "POST", path: "/api/projects/media" },
  { method: "PUT", path: "/api/projects/media/retirement-probe" },
  { method: "DELETE", path: "/api/projects/media/retirement-probe" },
  { method: "POST", path: "/api/projects/media/presign" },
  { method: "POST", path: "/api/certificates/media" },
  { method: "PUT", path: "/api/certificates/media/retirement-probe" },
  { method: "DELETE", path: "/api/certificates/media/retirement-probe" },
  { method: "POST", path: "/api/certificates/media/presign" },
  { method: "POST", path: "/api/project" },
  { method: "PUT", path: "/api/project/1" },
  { method: "DELETE", path: "/api/project/1" },
  { method: "PUT", path: "/api/projects/order" },
  { method: "POST", path: "/api/gallery" },
  { method: "PUT", path: "/api/gallery/1" },
  { method: "DELETE", path: "/api/gallery/1" },
  { method: "POST", path: "/api/certificates" },
  { method: "PUT", path: "/api/certificates/1" },
  { method: "DELETE", path: "/api/certificates/1" },
  { method: "PUT", path: "/api/certificates/order" },
  { method: "POST", path: "/api/certificates/items" },
  { method: "PUT", path: "/api/certificates/items/1" },
  { method: "DELETE", path: "/api/certificates/items/1" },
  { method: "POST", path: "/api/snippets" },
  { method: "PATCH", path: "/api/snippets/1" },
  { method: "DELETE", path: "/api/snippets/1" },
  { method: "POST", path: "/api/settings" },
  { method: "PUT", path: "/api/settings" },
  { method: "DELETE", path: "/api/settings/retirement-probe" },
  { method: "POST", path: "/api/profile" },
  { method: "PUT", path: "/api/profile" },
  { method: "DELETE", path: "/api/profile/1" },
  { method: "DELETE", path: "/api/profile/retirement-probe" },
  { method: "PUT", path: "/api/profile/1" },
  { method: "POST", path: "/api/sections" },
  { method: "PUT", path: "/api/sections" },
  { method: "DELETE", path: "/api/sections/1" },
  { method: "POST", path: "/api/sections/items" },
  { method: "PUT", path: "/api/sections/items/1" },
  { method: "DELETE", path: "/api/sections/items/1" },
];

class ThrowingDatabase {
  readonly queries: string[] = [];

  prepare(sql: string): never {
    this.queries.push(sql);
    throw new Error("D1 must not be accessed by a retired browser write");
  }
}

class RecordingDatabase {
  readonly queries: string[] = [];

  prepare(sql: string) {
    this.queries.push(sql);
    return {
      all: async <T>() => ({ results: [] as T[] }),
      bind: (...values: unknown[]) => ({
        all: async <T>() => ({ results: [] as T[] }),
        first: async <T>() => ({ key: values[0], value: values[1] }) as T,
        run: async () => ({ success: true }),
      }),
    };
  }
}

function environment(database: unknown) {
  return { DB: database, ADMIN_INTERNAL_KEY: INTERNAL_KEY };
}

async function call(
  database: unknown,
  method: string,
  path: string,
  options: { origin?: string; cookie?: string; internalKey?: string; body?: unknown } = {},
) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (options.origin !== undefined) headers.set("Origin", options.origin);
  if (options.cookie) headers.set("Cookie", options.cookie);
  if (options.internalKey) headers.set("X-Admin-Internal-Key", options.internalKey);
  return app.fetch(
    new Request(`https://personal-portfolio.syn-forge.com${path}`, {
      method,
      headers,
      body: method === "GET" ? undefined : JSON.stringify(options.body ?? {}),
    }),
    environment(database) as never,
  );
}

test("browser-cookie content writes fail closed before auth or D1 access", async () => {
  const database = new ThrowingDatabase();

  for (const probe of PRIVATE_WRITE_PROBES) {
    const response = await call(database, probe.method, probe.path, {
      origin: ADMIN_ORIGIN,
      cookie: "auth_token=retirement-probe-only",
    });
    assert.equal(response.status, 410, `${probe.method} ${probe.path}`);
    assert.deepEqual(await response.json(), RETIRED_ERROR);
  }

  const wrongOrigin = await call(database, "POST", "/api/project", {
    origin: "https://evil.example",
    cookie: "auth_token=retirement-probe-only",
  });
  assert.equal(wrongOrigin.status, 403);

  const noOrigin = await call(database, "POST", "/api/project", {
    cookie: "auth_token=retirement-probe-only",
  });
  assert.equal(noOrigin.status, 403);
  assert.deepEqual(database.queries, []);
});

test("the internal Eury gateway key remains the write path", async () => {
  const database = new RecordingDatabase();
  const response = await call(database, "POST", "/api/settings", {
    origin: ADMIN_ORIGIN,
    internalKey: INTERNAL_KEY,
    body: { key: "retirement-check", value: "internal write" },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    key: "retirement-check",
    value: "internal write",
  });
  assert.equal(database.queries.length, 1);
});

test("public content reads remain available", async () => {
  const database = new RecordingDatabase();
  const response = await call(database, "GET", "/api/projects", { origin: ADMIN_ORIGIN });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
  assert.equal(database.queries.length, 1);
});
