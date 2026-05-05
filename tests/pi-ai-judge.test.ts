import { describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@mariozechner/pi-ai";

import { PiAIJudge } from "../src/intent/pi-ai-judge.js";

describe("PiAIJudge", () => {
  it("upgrades approval to validated when reason is clearly positive and operation is allowed", async () => {
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
            fauxToolCall("security_verdict", {
              verdict: "REQUIRE_APPROVAL",
              reason: "The action directly aligns with the goal and the operation is explicitly allowed.",
              confidence: 0.9,
            }),
          ],
          { stopReason: "toolUse" },
        ),
      ]);

      const judge = new PiAIJudge({
        mode: "pi-ai",
        provider: "google",
        model: "gemma-4-26b-a4b-it",
        apiKeyEnvVar: "GOOGLE_GENERATIVE_AI_API_KEY",
        timeoutMs: 1500,
        doubleCheck: false,
      });

      const verdict = await judge.evaluate(
        {
          category: "filesystem",
          operation: "write",
          target: "src/main.ts",
          parser: "tool",
          metadata: {},
        },
        {
          primaryIntent: "write and fix src/main.ts",
          allowRead: true,
          allowWrite: true,
          allowDelete: false,
          allowExecute: false,
          allowNetwork: false,
          targetHints: ["src/main.ts"],
          sensitiveDataAllowed: false,
          externalTransferAllowed: false,
          approvalMentioned: false,
        },
      );

      expect(verdict.verdict).toBe("VALIDATED");
    } finally {
      if (previous === undefined) {
        delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      } else {
        process.env.GOOGLE_GENERATIVE_AI_API_KEY = previous;
      }
      faux.unregister();
    }
  });

  it("keeps approval when reason signals uncertainty", async () => {
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
            fauxToolCall("security_verdict", {
              verdict: "REQUIRE_APPROVAL",
              reason: "The request may align but is ambiguous and requires approval.",
              confidence: 0.6,
            }),
          ],
          { stopReason: "toolUse" },
        ),
      ]);

      const judge = new PiAIJudge({
        mode: "pi-ai",
        provider: "google",
        model: "gemma-4-26b-a4b-it",
        apiKeyEnvVar: "GOOGLE_GENERATIVE_AI_API_KEY",
        timeoutMs: 1500,
        doubleCheck: false,
      });

      const verdict = await judge.evaluate(
        {
          category: "filesystem",
          operation: "write",
          target: "src/main.ts",
          parser: "tool",
          metadata: {},
        },
        {
          primaryIntent: "write and fix src/main.ts",
          allowRead: true,
          allowWrite: true,
          allowDelete: false,
          allowExecute: false,
          allowNetwork: false,
          targetHints: ["src/main.ts"],
          sensitiveDataAllowed: false,
          externalTransferAllowed: false,
          approvalMentioned: false,
        },
      );

      expect(verdict.verdict).toBe("REQUIRE_APPROVAL");
    } finally {
      if (previous === undefined) {
        delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      } else {
        process.env.GOOGLE_GENERATIVE_AI_API_KEY = previous;
      }
      faux.unregister();
    }
  });
});
