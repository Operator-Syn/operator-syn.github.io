// workers/portfolio-api/src/controller/ProjectPage/ProjectsController.ts
import type { Context } from "hono";
import type { Bindings } from "../../bindings";
import { type ProjectCreate, ProjectsModel } from "../../model/ProjectPage/ProjectsModel";
import {
  asContentRecord,
  hasOnlyKnownKeys,
  parseBoundedText,
  parseMediaType,
  parseNonNegativeInteger,
  parsePositiveId,
  readContentRecord,
} from "../../utils/contentValidation";

const PROJECT_KEYS = [
  "id",
  "created_at",
  "title",
  "type",
  "url",
  "short_description",
  "long_description",
  "project_link",
  "display_order",
] as const;

function validateProjectBody(body: unknown, partial: boolean): Record<string, unknown> | Response {
  const record = asContentRecord(body);
  if (!record || !hasOnlyKnownKeys(record, PROJECT_KEYS)) {
    return Response.json({ error: "Project contains an unsupported field" }, { status: 400 });
  }

  const result: Record<string, unknown> = {};
  const requiredTextFields = [
    "title",
    "url",
    "short_description",
    "long_description",
    "project_link",
  ] as const;
  for (const field of requiredTextFields) {
    if (partial && record[field] === undefined) continue;
    const value = parseBoundedText(record[field], 20_000);
    if (value === null)
      return Response.json({ error: `${field} must be a non-empty string` }, { status: 400 });
    result[field] = value;
  }
  if (!partial && requiredTextFields.some((field) => result[field] === undefined)) {
    return Response.json({ error: "Project fields are incomplete" }, { status: 400 });
  }
  if (!partial || record.type !== undefined) {
    const type = parseMediaType(record.type);
    if (type === null)
      return Response.json({ error: "type must be image or video" }, { status: 400 });
    result.type = type;
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

export const ProjectsController = {
  async list(c: Context<{ Bindings: Bindings }>) {
    const model = new ProjectsModel(c.env.DB);
    const projects = await model.listAll();
    return c.json(projects);
  },

  async get(c: Context<{ Bindings: Bindings }>) {
    const id = parsePositiveId(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid project ID" }, 400);
    const model = new ProjectsModel(c.env.DB);
    const project = await model.getById(id);
    if (!project) return c.json({ error: "Project not found" }, 404);
    return c.json(project);
  },

  async create(c: Context<{ Bindings: Bindings }>) {
    const body = validateProjectBody(await readContentRecord(c.req.raw ?? c.req), false);
    if (body instanceof Response) return body;
    const model = new ProjectsModel(c.env.DB);
    const newId = await model.create(body as unknown as ProjectCreate);
    const project = newId ? await model.getById(newId) : null;
    return c.json(project ?? { success: true }, project ? 201 : 200);
  },

  async update(c: Context<{ Bindings: Bindings }>) {
    const id = parsePositiveId(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid project ID" }, 400);
    const body = validateProjectBody(await readContentRecord(c.req.raw ?? c.req), true);
    if (body instanceof Response) return body;
    if (Object.keys(body).length === 0) return c.json({ error: "No changes provided" }, 400);
    const model = new ProjectsModel(c.env.DB);
    await model.update(id, body);
    const project = await model.getById(id);
    return project ? c.json(project) : c.json({ error: "Project not found" }, 404);
  },

  async delete(c: Context<{ Bindings: Bindings }>) {
    const id = parsePositiveId(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid project ID" }, 400);
    const model = new ProjectsModel(c.env.DB);
    if (!(await model.getById(id))) return c.json({ error: "Project not found" }, 404);
    await model.delete(id);
    return c.json({ success: true });
  },
};
