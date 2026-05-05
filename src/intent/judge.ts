import path from "node:path";

import type { IntentEvaluationContext, IntentGoal, IntentVerdict, NormalizedAction } from "../types.js";

const sensitiveTargetPatterns = [
  /(^|\/)\.env(\.|$|\/)?/i,
  /(^|\/)id_rsa(\.|$|\/)?/i,
  /(^|\/)id_ed25519(\.|$|\/)?/i,
  /\.pem$/i,
  /\.key$/i,
  /(^|\/)secrets?(\.|$|\/)?/i,
  /(^|\/)credentials?(\.|$|\/)?/i,
  /(^|\/)auth(\.|$|\/)?/i,
  /(^|\/)token(\.|$|\/)?/i,
  /\/\.ssh\//i,
  /\/\.aws\//i,
];

function normalizeTarget(target: string): string {
  return target.trim().toLowerCase();
}

function isSensitiveTarget(target: string): boolean {
  return sensitiveTargetPatterns.some((pattern) => pattern.test(target));
}

function targetMatchesGoal(action: NormalizedAction, goal: IntentGoal): boolean {
  if (goal.targetHints.length === 0) {
    return true;
  }

  const normalizedTarget = normalizeTarget(action.target);
  return goal.targetHints.some((hint) => {
    const normalizedHint = normalizeTarget(hint);
    const hintBase = path.basename(normalizedHint);
    return (
      normalizedTarget === normalizedHint ||
      normalizedTarget.endsWith(`/${normalizedHint}`) ||
      normalizedTarget.includes(normalizedHint) ||
      normalizedTarget === hintBase ||
      normalizedTarget.endsWith(`/${hintBase}`)
    );
  });
}

function findOperationViolation(action: NormalizedAction, goal: IntentGoal): string | null {
  if (action.operation === "write" && !goal.allowWrite) {
    return "Write operation is not part of user goal.";
  }

  if (action.operation === "delete" && !goal.allowDelete) {
    return "Delete operation is not part of user goal.";
  }

  if (action.operation === "execute" && !goal.allowExecute) {
    return "Process execution is not part of user goal.";
  }

  if (action.operation === "connect" && !goal.allowNetwork) {
    return "Network access is not part of user goal.";
  }

  return null;
}

function requiresApproval(action: NormalizedAction, goal: IntentGoal, context?: IntentEvaluationContext): string | null {
  const normalizedTarget = normalizeTarget(action.target);

  if (action.operation === "delete" && goal.allowDelete && !goal.approvalMentioned) {
    return "Destructive delete action requested without explicit approval context.";
  }

  if (action.operation === "connect" && isSensitiveTarget(normalizedTarget) && !goal.externalTransferAllowed) {
    return "Sensitive target appears to be leaving the workspace without explicit sharing intent.";
  }

  if ((action.operation === "read" || action.operation === "write") && isSensitiveTarget(normalizedTarget) && !goal.sensitiveDataAllowed) {
    return "Sensitive file access requires explicit policy-aware approval.";
  }

  if ((action.operation === "write" || action.operation === "delete") && goal.targetHints.length > 0 && !targetMatchesGoal(action, goal)) {
    return "Filesystem mutation target does not match the user-requested artifact.";
  }

  if (action.operation === "connect" && goal.targetHints.length > 0 && !targetMatchesGoal(action, goal) && !goal.externalTransferAllowed) {
    return "Network destination does not match the user-requested resource and should be reviewed.";
  }

  const recentActions = context?.snapshot?.recentActions ?? [];
  if (action.operation === "connect" && recentActions.some((recentAction) => isSensitiveTarget(normalizeTarget(recentAction.target)))) {
    return "Network action follows access to a sensitive target in the same session and requires approval.";
  }

  return null;
}

export class IntentJudge {
  public evaluate(action: NormalizedAction, goal: IntentGoal, context?: IntentEvaluationContext): IntentVerdict {
    const reason = findOperationViolation(action, goal);

    if (reason) {
      return {
        verdict: "REJECTED",
        reason,
        confidence: 0.92,
      };
    }

    const approvalReason = requiresApproval(action, goal, context);
    if (approvalReason) {
      return {
        verdict: "REQUIRE_APPROVAL",
        reason: approvalReason,
        confidence: 0.78,
      };
    }

    return {
      verdict: "VALIDATED",
      reason: "Action is consistent with user goal.",
      confidence: 0.75,
    };
  }
}
