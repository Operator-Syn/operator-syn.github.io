export type MediaType = "video" | "image";

export type ContentRecord = Record<string, unknown>;

export function asContentRecord(value: unknown): ContentRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as ContentRecord;
}

export async function readContentRecord(
  request: Pick<Request, "json">,
): Promise<ContentRecord | null> {
  try {
    return asContentRecord(await request.json());
  } catch {
    return null;
  }
}

export function parsePositiveId(value: unknown): number | null {
  if (typeof value === "string" && !/^\d+$/.test(value)) return null;
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "number") return null;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function parseBoundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 && text.length <= maxLength ? text : null;
}

export function parseOptionalText(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  return value.length <= maxLength ? value : null;
}

export function parseMediaType(value: unknown): MediaType | null {
  return value === "video" || value === "image" ? value : null;
}

export function hasOnlyKnownKeys(value: ContentRecord, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
