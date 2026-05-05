import type { NormalizedAction } from "../types.js";
import { PYTHON_CALL_MAP } from "./mappings.js";

function extractPythonStringArg(payload: string): string {
  const match = payload.match(/[\("']([^\n"']+)["']/);
  return match?.[1] ?? "unknown";
}

function inferOpenOperation(payload: string): "read" | "write" {
  const modeMatch = payload.match(/open\s*\([^,]+,\s*["']([^"']+)["']/);
  const mode = modeMatch?.[1] ?? "r";
  return /[wa+]/.test(mode) ? "write" : "read";
}

export function parsePythonPayload(payload: string): NormalizedAction | null {
  if (!payload.includes("python") && !payload.includes("import ")) {
    return null;
  }

  for (const [call, mapped] of Object.entries(PYTHON_CALL_MAP)) {
    if (payload.includes(call)) {
      return {
        category: mapped.category,
        operation: mapped.operation,
        target: extractPythonStringArg(payload),
        parser: "python",
        metadata: {
          flags: {
            matchedCall: call,
          },
        },
      };
    }
  }

  if (payload.includes("open(")) {
    return {
      category: "filesystem",
      operation: inferOpenOperation(payload),
      target: extractPythonStringArg(payload),
      parser: "python",
      metadata: {
        flags: {
          matchedCall: "open",
        },
      },
    };
  }

  return null;
}
