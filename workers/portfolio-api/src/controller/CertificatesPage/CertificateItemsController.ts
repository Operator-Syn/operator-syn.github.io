// workers/portfolio-api/src/controller/CertificatesPage/CertificateItemsController.ts

import type { Context } from "hono";
import type { Bindings } from "../../bindings";
import {
  type CertificateItemCreate,
  CertificateItemsModel,
} from "../../model/CertificatesPage/CertificateItemsModel";
import {
  asContentRecord,
  hasOnlyKnownKeys,
  parseBoundedText,
  parseMediaType,
  parseNonNegativeInteger,
  parsePositiveId,
  readContentRecord,
} from "../../utils/contentValidation";
import { logInternalError } from "../../utils/serverErrors";

type CertificateItemUpdatePayload = Partial<CertificateItemCreate> & {
  project_id?: number;
  certificate_id?: number;
};

const CERTIFICATE_ITEM_KEYS = [
  "id",
  "project_id",
  "certificate_id",
  "type",
  "url",
  "display_order",
] as const;

function validateItemBody(body: unknown, partial: boolean): Record<string, unknown> | Response {
  const record = asContentRecord(body);
  if (!record || !hasOnlyKnownKeys(record, CERTIFICATE_ITEM_KEYS)) {
    return Response.json(
      { error: "Certificate item contains an unsupported field" },
      { status: 400 },
    );
  }
  const result: Record<string, unknown> = {};
  if (!partial || record.type !== undefined) {
    const type = parseMediaType(record.type);
    if (type === null)
      return Response.json({ error: "type must be image or video" }, { status: 400 });
    result.type = type;
  }
  if (!partial || record.url !== undefined) {
    const url = parseBoundedText(record.url, 2_048);
    if (url === null)
      return Response.json({ error: "url must be a non-empty string" }, { status: 400 });
    result.url = url;
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

export const CertificateItemsController = {
  // List all items for a specific certificate
  async listByCertificate(c: Context<{ Bindings: Bindings }>) {
    const certId = parsePositiveId(c.req.param("certId"));
    if (certId === null) return c.json({ error: "Invalid certificate ID" }, 400);

    const model = new CertificateItemsModel(c.env.DB);
    const items = await model.listByCertificate(certId);

    return c.json(items);
  },

  // Create a new certificate gallery item
  async create(c: Context<{ Bindings: Bindings }>) {
    try {
      const body = await readContentRecord(c.req.raw ?? c.req);
      if (!body || !hasOnlyKnownKeys(body, CERTIFICATE_ITEM_KEYS)) {
        return c.json({ error: "Certificate item contains an unsupported field" }, 400);
      }

      // FIX: Map 'project_id' from frontend to 'certificate_id' for the database
      const certificateId = parsePositiveId(body.project_id ?? body.certificate_id);

      // Safety check to prevent NOT NULL constraint failures
      if (certificateId === null) {
        return c.json({ error: "Missing or invalid certificate_id/project_id" }, 400);
      }

      const validatedType = parseMediaType(body.type);
      const validatedUrl = parseBoundedText(body.url, 2_048);
      const validatedOrder = parseNonNegativeInteger(body.display_order ?? 0);
      if (validatedType === null || validatedUrl === null || validatedOrder === null) {
        return c.json({ error: "type, url, and display_order are invalid" }, 400);
      }

      const sanitizedData: CertificateItemCreate = {
        certificate_id: certificateId,
        type: validatedType,
        url: validatedUrl,
        display_order: validatedOrder,
      };

      const model = new CertificateItemsModel(c.env.DB);
      const newId = await model.create(sanitizedData);
      const item = newId ? await model.getById(newId) : null;

      return c.json(item ?? { success: true }, item ? 201 : 200);
    } catch (err: unknown) {
      logInternalError("CertificateItemsController.create", err);
      return c.json({ error: "Internal Server Error" }, 500);
    }
  },

  // Update a certificate gallery item
  async update(c: Context<{ Bindings: Bindings }>) {
    try {
      const id = parsePositiveId(c.req.param("id"));
      if (id === null) return c.json({ error: "Invalid item ID" }, 400);

      const body = validateItemBody(await c.req.json(), true);
      if (body instanceof Response) return body;
      if (Object.keys(body).length === 0) return c.json({ error: "No changes provided" }, 400);
      const model = new CertificateItemsModel(c.env.DB);
      const item = await model.update(id, body as CertificateItemUpdatePayload);
      return item ? c.json(item) : c.json({ error: "Certificate item not found" }, 404);
    } catch (err: unknown) {
      logInternalError("CertificateItemsController.update", err);
      return c.json({ error: "Update failed" }, 500);
    }
  },

  // Delete a certificate gallery item
  async delete(c: Context<{ Bindings: Bindings }>) {
    const id = parsePositiveId(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid item ID" }, 400);

    const model = new CertificateItemsModel(c.env.DB);
    if (!(await model.getById(id))) return c.json({ error: "Certificate item not found" }, 404);
    await model.delete(id);
    return c.json({ success: true });
  },
};
