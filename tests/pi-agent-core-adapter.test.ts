import { describe, expect, it, vi } from "vitest";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";

import { createPiAgentCoreAdapterFromPipeline } from "../src/interceptor/pi-agent-core-adapter.js";

describe("pi-agent-core adapter", () => {
  it("blocks tool call when SAF denies", async () => {
    const evaluate = vi.fn().mockResolvedValue({
      verdict: "DENIED",
      reason: "blocked by policy",
      latencyMs: 1,
    });

    const adapter = createPiAgentCoreAdapterFromPipeline(
      {
        evaluate,
      },
      {
        workspacePath: "/workspace",
      },
    );

    const result = await adapter.beforeToolCall({
      assistantMessage: {
        role: "assistant",
        api: "openai-completions",
        provider: "openai",
        model: "gpt-4o-mini",
        content: [
          {
            type: "toolCall",
            id: "tool-1",
            name: "bash",
            arguments: { command: "rm -rf /" },
          },
        ],
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: Date.now(),
      },
      toolCall: {
        type: "toolCall",
        id: "tool-1",
        name: "bash",
        arguments: { command: "rm -rf /" },
      },
      args: { command: "rm -rf /" },
      context: {
        systemPrompt: "You are a coding agent",
        messages: [
          {
            role: "user",
            content: "delete everything",
            timestamp: Date.now(),
          },
        ],
        tools: [],
      },
    });

    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("[SAF]");
  });

  it("rewrites execute args via wrapped tool", async () => {
    const evaluate = vi.fn().mockResolvedValue({
      verdict: "ALLOWED",
      reason: "ok",
      rewrittenArgs: { command: "sandbox cat src/index.ts" },
      latencyMs: 1,
    });

    const adapter = createPiAgentCoreAdapterFromPipeline(
      {
        evaluate,
      },
      {
        workspacePath: "/workspace",
      },
    );

    const executeSpy = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      details: { ok: true },
    });

    const toolSchema = Type.Object({ command: Type.String() });
    const tool: AgentTool<typeof toolSchema, { ok: boolean }> = {
      name: "bash",
      label: "Bash",
      description: "Execute command",
      parameters: toolSchema,
      execute: executeSpy,
    };

    const wrapped = adapter.wrapTool(tool);

    await adapter.beforeToolCall({
      assistantMessage: {
        role: "assistant",
        api: "openai-completions",
        provider: "openai",
        model: "gpt-4o-mini",
        content: [
          {
            type: "toolCall",
            id: "tool-2",
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
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: Date.now(),
      },
      toolCall: {
        type: "toolCall",
        id: "tool-2",
        name: "bash",
        arguments: { command: "cat src/index.ts" },
      },
      args: { command: "cat src/index.ts" },
      context: {
        systemPrompt: "You are a coding agent",
        messages: [
          {
            role: "user",
            content: "inspect code",
            timestamp: Date.now(),
          },
        ],
        tools: [wrapped],
      },
    });

    await wrapped.execute("tool-2", { command: "cat src/index.ts" });

    expect(executeSpy).toHaveBeenCalledTimes(1);
    const [, params] = executeSpy.mock.calls[0] ?? [];
    expect(params).toEqual({ command: "sandbox cat src/index.ts" });
  });

  it("blocks with explicit approval-required reason when SAF requires approval", async () => {
    const evaluate = vi.fn().mockResolvedValue({
      verdict: "REQUIRE_APPROVAL",
      reason: "delete requires approval",
      latencyMs: 1,
    });

    const adapter = createPiAgentCoreAdapterFromPipeline(
      {
        evaluate,
      },
      {
        workspacePath: "/workspace",
      },
    );

    const result = await adapter.beforeToolCall({
      assistantMessage: {
        role: "assistant",
        api: "openai-completions",
        provider: "openai",
        model: "gpt-4o-mini",
        content: [
          {
            type: "toolCall",
            id: "tool-approval",
            name: "bash",
            arguments: { command: "rm src/index.ts" },
          },
        ],
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: Date.now(),
      },
      toolCall: {
        type: "toolCall",
        id: "tool-approval",
        name: "bash",
        arguments: { command: "rm src/index.ts" },
      },
      args: { command: "rm src/index.ts" },
      context: {
        systemPrompt: "You are a coding agent",
        messages: [
          {
            role: "user",
            content: "cleanup project",
            timestamp: Date.now(),
          },
        ],
        tools: [],
      },
    });

    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("Human approval is required");
  });
});
