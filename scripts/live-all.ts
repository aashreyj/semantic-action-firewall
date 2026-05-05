import { spawn } from "node:child_process";

async function run(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: true,
      env: process.env,
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Command '${command} ${args.join(" ")}' failed with exit code ${code ?? "null"}.`));
    });
  });
}

async function main(): Promise<void> {
  await run("npm", ["run", "live:preflight"]);
  await run("npm", ["run", "live:scenarios"]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
