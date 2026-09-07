// workers/portfolio-api/src/controller/HomePage/SectionsController.ts
import type { Context } from "hono";
import type { Bindings } from "../../bindings";
import { SectionsModel } from "../../model/HomePage/SectionsModel";
import {
  asContentRecord,
  hasOnlyKnownKeys,
  parseBoundedText,
  parseNonNegativeInteger,
  parsePositiveId,
  readContentRecord,
} from "../../utils/contentValidation";

const SECTION_KEYS = ["id", "title", "section_type", "order", "display_order"] as const;

function validateSectionBody(body: unknown, partial: boolean): Record<string, unknown> | Response {
  const record = asContentRecord(body);
  if (!record || !hasOnlyKnownKeys(record, SECTION_KEYS)) {
    return Response.json({ error: "Section contains an unsupported field" }, { status: 400 });
  }
  const result: Record<string, unknown> = {};
  if (!partial || record.title !== undefined) {
    const title = parseBoundedText(record.title, 200);
    if (title === null)
      return Response.json({ error: "title must be a non-empty string" }, { status: 400 });
    result.title = title;
  }
  if (!partial || record.section_type !== undefined) {
    const type = parseBoundedText(record.section_type, 100);
    if (type === null)
      return Response.json({ error: "section_type must be a non-empty string" }, { status: 400 });
    result.section_type = type;
  }
  const orderValue = record.display_order ?? record.order;
  if (!partial || orderValue !== undefined) {
    const order = parseNonNegativeInteger(orderValue ?? 0);
    if (order === null)
      return Response.json(
        { error: "display_order must be a non-negative integer" },
        { status: 400 },
      );
    result.display_order = order;
  }
  return result;
}

export const SectionsController = {
  async list(c: Context<{ Bindings: Bindings }>) {
    const model = new SectionsModel(c.env.DB);
    return c.json(await model.list());
  },

  async create(c: Context<{ Bindings: Bindings }>) {
    const body = validateSectionBody(await readContentRecord(c.req.raw ?? c.req), false);
    if (body instanceof Response) return body;
    const model = new SectionsModel(c.env.DB);
    return c.json(
      await model.create(
        body.title as string,
        body.section_type as string,
        body.display_order as number,
      ),
    );
  },

  async update(c: Context<{ Bindings: Bindings }>) {
    const body = await readContentRecord(c.req.raw ?? c.req);
    if (!body) return c.json({ error: "A section object is required" }, 400);
    const id = parsePositiveId(body.id);
    if (id === null) return c.json({ error: "id must be a positive integer" }, 400);
    const validated = validateSectionBody(body, true);
    if (validated instanceof Response) return validated;
    const title = validated.title;
    const sectionType = validated.section_type;
    const displayOrder = validated.display_order;
    if (
      typeof title !== "string" ||
      typeof sectionType !== "string" ||
      typeof displayOrder !== "number"
    ) {
      return c.json({ error: "Section fields are incomplete" }, 400);
    }
    const model = new SectionsModel(c.env.DB);
    const saved = await model.update(id, title, sectionType, displayOrder);
    return saved ? c.json(saved) : c.json({ error: "Section not found" }, 404);
  },

  async delete(c: Context<{ Bindings: Bindings }>) {
    const id = parsePositiveId(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid section ID" }, 400);
    const model = new SectionsModel(c.env.DB);
    const existing = (await model.list()).some((section) => section.id === id);
    if (!existing) return c.json({ error: "Section not found" }, 404);
    await model.delete(id);
    return c.json({ success: true });
  },
};
