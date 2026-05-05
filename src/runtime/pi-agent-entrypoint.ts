import path from "node:path";

import {
  Agent,
  type AgentMessage,
  type AgentTool,
  type ThinkingLevel,
  type ToolExecutionMode,
} from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";

import { loadConfig } from "../config.js";
import { createPiAgentCoreAdapter, type PiAgentCoreAdapter } from "../interceptor/pi-agent-core-adapter.js";
import type { SAFConfig } from "../types.js";

function isToolResultMessage(message: AgentMessage): boolean {
  return typeof message === "object" && message !== null && "role" in message && message.role === "toolResult";
}

function getLastUserGoal(messages: AgentMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as AgentMessage & {
      role?: unknown;
      content?: unknown;
    };

    if (message.role !== "user") {
      continue;
    }

    if (typeof message.content === "string") {
      const value = message.content.trim();
      return value.length > 0 ? value : undefined;
    }

    if (Array.isArray(message.content)) {
      const value = message.content
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

      if (value.length > 0) {
        return value;
      }
    }
  }

  return undefined;
}

export interface CreateSAFEnabledAgentOptions {
  config?: SAFConfig;
  configPath?: string;
  systemPrompt: string;
  model: Model<any>;
  tools: AgentTool<any>[];
  initialMessages?: AgentMessage[];
  sessionId?: string;
  agentId?: string;
  agentMode?: "autonomous" | "interactive";
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  thinkingLevel?: ThinkingLevel;
  toolExecution?: ToolExecutionMode;
}

export interface SAFEnabledAgentHandle {
  agent: Agent;
  adapter: PiAgentCoreAdapter;
  shutdown: () => Promise<void>;
}

export async function createSAFEnabledAgent(options: CreateSAFEnabledAgentOptions): Promise<SAFEnabledAgentHandle> {
  const config =
    options.config ??
    (await loadConfig(options.configPath ?? path.resolve(process.cwd(), "configs/saf-config.json")));

  let agentRef: Agent | undefined;

  const adapter = await createPiAgentCoreAdapter(config, {
    workspacePath: config.workspacePath,
    sessionId: options.sessionId,
    agentId: options.agentId,
    agentMode: options.agentMode,
    userGoalResolver: (context) => getLastUserGoal(context.messages),
    getActionCountThisSession: () => {
      if (!agentRef) {
        return 0;
      }

      return agentRef.state.messages.filter(isToolResultMessage).length;
    },
  });

  const wrappedTools = adapter.wrapTools(options.tools);

  const agent = new Agent({
    initialState: {
      systemPrompt: options.systemPrompt,
      model: options.model,
      tools: wrappedTools,
      messages: options.initialMessages ?? [],
      thinkingLevel: options.thinkingLevel,
    },
    getApiKey: options.getApiKey,
    beforeToolCall: adapter.beforeToolCall,
    afterToolCall: adapter.afterToolCall,
    toolExecution: options.toolExecution,
    sessionId: options.sessionId,
  });

  agentRef = agent;

  return {
    agent,
    adapter,
    shutdown: async () => {
      await adapter.shutdown();
    },
  };
}
