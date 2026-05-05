import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { fauxAssistantMessage, fauxText, fauxToolCall, registerFauxProvider } from "@mariozechner/pi-ai";

import { createSAFEnabledAgent } from "../src/runtime/pi-agent-entrypoint.js";
import { loadConfig } from "../src/config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("createSAFEnabledAgent", () => {
  let unregister: (() => void) | undefined;
  let logPath: string | undefined;

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
  }

  afterEach(async () => {
    if (unregister) {
      unregister();
      unregister = undefined;
    }

    if (logPath) {
      try {
        const { unlink } = await import("node:fs/promises");
        await unlink(logPath);
      } catch {
        // no-op for cleanup
      }
      logPath = undefined;
    }
  });

  it("runs agent prompt through SAF-enabled hooks", async () => {
    const faux = registerFauxProvider();
    unregister = faux.unregister;

    const model = faux.getModel();
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall(
            "read_file",
            {
              path: "src/index.ts",
            },
            { id: "tool-read-1" },
          ),
        ],
        {
          stopReason: "toolUse",
        },
      ),
      fauxAssistantMessage([fauxText("Done")], {
        stopReason: "stop",
      }),
    ]);

    const toolSchema = Type.Object({ path: Type.String() });
    const executeSpy = {
      calls: 0,
    };

    const readFileTool: AgentTool<typeof toolSchema, { ok: boolean }> = {
      name: "read_file",
      label: "Read File",
      description: "Read file",
      parameters: toolSchema,
      execute: async () => {
        executeSpy.calls += 1;
        return {
          content: [{ type: "text", text: "file content" }],
          details: { ok: true },
        };
      },
    };

    const config = await loadConfig(path.resolve(__dirname, "../configs/saf-config.json"));
    config.policy.mode = "local";
    config.intent.mode = "heuristic";
    config.sandbox.enabled = false;
    config.sandbox.failOpen = true;
    config.auditLogPath = path.resolve(__dirname, `../logs/runtime-entrypoint-${Date.now()}.log`);
    logPath = config.auditLogPath;

    const handle = await createSAFEnabledAgent({
      config,
      systemPrompt: "You are helpful.",
      model,
      tools: [readFileTool],
      sessionId: "runtime-entrypoint-test",
      agentId: "runtime-entrypoint-test-agent",
      agentMode: "autonomous",
    });

    try {
      await handle.agent.prompt("Read src/index.ts and summarize it.");
      expect(executeSpy.calls).toBe(1);

      const { readFile } = await import("node:fs/promises");
      const logRaw = await readFile(logPath!, "utf8");
      expect(logRaw).toContain("\"toolName\":\"read_file\"");
      expect(logRaw).toContain("\"finalVerdict\":\"ALLOWED\"");
    } finally {
      await handle.shutdown();
    }
  });
});
