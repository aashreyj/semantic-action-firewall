import type { NormalizedAction, PolicyConfig, PolicyDecision, PolicyMode } from "../types.js";
import { isAllowedDomainTarget, isProtectedPath, isSensitiveTarget, isWithinWorkspace } from "../security/validators.js";
import type { PolicyEvaluationContext, PolicyEvaluator } from "./contracts.js";

function mapModeToVerdict(mode: PolicyMode): PolicyDecision["verdict"] {
  if (mode === "allow") {
    return "ALLOW";
  }
  if (mode === "deny") {
    return "DENY";
  }
  if (mode === "flag_intent") {
    return "FLAG_FOR_INTENT_CHECK";
  }
  return "REQUIRE_APPROVAL";
}

export class LocalPolicyEngine implements PolicyEvaluator {
  public constructor(private readonly config: PolicyConfig) {}

  public async evaluate(action: NormalizedAction, context: PolicyEvaluationContext): Promise<PolicyDecision> {
    if (action.category === "filesystem" && action.operation === "read" && isSensitiveTarget(action.target)) {
      return {
        verdict: "REQUIRE_APPROVAL",
        matchedRule: "sensitive-read",
        reason: `Sensitive filesystem read requires approval: ${action.target}`,
      };
    }

    if (action.operation === "delete" && isProtectedPath(action.target, this.config.protectedPaths)) {
      return {
        verdict: "DENY",
        matchedRule: "protected-path-delete",
        reason: `Delete blocked on protected path: ${action.target}`,
      };
    }

    if (action.category === "network" && action.operation === "connect") {
      const allowed = isAllowedDomainTarget(action.target, this.config.allowedDomains);
      if (!allowed) {
        return {
          verdict: "DENY",
          matchedRule: "network-allowlist",
          reason: `Network target not allowlisted: ${action.target}`,
        };
      }
    }

    if (
      action.category === "filesystem" &&
      (action.operation === "write" || action.operation === "delete") &&
      !isWithinWorkspace(action.target, context.workspacePath)
    ) {
      return {
        verdict: "DENY",
        matchedRule: "workspace-scope",
        reason: `Filesystem mutation outside workspace: ${action.target}`,
      };
    }

    const mode =
      this.config.scopes[action.category]?.[action.operation] ??
      (this.config.defaultBehavior === "allow" ? "allow" : "deny");

    return {
      verdict: mapModeToVerdict(mode),
      matchedRule: `${action.category}.${action.operation}`,
      reason: `Policy mode: ${mode}`,
    };
  }
}
