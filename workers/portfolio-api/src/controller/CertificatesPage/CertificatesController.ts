// workers/portfolio-api/src/controller/CertificatesPage/CertificatesController.ts

import type { Context } from "hono";
import type { Bindings } from "../../bindings";
import {
  type CertificateCreate,
  CertificatesModel,
} from "../../model/CertificatesPage/CertificatesModel";
import {
  asContentRecord,
  hasOnlyKnownKeys,
  parseBoundedText,
  parseMediaType,
  parseNonNegativeInteger,
  parseOptionalText,
  parsePositiveId,
  readContentRecord,
} from "../../utils/contentValidation";

const CERTIFICATE_KEYS = [
  "id",
  "created_at",
  "title",
  "type",
  "url",
  "short_description",
  "long_description",
  "certificate_link",
  "project_link",
  "display_order",
] as const;

function validateCertificateBody(
  body: unknown,
  partial: boolean,
): Record<string, unknown> | Response {
  const record = asContentRecord(body);
  if (!record || !hasOnlyKnownKeys(record, CERTIFICATE_KEYS)) {
    return Response.json({ error: "Certificate contains an unsupported field" }, { status: 400 });
  }
  const result: Record<string, unknown> = {};
  const requiredTextFields = ["title", "url", "short_description", "long_description"] as const;
  for (const field of requiredTextFields) {
    if (partial && record[field] === undefined) continue;
    const value = parseBoundedText(record[field], 20_000);
    if (value === null)
      return Response.json({ error: `${field} must be a non-empty string` }, { status: 400 });
    result[field] = value;
  }
  if (!partial && requiredTextFields.some((field) => result[field] === undefined)) {
    return Response.json({ error: "Certificate fields are incomplete" }, { status: 400 });
  }
  if (!partial || record.type !== undefined) {
    const type = parseMediaType(record.type);
    if (type === null)
      return Response.json({ error: "type must be image or video" }, { status: 400 });
    result.type = type;
  }
  if (record.certificate_link !== undefined || record.project_link !== undefined) {
    const link = record.certificate_link ?? record.project_link;
    const parsedLink = parseOptionalText(link, 2_048);
    if (parsedLink === null && link !== null && link !== "") {
      return Response.json({ error: "certificate_link must be a string" }, { status: 400 });
    }
    result.certificate_link = parsedLink || null;
  } else if (!partial) {
    result.certificate_link = null;
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

export const CertificatesController = {
  // List all certificates
  async listAll(c: Context<{ Bindings: Bindings }>) {
    const model = new CertificatesModel(c.env.DB);
    const certificates = await model.listAll();
    return c.json(certificates);
  },

  // Get single certificate by ID
  async getById(c: Context<{ Bindings: Bindings }>) {
    const id = parsePositiveId(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid ID" }, 400);

    const model = new CertificatesModel(c.env.DB);
    const cert = await model.getById(id);

    if (!cert) return c.json({ error: "Certificate not found" }, 404);
    return c.json(cert);
  },

  // Create a certificate
  async create(c: Context<{ Bindings: Bindings }>) {
    const body = validateCertificateBody(await readContentRecord(c.req.raw ?? c.req), false);
    if (body instanceof Response) return body;
    const model = new CertificatesModel(c.env.DB);
    const newId = await model.create(body as unknown as CertificateCreate);
    const cert = newId ? await model.getById(newId) : null;
    return c.json(cert ?? { success: true, id: newId }, cert ? 201 : 200);
  },

  // Update a certificate
  async update(c: Context<{ Bindings: Bindings }>) {
    const id = parsePositiveId(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid ID" }, 400);

    const body = validateCertificateBody(await readContentRecord(c.req.raw ?? c.req), true);
    if (body instanceof Response) return body;
    if (Object.keys(body).length === 0) return c.json({ error: "No changes provided" }, 400);
    const model = new CertificatesModel(c.env.DB);
    await model.update(id, body);
    const cert = await model.getById(id);
    return cert ? c.json(cert) : c.json({ error: "Certificate not found" }, 404);
  },

  // Delete a certificate
  async delete(c: Context<{ Bindings: Bindings }>) {
    const id = parsePositiveId(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid ID" }, 400);

    const model = new CertificatesModel(c.env.DB);
    if (!(await model.getById(id))) return c.json({ error: "Certificate not found" }, 404);
    await model.delete(id);
    return c.json({ success: true });
  },
};
