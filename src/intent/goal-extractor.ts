import type { IntentGoal } from "../types.js";

function includesAny(input: string, words: string[]): boolean {
  return words.some((word) => input.includes(word));
}

function collectTargetHints(input: string): string[] {
  const matches = input.match(/[./~\w-]+\.[a-z0-9]+|\/[\w./-]+/gi) ?? [];
  return [...new Set(matches.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0))];
}

export function extractGoal(userGoal: string | undefined): IntentGoal {
  const normalized = (userGoal ?? "").toLowerCase();

  const allowRead = true;
  const allowWrite = includesAny(normalized, [
    "write",
    "edit",
    "update",
    "modify",
    "change",
    "create",
    "add",
    "implement",
    "refactor",
    "fix",
    "patch",
    "rename",
    "format",
  ]);
  const allowDelete = includesAny(normalized, ["delete", "remove", "cleanup", "clean up"]);
  const allowExecute = includesAny(normalized, ["run", "execute", "build", "test"]);
  const allowNetwork = includesAny(normalized, ["download", "fetch", "internet", "api", "curl", "http"]);
  const targetHints = collectTargetHints(normalized);
  const sensitiveDataAllowed = includesAny(normalized, [
    "secret",
    "credential",
    "token",
    "password",
    "ssh key",
    "api key",
    "private key",
    ".env",
  ]);
  const externalTransferAllowed = includesAny(normalized, [
    "upload",
    "send",
    "share",
    "publish",
    "post",
    "submit",
    "deploy",
    "push",
  ]);
  const approvalMentioned = includesAny(normalized, ["approve", "approval", "confirm", "authorized", "permission"]);

  return {
    primaryIntent: userGoal ?? "No explicit goal provided",
    allowRead,
    allowWrite,
    allowDelete,
    allowExecute,
    allowNetwork,
    targetHints,
    sensitiveDataAllowed,
    externalTransferAllowed,
    approvalMentioned,
  };
}
