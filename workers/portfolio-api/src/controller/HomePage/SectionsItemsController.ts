// workers/portfolio-api/src/controller/HomePage/SectionsItemsController.ts
import type { Context } from "hono";
import type { Bindings } from "../../bindings";
import { SectionItemsModel } from "../../model/HomePage/SectionItemsModel";
import {
  hasOnlyKnownKeys,
  parseNonNegativeInteger,
  parsePositiveId,
  readContentRecord,
} from "../../utils/contentValidation";
import { respondWithInternalError } from "../../utils/serverErrors";

const SECTION_ITEM_KEYS = [
  "id",
  "sectionId",
  "section_id",
  "label",
  "content",
  "image_url",
  "target_url",
  "order",
  "display_order",
] as const;

function nullableText(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined || value === null) return value;
  return typeof value === "string" && value.length <= maxLength ? value : undefined;
}

export const SectionItemsController = {
  async list(c: Context<{ Bindings: Bindings }>) {
    const sectionId = parsePositiveId(c.req.param("sectionId"));
    if (sectionId === null) return c.json({ error: "Invalid section ID" }, 400);
    const model = new SectionItemsModel(c.env.DB);
    return c.json(await model.list(sectionId));
  },

  async create(c: Context<{ Bindings: Bindings }>) {
    try {
      const body = await readContentRecord(c.req.raw ?? c.req);
      if (!body || !hasOnlyKnownKeys(body, SECTION_ITEM_KEYS)) {
        return c.json({ error: "Section item contains an unsupported field" }, 400);
      }

      const model = new SectionItemsModel(c.env.DB);

      const sectionId = parsePositiveId(body.sectionId ?? body.section_id);
      const order = parseNonNegativeInteger(body.display_order ?? body.order ?? 0);

      if (sectionId === null || order === null) {
        return c.json({ error: "sectionId and display_order are invalid" }, 400);
      }

      const label = nullableText(body.label, 200);
      const content = nullableText(body.content, 20_000);
      const imageUrl = nullableText(body.image_url, 2_048);
      const targetUrl = nullableText(body.target_url, 2_048);
      if (
        (body.label !== undefined && label === undefined) ||
        (body.content !== undefined && content === undefined) ||
        (body.image_url !== undefined && imageUrl === undefined) ||
        (body.target_url !== undefined && targetUrl === undefined)
      ) {
        return c.json({ error: "Section item text fields are invalid" }, 400);
      }

      const savedItem = await model.create(
        Number(sectionId),
        label ?? null,
        content ?? null,
        imageUrl ?? null,
        targetUrl ?? null,
        order,
      );

      return c.json(savedItem ?? { success: true });
    } catch (err: unknown) {
      return respondWithInternalError(c, "SectionItemsController.create", err);
    }
  },

  async update(c: Context<{ Bindings: Bindings }>) {
    try {
      const body = await readContentRecord(c.req.raw ?? c.req);
      if (!body || !hasOnlyKnownKeys(body, SECTION_ITEM_KEYS)) {
        return c.json({ error: "Section item contains an unsupported field" }, 400);
      }

      const model = new SectionItemsModel(c.env.DB);
      const id = parsePositiveId(c.req.param("id") ?? body.id);

      const order = parseNonNegativeInteger(body.display_order ?? body.order ?? 0);

      if (id === null || order === null) {
        return c.json({ error: "id is required for update" }, 400);
      }

      const label = nullableText(body.label, 200);
      const content = nullableText(body.content, 20_000);
      const imageUrl = nullableText(body.image_url, 2_048);
      const targetUrl = nullableText(body.target_url, 2_048);
      if (
        (body.label !== undefined && label === undefined) ||
        (body.content !== undefined && content === undefined) ||
        (body.image_url !== undefined && imageUrl === undefined) ||
        (body.target_url !== undefined && targetUrl === undefined)
      ) {
        return c.json({ error: "Section item text fields are invalid" }, 400);
      }

      const savedItem = await model.update(
        id,
        label ?? null,
        content ?? null,
        imageUrl ?? null,
        targetUrl ?? null,
        order,
      );

      return c.json(savedItem ?? { success: true });
    } catch (err: unknown) {
      return respondWithInternalError(c, "SectionItemsController.update", err);
    }
  },

  async delete(c: Context<{ Bindings: Bindings }>) {
    try {
      const id = parsePositiveId(c.req.param("id"));
      if (id === null) return c.json({ error: "Invalid item ID" }, 400);
      const model = new SectionItemsModel(c.env.DB);
      await model.delete(id);
      return c.json({ success: true });
    } catch (err: unknown) {
      return respondWithInternalError(c, "SectionItemsController.delete", err);
    }
  },
};
