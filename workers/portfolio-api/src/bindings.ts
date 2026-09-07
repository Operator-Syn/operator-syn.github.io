import type { D1Database, Fetcher, R2Bucket } from "@cloudflare/workers-types";

export type Bindings = {
  DB: D1Database;
  BUCKET: R2Bucket;
  AUTH_WORKER: Fetcher;
  /** Server-held credential used by the admin gateway service binding. */
  ADMIN_INTERNAL_KEY: string;
  VITE_CDN_URL: string;
  ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
};
