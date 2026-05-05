import { describe, expect, it } from "vitest";

import { OPAPolicyEngine } from "../src/policy/opa-engine.js";
import { LocalPolicyEngine } from "../src/policy/engine.js";
import type { PolicyConfig } from "../src/types.js";

const localConfig: PolicyConfig = {
  defaultBehavior: "deny",
  scopes: {
    filesystem: {
      read: "allow",
      write: "flag_intent",
      delete: "require_approval",
    },
  },
  allowedDomains: [],
  protectedPaths: [],
};

describe("OPAPolicyEngine", () => {
  it("falls back to local engine when OPA is unreachable", async () => {
    const fallback = new LocalPolicyEngine(localConfig);
    const engine = new OPAPolicyEngine(
      "http://127.0.0.1:1/v1/data/saf/decision",
      50,
      "local",
      localConfig,
      fallback,
    );

    const decision = await engine.evaluate(
      {
        category: "filesystem",
        operation: "read",
        target: "src/index.ts",
        parser: "shell",
        metadata: {},
      },
      { workspacePath: "/workspace" },
    );

    expect(decision.verdict).toBe("ALLOW");
    expect(decision.matchedRule).toContain("fallback.local");
  });

  it("returns deny fallback mode when configured", async () => {
    const engine = new OPAPolicyEngine("http://127.0.0.1:1/v1/data/saf/decision", 50, "deny", localConfig);

    const decision = await engine.evaluate(
      {
        category: "filesystem",
        operation: "read",
        target: "src/index.ts",
        parser: "shell",
        metadata: {},
      },
      { workspacePath: "/workspace" },
    );

    expect(decision.verdict).toBe("DENY");
    expect(decision.matchedRule).toBe("fallback.deny");
  });
});
