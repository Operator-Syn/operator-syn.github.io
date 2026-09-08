export type PageTransitionScope = "page" | "nested" | "none";
export type PageTransitionDirection = "forward" | "backward" | "neutral";

export interface PageTransitionPlan {
  scope: PageTransitionScope;
  direction: PageTransitionDirection;
  fromRailIndex: number | null;
  toRailIndex: number | null;
}

const PRIMARY_RAIL_PATHS = ["/", "/projects", "/certificates", "/snippets"] as const;

const UTILITY_ROUTE_PREFIXES = [
  "/privacy-policy",
  "/terms-and-conditions",
  "/netbird",
  "/atelier",
  "/agent",
] as const;

export const PAGE_TRANSITION_DURATION_MS = 560;
export const PAGE_TRANSITION_HANDOFF_DURATION_MS = 80;
export const NESTED_TRANSITION_DURATION_MS = 220;

export function normalizeRoutePath(pathname: string) {
  const normalized = pathname.replace(/\/+$/, "");
  return normalized || "/";
}

export function getRouteRailIndex(pathname: string): number | null {
  const normalized = normalizeRoutePath(pathname);

  if (normalized === "/") return 0;
  if (normalized === "/projects" || normalized.startsWith("/projects/")) return 1;
  if (normalized === "/certificates" || normalized.startsWith("/certificates/")) return 2;
  if (normalized === "/snippets" || normalized.startsWith("/snippets/")) return 3;

  return null;
}

export function getPageTransitionScope(pathname: string): PageTransitionScope {
  const normalized = normalizeRoutePath(pathname);

  if (normalized === "/" || normalized === "/snippets") return "page";
  if (normalized.startsWith("/snippets/document/")) return "page";
  if (normalized.startsWith("/snippets/")) return "nested";
  if (PRIMARY_RAIL_PATHS.some((path) => normalized === path)) return "page";
  if (UTILITY_ROUTE_PREFIXES.some((prefix) => normalized === prefix)) return "page";

  return "page";
}

export function getPageTransitionPlan(
  fromPathname: string,
  toPathname: string,
): PageTransitionPlan {
  const fromPath = normalizeRoutePath(fromPathname);
  const toPath = normalizeRoutePath(toPathname);
  const isSnippetWorkspaceNavigation =
    (fromPath === "/snippets" || fromPath.startsWith("/snippets/")) &&
    !fromPath.startsWith("/snippets/document/") &&
    (toPath === "/snippets" || toPath.startsWith("/snippets/")) &&
    !toPath.startsWith("/snippets/document/");
  const scope =
    fromPath === toPath
      ? "none"
      : isSnippetWorkspaceNavigation
        ? "nested"
        : getPageTransitionScope(toPath);
  const fromRailIndex = getRouteRailIndex(fromPath);
  const toRailIndex = getRouteRailIndex(toPath);

  let direction: PageTransitionDirection = "neutral";

  if (fromRailIndex !== null && toRailIndex !== null && fromRailIndex !== toRailIndex) {
    direction = toRailIndex > fromRailIndex ? "forward" : "backward";
  }

  return {
    scope,
    direction,
    fromRailIndex,
    toRailIndex,
  };
}

let transitionSequence = 0;

export function markRouteTransitionIntent(plan: PageTransitionPlan) {
  if (typeof document === "undefined" || plan.scope === "none") return null;

  const id = String(++transitionSequence);
  const root = document.documentElement;
  root.dataset.pageTransitionId = id;
  root.dataset.pageTransitionScope = plan.scope;
  root.dataset.pageTransitionDirection = plan.direction;

  return id;
}

export function clearRouteTransitionIntent(id: string | null) {
  if (typeof document === "undefined" || !id) return;

  const root = document.documentElement;
  if (root.dataset.pageTransitionId !== id) return;

  delete root.dataset.pageTransitionId;
  delete root.dataset.pageTransitionScope;
  delete root.dataset.pageTransitionDirection;
}
