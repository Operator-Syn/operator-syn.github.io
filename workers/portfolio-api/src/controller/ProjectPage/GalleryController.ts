// workers/portfolio-api/src/controller/ProjectPage/GalleryController.ts
import type { Context } from "hono";
import type { Bindings } from "../../bindings";
import { type GalleryCreate, GalleryModel } from "../../model/ProjectPage/GalleryModel";
import {
  asContentRecord,
  hasOnlyKnownKeys,
  parseBoundedText,
  parseMediaType,
  parseNonNegativeInteger,
  parsePositiveId,
  readContentRecord,
} from "../../utils/contentValidation";

const GALLERY_KEYS = ["id", "project_id", "type", "url", "display_order"] as const;

function validateGalleryBody(body: unknown, partial: boolean): Record<string, unknown> | Response {
  const record = asContentRecord(body);
  if (!record || !hasOnlyKnownKeys(record, GALLERY_KEYS)) {
    return Response.json({ error: "Gallery item contains an unsupported field" }, { status: 400 });
  }
  const result: Record<string, unknown> = {};
  if (!partial || record.project_id !== undefined) {
    const projectId = parsePositiveId(record.project_id);
    if (projectId === null)
      return Response.json({ error: "project_id must be a positive integer" }, { status: 400 });
    result.project_id = projectId;
  }
  if (!partial || record.type !== undefined) {
    const type = parseMediaType(record.type);
    if (type === null)
      return Response.json({ error: "type must be image or video" }, { status: 400 });
    result.type = type;
  }
  if (!partial || record.url !== undefined) {
    const url = parseBoundedText(record.url, 2_048);
    if (url === null)
      return Response.json({ error: "url must be a non-empty string" }, { status: 400 });
    result.url = url;
  }
  if (!partial || record.display_order !== undefined) {
    const displayOrder = parseNonNegativeInteger(record.display_order ?? 0);
    if (displayOrder === null)
      return Response.json(
        { error: "display_order must be a non-negative integer" },
        { status: 400 },
      );
    result.display_order = displayOrder;
  }
  return result;
}

export const GalleryController = {
  // List all gallery items for a specific project
  async listByProject(c: Context<{ Bindings: Bindings }>) {
    // Match the route param name
    const projectId = parsePositiveId(c.req.param("projectId"));
    if (projectId === null) return c.json({ error: "Invalid project ID" }, 400);

    const model = new GalleryModel(c.env.DB);
    const gallery = await model.listByProject(projectId);

    return c.json(gallery);
  },

  // Create a new gallery item
  async create(c: Context<{ Bindings: Bindings }>) {
    const body = validateGalleryBody(await readContentRecord(c.req.raw ?? c.req), false);
    if (body instanceof Response) return body;
    const model = new GalleryModel(c.env.DB);
    const newId = await model.create(body as unknown as GalleryCreate);
    const item = newId ? await model.getById(newId) : null;
    return c.json(item ?? { success: true }, item ? 201 : 200);
  },

  // Update a gallery item
  async update(c: Context<{ Bindings: Bindings }>) {
    const id = parsePositiveId(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid gallery item ID" }, 400);

    const body = validateGalleryBody(await readContentRecord(c.req.raw ?? c.req), true);
    if (body instanceof Response) return body;
    if (Object.keys(body).length === 0) return c.json({ error: "No changes provided" }, 400);
    const model = new GalleryModel(c.env.DB);
    const item = await model.update(id, body);
    return item ? c.json(item) : c.json({ error: "Gallery item not found" }, 404);
  },

  // Delete a gallery item
  async delete(c: Context<{ Bindings: Bindings }>) {
    const id = parsePositiveId(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid gallery item ID" }, 400);

    const model = new GalleryModel(c.env.DB);
    if (!(await model.getById(id))) return c.json({ error: "Gallery item not found" }, 404);
    await model.delete(id);
    return c.json({ success: true });
  },
};
