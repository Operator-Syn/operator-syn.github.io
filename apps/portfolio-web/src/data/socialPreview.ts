export const SOCIAL_PREVIEW_SITE_ORIGIN = "https://syn-forge.com";
export const SOCIAL_PREVIEW_IMAGE_SUFFIX = "/social-image.png";
export const SOCIAL_PREVIEW_WIDTH = 1200;
export const SOCIAL_PREVIEW_HEIGHT = 630;
export const SOCIAL_PREVIEW_CONTENT_TYPE = "image/png";
export const SOCIAL_PREVIEW_AVATAR_URL =
  "https://personal-portfolio-bucket.syn-forge.com/ProfilePicture/nice.webp";
export const SOCIAL_PREVIEW_COLORS = {
  canvas: "#101111",
  surface: "#171918",
  text: "#f2ede3",
  textMuted: "#b7b1a7",
  textFaint: "#7e7b74",
  line: "rgb(242 237 227 / 18%)",
  lineStrong: "rgb(242 237 227 / 35%)",
  signal: "#f0a42a",
} as const;

export type SocialPreviewRouteKey =
  | "home"
  | "projects"
  | "certificates"
  | "snippets"
  | "privacy"
  | "terms"
  | "netbird"
  | "atelier"
  | "ai"
  | "agent";

export type SocialPreviewRouteDefinition = {
  readonly route: SocialPreviewRouteKey;
  readonly pathname: string;
  readonly label: string;
  readonly title: string;
  readonly description: string;
};

export type SocialPreviewMetadata = SocialPreviewRouteDefinition & {
  readonly imageAlt: string;
  readonly routeIndex: string;
};

export const HOME_PAGE_DESCRIPTION =
  "Explore Syn-Forge: Operator-Syn's software developer portfolio of projects, experiments, code snippets, and practical notes on software development.";

export const SOCIAL_PREVIEW_ROUTES = [
  {
    route: "home",
    pathname: "/",
    label: "Home",
    title: "Software Developer Portfolio",
    description: HOME_PAGE_DESCRIPTION,
  },
  {
    route: "projects",
    pathname: "/projects",
    label: "Projects",
    title: "Projects",
    description: "Browse software projects by Operator-Syn.",
  },
  {
    route: "certificates",
    pathname: "/certificates",
    label: "Certificates",
    title: "Training and Credentials",
    description:
      "Explore certificates and training credentials covering software development and related learning.",
  },
  {
    route: "snippets",
    pathname: "/snippets",
    label: "Snippets",
    title: "Code Snippets",
    description:
      "Browse code snippets, developer notes, and reference files from the Syn-Forge portfolio.",
  },
  {
    route: "privacy",
    pathname: "/privacy-policy",
    label: "Privacy",
    title: "Privacy Policy",
    description:
      "Privacy Policy for Syn-Forge, Operator-Syn, and related personal applications hosted under syn-forge.com.",
  },
  {
    route: "terms",
    pathname: "/terms-and-conditions",
    label: "Terms",
    title: "Terms and Conditions",
    description:
      "Terms and Conditions for Syn-Forge, Operator-Syn, and related personal applications hosted under syn-forge.com.",
  },
  {
    route: "netbird",
    pathname: "/netbird",
    label: "NetBird",
    title: "NetBird",
    description:
      "NetBird access homepage for Syn-Forge infrastructure and Google project verification.",
  },
  {
    route: "atelier",
    pathname: "/atelier",
    label: "Atelier",
    title: "Atelier",
    description:
      "Atelier dashboard homepage for Syn-Forge portfolio administration and application verification.",
  },
  {
    route: "ai",
    pathname: "/ai",
    label: "AI and MCP",
    title: "AI and MCP Access",
    description:
      "Connect AI agents to Syn-Forge's public portfolio MCP for grounded profile, project, certificate, public snippet, and bounded GitHub project information.",
  },
  {
    route: "agent",
    pathname: "/agent",
    label: "Feilhann Agent",
    title: "Feilhann Agent",
    description: "Feilhann Agent homepage for Syn-Forge and Google project verification.",
  },
] as const satisfies readonly SocialPreviewRouteDefinition[];

const fallbackRoute = SOCIAL_PREVIEW_ROUTES[0];

export function normalizeSocialPreviewPath(pathname: string) {
  const rawPath = pathname.trim().split(/[?#]/, 1)[0] ?? "";
  if (!rawPath) return "/";

  const withLeadingSlash = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  const normalized = withLeadingSlash.replace(/\/+$/, "");
  return normalized || "/";
}

export function getSocialPreviewMetadata(pathname: string): SocialPreviewMetadata {
  const normalized = normalizeSocialPreviewPath(pathname);
  const definition =
    SOCIAL_PREVIEW_ROUTES.find(
      (candidate) =>
        candidate.pathname === normalized ||
        (candidate.pathname !== "/" && normalized.startsWith(`${candidate.pathname}/`)),
    ) ?? fallbackRoute;

  const routePosition = SOCIAL_PREVIEW_ROUTES.findIndex(
    (candidate) => candidate.route === definition.route,
  );
  const routeIndex = [
    String(routePosition + 1).padStart(2, "0"),
    String(SOCIAL_PREVIEW_ROUTES.length).padStart(2, "0"),
  ].join(" / ");

  return {
    ...definition,
    imageAlt: `${definition.title} — Syn-Forge social preview`,
    routeIndex,
  };
}

export function getSocialPreviewImagePath(pathname: string) {
  const metadata = getSocialPreviewMetadata(pathname);
  return metadata.pathname === "/"
    ? SOCIAL_PREVIEW_IMAGE_SUFFIX
    : metadata.pathname + SOCIAL_PREVIEW_IMAGE_SUFFIX;
}

export function getSocialPreviewImageUrl(pathname: string, origin = SOCIAL_PREVIEW_SITE_ORIGIN) {
  return new URL(getSocialPreviewImagePath(pathname), `${origin.replace(/\/+$/, "")}/`).href;
}
