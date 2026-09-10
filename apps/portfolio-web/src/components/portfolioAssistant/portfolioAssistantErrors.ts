export const MODEL_CAPACITY_MESSAGE =
  "The model is temporarily at capacity. Please try again later.";
export const MODEL_ALLOCATION_MESSAGE =
  "The provider's daily Workers AI allocation has been used up. Try again after 00:00 UTC.";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (
    error &&
    typeof error === "object" &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "";
}

export type AssistantErrorPresentation = {
  title: "Provider allocation exhausted." | "Model capacity reached." | "Response interrupted.";
  message: string;
};

export function describeAssistantError(error: unknown): AssistantErrorPresentation {
  const message = errorMessage(error);
  if (/daily Workers AI allocation has been used up/i.test(message)) {
    return { title: "Provider allocation exhausted.", message: MODEL_ALLOCATION_MESSAGE };
  }
  if (/temporarily at capacity|maximum daily capacity/i.test(message)) {
    return { title: "Model capacity reached.", message: MODEL_CAPACITY_MESSAGE };
  }
  return {
    title: "Response interrupted.",
    message:
      "This model response stopped before an answer arrived. Try the last question again or send a new one.",
  };
}

export function isModelCapacityClientError(error: unknown): boolean {
  return describeAssistantError(error).title === "Model capacity reached.";
}

export function isModelAllocationClientError(error: unknown): boolean {
  return describeAssistantError(error).title === "Provider allocation exhausted.";
}
