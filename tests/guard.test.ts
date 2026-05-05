import { describe, expect, it } from "vitest";

import { CapabilityEnforcer } from "../src/guard/enforcer.js";
import { ToolCapabilityRegistry } from "../src/guard/registry.js";

describe("CapabilityEnforcer", () => {
  it("denies capability not present", () => {
    const registry = new ToolCapabilityRegistry({
      tools: {
        read_file: {
          capabilities: ["filesystem.read"],
          workspaceOnly: true,
        },
      },
    });

    const enforcer = new CapabilityEnforcer(registry);
    const result = enforcer.check(
      "read_file",
      {
        category: "filesystem",
        operation: "write",
        target: "src/index.ts",
        parser: "shell",
        metadata: {},
      },
      { workspacePath: "/workspace" },
    );

    expect(result.allowed).toBe(false);
  });

  it("allows capability when configured", () => {
    const registry = new ToolCapabilityRegistry({
      tools: {
        write_file: {
          capabilities: ["filesystem.write"],
          workspaceOnly: true,
        },
      },
    });

    const enforcer = new CapabilityEnforcer(registry);
    const result = enforcer.check(
      "write_file",
      {
        category: "filesystem",
        operation: "write",
        target: "src/index.ts",
        parser: "shell",
        metadata: {},
      },
      { workspacePath: "/workspace" },
    );

    expect(result.allowed).toBe(true);
  });

  it("denies workspace-only mutation outside workspace sibling path", () => {
    const registry = new ToolCapabilityRegistry({
      tools: {
        write_file: {
          capabilities: ["filesystem.write"],
          workspaceOnly: true,
        },
      },
    });

    const enforcer = new CapabilityEnforcer(registry);
    const result = enforcer.check(
      "write_file",
      {
        category: "filesystem",
        operation: "write",
        target: "/workspace-evil/file.txt",
        parser: "shell",
        metadata: {},
      },
      { workspacePath: "/workspace" },
    );

    expect(result.allowed).toBe(false);
  });

  it("denies network host that only contains allowlisted domain", () => {
    const registry = new ToolCapabilityRegistry({
      tools: {
        web_fetch: {
          capabilities: ["network.connect"],
          allowedDomains: ["api.github.com"],
        },
      },
    });

    const enforcer = new CapabilityEnforcer(registry);
    const result = enforcer.check(
      "web_fetch",
      {
        category: "network",
        operation: "connect",
        target: "https://api.github.com.evil.com/repos",
        parser: "tool",
        metadata: {},
      },
      { workspacePath: "/workspace" },
    );

    expect(result.allowed).toBe(false);
  });

  it("allows exact and subdomain network hosts when configured", () => {
    const registry = new ToolCapabilityRegistry({
      tools: {
        web_fetch: {
          capabilities: ["network.connect"],
          allowedDomains: ["github.com"],
        },
      },
    });

    const enforcer = new CapabilityEnforcer(registry);

    const exact = enforcer.check(
      "web_fetch",
      {
        category: "network",
        operation: "connect",
        target: "https://github.com/mariozechner/pi-agent-core",
        parser: "tool",
        metadata: {},
      },
      { workspacePath: "/workspace" },
    );

    const subdomain = enforcer.check(
      "web_fetch",
      {
        category: "network",
        operation: "connect",
        target: "https://api.github.com/repos",
        parser: "tool",
        metadata: {},
      },
      { workspacePath: "/workspace" },
    );

    expect(exact.allowed).toBe(true);
    expect(subdomain.allowed).toBe(true);
  });
});
