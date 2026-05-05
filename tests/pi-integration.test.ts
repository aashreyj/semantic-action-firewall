import { describe, expect, it } from "vitest";

import { resolveBeforeToolCallResult } from "../src/interceptor/pi-integration.js";

describe("resolveBeforeToolCallResult", () => {
  it("keeps original args when hook allows and does not rewrite", () => {
    const original = { command: "cat src/index.ts" };
    const result = resolveBeforeToolCallResult(original, undefined);

    expect(result.blocked).toBe(false);
    expect(result.requiresApproval).toBe(false);
    expect(result.args).toBe(original);
  });

  it("returns blocked resolution when hook blocks", () => {
    const original = { command: "rm -rf /" };
    const result = resolveBeforeToolCallResult(original, {
      block: true,
      reason: "blocked by policy",
    });

    expect(result.blocked).toBe(true);
    expect(result.requiresApproval).toBe(false);
    expect(result.reason).toBe("blocked by policy");
    expect(result.args).toBe(original);
  });

  it("returns approval resolution when hook requires approval", () => {
    const original = { command: "rm -rf /tmp/cache" };
    const result = resolveBeforeToolCallResult(original, {
      requireApproval: true,
      reason: "approval required",
    });

    expect(result.blocked).toBe(false);
    expect(result.requiresApproval).toBe(true);
    expect(result.reason).toBe("approval required");
    expect(result.args).toBe(original);
  });

  it("returns rewritten args when hook rewrites", () => {
    const original = { command: "cat src/index.ts" };
    const rewritten = { command: "sandbox-wrapper -- cat src/index.ts" };
    const result = resolveBeforeToolCallResult(original, {
      args: rewritten,
    });

    expect(result.blocked).toBe(false);
    expect(result.requiresApproval).toBe(false);
    expect(result.args).toBe(rewritten);
  });
});
