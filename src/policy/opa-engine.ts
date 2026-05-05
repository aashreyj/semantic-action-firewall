import type { NormalizedAction, PolicyConfig, PolicyDecision } from "../types.js";
import type { PolicyEvaluationContext, PolicyEvaluator } from "./contracts.js";

interface OPAResultBody {
  result?: unknown;
}

function normalizeDecision(value: string | undefined): PolicyDecision["verdict"] {
  if (value === "ALLOW") {
    return "ALLOW";
  }

  if (value === "DENY") {
    return "DENY";
  }

  if (value === "FLAG_FOR_INTENT_CHECK") {
    return "FLAG_FOR_INTENT_CHECK";
  }

  return "REQUIRE_APPROVAL";
}

function toPolicyDecision(result: unknown): PolicyDecision | null {
  if (typeof result === "string") {
    return {
      verdict: normalizeDecision(result),
      matchedRule: "opa.string-result",
      reason: "OPA returned string decision",
    };
  }

  if (typeof result !== "object" || result === null) {
    return null;
  }

  const record = result as Record<string, unknown>;
  const decisionValue = typeof record.decision === "string" ? record.decision : undefined;
  const matchedRule = typeof record.matchedRule === "string" ? record.matchedRule : "opa.default";
  const reason = typeof record.reason === "string" ? record.reason : "OPA decision";

  if (!decisionValue) {
    return null;
  }

  return {
    verdict: normalizeDecision(decisionValue),
    matchedRule,
    reason,
  };
}

export class OPAPolicyEngine implements PolicyEvaluator {
  public constructor(
    private readonly opaUrl: string,
    private readonly timeoutMs: number,
    private readonly fallbackMode: "local" | "deny" | "require_approval",
    private readonly policyConfig: PolicyConfig,
    private readonly fallbackEvaluator?: PolicyEvaluator,
  ) {}

  public async evaluate(action: NormalizedAction, context: PolicyEvaluationContext): Promise<PolicyDecision> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.opaUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          input: {
            action,
            context,
            policy: {
              defaultBehavior: this.policyConfig.defaultBehavior,
              allowedDomains: this.policyConfig.allowedDomains,
              protectedPaths: this.policyConfig.protectedPaths,
            },
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return this.handleFallback(`OPA returned HTTP ${response.status}`, action, context);
      }

      const body = (await response.json()) as OPAResultBody;
      const decision = toPolicyDecision(body.result);
      if (!decision) {
        return this.handleFallback("OPA result payload missing decision", action, context);
      }

      return decision;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown OPA error";
      return this.handleFallback(`OPA request failed: ${message}`, action, context);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async handleFallback(
    reason: string,
    action: NormalizedAction,
    context: PolicyEvaluationContext,
  ): Promise<PolicyDecision> {
    if (this.fallbackMode === "local" && this.fallbackEvaluator) {
      const decision = await this.fallbackEvaluator.evaluate(action, context);
      return {
        ...decision,
        matchedRule: `fallback.local:${decision.matchedRule}`,
        reason: `${decision.reason} (OPA fallback: ${reason})`,
      };
    }

    if (this.fallbackMode === "deny") {
      return {
        verdict: "DENY",
        matchedRule: "fallback.deny",
        reason,
      };
    }

    return {
      verdict: "REQUIRE_APPROVAL",
      matchedRule: "fallback.require_approval",
      reason,
    };
  }
}
