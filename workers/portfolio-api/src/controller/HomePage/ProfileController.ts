// workers/portfolio-api/src/controller/HomePage/ProfileController.ts
import type { Context } from "hono";
import type { Bindings } from "../../bindings";
import { ProfileModel } from "../../model/HomePage/ProfileModel";
import {
  asContentRecord,
  hasOnlyKnownKeys,
  parseBoundedText,
  parseNonNegativeInteger,
  parsePositiveId,
  readContentRecord,
} from "../../utils/contentValidation";

const PROFILE_KEYS = ["id", "label", "value", "display_order"] as const;

function validateProfileBody(body: unknown, partial: boolean): Record<string, unknown> | Response {
  const record = asContentRecord(body);
  if (!record || !hasOnlyKnownKeys(record, PROFILE_KEYS)) {
    return Response.json({ error: "Profile contains an unsupported field" }, { status: 400 });
  }
  const result: Record<string, unknown> = {};
  if (!partial || record.label !== undefined) {
    const label = parseBoundedText(record.label, 200);
    if (label === null)
      return Response.json({ error: "label must be a non-empty string" }, { status: 400 });
    result.label = label;
  }
  if (!partial || record.value !== undefined) {
    if (typeof record.value !== "string" || record.value.length > 20_000) {
      return Response.json({ error: "value must be a string" }, { status: 400 });
    }
    result.value = record.value;
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

export const ProfileController = {
  async list(c: Context<{ Bindings: Bindings }>) {
    const model = new ProfileModel(c.env.DB);
    return c.json(await model.list());
  },

  async create(c: Context<{ Bindings: Bindings }>) {
    const body = validateProfileBody(await readContentRecord(c.req.raw ?? c.req), false);
    if (body instanceof Response) return body;
    const model = new ProfileModel(c.env.DB);
    return c.json(
      await model.create(body.label as string, body.value as string, body.display_order as number),
    );
  },

  async update(c: Context<{ Bindings: Bindings }>) {
    const body = validateProfileBody(await readContentRecord(c.req.raw ?? c.req), false);
    if (body instanceof Response) return body;
    const model = new ProfileModel(c.env.DB);
    const saved = await model.update(
      body.label as string,
      body.value as string,
      body.display_order as number,
    );
    return saved ? c.json(saved) : c.json({ error: "Profile not found" }, 404);
  },

  async updateById(c: Context<{ Bindings: Bindings }>) {
    const id = parsePositiveId(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid profile ID" }, 400);
    const body = validateProfileBody(await readContentRecord(c.req.raw ?? c.req), true);
    if (body instanceof Response) return body;
    delete body.id;
    if (Object.keys(body).length === 0) return c.json({ error: "No changes provided" }, 400);
    const model = new ProfileModel(c.env.DB);
    const saved = await model.updateById(
      id,
      body as { label?: string; value?: string; display_order?: number },
    );
    if (!saved) return c.json({ error: "Profile not found" }, 404);
    return c.json(saved);
  },

  async delete(c: Context<{ Bindings: Bindings }>) {
    // Note: ensure your useAdminHomeData.ts wraps the label in encodeURIComponent(label)
    // when making the DELETE request, otherwise labels with spaces will 404!
    const label = c.req.param("label");
    // Minimal change: Guard clause to ensure label is a string
    if (!label) return c.json({ error: "Label is required" }, 400);

    // Numeric path segments use the stable ID contract. Keep the label route
    // behavior for older dashboard clients during the compatibility window.
    if (/^\d+$/.test(label)) {
      const id = parsePositiveId(label);
      if (id === null) return c.json({ error: "Invalid profile ID" }, 400);
      const model = new ProfileModel(c.env.DB);
      if (!(await model.getById(id))) return c.json({ error: "Profile not found" }, 404);
      await model.deleteById(id);
      return c.json({ success: true });
    }

    const model = new ProfileModel(c.env.DB);
    await model.delete(label);
    return c.json({ success: true });
  },

  async deleteById(c: Context<{ Bindings: Bindings }>) {
    const id = parsePositiveId(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid profile ID" }, 400);
    const model = new ProfileModel(c.env.DB);
    if (!(await model.getById(id))) return c.json({ error: "Profile not found" }, 404);
    await model.deleteById(id);
    return c.json({ success: true });
  },
};
