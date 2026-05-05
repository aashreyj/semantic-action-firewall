import { describe, expect, it } from "vitest";

import { ActionNormalizer } from "../src/normalizer/index.js";

describe("ActionNormalizer", () => {
  it("normalizes shell delete command", async () => {
    const normalizer = new ActionNormalizer({ mode: "deterministic" });
    const result = await normalizer.normalize({
      toolName: "bash",
      rawArgs: { command: "rm -rf tmp/cache" },
    });

    expect(result.category).toBe("filesystem");
    expect(result.operation).toBe("delete");
    expect(result.target).toBe("tmp/cache");
    expect(result.metadata.recursive).toBe(true);
    expect(result.metadata.force).toBe(true);
  });

  it("normalizes python network command", async () => {
    const normalizer = new ActionNormalizer({ mode: "deterministic" });
    const result = await normalizer.normalize({
      toolName: "python",
      rawArgs: { code: "import requests\nrequests.get('https://api.github.com')" },
    });

    expect(result.category).toBe("network");
    expect(result.operation).toBe("connect");
  });

  it("falls back when no parser matches", async () => {
    const normalizer = new ActionNormalizer({ mode: "deterministic" });
    const result = await normalizer.normalize({
      toolName: "unknown",
      rawArgs: { anything: "opaque payload" },
    });

    expect(result.category).toBe("unknown");
    expect(result.operation).toBe("unknown");
  });

  it("treats shell redirection as filesystem write", async () => {
    const normalizer = new ActionNormalizer({ mode: "deterministic" });
    const result = await normalizer.normalize({
      toolName: "bash",
      rawArgs: { command: "cat src/index.ts > out.txt" },
    });

    expect(result.category).toBe("filesystem");
    expect(result.operation).toBe("write");
    expect(result.target).toBe("out.txt");
    expect(result.metadata.redirectedTo).toBe("out.txt");
  });

  it("treats tee pipeline as filesystem write", async () => {
    const normalizer = new ActionNormalizer({ mode: "deterministic" });
    const result = await normalizer.normalize({
      toolName: "bash",
      rawArgs: { command: "cat src/index.ts | tee logs/output.txt" },
    });

    expect(result.category).toBe("filesystem");
    expect(result.operation).toBe("write");
    expect(result.target).toBe("logs/output.txt");
  });

  it("uses copy destination as target", async () => {
    const normalizer = new ActionNormalizer({ mode: "deterministic" });
    const result = await normalizer.normalize({
      toolName: "bash",
      rawArgs: { command: "cp src/index.ts ../outside.ts" },
    });

    expect(result.category).toBe("filesystem");
    expect(result.operation).toBe("write");
    expect(result.target).toBe("../outside.ts");
  });

  it("uses move destination as target", async () => {
    const normalizer = new ActionNormalizer({ mode: "deterministic" });
    const result = await normalizer.normalize({
      toolName: "bash",
      rawArgs: { command: "mv src/index.ts ../outside.ts" },
    });

    expect(result.category).toBe("filesystem");
    expect(result.operation).toBe("write");
    expect(result.target).toBe("../outside.ts");
  });

  it("classifies npm test as process execute", async () => {
    const normalizer = new ActionNormalizer({ mode: "deterministic" });
    const result = await normalizer.normalize({
      toolName: "bash",
      rawArgs: { command: "npm test" },
    });

    expect(result.category).toBe("process");
    expect(result.operation).toBe("execute");
    expect(result.target).toBe("npm");
  });

  it("classifies write-like read_file invocation as write", async () => {
    const normalizer = new ActionNormalizer({ mode: "deterministic" });
    const result = await normalizer.normalize({
      toolName: "read_file",
      rawArgs: {
        path: "code/secret.txt",
        operation: "write",
        content: "malicious overwrite",
      },
    });

    expect(result.category).toBe("filesystem");
    expect(result.operation).toBe("write");
    expect(result.target).toBe("code/secret.txt");
  });

  it("uses LLM normalization in hybrid mode for complex payloads", async () => {
    let calls = 0;
    const normalizer = new ActionNormalizer(
      {
        mode: "hybrid",
      },
      {
        normalize: async () => {
          calls += 1;
          return {
            action: {
              category: "filesystem",
              operation: "delete",
              target: "tmp/owned.txt",
              parser: "llm",
              metadata: {
                flags: {
                  source: "llm",
                },
              },
            },
          };
        },
      },
    );

    const result = await normalizer.normalize({
      toolName: "bash",
      rawArgs: { command: "python -c \"import os; os.remove('tmp/owned.txt')\"" },
    });

    expect(result.parser).toBe("llm");
    expect(result.category).toBe("filesystem");
    expect(result.operation).toBe("delete");
    expect(result.target).toBe("tmp/owned.txt");
    expect(calls).toBe(1);
  });

  it("keeps deterministic process execute for simple npm test in hybrid mode", async () => {
    let calls = 0;
    const normalizer = new ActionNormalizer(
      {
        mode: "hybrid",
      },
      {
        normalize: async () => {
          calls += 1;
          return {
            action: {
              category: "unknown",
              operation: "unknown",
              target: "unknown",
              parser: "llm",
              metadata: {},
            },
          };
        },
      },
    );

    const result = await normalizer.normalize({
      toolName: "bash",
      rawArgs: { command: "npm test" },
    });

    expect(calls).toBe(0);
    expect(result.parser).toBe("shell");
    expect(result.category).toBe("process");
    expect(result.operation).toBe("execute");
    expect(result.target).toBe("npm");
  });

  it("caches LLM normalization results", async () => {
    let calls = 0;
    const llmResult = {
      category: "network" as const,
      operation: "connect" as const,
      target: "https://example.com",
      parser: "llm" as const,
      metadata: {},
    };

    const normalizer = new ActionNormalizer(
      {
        mode: "llm",
        cacheEnabled: true,
        cacheMaxEntries: 8,
      },
      {
        normalize: async () => {
          calls += 1;
          return { action: llmResult };
        },
      },
    );

    const input = {
      toolName: "bash",
      rawArgs: { command: "curl https://example.com" },
    };

    const first = await normalizer.normalize(input);
    const second = await normalizer.normalize(input);

    expect(first.parser).toBe("llm");
    expect(second.parser).toBe("llm");
    expect(calls).toBe(1);
  });

  it("falls back safely when LLM returns malformed output", async () => {
    const normalizer = new ActionNormalizer(
      {
        mode: "llm",
      },
      {
        normalize: async () => ({ action: null, error: "bad response" }),
      },
    );

    const result = await normalizer.normalize({
      toolName: "bash",
      rawArgs: { command: "python -c \"print('x')\"" },
    });

    expect(result.parser).toBe("fallback");
    expect(result.category).toBe("unknown");
    expect(result.operation).toBe("unknown");
    expect(result.metadata.flags?.reason).toContain("LLM-only normalization failed: bad response");
  });

  it("does not degrade to deterministic result when escalated LLM fails", async () => {
    const normalizer = new ActionNormalizer(
      {
        mode: "hybrid",
      },
      {
        normalize: async () => ({ action: null, error: "timeout" }),
      },
    );

    const result = await normalizer.normalize({
      toolName: "bash",
      rawArgs: { command: "python -c \"import os; os.remove('tmp/owned.txt')\"" },
    });

    expect(result.parser).toBe("fallback");
    expect(result.category).toBe("unknown");
    expect(result.operation).toBe("unknown");
    expect(result.metadata.flags?.reason).toContain("escalation=deterministic-process-execute");
  });
});
