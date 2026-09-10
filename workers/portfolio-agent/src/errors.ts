import { MODEL_CAPACITY_MESSAGE } from "./config.ts";

type ErrorRecord = Record<string, unknown>;

export type ModelCapacityClass = "account-allocation" | "out-of-capacity";

export type ModelCapacityClassification = {
  class: ModelCapacityClass;
  code: 3036 | 3040 | 4006 | null;
};

function asRecord(value: unknown): ErrorRecord | null {
  return value && typeof value === "object" ? (value as ErrorRecord) : null;
}

function capacityCode(record: ErrorRecord): ModelCapacityClassification["code"] {
  const data = asRecord(record.data);
  const values = [record.workersAIErrorCode, record.code, data?.workersAIErrorCode, data?.code];
  for (const value of values) {
    if (value === 3036 || value === "3036" || value === 4006 || value === "4006") {
      return value === 3036 || value === "3036" ? 3036 : 4006;
    }
    if (value === 3040 || value === "3040") return 3040;
  }
  return null;
}

function capacityClassFromMessage(value: unknown): ModelCapacityClass | null {
  if (typeof value !== "string") return null;
  if (
    /\b(?:3036|4006)\b|daily(?:\s+\w+){0,3}\s+allocation|used\s+up.*(?:allocation|neurons?)/i.test(
      value,
    )
  ) {
    return "account-allocation";
  }
  if (
    /\b3040\b|out\s+of\s+capacity|maximum(?:\s+daily)?\s+capacity|capacity.*(?:limit|reached|full)/i.test(
      value,
    )
  ) {
    return "out-of-capacity";
  }
  return null;
}

function classifyCapacityError(
  value: unknown,
  seen: Set<unknown>,
  depth: number,
): ModelCapacityClassification | null {
  if (depth > 4 || seen.has(value)) return null;
  if (Array.isArray(value)) {
    seen.add(value);
    for (const item of value) {
      const classification = classifyCapacityError(item, seen, depth + 1);
      if (classification) return classification;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) {
    const className = capacityClassFromMessage(value);
    return className ? { class: className, code: null } : null;
  }
  seen.add(value);
  const code = capacityCode(record);
  if (code !== null) {
    return { class: code === 3040 ? "out-of-capacity" : "account-allocation", code };
  }
  for (const message of [record.message, record.responseBody, record.statusText]) {
    const className = capacityClassFromMessage(message);
    if (className) return { class: className, code: null };
  }
  for (const nested of [record.cause, record.error, record.response, record.data, record.errors]) {
    const classification = classifyCapacityError(nested, seen, depth + 1);
    if (classification) return classification;
  }
  return null;
}

export function classifyModelCapacityError(error: unknown): ModelCapacityClassification | null {
  return classifyCapacityError(error, new Set(), 0);
}

export function isModelCapacityError(error: unknown): boolean {
  return classifyModelCapacityError(error) !== null;
}

export { MODEL_CAPACITY_MESSAGE };
