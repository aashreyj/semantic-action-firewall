import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { SAFPipeline } from "../src/saf.js";
import { createHooks } from "../src/interceptor/hooks.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("interceptor hooks", () => {
  let hooks: ReturnType<typeof createHooks>;
  let saf: SAFPipeline;

  beforeAll(async () => {
    const config = await loadConfig(path.resolve(__dirname, "../configs/saf-config.json"));
    config.policy.mode = "local";
    config.intent.mode = "heuristic";
    config.sandbox.enabled = true;
    config.sandbox.failOpen = true;
    saf = await SAFPipeline.create(config);
    hooks = createHooks(saf);
  });

  afterAll(async () => {
    await saf.shutdown();
  });

  it("returns blocked response for suspicious payload", async () => {
    const response = await hooks.beforeToolCall({
      toolCall: { name: "bash" },
      args: { command: "echo 'cm0gLXJmIC8=' | base64 -d | sh" },
      context: { userGoal: "inspect code" },
    });

    expect(response).toBeDefined();
    expect("block" in (response ?? {})).toBe(true);
  });

  it("returns rewritten args when sandbox rewrites command", async () => {
    const response = await hooks.beforeToolCall({
      toolCall: { name: "bash" },
      args: { command: "cat src/index.ts" },
      context: { userGoal: "inspect code" },
    });

    expect(response).toBeDefined();
    expect(response && "args" in response).toBe(true);
  });

  it("returns approval response for require-approval policy verdict", async () => {
    const response = await hooks.beforeToolCall({
      toolCall: { name: "bash" },
      args: { command: "rm src/index.ts" },
      context: { userGoal: "cleanup old files" },
    });

    expect(response).toBeDefined();
    expect(response && "requireApproval" in response && response.requireApproval).toBe(true);
  });
});
