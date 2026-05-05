import { describe, expect, it } from "vitest";

import { LocalPolicyEngine } from "../src/policy/engine.js";
import type { PolicyConfig } from "../src/types.js";

const policyConfig: PolicyConfig = {
  defaultBehavior: "deny",
  scopes: {
    filesystem: {
      read: "allow",
      write: "flag_intent",
      delete: "require_approval",
    },
    network: {
      connect: "deny",
    },
  },
  allowedDomains: ["api.github.com"],
  protectedPaths: ["/"],
};

describe("PolicyEngine", () => {
  it("allows filesystem read", async () => {
    const engine = new LocalPolicyEngine(policyConfig);
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
  });

  it("requires approval for sensitive filesystem read", async () => {
    const engine = new LocalPolicyEngine(policyConfig);
    const decision = await engine.evaluate(
      {
        category: "filesystem",
        operation: "read",
        target: ".env",
        parser: "tool",
        metadata: {},
      },
      { workspacePath: "/workspace" },
    );

    expect(decision.verdict).toBe("REQUIRE_APPROVAL");
    expect(decision.matchedRule).toBe("sensitive-read");
  });

  it("denies disallowed network domain", async () => {
    const engine = new LocalPolicyEngine(policyConfig);
    const decision = await engine.evaluate(
      {
        category: "network",
        operation: "connect",
        target: "https://evil.example",
        parser: "shell",
        metadata: {},
      },
      { workspacePath: "/workspace" },
    );

    expect(decision.verdict).toBe("DENY");
  });

  it("denies network target that only contains allowlisted domain", async () => {
    const engine = new LocalPolicyEngine(policyConfig);
    const decision = await engine.evaluate(
      {
        category: "network",
        operation: "connect",
        target: "https://api.github.com.evil.com/repos",
        parser: "shell",
        metadata: {},
      },
      { workspacePath: "/workspace" },
    );

    expect(decision.verdict).toBe("DENY");
  });

  it("denies write outside workspace sibling path", async () => {
    const engine = new LocalPolicyEngine(policyConfig);
    const decision = await engine.evaluate(
      {
        category: "filesystem",
        operation: "write",
        target: "/workspace-evil/file.txt",
        parser: "shell",
        metadata: {},
      },
      { workspacePath: "/workspace" },
    );

    expect(decision.verdict).toBe("DENY");
  });

  it("denies delete on root-protected path", async () => {
    const engine = new LocalPolicyEngine(policyConfig);
    const decision = await engine.evaluate(
      {
        category: "filesystem",
        operation: "delete",
        target: "/workspace/src/index.ts",
        parser: "shell",
        metadata: {},
      },
      { workspacePath: "/workspace" },
    );

    expect(decision.verdict).toBe("DENY");
    expect(decision.matchedRule).toBe("protected-path-delete");
  });
});
