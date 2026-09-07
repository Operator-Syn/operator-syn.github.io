import type { Context } from "hono";
import type { Bindings } from "../bindings";
import { hasOnlyKnownKeys, readContentRecord } from "../utils/contentValidation";

type OrderedItem = { id: number; display_order: number };

function parseItems(value: unknown): OrderedItem[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) return null;
  const seen = new Set<number>();
  const items: OrderedItem[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") return null;
    const row = candidate as { id?: unknown; display_order?: unknown };
    const id = row.id;
    const displayOrder = row.display_order;
    if (
      typeof id !== "number" ||
      !Number.isInteger(id) ||
      id < 1 ||
      typeof displayOrder !== "number" ||
      !Number.isInteger(displayOrder) ||
      displayOrder < 0 ||
      seen.has(id)
    ) {
      return null;
    }
    seen.add(id);
    items.push({ id, display_order: displayOrder });
  }
  return items;
}

async function reorder(c: Context<{ Bindings: Bindings }>, table: "Projects" | "Certificates") {
  const body = await readContentRecord(c.req.raw ?? c.req);
  if (!body || !hasOnlyKnownKeys(body, ["items"])) {
    return c.json({ error: "An ordering object with items is required" }, 400);
  }
  const items = parseItems(body.items);
  if (!items) return c.json({ error: "items must contain unique ordered records" }, 400);

  const placeholders = items.map(() => "?").join(",");
  const existing = await c.env.DB.prepare(`SELECT id FROM ${table} WHERE id IN (${placeholders})`)
    .bind(...items.map((item) => item.id))
    .all<{ id: number }>();
  if (existing.results.length !== items.length) {
    return c.json({ error: "One or more records were not found" }, 404);
  }

  await c.env.DB.batch(
    items.map((item) =>
      c.env.DB.prepare(`UPDATE ${table} SET display_order=? WHERE id=?`).bind(
        item.display_order,
        item.id,
      ),
    ),
  );
  return c.json({ success: true, items });
}

export const OrderingController = {
  projects: (c: Context<{ Bindings: Bindings }>) => reorder(c, "Projects"),
  certificates: (c: Context<{ Bindings: Bindings }>) => reorder(c, "Certificates"),
};
