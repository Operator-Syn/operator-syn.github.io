import { defaultUrlTransform } from "react-markdown";

const PORTFOLIO_SITE_ORIGIN = "https://syn-forge.com";
const PORTFOLIO_SITE_HOSTNAME = "syn-forge.com";
const KNOWN_PORTFOLIO_PATHS = new Set([
  "/",
  "/projects",
  "/certificates",
  "/snippets",
  "/privacy-policy",
  "/terms-and-conditions",
  "/netbird",
  "/atelier",
  "/ai",
  "/agent",
]);

function isAbsoluteUrl(value: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value);
}

function normalizePortfolioPath(pathname: string): string | null {
  const trimmed = pathname.trim();
  if (!trimmed) return null;

  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    return null;
  }

  // A model can encode the root slash after the leading slash as "/%2F".
  if (/^\/%2f$/i.test(trimmed) || decoded === "//") return "/";

  const canonical = decoded.replace(/^\/+/, "/") || "/";
  const routePath = canonical === "/" ? "/" : canonical.replace(/\/+$/, "");
  if (KNOWN_PORTFOLIO_PATHS.has(routePath) || routePath.startsWith("/snippets/")) {
    return canonical;
  }

  return null;
}

export function normalizeAssistantMarkdownHref(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed, PORTFOLIO_SITE_ORIGIN);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  const isRelative = !isAbsoluteUrl(trimmed);
  if (parsed.hostname.toLowerCase() !== PORTFOLIO_SITE_HOSTNAME) {
    return isRelative ? null : trimmed;
  }

  const pathname = normalizePortfolioPath(parsed.pathname);
  if (!pathname) return null;
  parsed.pathname = pathname;

  if (!isRelative) return parsed.href;
  if (trimmed.startsWith("#")) return parsed.hash;
  if (trimmed.startsWith("?")) return parsed.search + parsed.hash;
  return parsed.pathname + parsed.search + parsed.hash;
}

export function normalizeAssistantMarkdownText(value: string): string {
  return value.replace(
    /https:\/\/syn-forge\.com\/(?=(?:—|–|%E2%80%94)[\p{L}\p{N}])/giu,
    "https://syn-forge.com/ ",
  );
}

export function transformAssistantMarkdownUrl(value: string, key: string): string {
  const trimmed = value.trim();
  if (key === "src" && /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp)(?:;|,)/i.test(trimmed)) {
    return trimmed;
  }

  const transformed = defaultUrlTransform(trimmed);
  if (key !== "href") return transformed;
  return normalizeAssistantMarkdownHref(transformed) ?? "";
}
