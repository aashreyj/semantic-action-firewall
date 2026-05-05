import { spawn } from "node:child_process";

export interface SandboxExecutionResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface SandboxRunnerOptions {
  cwd: string;
  timeoutMs?: number;
}

export class SandboxRunner {
  public async execute(command: string, options: SandboxRunnerOptions): Promise<SandboxExecutionResult> {
    const timeoutMs = options.timeoutMs ?? 30_000;

    return await new Promise<SandboxExecutionResult>((resolve, reject) => {
      const child = spawn(command, {
        cwd: options.cwd,
        shell: true,
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });

      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.on("error", (error) => {
        reject(error);
      });

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);

      child.on("close", (code) => {
        clearTimeout(timeout);
        resolve({
          code,
          stdout,
          stderr,
          timedOut,
        });
      });
    });
  }
}
