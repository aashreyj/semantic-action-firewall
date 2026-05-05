import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";

import type { NormalizedAction } from "../types.js";

export type { SandboxRuntimeConfig };

export function buildSandboxConfig(
  action: NormalizedAction,
  workspacePath: string,
  allowedDomains: string[],
): SandboxRuntimeConfig {
  const effectiveDomains = action.operation === "connect" ? allowedDomains : [];

  return {
    network: {
      allowedDomains: effectiveDomains,
      deniedDomains: ["169.254.169.254", "metadata.google.internal"],
      allowLocalBinding: false,
    },
    filesystem: {
      denyRead: ["~/.ssh", "~/.aws", "~/.gnupg", "~/.config"],
      allowRead: [workspacePath, "/tmp"],
      allowWrite: [workspacePath, "/tmp"],
      denyWrite: [".env", "*.pem", "*.key", "*_rsa", "*.credentials"],
    },
    allowPty: true,
  };
}
