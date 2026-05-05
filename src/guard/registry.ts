import type { ToolCapabilityConfig, ToolCapabilityProfile } from "../types.js";

export class ToolCapabilityRegistry {
  public constructor(private readonly config: ToolCapabilityConfig) {}

  public get(toolName: string): ToolCapabilityProfile | undefined {
    return this.config.tools[toolName];
  }
}
