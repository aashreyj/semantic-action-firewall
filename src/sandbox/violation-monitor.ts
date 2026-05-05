import { SandboxManager } from "@anthropic-ai/sandbox-runtime";

export interface SandboxViolation {
  kind: "filesystem" | "network" | "process";
  detail: string;
  timestamp: number;
}

export class SandboxViolationMonitor {
  public pullFromRuntime(limit = 20): SandboxViolation[] {
    const store = SandboxManager.getSandboxViolationStore();
    const events = store.getViolations(limit);
    const mapped = events.map((event): SandboxViolation => ({
      kind: this.inferKind(event.line),
      detail: event.line,
      timestamp: event.timestamp.getTime(),
    }));

    for (const violation of mapped) {
      this.record(violation);
    }

    return mapped;
  }

  private readonly violations: SandboxViolation[] = [];

  public record(violation: SandboxViolation): void {
    this.violations.push(violation);
  }

  public list(): SandboxViolation[] {
    return [...this.violations];
  }

  public clear(): void {
    this.violations.length = 0;
  }

  private inferKind(line: string): SandboxViolation["kind"] {
    const normalized = line.toLowerCase();
    if (normalized.includes("network") || normalized.includes("socket") || normalized.includes("connect")) {
      return "network";
    }

    if (normalized.includes("exec") || normalized.includes("process")) {
      return "process";
    }

    return "filesystem";
  }
}
