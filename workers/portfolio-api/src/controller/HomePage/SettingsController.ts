// workers/portfolio-api/src/controller/HomePage/SettingsController.ts
import type { Context } from "hono";
import type { Bindings } from "../../bindings";
import { SettingsModel } from "../../model/HomePage/SettingsModel";
import {
  asContentRecord,
  hasOnlyKnownKeys,
  parseBoundedText,
  readContentRecord,
} from "../../utils/contentValidation";

const SETTING_KEYS = ["key", "value"] as const;

function validateSettingBody(body: unknown): { key: string; value: string } | Response {
  const record = asContentRecord(body);
  if (!record || !hasOnlyKnownKeys(record, SETTING_KEYS)) {
    return Response.json(
      { error: "A setting object with key and value is required" },
      { status: 400 },
    );
  }
  const key = parseBoundedText(record.key, 100);
  const value =
    typeof record.value === "string" && record.value.length <= 20_000 ? record.value : null;
  if (key === null || value === null)
    return Response.json({ error: "key and value are required strings" }, { status: 400 });
  return { key, value };
}

export const SettingsController = {
  async list(c: Context<{ Bindings: Bindings }>) {
    const model = new SettingsModel(c.env.DB);
    return c.json(await model.listPublic());
  },

  async create(c: Context<{ Bindings: Bindings }>) {
    const setting = validateSettingBody(await readContentRecord(c.req.raw ?? c.req));
    if (setting instanceof Response) return setting;
    const model = new SettingsModel(c.env.DB);
    return c.json(await model.create(setting.key, setting.value));
  },

  async update(c: Context<{ Bindings: Bindings }>) {
    const setting = validateSettingBody(await readContentRecord(c.req.raw ?? c.req));
    if (setting instanceof Response) return setting;
    const model = new SettingsModel(c.env.DB);
    const saved = await model.update(setting.key, setting.value);
    return saved ? c.json(saved) : c.json({ error: "Setting not found" }, 404);
  },

  async delete(c: Context<{ Bindings: Bindings }>) {
    const key = c.req.param("key");
    if (!key || key.length > 100) return c.json({ error: "Key is invalid" }, 400);
    const model = new SettingsModel(c.env.DB);
    await model.delete(key);
    return c.json({ success: true });
  },
};
