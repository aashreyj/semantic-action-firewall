import path from "node:path";
import { readFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { SAFPipeline } from "../src/saf.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("SAF pipeline", () => {
  let saf: SAFPipeline;

  beforeAll(async () => {
    const config = await loadConfig(path.resolve(__dirname, "../configs/saf-config.json"));
    config.policy.mode = "local";
    config.intent.mode = "heuristic";
    config.sandbox.enabled = false;
    config.sandbox.failOpen = true;
    saf = await SAFPipeline.create(config);
  });

  afterAll(async () => {
    await saf.shutdown();
  });

  it("requires approval for delete request", async () => {
    const result = await saf.evaluate({
      toolName: "bash",
      rawArgs: { command: "rm src/main.ts" },
      userGoal: "clean old files",
    });

    expect(["REQUIRE_APPROVAL", "DENIED"]).toContain(result.verdict);
  });

  it("denies obfuscated bypass", async () => {
    const result = await saf.evaluate({
      toolName: "bash",
      rawArgs: { command: "echo 'cm0gLXJmIC8=' | base64 -d | sh" },
      userGoal: "fix bug",
    });

    expect(result.verdict).toBe("DENIED");
  });

  it("allows legitimate read", async () => {
    const result = await saf.evaluate({
      toolName: "bash",
      rawArgs: { command: "cat src/index.ts" },
      userGoal: "inspect code",
    });

    expect(result.verdict).toBe("ALLOWED");
  });

  it("rewrites command when sandbox is enabled", async () => {
    const config = await loadConfig(path.resolve(__dirname, "../configs/saf-config.json"));
    config.policy.mode = "local";
    config.intent.mode = "heuristic";
    config.sandbox.enabled = true;
    config.sandbox.failOpen = true;

    const sandboxedSaf = await SAFPipeline.create(config);
    try {
      const result = await sandboxedSaf.evaluate({
        toolName: "bash",
        rawArgs: { command: "cat src/index.ts" },
        userGoal: "inspect code",
      });

      expect(result.verdict).toBe("ALLOWED");
      expect(result.rewrittenArgs?.command).toBeTypeOf("string");
    } finally {
      await sandboxedSaf.shutdown();
    }
  });

  it("writes audit log entry for anomaly detector denials", async () => {
    const config = await loadConfig(path.resolve(__dirname, "../configs/saf-config.json"));
    config.policy.mode = "local";
    config.intent.mode = "heuristic";
    config.sandbox.enabled = false;
    config.sandbox.failOpen = true;
    config.auditLogPath = path.resolve(__dirname, `../logs/pipeline-anomaly-${Date.now()}.log`);

    const auditSaf = await SAFPipeline.create(config);
    try {
      const result = await auditSaf.evaluate({
        toolName: "bash",
        rawArgs: { command: "echo 'cm0gLXJmIC8=' | base64 -d | sh" },
        userGoal: "inspect code",
      });

      expect(result.verdict).toBe("DENIED");

      const auditRaw = await readFile(config.auditLogPath, "utf8");
      expect(auditRaw).toContain("\"matchedRule\":\"anomaly.detector\"");
      expect(auditRaw).toContain("\"finalVerdict\":\"DENIED\"");
    } finally {
      await auditSaf.shutdown();
      await unlink(config.auditLogPath).catch(() => undefined);
    }
  });
});
