// workers/portfolio-api/src/entrypoint.ts

import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Bindings } from "./bindings";
import { CertificateItemsController } from "./controller/CertificatesPage/CertificateItemsController";
import { CertificatesController } from "./controller/CertificatesPage/CertificatesController";
import { CertificatesPageController } from "./controller/CertificatesPageController";
import { ProfileController } from "./controller/HomePage/ProfileController";
import { SectionsController } from "./controller/HomePage/SectionsController";
import { SectionItemsController } from "./controller/HomePage/SectionsItemsController";
import { SettingsController } from "./controller/HomePage/SettingsController";
import { createMediaController, MediaController } from "./controller/Media/MediaController";
import { OrderingController } from "./controller/OrderingController";
import { GalleryController } from "./controller/ProjectPage/GalleryController";
import { ProjectsController } from "./controller/ProjectPage/ProjectsController";
import { ProjectsPageController } from "./controller/ProjectsPageController";
import { SnippetsPageController } from "./controller/SnippetsPage/SnippetsPageController";

const ProjectsMedia = MediaController;
const CertificatesMedia = createMediaController("Certificates/");

const app = new Hono<{ Bindings: Bindings }>();
const API_V2_PREFIX = "/api/v2";
const ADMIN_WRITE_ORIGINS = new Set([
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://localhost:3000",
  "https://www.syn-forge.com",
  "https://syn-forge.com",
  "https://personal-portfolio.syn-forge.com",
  "https://atelier.syn-forge.com",
]);

const noStoreByDefault: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  await next();

  if (!c.res.headers.has("Cache-Control")) {
    c.header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  }

  c.header("Pragma", "no-cache");
  c.header("Expires", "0");
};

// --- CORS MIDDLEWARE ---
app.use(
  "/*",
  cors({
    origin: (origin) => {
      if (!origin) return "";

      if (ADMIN_WRITE_ORIGINS.has(origin)) return origin;
      return "";
    },
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

// --- OPTIONS handler for preflight requests ---
app.options("/api/*", (c) => c.json({}));

// Default all API responses to no-store unless a route explicitly overrides it.
app.use("/api/*", noStoreByDefault);

// --- ROOT REDIRECT ---
app.get("/", (c) => c.redirect("https://www.syn-forge.com", 301));

// ==========================================
//   PUBLIC APIS (No Auth Required)
// ==========================================

app.get("/api/projects", ProjectsController.list);
app.get(`${API_V2_PREFIX}/projects/archive`, ProjectsPageController.handleProjects);
app.get(`${API_V2_PREFIX}/certificates/archive`, CertificatesPageController.handleCertificates);
app.get("/api/project/:id", ProjectsController.get);
app.get("/api/project/:projectId/gallery", GalleryController.listByProject);

app.get(`${API_V2_PREFIX}/snippets/:id/preview`, SnippetsPageController.getSnippetPreview);
app.get(`${API_V2_PREFIX}/snippets/:id/content`, SnippetsPageController.streamSnippetDocument);
app.get(`${API_V2_PREFIX}/snippets/:id`, SnippetsPageController.getSnippetDocument);
app.get("/api/snippets", SnippetsPageController.getSnippets);
app.get("/api/snippets/:id", SnippetsPageController.getSnippet);
app.get("/api/snippets/:id/content", SnippetsPageController.downloadSnippet);

app.get("/api/settings", SettingsController.list);
app.get("/api/profile", ProfileController.list);
app.get("/api/sections", SectionsController.list);
app.get("/api/sections/:sectionId/items", SectionItemsController.list);

app.get("/api/projects/media", ProjectsMedia.list);
app.get("/api/projects/media/:key{.+}", ProjectsMedia.get);

app.get("/api/certificates/media", CertificatesMedia.list);
app.get("/api/certificates/media/:key{.+}", CertificatesMedia.get);

app.get("/api/certificates", CertificatesController.listAll);
app.get("/api/certificates/:id", CertificatesController.getById);
app.get("/api/certificates/:certId/items", CertificateItemsController.listByCertificate);

// ==========================================
//   PRIVATE APIS (Eury Gateway Protected)
// ==========================================

app.use("/api/*", async (c, next) => {
  const internalKey = c.req.header("X-Admin-Internal-Key");
  if (
    typeof c.env.ADMIN_INTERNAL_KEY === "string" &&
    c.env.ADMIN_INTERNAL_KEY.length > 0 &&
    internalKey === c.env.ADMIN_INTERNAL_KEY
  ) {
    await next();
    return;
  }

  if (!ADMIN_WRITE_ORIGINS.has(c.req.header("Origin") ?? "")) {
    return c.json({ error: "Origin is not allowed" }, 403);
  }

  return c.json(
    { error: { code: "LEGACY_ROUTE_RETIRED", message: "Use the Eury admin gateway." } },
    410,
  );
});

// --- MEDIA (Private CRUD) ---
app.post("/api/projects/media", ProjectsMedia.upload);
app.put("/api/projects/media/:key{.+}", ProjectsMedia.update);
app.delete("/api/projects/media/:key{.+}", ProjectsMedia.delete);
app.post("/api/projects/media/presign", ProjectsMedia.presign);

app.post("/api/certificates/media", CertificatesMedia.upload);
app.put("/api/certificates/media/:key{.+}", CertificatesMedia.update);
app.delete("/api/certificates/media/:key{.+}", CertificatesMedia.delete);
app.post("/api/certificates/media/presign", CertificatesMedia.presign);

// --- PROJECTS CRUD (Write) ---
app.post("/api/project", ProjectsController.create);
app.put("/api/project/:id", ProjectsController.update);
app.delete("/api/project/:id", ProjectsController.delete);
app.put("/api/projects/order", OrderingController.projects);

// --- GALLERY (Write) ---
app.post("/api/gallery", GalleryController.create);
app.put("/api/gallery/:id", GalleryController.update);
app.delete("/api/gallery/:id", GalleryController.delete);

// --- CERTIFICATES CRUD (Write) ---
app.post("/api/certificates", CertificatesController.create);
app.put("/api/certificates/:id", CertificatesController.update);
app.delete("/api/certificates/:id", CertificatesController.delete);
app.put("/api/certificates/order", OrderingController.certificates);

// --- CERTIFICATE ITEMS (Write) ---
app.post("/api/certificates/items", CertificateItemsController.create);
app.put("/api/certificates/items/:id", CertificateItemsController.update);
app.delete("/api/certificates/items/:id", CertificateItemsController.delete);

// --- SNIPPETS (Write) ---
app.post("/api/snippets", SnippetsPageController.createSnippet);
app.patch("/api/snippets/:id", SnippetsPageController.updateSnippet);
app.delete("/api/snippets/:id", SnippetsPageController.deleteSnippet);

// --- SETTINGS (Write) ---
app.post("/api/settings", SettingsController.create);
app.put("/api/settings", SettingsController.update);
app.delete("/api/settings/:key", SettingsController.delete);

// --- PROFILE (Write) ---
app.post("/api/profile", ProfileController.create);
app.put("/api/profile", ProfileController.update);
app.delete("/api/profile/:id{[0-9]+}", ProfileController.deleteById);
app.delete("/api/profile/:label", ProfileController.delete);
app.put("/api/profile/:id", ProfileController.updateById);

// --- SECTIONS (Write) ---
app.post("/api/sections", SectionsController.create);
app.put("/api/sections", SectionsController.update);
app.delete("/api/sections/:id", SectionsController.delete);

// --- SECTION ITEMS (Write) ---
app.post("/api/sections/items", SectionItemsController.create);
app.put("/api/sections/items/:id", SectionItemsController.update);
app.delete("/api/sections/items/:id", SectionItemsController.delete);

export default app;
