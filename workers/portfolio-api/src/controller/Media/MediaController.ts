// workers/portfolio-api/src/controller/Media/MediaController.ts

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Context } from "hono";
import type { Bindings } from "../../bindings";
import { hasOnlyKnownKeys, readContentRecord } from "../../utils/contentValidation";
import { respondWithInternalError } from "../../utils/serverErrors";

const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

function isAllowedMediaType(value: unknown): value is string {
  return typeof value === "string" && /^(image|video)\/[a-z0-9.+-]+$/i.test(value);
}

function sanitizeFileName(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) return null;
  const sanitized = value.replace(/[^a-z0-9.]/gi, "_").toLowerCase();
  return sanitized === "." || sanitized === ".." ? null : sanitized;
}

function isSafeKey(key: string, prefix: string): boolean {
  return key.startsWith(prefix) && !key.includes("..") && !key.includes("\\");
}

// Factory function to create a controller for a specific bucket directory
export const createMediaController = (prefix: string) => ({
  list: async (c: Context<{ Bindings: Bindings }>) => {
    try {
      const objects = await c.env.BUCKET.list({ prefix });
      const fileList = objects.objects
        .filter((obj) => obj.size > 0)
        .map((obj) => ({
          key: obj.key,
          size: obj.size,
          uploaded: obj.uploaded,
          url: `${c.env.VITE_CDN_URL}/${obj.key}`,
        }));
      return c.json({ success: true, data: fileList });
    } catch (err: unknown) {
      return respondWithInternalError(c, "MediaController.list", err);
    }
  },

  upload: async (c: Context<{ Bindings: Bindings }>) => {
    try {
      const formData = await c.req.formData();
      const file = formData.get("file");
      if (!file || !(file instanceof File)) return c.json({ error: "No file provided" }, 400);
      if (file.size > MAX_MEDIA_BYTES)
        return c.json({ error: "File exceeds the 100 MB limit" }, 413);
      if (!isAllowedMediaType(file.type))
        return c.json({ error: "Only image and video files are supported" }, 415);

      const safeName = sanitizeFileName(file.name);
      if (!safeName) return c.json({ error: "Filename is invalid" }, 400);
      const key = `${prefix}${crypto.randomUUID()}-${safeName}`;

      const arrayBuffer = await file.arrayBuffer();
      await c.env.BUCKET.put(key, arrayBuffer, { httpMetadata: { contentType: file.type } });

      return c.json({ success: true, url: `${c.env.VITE_CDN_URL}/${key}`, key }, 201);
    } catch (err: unknown) {
      return respondWithInternalError(c, "MediaController.upload", err);
    }
  },

  presign: async (c: Context<{ Bindings: Bindings }>) => {
    try {
      const body = await readContentRecord(c.req.raw ?? c.req);
      if (!body || !hasOnlyKnownKeys(body, ["filename", "contentType"])) {
        return c.json({ error: "filename and contentType are required" }, 400);
      }
      const safeName = sanitizeFileName(body.filename);
      if (!safeName) return c.json({ error: "Filename is invalid" }, 400);
      if (!isAllowedMediaType(body.contentType))
        return c.json({ error: "Only image and video files are supported" }, 415);

      const key = `${prefix}${crypto.randomUUID()}-${safeName}`;

      const client = new S3Client({
        region: "auto",
        requestChecksumCalculation: "WHEN_REQUIRED",
        endpoint: `https://${c.env.ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: c.env.R2_ACCESS_KEY_ID,
          secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
        },
      });

      const command = new PutObjectCommand({
        Bucket: c.env.R2_BUCKET_NAME,
        Key: key,
        ContentType: body.contentType,
      });

      const uploadUrl = await getSignedUrl(client, command, { expiresIn: 300 });
      c.header("Cache-Control", "no-store");
      return c.json({ success: true, uploadUrl, publicUrl: `${c.env.VITE_CDN_URL}/${key}`, key });
    } catch (err: unknown) {
      return respondWithInternalError(c, "MediaController.presign", err);
    }
  },

  get: async (c: Context<{ Bindings: Bindings }>) => {
    const key = c.req.param("key");
    if (!key || !isSafeKey(key, prefix)) return c.json({ error: "Key is invalid" }, 400);

    const object = await c.env.BUCKET.get(key);
    if (!object) return c.json({ error: "Object not found" }, 404);

    return c.json({
      key: object.key,
      size: object.size,
      contentType: object.httpMetadata?.contentType,
      uploaded: object.uploaded,
      url: `${c.env.VITE_CDN_URL}/${object.key}`,
    });
  },

  update: async (c: Context<{ Bindings: Bindings }>) => {
    try {
      const key = c.req.param("key");
      if (!key || !isSafeKey(key, prefix)) return c.json({ error: "Key is invalid" }, 400);

      const formData = await c.req.formData();
      const file = formData.get("file");
      if (!file || !(file instanceof File))
        return c.json({ error: "No replacement file provided" }, 400);
      if (file.size > MAX_MEDIA_BYTES)
        return c.json({ error: "File exceeds the 100 MB limit" }, 413);
      if (!isAllowedMediaType(file.type))
        return c.json({ error: "Only image and video files are supported" }, 415);

      const arrayBuffer = await file.arrayBuffer();
      await c.env.BUCKET.put(key, arrayBuffer, { httpMetadata: { contentType: file.type } });
      return c.json({ success: true, url: `${c.env.VITE_CDN_URL}/${key}` });
    } catch (err: unknown) {
      return respondWithInternalError(c, "MediaController.update", err);
    }
  },

  delete: async (c: Context<{ Bindings: Bindings }>) => {
    try {
      const key = c.req.param("key");
      if (!key || !isSafeKey(key, prefix)) return c.json({ error: "Key is invalid" }, 400);

      const object = await c.env.BUCKET.head(key);
      if (!object) return c.json({ error: "Resource not found" }, 404);
      await c.env.BUCKET.delete(key);
      return c.json({ success: true, message: `Asset ${key} deleted.` });
    } catch (err: unknown) {
      return respondWithInternalError(c, "MediaController.delete", err);
    }
  },
});

// For backward compatibility with existing imports
export const MediaController = createMediaController("Projects/");
