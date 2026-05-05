import type {
  AfterToolCallContext,
  AfterToolCallResult,
  AgentContext,
  AgentMessage,
  AgentTool,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@mariozechner/pi-agent-core";
import type { TSchema } from "@sinclair/typebox";

import { SAFPipeline } from "../saf.js";
import type {
  SAFEvaluationInput,
  SAFEvaluationResult,
  SAFConfig,
  SAFEvaluationContext,
} from "../types.js";

interface SAFLike {
  evaluate(input: SAFEvaluationInput): Promise<SAFEvaluationResult>;
  shutdown?: () => Promise<void>;
}

export interface PiAgentCoreAdapterOptions {
  workspacePath: string;
  sessionId?: string;
  agentId?: string;
  agentMode?: SAFEvaluationContext["agentMode"];
  getActionCountThisSession?: () => number;
  userGoalResolver?: (context: AgentContext) => string | undefined;
}

export interface PiAgentCoreAdapter {
  beforeToolCall: (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ) => Promise<BeforeToolCallResult | undefined>;
  afterToolCall: (
    context: AfterToolCallContext,
    signal?: AbortSignal,
  ) => Promise<AfterToolCallResult | undefined>;
  wrapTool: <TParameters extends TSchema, TDetails>(
    tool: AgentTool<TParameters, TDetails>,
  ) => AgentTool<TParameters, TDetails>;
  wrapTools: <T extends AgentTool<any, any>>(tools: T[]) => T[];
  shutdown: () => Promise<void>;
}

class RewrittenArgsStore {
  private readonly map = new Map<string, Record<string, unknown>>();

  public set(toolCallId: string, args: Record<string, unknown>): void {
    this.map.set(toolCallId, args);
  }

  public take(toolCallId: string): Record<string, unknown> | undefined {
    const value = this.map.get(toolCallId);
    this.map.delete(toolCallId);
    return value;
  }

  public delete(toolCallId: string): void {
    this.map.delete(toolCallId);
  }

  public clear(): void {
    this.map.clear();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : { value };
}

function extractTextFromBlocks(content: unknown): string | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }

  const text = content
    .filter(
      (block): block is { type: "text"; text: string } =>
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        "text" in block &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join("\n")
    .trim();

  return text.length > 0 ? text : undefined;
}

function defaultUserGoalResolver(context: AgentContext): string | undefined {
  for (let i = context.messages.length - 1; i >= 0; i -= 1) {
    const message = context.messages[i] as AgentMessage & {
      role?: unknown;
      content?: unknown;
    };

    if (message.role !== "user") {
      continue;
    }

    if (typeof message.content === "string") {
      return message.content;
    }

    const text = extractTextFromBlocks(message.content);
    if (text) {
      return text;
    }
  }

  return undefined;
}

export function createPiAgentCoreAdapterFromPipeline(
  saf: SAFLike,
  options: PiAgentCoreAdapterOptions,
): PiAgentCoreAdapter {
  const rewrites = new RewrittenArgsStore();
  const userGoalResolver = options.userGoalResolver ?? defaultUserGoalResolver;

  const beforeToolCall = async (context: BeforeToolCallContext): Promise<BeforeToolCallResult | undefined> => {
    const rawArgs = toRecord(context.args);
    const result = await saf.evaluate({
      toolName: context.toolCall.name,
      rawArgs,
      userGoal: userGoalResolver(context.context),
      context: {
        workspacePath: options.workspacePath,
        sessionId: options.sessionId,
        agentId: options.agentId,
        agentMode: options.agentMode,
        actionCountThisSession: options.getActionCountThisSession?.(),
      },
    });

    if (result.verdict !== "ALLOWED") {
      if (result.verdict === "REQUIRE_APPROVAL") {
        return {
          block: true,
          reason: `[SAF] ${result.verdict}: ${result.reason}. Human approval is required before execution.`,
        };
      }

      return {
        block: true,
        reason: `[SAF] ${result.verdict}: ${result.reason}`,
      };
    }

    if (result.rewrittenArgs) {
      rewrites.set(context.toolCall.id, result.rewrittenArgs);
    }

    return undefined;
  };

  const afterToolCall = async (context: AfterToolCallContext): Promise<AfterToolCallResult | undefined> => {
    rewrites.delete(context.toolCall.id);
    return undefined;
  };

  const wrapTool = <TParameters extends TSchema, TDetails>(
    tool: AgentTool<TParameters, TDetails>,
  ): AgentTool<TParameters, TDetails> => {
    return {
      ...tool,
      execute: async (toolCallId, params, signal, onUpdate) => {
        const rewritten = rewrites.take(toolCallId);
        const effectiveParams = (rewritten ?? (params as unknown as Record<string, unknown>)) as typeof params;
        return await tool.execute(toolCallId, effectiveParams, signal, onUpdate);
      },
    };
  };

  const wrapTools = <T extends AgentTool<any, any>>(tools: T[]): T[] => {
    return tools.map((tool) => wrapTool(tool)) as T[];
  };

  const shutdown = async (): Promise<void> => {
    rewrites.clear();
    if (saf.shutdown) {
      await saf.shutdown();
    }
  };

  return {
    beforeToolCall,
    afterToolCall,
    wrapTool,
    wrapTools,
    shutdown,
  };
}

export async function createPiAgentCoreAdapter(
  config: SAFConfig,
  options?: Omit<PiAgentCoreAdapterOptions, "workspacePath"> & { workspacePath?: string },
): Promise<PiAgentCoreAdapter> {
  const saf = await SAFPipeline.create(config);
  return createPiAgentCoreAdapterFromPipeline(saf, {
    workspacePath: options?.workspacePath ?? config.workspacePath,
    sessionId: options?.sessionId,
    agentId: options?.agentId,
    agentMode: options?.agentMode,
    getActionCountThisSession: options?.getActionCountThisSession,
    userGoalResolver: options?.userGoalResolver,
  });
}
