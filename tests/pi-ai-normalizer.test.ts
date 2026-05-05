import { describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@mariozechner/pi-ai";

import { PiAINormalizer } from "../src/normalizer/pi-ai-normalizer.js";

describe("PiAINormalizer", () => {
  it("returns explicit error for missing API key", async () => {
    const previous = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    try {
      const normalizer = new PiAINormalizer({
        mode: "hybrid",
        provider: "google",
        model: "gemma-4-26b-a4b-it",
        apiKeyEnvVar: "GOOGLE_GENERATIVE_AI_API_KEY",
        timeoutMs: 1500,
        maxPayloadChars: 8000,
        cacheEnabled: true,
        cacheMaxEntries: 100,
      });

      const result = await normalizer.normalize({
        toolName: "bash",
        rawArgs: { command: "cat src/index.ts" },
        payload: "cat src/index.ts",
      });

      expect(result.action).toBeNull();
      expect(result.error).toContain("Missing GOOGLE_GENERATIVE_AI_API_KEY");
    } finally {
      if (previous === undefined) {
        delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      } else {
        process.env.GOOGLE_GENERATIVE_AI_API_KEY = previous;
      }
    }
  });

  it("normalizes action for gemma model via google api", async () => {
    const previous = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
    const faux = registerFauxProvider({
      api: "google-generative-ai",
      provider: "google",
      models: [{ id: "gemma-4-26b-a4b-it" }],
    });

    try {
      faux.setResponses([
        fauxAssistantMessage(
          [
            fauxToolCall("normalize_action", {
              category: "filesystem",
              operation: "delete",
              target: "source.txt",
              metadata: {
                force: true,
              },
            }),
          ],
          { stopReason: "toolUse" },
        ),
      ]);

      const normalizer = new PiAINormalizer({
        mode: "hybrid",
        provider: "google",
        model: "gemma-4-26b-a4b-it",
        apiKeyEnvVar: "GOOGLE_GENERATIVE_AI_API_KEY",
        timeoutMs: 1500,
        maxPayloadChars: 8000,
        cacheEnabled: true,
        cacheMaxEntries: 100,
      });

      const result = await normalizer.normalize({
        toolName: "bash",
        rawArgs: { command: "python -c \"import os; os.remove('source.txt')\"" },
        payload: "python -c \"import os; os.remove('source.txt')\"",
      });

      expect(result.error).toBeUndefined();
      expect(result.action).not.toBeNull();
      expect(result.action?.parser).toBe("llm");
      expect(result.action?.category).toBe("filesystem");
      expect(result.action?.operation).toBe("delete");
      expect(result.action?.target).toBe("source.txt");
    } finally {
      if (previous === undefined) {
        delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      } else {
        process.env.GOOGLE_GENERATIVE_AI_API_KEY = previous;
      }
      faux.unregister();
    }
  });

  it("returns explicit error for unknown model", async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key";

    try {
      const normalizer = new PiAINormalizer({
        mode: "hybrid",
        provider: "anthropic",
        model: "does-not-exist",
        apiKeyEnvVar: "ANTHROPIC_API_KEY",
        timeoutMs: 1500,
        maxPayloadChars: 8000,
        cacheEnabled: true,
        cacheMaxEntries: 100,
      });

      const result = await normalizer.normalize({
        toolName: "bash",
        rawArgs: { command: "python -c \"print('x')\"" },
        payload: "python -c \"print('x')\"",
      });

      expect(result.action).toBeNull();
      expect(result.error).toContain("Unknown model 'does-not-exist' for provider 'anthropic'");
    } finally {
      if (previous === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = previous;
      }
    }
  });
});
