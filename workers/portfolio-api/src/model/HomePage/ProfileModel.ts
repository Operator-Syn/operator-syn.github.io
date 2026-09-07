// workers/portfolio-api/src/model/HomePage/ProfileModel.ts
import type { D1Database } from "@cloudflare/workers-types";

export interface ProfileRow {
  id?: number;
  label: string;
  value: string;
  display_order: number;
}

export class ProfileModel {
  private db: D1Database;
  constructor(db: D1Database) {
    this.db = db;
  }

  async list() {
    const res = await this.db
      .prepare(
        "SELECT id, label, value, display_order FROM profile_info ORDER BY display_order, id",
      )
      .all<ProfileRow>();

    return res.results;
  }

  async getById(id: number) {
    return this.db
      .prepare("SELECT id, label, value, display_order FROM profile_info WHERE id=?")
      .bind(id)
      .first<ProfileRow>();
  }

  async create(label: string, value: string, display_order: number) {
    return this.db
      .prepare(
        "INSERT INTO profile_info (label, value, display_order) VALUES (?, ?, ?) RETURNING id, label, value, display_order",
      )
      .bind(label, value, display_order)
      .first<ProfileRow>();
  }

  // ADDED: display_order to the parameters and the SQL query
  async update(label: string, value: string, display_order: number) {
    return this.db
      .prepare(
        "UPDATE profile_info SET value=?, display_order=? WHERE label=? RETURNING id, label, value, display_order",
      )
      .bind(value, display_order, label)
      .first<ProfileRow>();
  }

  async updateById(
    id: number,
    changes: { label?: string; value?: string; display_order?: number },
  ) {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (changes.label !== undefined) {
      fields.push("label=?");
      values.push(changes.label);
    }
    if (changes.value !== undefined) {
      fields.push("value=?");
      values.push(changes.value);
    }
    if (changes.display_order !== undefined) {
      fields.push("display_order=?");
      values.push(changes.display_order);
    }
    if (fields.length === 0) return null;
    return this.db
      .prepare(
        `UPDATE profile_info SET ${fields.join(", ")} WHERE id=? RETURNING id, label, value, display_order`,
      )
      .bind(...values, id)
      .first<ProfileRow>();
  }

  async delete(label: string) {
    await this.db.prepare("DELETE FROM profile_info WHERE label=?").bind(label).run();
  }

  async deleteById(id: number) {
    await this.db.prepare("DELETE FROM profile_info WHERE id=?").bind(id).run();
  }
}
