import type { NormalizedAction } from "../types.js";

function stringArg(rawArgs: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = rawArgs[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

function isWriteLikeReadFileCall(rawArgs: Record<string, unknown>): boolean {
  const operation = rawArgs.operation;
  if (typeof operation === "string" && operation.toLowerCase() === "write") {
    return true;
  }

  const mode = rawArgs.mode;
  if (typeof mode === "string") {
    const normalized = mode.toLowerCase();
    if (normalized.includes("w") || normalized.includes("write") || normalized.includes("append")) {
      return true;
    }
  }

  if (typeof rawArgs.content === "string" || typeof rawArgs.text === "string" || typeof rawArgs.data === "string") {
    return true;
  }

  return false;
}

function makeToolAction(
  toolName: string,
  category: NormalizedAction["category"],
  operation: NormalizedAction["operation"],
  target: string,
): NormalizedAction {
  return {
    category,
    operation,
    target,
    parser: "tool",
    metadata: {
      flags: {
        mappedFromTool: toolName,
      },
    },
  };
}

export function parseToolInvocation(toolName: string, rawArgs: Record<string, unknown>): NormalizedAction | null {
  const normalizedTool = toolName.toLowerCase();

  if (normalizedTool === "bash" || normalizedTool === "python" || normalizedTool === "python3") {
    return null;
  }

  if (normalizedTool === "read_file") {
    const target = stringArg(rawArgs, ["path", "filePath", "file", "target"]) ?? "unknown";
    return makeToolAction(normalizedTool, "filesystem", isWriteLikeReadFileCall(rawArgs) ? "write" : "read", target);
  }

  if (normalizedTool === "list_directory") {
    const target = stringArg(rawArgs, ["path", "directory", "target"]) ?? ".";
    return makeToolAction(normalizedTool, "filesystem", "read", target);
  }

  if (normalizedTool === "write_file" || normalizedTool === "edit_file") {
    const target = stringArg(rawArgs, ["path", "filePath", "file", "target"]) ?? "unknown";
    return makeToolAction(normalizedTool, "filesystem", "write", target);
  }

  if (normalizedTool === "delete_file" || normalizedTool === "remove_file") {
    const target = stringArg(rawArgs, ["path", "filePath", "file", "target"]) ?? "unknown";
    return makeToolAction(normalizedTool, "filesystem", "delete", target);
  }

  if (normalizedTool === "web_fetch" || normalizedTool === "web_search") {
    const target = stringArg(rawArgs, ["url", "target", "query"]) ?? "unknown";
    return makeToolAction(normalizedTool, "network", "connect", target);
  }

  return null;
}
