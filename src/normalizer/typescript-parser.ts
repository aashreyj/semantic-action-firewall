import type { NormalizedAction } from "../types.js";
import { TYPESCRIPT_CALL_MAP } from "./mappings.js";

function extractStringLiteral(payload: string): string {
  const match = payload.match(/["'`]([^"'`\n]+)["'`]/);
  return match?.[1] ?? "unknown";
}

export function parseTypeScriptPayload(payload: string): NormalizedAction | null {
  if (!payload.includes("fs") && !payload.includes("fetch") && !payload.includes("child_process")) {
    return null;
  }

  for (const matcher of TYPESCRIPT_CALL_MAP) {
    if (matcher.pattern.test(payload)) {
      return {
        category: matcher.value.category,
        operation: matcher.value.operation,
        target: extractStringLiteral(payload),
        parser: "typescript",
        metadata: {
          flags: {
            matchedPattern: matcher.pattern.source,
          },
        },
      };
    }
  }

  return null;
}
