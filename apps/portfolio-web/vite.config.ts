import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import Sitemap from "vite-plugin-sitemap";
import { assertPagesBuildHasTurnstileSiteKey } from "./src/components/portfolioAssistant/portfolioAssistantBuildGuard.ts";

const appRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(appRoot, "../..");

type SnippetRouteNode = {
  id: number;
  name: string;
  type: "dir" | "file";
  children?: SnippetRouteNode[];
};

const staticRoutes = [
  "/projects",
  "/certificates",
  "/snippets",
  "/privacy-policy",
  "/terms-and-conditions",
  "/netbird",
  "/atelier",
  "/ai",
  "/agent",
];

function slugifySnippetName(name: string) {
  const trimmed = name.trim();
  const extensionMatch = trimmed.match(/(\.[a-z0-9]+)$/i);
  const extension = extensionMatch?.[1].toLowerCase() ?? "";
  const stem = extension ? trimmed.slice(0, -extension.length) : trimmed;
  const slug = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return (slug || "document") + extension;
}

function flattenSnippetRoutes(nodes: SnippetRouteNode[], routes: string[] = []): string[] {
  for (const node of nodes) {
    if (node.type === "file") {
      routes.push(
        "/snippets/document/" +
          encodeURIComponent(String(node.id)) +
          "/" +
          encodeURIComponent(slugifySnippetName(node.name)) +
          "/",
      );
      continue;
    }

    if (node.children) {
      flattenSnippetRoutes(node.children, routes);
    }
  }

  return routes;
}

async function fetchSnippetRoutes(apiUrl: string): Promise<string[]> {
  if (!apiUrl) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetch(`${apiUrl}/snippets`, {
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) return [];

    const payload = (await response.json()) as { data?: SnippetRouteNode[] };
    return payload.data ? flattenSnippetRoutes(payload.data) : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, repositoryRoot, "");
  assertPagesBuildHasTurnstileSiteKey({
    isPagesBuild: process.env.CF_PAGES === "1",
    mode,
    siteKey: env.VITE_TURNSTILE_SITE_KEY,
  });
  const snippetRoutes = await fetchSnippetRoutes(env.VITE_API_URL);

  return {
    root: appRoot,
    envDir: repositoryRoot,
    plugins: [
      react(),
      tailwindcss(),
      Sitemap({
        hostname: "https://syn-forge.com",
        dynamicRoutes: [...staticRoutes, ...snippetRoutes],
      }),
    ],
    base: "/",
    server: {
      host: true,
      allowedHosts: [
        "yashindo.local",
        "dev.syn-forge.com",
        "yashindo.syn-forge.netbird",
        "portfolio.yashindo.syn-forge.com",
        "hiraeth.internal.netbird-network",
      ],
    },
    build: {
      chunkSizeWarningLimit: 1500,
      rollupOptions: {},
    },
  };
});
