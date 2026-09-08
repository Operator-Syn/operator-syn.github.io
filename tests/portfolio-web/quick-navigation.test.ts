import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../../apps/portfolio-web");

test("surfaces every hidden route in quick navigation", async () => {
  const [quickNavigation, routeRegistry] = await Promise.all([
    readFile(resolve(repositoryRoot, "src/components/quickNavigation/QuickNavigation.tsx"), "utf8"),
    readFile(resolve(repositoryRoot, "src/data/NavLinks.types.ts"), "utf8"),
  ]);
  const hiddenRoutes = [
    ...routeRegistry.matchAll(
      /\{ name: "([^"]+)", path: "([^"]+)", component: [^,]+, showInNav: false \}/g,
    ),
  ].map((match) => ({ name: match[1], path: match[2] }));

  assert.deepEqual(
    hiddenRoutes.map((route) => route.path),
    ["/privacy-policy", "/terms-and-conditions", "/netbird", "/atelier", "/ai", "/agent"],
  );

  for (const route of hiddenRoutes) {
    assert.ok(
      quickNavigation.includes(`"${route.path}"`),
      `${route.name} should be available from quick navigation`,
    );
  }
});
