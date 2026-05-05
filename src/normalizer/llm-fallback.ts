import type { NormalizedAction } from "../types.js";

export function fallbackNormalize(payload: string, reason?: string): NormalizedAction {
  return {
    category: "unknown",
    operation: "unknown",
    target: payload.slice(0, 80) || "unknown",
    parser: "fallback",
    metadata: {
      flags: {
        reason: reason ?? "No parser matched. Requires approval path.",
      },
    },
  };
}
