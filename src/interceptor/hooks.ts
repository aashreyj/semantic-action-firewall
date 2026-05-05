import type { SAFEvaluationInput, SAFEvaluationResult } from "../types.js";
import { SAFPipeline } from "../saf.js";

export interface BeforeToolCallArgs {
  toolCall: { name: string };
  args: Record<string, unknown>;
  context?: {
    userGoal?: string;
    workspacePath?: string;
    sessionId?: string;
    agentId?: string;
  };
}

export interface AfterToolCallArgs {
  toolCall: { name: string };
  result: unknown;
  isError: boolean;
}

export interface BlockedToolCallResponse {
  block: true;
  reason: string;
}

export interface ApprovalRequiredToolCallResponse {
  requireApproval: true;
  reason: string;
}

export interface RewrittenToolCallResponse {
  block?: false;
  args: Record<string, unknown>;
}

export interface SAFHooks {
  beforeToolCall: (
    args: BeforeToolCallArgs,
  ) => Promise<BlockedToolCallResponse | ApprovalRequiredToolCallResponse | RewrittenToolCallResponse | undefined>;
  afterToolCall: (args: AfterToolCallArgs) => Promise<void>;
  evaluate: (input: SAFEvaluationInput) => Promise<SAFEvaluationResult>;
}

export function createHooks(saf: SAFPipeline): SAFHooks {
  return {
    beforeToolCall: async ({ toolCall, args, context }) => {
      const result = await saf.evaluate({
        toolName: toolCall.name,
        rawArgs: args,
        userGoal: context?.userGoal,
        context: {
          workspacePath: context?.workspacePath,
          sessionId: context?.sessionId,
          agentId: context?.agentId,
        },
      });

      if (result.verdict !== "ALLOWED") {
        if (result.verdict === "REQUIRE_APPROVAL") {
          return {
            requireApproval: true,
            reason: `[SAF] ${result.verdict}: ${result.reason}`,
          };
        }

        return {
          block: true,
          reason: `[SAF] ${result.verdict}: ${result.reason}`,
        };
      }

      if (result.rewrittenArgs) {
        return {
          args: result.rewrittenArgs,
        };
      }

      return undefined;
    },
    afterToolCall: async () => {
      return;
    },
    evaluate: async (input) => saf.evaluate(input),
  };
}
