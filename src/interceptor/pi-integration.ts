import type { SAFConfig } from "../types.js";
import { SAFPipeline } from "../saf.js";
import {
  type ApprovalRequiredToolCallResponse,
  createHooks,
  type BlockedToolCallResponse,
  type RewrittenToolCallResponse,
  type SAFHooks,
} from "./hooks.js";

export interface ResolvedBeforeToolCall {
  blocked: boolean;
  requiresApproval: boolean;
  reason?: string;
  args: Record<string, unknown>;
}

export function resolveBeforeToolCallResult(
  originalArgs: Record<string, unknown>,
  response: BlockedToolCallResponse | ApprovalRequiredToolCallResponse | RewrittenToolCallResponse | undefined,
): ResolvedBeforeToolCall {
  if (!response) {
    return {
      blocked: false,
      requiresApproval: false,
      args: originalArgs,
    };
  }

  if ("block" in response && response.block) {
    return {
      blocked: true,
      requiresApproval: false,
      reason: response.reason,
      args: originalArgs,
    };
  }

  if ("requireApproval" in response && response.requireApproval) {
    return {
      blocked: false,
      requiresApproval: true,
      reason: response.reason,
      args: originalArgs,
    };
  }

  if ("args" in response) {
    return {
      blocked: false,
      requiresApproval: false,
      args: response.args,
    };
  }

  return {
    blocked: true,
    requiresApproval: false,
    reason: "Invalid beforeToolCall response shape",
    args: originalArgs,
  };
}

export async function createSAFHooks(config: SAFConfig): Promise<SAFHooks> {
  const pipeline = await SAFPipeline.create(config);
  return createHooks(pipeline);
}
