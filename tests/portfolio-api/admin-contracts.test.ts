import assert from "node:assert/strict";
import { test } from "node:test";
import type { Context } from "hono";
import type { Bindings } from "../../workers/portfolio-api/src/bindings.ts";
import { CertificateItemsController } from "../../workers/portfolio-api/src/controller/CertificatesPage/CertificateItemsController.ts";
import { ProfileController } from "../../workers/portfolio-api/src/controller/HomePage/ProfileController.ts";
import { createMediaController } from "../../workers/portfolio-api/src/controller/Media/MediaController.ts";
import { OrderingController } from "../../workers/portfolio-api/src/controller/OrderingController.ts";
import { ProjectsController } from "../../workers/portfolio-api/src/controller/ProjectPage/ProjectsController.ts";

function context(
  body: unknown,
  params: Record<string, string> = {},
  database = {},
): Context<{ Bindings: Bindings }> {
  return {
    env: { DB: database },
    req: {
      json: async () => body,
      param: (name: string) => params[name],
    },
    json(value: unknown, status = 200) {
      return Response.json(value, { status });
    },
  } as unknown as Context<{ Bindings: Bindings }>;
}

test("project writes reject unknown fields and invalid values before SQL", async () => {
  const unknownField = await ProjectsController.update(
    context({ title: "Valid", injected: "nope" }, { id: "1" }),
  );
  assert.equal((unknownField as Response).status, 400);

  const invalidType = await ProjectsController.update(context({ type: "archive" }, { id: "1" }));
  assert.equal((invalidType as Response).status, 400);

  const invalidId = await ProjectsController.delete(context({}, { id: "0" }));
  assert.equal((invalidId as Response).status, 400);
});

test("profile and certificate-item writes reject coerced object values", async () => {
  const profile = await ProfileController.updateById(
    context({ value: { secret: "object" } }, { id: "1" }),
  );
  assert.equal((profile as Response).status, 400);

  const item = await CertificateItemsController.create(
    context({ project_id: 1, type: "image", url: "", display_order: 0 }),
  );
  assert.equal((item as Response).status, 400);

  const invalidItemId = await CertificateItemsController.update(
    context({ url: "https://example.com/item" }, { id: "1.5" }),
  );
  assert.equal((invalidItemId as Response).status, 400);
});

test("ordering accepts only numeric unique IDs and batches updates", async () => {
  const invalidDatabase = {
    prepare() {
      throw new Error("database should not be read for invalid payload");
    },
  };
  const invalid = await OrderingController.projects(
    context({ items: [{ id: "1", display_order: 0 }] }, {}, invalidDatabase),
  );
  assert.equal((invalid as Response).status, 400);

  let batchCalls = 0;
  const database = {
    prepare() {
      return {
        bind: (...args: unknown[]) => ({
          all: async () => ({ results: args.map((id) => ({ id })) }),
        }),
      };
    },
    async batch() {
      batchCalls += 1;
      return [];
    },
  };
  const ordered = await OrderingController.projects(
    context(
      {
        items: [
          { id: 1, display_order: 0 },
          { id: 2, display_order: 1 },
        ],
      },
      {},
      database,
    ),
  );
  assert.equal((ordered as Response).status, 200);
  assert.equal(batchCalls, 1);
});

test("media keys cannot escape their controller prefix", async () => {
  const controller = createMediaController("Projects/");
  const response = await controller.get(
    context({}, { key: "Certificates/other.mp4" }, { BUCKET: {} }),
  );
  assert.equal((response as Response).status, 400);
});
