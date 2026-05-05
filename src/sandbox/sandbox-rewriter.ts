import { SandboxManager } from "@anthropic-ai/sandbox-runtime";

import { buildSandboxConfig } from "./config-generator.js";
import type { PolicyConfig, SAFConfig } from "../types.js";
import type { NormalizedAction } from "../types.js";

function extractCommand(toolName: string, rawArgs: Record<string, unknown>): string | null {
  if (toolName === "bash" && typeof rawArgs.command === "string") {
    return rawArgs.command;
  }

  return null;
}

export class SandboxCommandRewriter {
  private initialized = false;

  public constructor(private readonly config: SAFConfig, private readonly policyConfig: PolicyConfig) {}

  public async rewrite(
    toolName: string,
    rawArgs: Record<string, unknown>,
    action: NormalizedAction,
    workspacePath: string,
  ): Promise<Record<string, unknown>> {
    if (!this.config.sandbox.enabled) {
      return rawArgs;
    }

    const command = extractCommand(toolName, rawArgs);
    if (!command) {
      return rawArgs;
    }

    const runtimeConfig = buildSandboxConfig(action, workspacePath, this.policyConfig.allowedDomains);

    try {
      if (!this.initialized) {
        await SandboxManager.initialize(runtimeConfig);
        this.initialized = true;
      } else {
        SandboxManager.updateConfig(runtimeConfig);
      }

      const wrapped = await SandboxManager.wrapWithSandbox(command);
      return {
        ...rawArgs,
        command: wrapped,
      };
    } catch (error) {
      if (this.config.sandbox.failOpen) {
        return rawArgs;
      }

      const message = error instanceof Error ? error.message : "unknown sandbox error";
      throw new Error(`Sandbox rewrite failed: ${message}`);
    }
  }

  public async reset(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    try {
      await SandboxManager.reset();
    } finally {
      this.initialized = false;
    }
  }
}
