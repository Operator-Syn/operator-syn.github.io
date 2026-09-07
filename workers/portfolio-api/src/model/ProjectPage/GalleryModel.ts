// workers/portfolio-api/src/model/ProjectPage/GalleryModel.ts
import type { D1Database } from "@cloudflare/workers-types";

export interface GalleryItem {
  id: number;
  project_id: number;
  type: "video" | "image";
  url: string;
  display_order: number;
}

export interface GalleryCreate {
  project_id: number;
  type: "video" | "image";
  url: string;
  display_order?: number;
}

type GalleryRow = {
  id: number;
  project_id: number;
  type: "video" | "image";
  url: string;
  display_order: number;
};

export class GalleryModel {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async listByProject(project_id: number): Promise<GalleryItem[]> {
    const query = `
      SELECT id, project_id, type, url, display_order
      FROM GalleryItems
      WHERE project_id = ?
      ORDER BY display_order ASC, id ASC
    `;

    const { results } = await this.db.prepare(query).bind(project_id).all<GalleryRow>();

    if (!results || results.length === 0) {
      return [];
    }

    return results.map((r) => ({
      id: Number(r.id),
      project_id: Number(r.project_id),
      type: r.type === "video" ? "video" : "image",
      url: String(r.url),
      display_order: Number(r.display_order),
    }));
  }

  async getById(id: number): Promise<GalleryItem | null> {
    const query = `
      SELECT id, project_id, type, url, display_order
      FROM GalleryItems
      WHERE id = ?
    `;

    const row = await this.db.prepare(query).bind(id).first<GalleryRow>();

    if (!row) {
      return null;
    }

    return {
      id: Number(row.id),
      project_id: Number(row.project_id),
      type: row.type === "video" ? "video" : "image",
      url: String(row.url),
      display_order: Number(row.display_order),
    };
  }

  async create(item: GalleryCreate): Promise<number> {
    const query = `
      INSERT INTO GalleryItems (project_id, type, url, display_order)
      VALUES (?, ?, ?, ?)
      RETURNING id
    `;

    const result = await this.db
      .prepare(query)
      .bind(item.project_id, item.type, item.url, item.display_order ?? 0)
      .first<{ id: number }>();

    return result?.id ? Number(result.id) : 0;
  }

  async update(
    id: number,
    item: Partial<Omit<GalleryCreate, "project_id">>,
  ): Promise<GalleryItem | null> {
    const fields: string[] = [];
    const values: unknown[] = [];

    const allowedKeys = new Set(["type", "url", "display_order"]);

    for (const [key, value] of Object.entries(item)) {
      if (!allowedKeys.has(key)) continue;
      fields.push(`${key} = ?`);
      values.push(value);
    }

    if (fields.length === 0) {
      return null;
    }

    const query = `
      UPDATE GalleryItems
      SET ${fields.join(", ")}
      WHERE id = ?
    `;

    await this.db
      .prepare(query)
      .bind(...values, id)
      .run();

    return (await this.getById(id)) ?? null;
  }

  async delete(id: number): Promise<void> {
    await this.db.prepare(`DELETE FROM GalleryItems WHERE id = ?`).bind(id).run();
  }
}
