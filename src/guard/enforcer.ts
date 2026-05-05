import type { GuardDecision, NormalizedAction } from "../types.js";
import { isAllowedDomainTarget, isWithinWorkspace } from "../security/validators.js";
import { ToolCapabilityRegistry } from "./registry.js";

export class CapabilityEnforcer {
  public constructor(private readonly registry: ToolCapabilityRegistry) {}

  public check(
    toolName: string,
    action: NormalizedAction,
    context: { workspacePath: string },
  ): GuardDecision {
    const profile = this.registry.get(toolName);
    const requiredCapability = `${action.category}.${action.operation}`;

    if (!profile) {
      return {
        allowed: false,
        reason: `Unknown tool profile: ${toolName}`,
        requiredCapability,
      };
    }

    if (!profile.capabilities.includes(requiredCapability)) {
      return {
        allowed: false,
        reason: `Tool ${toolName} lacks capability ${requiredCapability}`,
        requiredCapability,
      };
    }

    if (
      profile.workspaceOnly &&
      (action.operation === "write" || action.operation === "delete") &&
      !isWithinWorkspace(action.target, context.workspacePath)
    ) {
      return {
        allowed: false,
        reason: `Tool ${toolName} may only mutate files in workspace`,
        requiredCapability,
      };
    }

    if (action.operation === "connect" && profile.allowedDomains && profile.allowedDomains.length > 0) {
      const allowed = isAllowedDomainTarget(action.target, profile.allowedDomains);
      if (!allowed) {
        return {
          allowed: false,
          reason: `Tool ${toolName} may only connect to allowed domains`,
          requiredCapability,
        };
      }
    }

    return {
      allowed: true,
      reason: "Capability check passed",
      requiredCapability,
    };
  }
}
