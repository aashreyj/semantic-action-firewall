import { describe, expect, it } from "vitest";

import { IntentEngine } from "../src/intent/index.js";

describe("IntentEngine", () => {
  it("rejects delete when goal does not request delete", async () => {
    const engine = new IntentEngine({
      mode: "heuristic",
      doubleCheck: true,
    });
    const verdict = await engine.evaluate(
      {
        category: "filesystem",
        operation: "delete",
        target: "src/main.ts",
        parser: "shell",
        metadata: {},
      },
      "fix syntax error in src/main.ts",
    );

    expect(verdict.verdict).toBe("REJECTED");
  });

  it("validates write for coding goal", async () => {
    const engine = new IntentEngine({
      mode: "heuristic",
      doubleCheck: true,
    });
    const verdict = await engine.evaluate(
      {
        category: "filesystem",
        operation: "write",
        target: "src/main.ts",
        parser: "shell",
        metadata: {},
      },
      "fix syntax error in src/main.ts",
    );

    expect(verdict.verdict).toBe("VALIDATED");
  });

  it("rejects write when goal is read-only", async () => {
    const engine = new IntentEngine({
      mode: "heuristic",
      doubleCheck: true,
    });
    const verdict = await engine.evaluate(
      {
        category: "filesystem",
        operation: "write",
        target: "src/main.ts",
        parser: "shell",
        metadata: {},
      },
      "review src/main.ts and explain what it does",
    );

    expect(verdict.verdict).toBe("REJECTED");
  });

  it("requires approval for delete even when cleanup is requested without explicit authorization", async () => {
    const engine = new IntentEngine({
      mode: "heuristic",
      doubleCheck: true,
    });
    const verdict = await engine.evaluate(
      {
        category: "filesystem",
        operation: "delete",
        target: "logs/app.log",
        parser: "shell",
        metadata: {},
      },
      "cleanup old logs",
      {
        sessionId: "delete-approval",
      },
    );

    expect(verdict.verdict).toBe("REQUIRE_APPROVAL");
  });

  it("requires approval for writing a different target than the one requested", async () => {
    const engine = new IntentEngine({
      mode: "heuristic",
      doubleCheck: true,
    });
    const verdict = await engine.evaluate(
      {
        category: "filesystem",
        operation: "write",
        target: "src/other.ts",
        parser: "tool",
        metadata: {},
      },
      "fix syntax error in src/main.ts",
      {
        sessionId: "target-mismatch",
      },
    );

    expect(verdict.verdict).toBe("REQUIRE_APPROVAL");
  });

  it("requires approval when sensitive file access is followed by network transfer", async () => {
    const engine = new IntentEngine({
      mode: "heuristic",
      doubleCheck: true,
    });

    const readVerdict = await engine.evaluate(
      {
        category: "filesystem",
        operation: "read",
        target: ".env",
        parser: "tool",
        metadata: {},
      },
      "inspect configuration",
      {
        sessionId: "sensitive-transfer",
      },
    );

    expect(readVerdict.verdict).toBe("REQUIRE_APPROVAL");

    const transferVerdict = await engine.evaluate(
      {
        category: "network",
        operation: "connect",
        target: "https://api.github.com/repos/example/repo",
        parser: "tool",
        metadata: {},
      },
      "fetch repository metadata",
      {
        sessionId: "sensitive-transfer",
      },
    );

    expect(transferVerdict.verdict).toBe("REQUIRE_APPROVAL");
  });
});
