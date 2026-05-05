import { describe, expect, it } from "vitest";

import { buildSandboxConfig } from "../src/sandbox/config-generator.js";

describe("Sandbox config", () => {
  it("denies network by default for non-network actions", () => {
    const cfg = buildSandboxConfig(
      {
        category: "filesystem",
        operation: "read",
        target: "src/index.ts",
        parser: "shell",
        metadata: {},
      },
      "/workspace",
      ["api.github.com"],
    );

    expect(cfg.network.allowedDomains).toEqual([]);
  });

  it("permits allowed domains for network actions", () => {
    const cfg = buildSandboxConfig(
      {
        category: "network",
        operation: "connect",
        target: "https://api.github.com",
        parser: "shell",
        metadata: {},
      },
      "/workspace",
      ["api.github.com"],
    );

    expect(cfg.network.allowedDomains).toContain("api.github.com");
  });
});
