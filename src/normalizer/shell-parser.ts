import { parse } from "shell-quote";

import type { NormalizedAction } from "../types.js";
import { SHELL_COMMAND_MAP } from "./mappings.js";

interface OperatorToken {
  op: string;
}

function isOperatorToken(value: unknown): value is OperatorToken {
  return typeof value === "object" && value !== null && "op" in value && typeof (value as { op?: unknown }).op === "string";
}

function isTeeToken(token: string): boolean {
  return token === "tee" || token.endsWith("/tee");
}

function isCpOrMvCommand(token: string): boolean {
  return token === "cp" || token === "mv";
}

function extractStringTokens(parts: unknown[]): string[] {
  return parts.filter((part): part is string => typeof part === "string");
}

function extractTarget(tokens: string[]): string {
  const candidate = tokens.find((token) => !token.startsWith("-"));
  return candidate ?? "unknown";
}

function extractDestination(tokens: string[]): string {
  const positional = tokens.filter((token) => !token.startsWith("-"));
  return positional[positional.length - 1] ?? "unknown";
}

function findRedirectionTarget(parts: unknown[]): string | undefined {
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!isOperatorToken(part)) {
      continue;
    }

    if (!part.op.startsWith(">")) {
      continue;
    }

    const destination = parts[i + 1];
    if (typeof destination === "string" && destination.trim().length > 0) {
      return destination;
    }
  }

  return undefined;
}

function findTeeTarget(parts: unknown[]): string | undefined {
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (typeof part !== "string" || !isTeeToken(part)) {
      continue;
    }

    const teeArgs: string[] = [];
    for (let j = i + 1; j < parts.length; j += 1) {
      const candidate = parts[j];

      if (isOperatorToken(candidate) && candidate.op === "|") {
        break;
      }

      if (typeof candidate === "string") {
        teeArgs.push(candidate);
      }
    }

    const target = teeArgs.find((arg) => !arg.startsWith("-"));
    if (target) {
      return target;
    }
  }

  return undefined;
}

function extractFlags(tokens: string[]): { recursive?: boolean; force?: boolean } {
  const flags: { recursive?: boolean; force?: boolean } = {};

  const hasRecursive = tokens.some((token) => {
    if (token === "-r" || token === "--recursive") {
      return true;
    }

    if (token.startsWith("--")) {
      return false;
    }

    return token.startsWith("-") && token.includes("r");
  });

  const hasForce = tokens.some((token) => {
    if (token === "-f" || token === "--force") {
      return true;
    }

    if (token.startsWith("--")) {
      return false;
    }

    return token.startsWith("-") && token.includes("f");
  });

  if (hasRecursive) {
    flags.recursive = true;
  }

  if (hasForce) {
    flags.force = true;
  }

  return flags;
}

export function parseShellCommand(command: string): NormalizedAction | null {
  const parsed = parse(command);
  const stringTokens = extractStringTokens(parsed);

  if (stringTokens.length === 0) {
    return null;
  }

  const cmd = stringTokens[0] ?? "";
  const mapping = SHELL_COMMAND_MAP[cmd];

  const redirectedTo = findRedirectionTarget(parsed);
  const teeTarget = findTeeTarget(parsed);
  const inferredWriteTarget = redirectedTo ?? teeTarget;

  if (!mapping && !inferredWriteTarget) {
    return null;
  }

  const rest = stringTokens.slice(1);
  const flags = extractFlags(rest);

  let category = mapping?.category ?? "filesystem";
  let operation = mapping?.operation ?? "write";
  let target =
    mapping && mapping.category === "process"
      ? cmd
      : mapping
        ? extractTarget(rest)
        : inferredWriteTarget ?? "unknown";

  if (isCpOrMvCommand(cmd)) {
    target = extractDestination(rest);
  }

  if (isTeeToken(cmd) && teeTarget) {
    category = "filesystem";
    operation = "write";
    target = teeTarget;
  }

  if (inferredWriteTarget) {
    category = "filesystem";
    operation = "write";
    target = inferredWriteTarget;
  }

  const pipeSegments = command
    .split("|")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  const metadata: NormalizedAction["metadata"] = {
    flags: {
      rawTokens: rest,
    },
  };

  if (flags.recursive) {
    metadata.recursive = true;
  }

  if (flags.force) {
    metadata.force = true;
  }

  if (redirectedTo) {
    metadata.redirectedTo = redirectedTo;
  }

  if (pipeSegments.length > 1) {
    metadata.pipedCommands = pipeSegments;
  }

  return {
    category,
    operation,
    target,
    parser: "shell",
    metadata,
  };
}
