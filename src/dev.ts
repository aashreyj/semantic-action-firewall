import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { type AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

import { loadConfig } from "./config.js";
import { SAFPipeline } from "./saf.js";
import { createHooks } from "./interceptor/hooks.js";
import { resolveBeforeToolCallResult } from "./interceptor/pi-integration.js";
import { createPiAgentCoreAdapterFromPipeline } from "./interceptor/pi-agent-core-adapter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main(): Promise<void> {
  const configPath = path.resolve(__dirname, "../configs/saf-config.json");
  const config = await loadConfig(configPath);
  config.policy.mode = "local";
  config.intent.mode = "heuristic";
  config.sandbox.enabled = true;
  config.sandbox.failOpen = true;
  const saf = await SAFPipeline.create(config);
  let actionCount = 0;
  const hooks = createHooks(saf);

  const adapter = createPiAgentCoreAdapterFromPipeline(saf, {
    workspacePath: config.workspacePath,
    sessionId: "dev-session",
    agentId: "dev-agent",
    agentMode: "autonomous",
    getActionCountThisSession: () => actionCount,
  });

  const bashToolSchema = Type.Object({
    command: Type.String(),
  });

  const bashTool: AgentTool<
    typeof bashToolSchema,
    {
      code: number | null;
      stdout: string;
      stderr: string;
    }
  > = {
    name: "bash",
    label: "Bash",
    description: "Execute a shell command",
    parameters: bashToolSchema,
    execute: async (_toolCallId, params) => {
      const result = await runCommand(params.command, config.workspacePath);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
        details: result,
      };
    },
  };

  const wrappedTool = adapter.wrapTool(bashTool);

  const fakeAgentContext: Parameters<typeof adapter.beforeToolCall>[0]["context"] = {
    systemPrompt: "You are a coding assistant.",
    messages: [
      {
        role: "user",
        content: "inspect code and fix bug",
        timestamp: Date.now(),
      },
    ],
    tools: [wrappedTool],
  };

  const adapterBefore = await adapter.beforeToolCall({
    assistantMessage: {
      role: "assistant",
      api: "openai-completions",
      provider: "openai",
      model: "gpt-4o-mini",
      content: [
        {
          type: "toolCall",
          id: "tool-dev-1",
          name: "bash",
          arguments: { command: "cat src/index.ts" },
        },
      ],
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      stopReason: "toolUse",
      timestamp: Date.now(),
    },
    toolCall: {
      type: "toolCall",
      id: "tool-dev-1",
      name: "bash",
      arguments: { command: "cat src/index.ts" },
    },
    args: { command: "cat src/index.ts" },
    context: fakeAgentContext,
  });

  actionCount += 1;

  const adapterExecution =
    adapterBefore?.block
      ? { blocked: true, reason: adapterBefore.reason }
      : await wrappedTool.execute("tool-dev-1", { command: "cat src/index.ts" });

  const toolCall = {
    toolCall: { name: "bash" },
    args: { command: "cat src/index.ts" },
    context: {
      userGoal: "inspect code and fix bug",
      workspacePath: config.workspacePath,
      sessionId: "dev-session",
      agentId: "dev-agent",
    },
  };

  const before = await hooks.beforeToolCall(toolCall);
  const resolved = resolveBeforeToolCallResult(toolCall.args, before);

  if (resolved.blocked) {
    console.log(`[BLOCKED] ${resolved.reason ?? "No reason"}`);
    await adapter.shutdown();
    return;
  }

  if (resolved.requiresApproval) {
    console.log(`[REQUIRES_APPROVAL] ${resolved.reason ?? "No reason"}`);
    await adapter.shutdown();
    return;
  }

  const command = String(resolved.args.command ?? "");
  const execution = await runCommand(command, config.workspacePath);

  const sample = {
    adapter: {
      beforeResult: adapterBefore,
      execution: adapterExecution,
    },
    toolName: toolCall.toolCall.name,
    originalArgs: toolCall.args,
    resolved,
    execution,
  };

  console.log(JSON.stringify(sample, null, 2));

  await adapter.shutdown();
}

async function runCommand(command: string, cwd: string): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
