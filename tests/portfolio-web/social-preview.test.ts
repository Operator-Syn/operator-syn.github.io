import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  getSocialPreviewImagePath,
  getSocialPreviewImageUrl,
  getSocialPreviewMetadata,
  HOME_PAGE_DESCRIPTION,
  normalizeSocialPreviewPath,
  SOCIAL_PREVIEW_AVATAR_URL,
  SOCIAL_PREVIEW_HEIGHT,
  SOCIAL_PREVIEW_ROUTES,
  SOCIAL_PREVIEW_WIDTH,
} from "../../apps/portfolio-web/src/data/socialPreview.ts";

const repositoryRoot = resolve(import.meta.dirname, "../../apps/portfolio-web");
const socialPreviewAssetPaths = SOCIAL_PREVIEW_ROUTES.map((route) =>
  getSocialPreviewImagePath(route.pathname),
);

test("normalizes route paths and falls back safely", () => {
  assert.equal(normalizeSocialPreviewPath("projects/?source=share"), "/projects");
  assert.equal(normalizeSocialPreviewPath("/"), "/");
  assert.equal(normalizeSocialPreviewPath(""), "/");
  assert.equal(getSocialPreviewMetadata("/unknown").route, "home");
  assert.equal(getSocialPreviewMetadata("/").routeIndex, "01 / 10");
  assert.equal(getSocialPreviewMetadata("/projects").routeIndex, "02 / 10");
  assert.equal(getSocialPreviewMetadata("/unknown").routeIndex, "01 / 10");
  assert.equal(
    getSocialPreviewMetadata("/snippets/document/22/database-migrations.md").route,
    "snippets",
  );
});

test("keeps the homepage description aligned with the SERP target", async () => {
  assert.ok(HOME_PAGE_DESCRIPTION.length >= 120);
  assert.ok(HOME_PAGE_DESCRIPTION.length <= 160);

  const [index, home] = await Promise.all([
    readFile(resolve(repositoryRoot, "index.html"), "utf8"),
    readFile(resolve(repositoryRoot, "src/components/pages/homePage/Home.tsx"), "utf8"),
  ]);

  assert.equal(index.split(HOME_PAGE_DESCRIPTION).length - 1, 3);
  assert.match(home, /description=\{HOME_PAGE_DESCRIPTION\}/);
  assert.match(home, /description: HOME_PAGE_DESCRIPTION/);
  assert.equal(getSocialPreviewMetadata("/").description, HOME_PAGE_DESCRIPTION);
});

test("creates distinct top-level image URLs", () => {
  const imageUrls = SOCIAL_PREVIEW_ROUTES.map((route) => getSocialPreviewImageUrl(route.pathname));

  assert.equal(new Set(imageUrls).size, SOCIAL_PREVIEW_ROUTES.length);
  assert.equal(getSocialPreviewImagePath("/"), "/social-image.png");
  assert.equal(getSocialPreviewImagePath("/projects/"), "/projects/social-image.png");
  assert.equal(getSocialPreviewImagePath("/ai"), "/ai/social-image.png");
  assert.equal(
    getSocialPreviewImageUrl("/projects/"),
    "https://syn-forge.com/projects/social-image.png",
  );
});

test("keeps generated assets at native dimensions", async () => {
  const assets = await Promise.all(
    socialPreviewAssetPaths.map((assetPath) =>
      readFile(resolve(repositoryRoot, "public", assetPath.slice(1))),
    ),
  );
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  for (const asset of assets) {
    assert.deepEqual(asset.subarray(0, 8), pngSignature);
    assert.equal(asset.readUInt32BE(16), SOCIAL_PREVIEW_WIDTH);
    assert.equal(asset.readUInt32BE(20), SOCIAL_PREVIEW_HEIGHT);
    assert.ok(asset.length > 1_000);
  }
});

test("keeps route metadata grounded in existing public copy", async () => {
  const sourcePaths = [
    "index.html",
    "src/components/pages/homePage/Home.tsx",
    "src/components/pages/projectsPage/Projects.tsx",
    "src/components/pages/certificatesPage/Certificates.tsx",
    "src/components/pages/snippetsPage/Snippets.tsx",
    "src/components/pages/privacyPolicyPage/PrivacyPolicy.tsx",
    "src/components/pages/termsAndConditionsPage/TermsAndConditions.tsx",
    "src/components/pages/netbirdPage/Netbird.tsx",
    "src/components/pages/atelierPage/Atelier.tsx",
    "src/components/pages/agentPage/Agent.tsx",
  ];

  const sources = await Promise.all(
    sourcePaths.map((path) => readFile(resolve(repositoryRoot, path), "utf8")),
  );

  assert.match(sources[0], /https:\/\/syn-forge\.com\/social-image\.png/);
  assert.ok(sources[0].includes(SOCIAL_PREVIEW_AVATAR_URL));
  for (const source of sources) {
    assert.doesNotMatch(source, /ProfilePicture\/preview\.png/);
  }
});

test("keeps Pages head rewriting and static image routing in the Pages boundary", async () => {
  const [middleware, routes, generator, component] = await Promise.all([
    readFile(resolve(repositoryRoot, "functions/_middleware.ts"), "utf8"),
    readFile(resolve(repositoryRoot, "public/_routes.json"), "utf8"),
    readFile(resolve(repositoryRoot, "scripts/generate-social-previews.ts"), "utf8"),
    readFile(resolve(repositoryRoot, "src/components/socialPreview/SocialPreviewCard.tsx"), "utf8"),
  ]);

  assert.doesNotMatch(middleware, /ImageResponse/);
  assert.match(middleware, /HTMLRewriter/);
  assert.match(middleware, /getSocialPreviewImageUrl/);
  assert.match(generator, /renderToStaticMarkup/);
  assert.match(generator, /page\.screenshot/);
  assert.match(generator, /naturalWidth/);
  assert.match(component, /SOCIAL_PREVIEW_AVATAR_URL/);
  assert.match(component, /<img/);
  assert.match(component, /Operator Syn/);
  assert.doesNotMatch(component, /John-Ronan/);

  const routesConfig = JSON.parse(routes);
  assert.ok(routesConfig.include.includes("/projects/*"));
  for (const assetPath of socialPreviewAssetPaths) {
    assert.ok(routesConfig.exclude.includes(assetPath));
  }
  assert.ok(routesConfig.exclude.includes("/assets/*"));
  assert.ok(routesConfig.exclude.includes("/llms.txt"));
});
