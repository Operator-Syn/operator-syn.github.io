// workers/portfolio-api/src/controller/SnippetsPage/SnippetsPageController.ts

import type { Context } from "hono";
import type { Bindings } from "../../bindings";
import { SnippetsPageModel } from "../../model/SnippetsPage/SnippetsPageModel";
import {
  hasOnlyKnownKeys,
  parsePositiveId as parseContentId,
  readContentRecord,
} from "../../utils/contentValidation";
import { logInternalError, respondWithInternalError } from "../../utils/serverErrors";

type AppContext = Context<{ Bindings: Bindings }>;

function parsePositiveId(value: string | undefined): number | null {
  return parseContentId(value);
}

function parseOptionalParentId(value: FormDataEntryValue | null): number | null {
  if (value === null || value === "") {
    return null;
  }

  if (value instanceof File) {
    throw new Error("Invalid parent_id");
  }

  const parentId = parseContentId(value);

  if (parentId === null) {
    throw new Error("Invalid parent_id");
  }

  return parentId;
}

function parseOptionalJsonParentId(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parentId = parseContentId(value);

  if (parentId === null) {
    throw new Error("Invalid parent_id");
  }

  return parentId;
}

function parseOptionalDisplayOrder(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === "") {
    throw new Error("Invalid display_order");
  }

  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("Invalid display_order");
  }

  return value;
}

export const createSnippetsPageController = (prefix = "snippets/") => ({
  // GET /api/snippets
  getSnippets: async (c: AppContext) => {
    try {
      const model = new SnippetsPageModel(c.env.DB, c.env.BUCKET, prefix);
      const data = await model.getFileTree();

      return c.json({
        success: true,
        data,
      });
    } catch (err: unknown) {
      return respondWithInternalError(c, "SnippetsPageController.getSnippets", err);
    }
  },

  // GET /api/snippets/:id
  getSnippet: async (c: AppContext) => {
    try {
      const id = parsePositiveId(c.req.param("id"));

      if (!id) {
        return c.json({ error: "Invalid ID" }, 400);
      }

      const model = new SnippetsPageModel(c.env.DB, c.env.BUCKET, prefix);
      const data = await model.getSnippetById(id);

      if (!data) {
        return c.json({ error: "Snippet not found" }, 404);
      }

      return c.json({
        success: true,
        data,
      });
    } catch (err: unknown) {
      return respondWithInternalError(c, "SnippetsPageController.getSnippet", err);
    }
  },

  // GET /api/v2/snippets/:id
  getSnippetDocument: async (c: AppContext) => {
    try {
      const id = parsePositiveId(c.req.param("id"));

      if (!id) {
        return c.json({ error: "Invalid ID" }, 400);
      }

      const model = new SnippetsPageModel(c.env.DB, c.env.BUCKET, prefix);
      const data = await model.getSnippetDocumentMetadata(id);

      if (!data) {
        return c.json({ error: "Snippet document not found" }, 404);
      }

      return c.json({ success: true, data });
    } catch (err: unknown) {
      return respondWithInternalError(c, "SnippetsPageController.getSnippetDocument", err);
    }
  },

  // GET /api/v2/snippets/:id/preview
  getSnippetPreview: async (c: AppContext) => {
    try {
      const id = parsePositiveId(c.req.param("id"));

      if (!id) {
        return c.json({ error: "Invalid ID" }, 400);
      }

      const model = new SnippetsPageModel(c.env.DB, c.env.BUCKET, prefix);
      const data = await model.getSnippetPreview(id);

      if (!data) {
        return c.json({ error: "Snippet preview not found" }, 404);
      }

      return c.json({ success: true, data });
    } catch (err: unknown) {
      return respondWithInternalError(c, "SnippetsPageController.getSnippetPreview", err);
    }
  },

  // GET /api/v2/snippets/:id/content
  streamSnippetDocument: async (c: AppContext) => {
    try {
      const id = parsePositiveId(c.req.param("id"));

      if (!id) {
        return c.json({ error: "Invalid ID" }, 400);
      }

      const model = new SnippetsPageModel(c.env.DB, c.env.BUCKET, prefix);
      const result = await model.getFileContent(id, "inline");

      if (!result) {
        return c.json({ error: "File not found" }, 404);
      }

      return c.body(result.stream as unknown as ReadableStream, 200, result.headers);
    } catch (err: unknown) {
      return respondWithInternalError(c, "SnippetsPageController.streamSnippetDocument", err);
    }
  },

  // GET /api/snippets/:id/content
  downloadSnippet: async (c: AppContext) => {
    try {
      const id = parsePositiveId(c.req.param("id"));

      if (!id) {
        return c.json({ error: "Invalid ID" }, 400);
      }

      const model = new SnippetsPageModel(c.env.DB, c.env.BUCKET, prefix);
      const result = await model.getFileContent(id);

      if (!result) {
        return c.json({ error: "File not found" }, 404);
      }

      return c.body(result.stream as unknown as ReadableStream, 200, result.headers);
    } catch (err: unknown) {
      return respondWithInternalError(c, "SnippetsPageController.downloadSnippet", err);
    }
  },

  // POST /api/snippets
  // application/json creates folder
  // multipart/form-data uploads file
  createSnippet: async (c: AppContext) => {
    try {
      const contentType = c.req.header("Content-Type") || "";
      const model = new SnippetsPageModel(c.env.DB, c.env.BUCKET, prefix);

      if (contentType.includes("application/json")) {
        const body = await readContentRecord(c.req.raw ?? c.req);
        if (!body || !hasOnlyKnownKeys(body, ["name", "parent_id"])) {
          return c.json({ error: "Folder payload contains an unsupported field" }, 400);
        }

        if (typeof body.name !== "string" || body.name.length > 200) {
          return c.json({ error: "Name is required" }, 400);
        }
        const name = body.name.trim();

        if (!name) {
          return c.json({ error: "Name is required" }, 400);
        }

        const parentId = parseOptionalJsonParentId(body.parent_id);
        const folder = await model.createFolder(name, parentId);

        return c.json(
          {
            success: true,
            data: folder,
          },
          201,
        );
      }

      if (contentType.includes("multipart/form-data")) {
        const formData = await c.req.formData();

        const file = formData.get("file");
        const parentIdRaw = formData.get("parent_id");

        if (!file || !(file instanceof File)) {
          return c.json({ error: "No file provided" }, 400);
        }

        const parentId = parseOptionalParentId(parentIdRaw);
        const uploaded = await model.uploadFile(file, parentId);

        return c.json(
          {
            success: true,
            data: uploaded,
          },
          201,
        );
      }

      return c.json({ error: "Unsupported Content-Type" }, 415);
    } catch (err: unknown) {
      logInternalError("SnippetsPageController.createSnippet", err);
      return c.json({ error: "Creation failed" }, 500);
    }
  },

  // PATCH /api/snippets/:id
  updateSnippet: async (c: AppContext) => {
    try {
      const id = parsePositiveId(c.req.param("id"));

      if (!id) {
        return c.json({ error: "Invalid ID" }, 400);
      }

      const body = await readContentRecord(c.req.raw ?? c.req);
      if (!body || !hasOnlyKnownKeys(body, ["name", "parent_id", "display_order"])) {
        return c.json({ error: "Snippet payload contains an unsupported field" }, 400);
      }

      if (body.name !== undefined && (typeof body.name !== "string" || body.name.length > 200)) {
        return c.json({ error: "Name is invalid" }, 400);
      }
      const name = body.name === undefined ? undefined : body.name.trim();
      const parentId =
        body.parent_id === undefined ? undefined : parseOptionalJsonParentId(body.parent_id);
      const displayOrder = parseOptionalDisplayOrder(body.display_order);

      if (name === undefined && parentId === undefined && displayOrder === undefined) {
        return c.json({ error: "No changes provided" }, 400);
      }

      if (name !== undefined && name.length === 0) {
        return c.json({ error: "Name cannot be empty" }, 400);
      }

      const model = new SnippetsPageModel(c.env.DB, c.env.BUCKET, prefix);

      const updated = await model.updateNode(id, {
        name,
        parent_id: parentId,
        display_order: displayOrder,
      });

      if (!updated) {
        return c.json({ error: "Snippet not found" }, 404);
      }

      return c.json({
        success: true,
        data: updated,
      });
    } catch (err: unknown) {
      logInternalError("SnippetsPageController.updateSnippet", err);
      return c.json({ error: "Update failed" }, 500);
    }
  },

  // DELETE /api/snippets/:id
  deleteSnippet: async (c: AppContext) => {
    try {
      const id = parsePositiveId(c.req.param("id"));

      if (!id) {
        return c.json({ error: "Invalid ID" }, 400);
      }

      const model = new SnippetsPageModel(c.env.DB, c.env.BUCKET, prefix);
      const deleted = await model.deleteNode(id);

      if (!deleted) {
        return c.json({ error: "Snippet not found" }, 404);
      }

      return c.json({
        success: true,
        message: `Snippet ${id} deleted.`,
      });
    } catch (err: unknown) {
      return respondWithInternalError(c, "SnippetsPageController.deleteSnippet", err);
    }
  },
});

// Backward-compatible export, like your MediaController.
export const SnippetsPageController = createSnippetsPageController("snippets/");
