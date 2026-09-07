// workers/portfolio-api/src/model/CertificatesPage/CertificateItemsModel.ts
import type { D1Database } from "@cloudflare/workers-types";

export interface CertificateItem {
  id: number;
  certificate_id: number;
  type: "video" | "image";
  url: string;
  display_order: number;
}

export interface CertificateItemCreate {
  certificate_id: number;
  type: "video" | "image";
  url: string;
  display_order?: number;
}

type CertificateItemRow = {
  id: number;
  certificate_id: number;
  type: "video" | "image";
  url: string;
  display_order: number;
};

export class CertificateItemsModel {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async listByCertificate(certificate_id: number): Promise<CertificateItem[]> {
    const query = `
      SELECT id, certificate_id, type, url, display_order
      FROM CertificateItems
      WHERE certificate_id = ?
      ORDER BY display_order ASC, id ASC
    `;

    const { results } = await this.db.prepare(query).bind(certificate_id).all<CertificateItemRow>();

    if (!results || results.length === 0) {
      return [];
    }

    return results.map((r) => ({
      id: Number(r.id),
      certificate_id: Number(r.certificate_id),
      type: r.type === "video" ? "video" : "image",
      url: String(r.url),
      display_order: Number(r.display_order),
    }));
  }

  async getById(id: number): Promise<CertificateItem | null> {
    const query = `
      SELECT id, certificate_id, type, url, display_order
      FROM CertificateItems
      WHERE id = ?
    `;

    const row = await this.db.prepare(query).bind(id).first<CertificateItemRow>();

    if (!row) {
      return null;
    }

    return {
      id: Number(row.id),
      certificate_id: Number(row.certificate_id),
      type: row.type === "video" ? "video" : "image",
      url: String(row.url),
      display_order: Number(row.display_order),
    };
  }

  async create(item: CertificateItemCreate): Promise<number> {
    const query = `
      INSERT INTO CertificateItems (certificate_id, type, url, display_order)
      VALUES (?, ?, ?, ?)
      RETURNING id
    `;

    const result = await this.db
      .prepare(query)
      .bind(item.certificate_id, item.type, item.url, item.display_order ?? 0)
      .first<{ id: number }>();

    return result?.id ? Number(result.id) : 0;
  }

  async update(
    id: number,
    item: Partial<Omit<CertificateItemCreate, "certificate_id">>,
  ): Promise<CertificateItem | null> {
    const fields: string[] = [];
    const values: unknown[] = [];

    const allowedKeys = new Set(["type", "url", "display_order"]);

    for (const [key, value] of Object.entries(item)) {
      if (!allowedKeys.has(key)) continue;
      fields.push(`${key} = ?`);
      values.push(value);
    }

    if (fields.length === 0) return null;

    const query = `
      UPDATE CertificateItems
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
    await this.db.prepare(`DELETE FROM CertificateItems WHERE id = ?`).bind(id).run();
  }
}
