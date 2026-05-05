import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";

interface OpaProbeResult {
  decision?: string;
  issue?: string;
}

export interface OpaHealthResult {
  decision: string;
  autoStarted: boolean;
}

interface EnsureOpaEndpointHealthyOptions {
  opaUrl: string;
  workspacePath: string;
  autoStart: boolean;
  setupScriptPath: string;
  probeTimeoutMs: number;
  startupWaitTimeoutMs?: number;
}

function isLocalOpaUrl(opaUrl: string): boolean {
  try {
    const parsed = new URL(opaUrl);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function parseOpaDecision(payload: unknown): string | undefined {
  if (typeof payload === "string") {
    return payload;
  }

  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  return typeof record.decision === "string" ? record.decision : undefined;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function probeOpaEndpoint(opaUrl: string, workspacePath: string, timeoutMs: number): Promise<OpaProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(opaUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        input: {
          action: {
            category: "filesystem",
            operation: "read",
            target: "README.md",
            parser: "tool",
            metadata: {},
          },
          context: {
            workspacePath,
            toolName: "read_file",
          },
          policy: {
            defaultBehavior: "deny",
            allowedDomains: ["api.github.com"],
            protectedPaths: ["/", "/etc"],
          },
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        issue: `OPA endpoint returned HTTP ${response.status}`,
      };
    }

    const body = (await response.json()) as { result?: unknown };
    const decision = parseOpaDecision(body.result);
    if (!decision) {
      return {
        issue: "OPA response did not contain a decision",
      };
    }

    return {
      decision,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      issue: `OPA endpoint probe failed: ${reason}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

function startOpa(setupScriptPath: string): void {
  const child = spawn(setupScriptPath, [], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export async function ensureOpaEndpointHealthy(options: EnsureOpaEndpointHealthyOptions): Promise<OpaHealthResult> {
  const probeTimeoutMs = Math.max(options.probeTimeoutMs, 1000);
  const first = await probeOpaEndpoint(options.opaUrl, options.workspacePath, probeTimeoutMs);
  if (!first.issue && first.decision) {
    return {
      decision: first.decision,
      autoStarted: false,
    };
  }

  if (!options.autoStart || !isLocalOpaUrl(options.opaUrl)) {
    throw new Error(`${first.issue ?? "OPA probe failed"} at ${options.opaUrl}`);
  }

  try {
    await access(options.setupScriptPath, constants.X_OK);
  } catch {
    throw new Error(
      `${first.issue ?? "OPA probe failed"} at ${options.opaUrl}; auto-start unavailable (missing executable ${options.setupScriptPath})`,
    );
  }

  startOpa(options.setupScriptPath);

  const deadline = Date.now() + (options.startupWaitTimeoutMs ?? 12000);
  let lastIssue = first.issue ?? "OPA probe failed";
  while (Date.now() < deadline) {
    await wait(400);
    const probe = await probeOpaEndpoint(options.opaUrl, options.workspacePath, probeTimeoutMs);
    if (!probe.issue && probe.decision) {
      return {
        decision: probe.decision,
        autoStarted: true,
      };
    }
    lastIssue = probe.issue ?? lastIssue;
  }

  throw new Error(`${lastIssue} at ${options.opaUrl}; auto-start attempted via ${options.setupScriptPath}`);
}
