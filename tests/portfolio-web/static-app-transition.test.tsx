import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../../apps/portfolio-web");
const staticAppPath = resolve(
  repositoryRoot,
  "src/components/pages/staticAppPage/StaticAppPage.tsx",
);
const transitionPath = resolve(repositoryRoot, "src/components/pageTransition/PageTransition.tsx");

test("routes stateful static-app links through page transitions", async () => {
  const [staticAppSource, transitionSource] = await Promise.all([
    readFile(staticAppPath, "utf8"),
    readFile(transitionPath, "utf8"),
  ]);

  assert.equal((staticAppSource.match(/<TransitionNavLink/g) ?? []).length, 4);
  assert.doesNotMatch(staticAppSource, /data-transition-preserve-state/);
  assert.match(transitionSource, /dataset\.transitionManaged !== "true"/);
});

test("uses the shared ruled shell for NetBird and Atelier", async () => {
  const [staticAppSource, staticAppStyles, netbirdSource, atelierSource] = await Promise.all([
    readFile(staticAppPath, "utf8"),
    readFile(
      resolve(repositoryRoot, "src/components/pages/staticAppPage/StaticAppPage.css"),
      "utf8",
    ),
    readFile(resolve(repositoryRoot, "src/components/pages/netbirdPage/Netbird.tsx"), "utf8"),
    readFile(resolve(repositoryRoot, "src/components/pages/atelierPage/Atelier.tsx"), "utf8"),
  ]);

  assert.match(
    staticAppSource,
    /<PointerCoordinates className="static-app-coordinates" markerCount=\{0\} \/>/,
  );
  assert.match(staticAppSource, /className="static-app-hero"/);
  assert.match(staticAppSource, /className="static-app-summary-grid"/);
  assert.match(staticAppSource, /className="static-app-document"/);
  assert.doesNotMatch(staticAppSource, /privacyPolicyPage\/PrivacyPolicy\.css/);
  assert.match(staticAppStyles, /--color-surface/);
  assert.match(staticAppStyles, /--color-signal/);
  assert.match(staticAppStyles, /@media \(max-width: 640px\)/);
  assert.doesNotMatch(staticAppStyles, /!important|border-radius: 999/);
  assert.match(netbirdSource, /heading: "NetBird"/);
  assert.match(atelierSource, /heading: "Atelier"/);
  const agentSource = await readFile(
    resolve(repositoryRoot, "src/components/pages/agentPage/Agent.tsx"),
    "utf8",
  );
  assert.match(agentSource, /heading: "Portfolio Assistant"/);
});
