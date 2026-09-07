// workers/portfolio-api/src/model/HomePage/SectionItemsModel.ts
import type { D1Database } from "@cloudflare/workers-types";

export interface SectionItemRow {
  id: number;
  section_id: number;
  label: string | null;
  content: string | null;
  image_url: string | null;
  target_url: string | null;
  display_order: number;
}

function normalizeOptionalUrl(value: string | null): string | null {
  return value === null ? null : value.trim();
}

export class SectionItemsModel {
  private db: D1Database;
  constructor(db: D1Database) {
    this.db = db;
  }

  async list(sectionId: number) {
    const res = await this.db
      .prepare(`
      SELECT id, section_id, label, content, image_url, target_url, display_order
      FROM section_items
      WHERE section_id=?
      ORDER BY display_order ASC, id ASC
    `)
      .bind(sectionId)
      .all<SectionItemRow>();
    return res.results;
  }

  async create(
    sectionId: number,
    label: string | null,
    content: string | null,
    image_url: string | null,
    target_url: string | null,
    order: number,
  ) {
    return this.db
      .prepare(`
      INSERT INTO section_items (section_id, label, content, image_url, target_url, display_order)
      VALUES (?, ?, ?, ?, ?, ?)
      RETURNING id, section_id, label, content, image_url, target_url, display_order
    `)
      .bind(
        sectionId,
        label ?? null,
        content ?? null,
        normalizeOptionalUrl(image_url),
        normalizeOptionalUrl(target_url),
        order ?? 0,
      )
      .first<SectionItemRow>();
  }

  // ADDED: display_order parameter here
  async update(
    id: number,
    label: string | null,
    content: string | null,
    image_url: string | null,
    target_url: string | null,
    display_order: number,
  ) {
    return this.db
      .prepare(`
      UPDATE section_items
      SET label=?, content=?, image_url=?, target_url=?, display_order=?
      WHERE id=?
      RETURNING id, section_id, label, content, image_url, target_url, display_order
    `)
      .bind(
        label ?? null,
        content ?? null,
        normalizeOptionalUrl(image_url),
        normalizeOptionalUrl(target_url),
        display_order,
        id,
      )
      .first<SectionItemRow>();
  }

  async delete(id: number) {
    await this.db.prepare("DELETE FROM section_items WHERE id=?").bind(id).run();
  }
}
