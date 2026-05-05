import type { NormalizedAction, PolicyDecision } from "../types.js";

export interface PolicyEvaluationContext {
  workspacePath: string;
  toolName?: string;
  sessionId?: string;
  agentMode?: "autonomous" | "interactive";
  actionCountThisSession?: number;
}

export interface PolicyEvaluator {
  evaluate(action: NormalizedAction, context: PolicyEvaluationContext): Promise<PolicyDecision>;
}
