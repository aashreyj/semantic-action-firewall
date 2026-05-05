import path from "node:path";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

import { type AgentMessage, type AgentTool } from "@mariozechner/pi-agent-core";
import { fauxAssistantMessage, fauxText, fauxToolCall, getModel, registerFauxProvider } from "@mariozechner/pi-ai";
import { Type, type Static } from "@sinclair/typebox";

import { createSAFEnabledAgent, loadConfig } from "../src/index.js";
import { isWithinWorkspace } from "../src/security/validators.js";

const bashParamsSchema = Type.Object({
  command: Type.String(),
});

const readFileParamsSchema = Type.Object({
  path: Type.String(),
});

type BashParams = Static<typeof bashParamsSchema>;
type ReadFileParams = Static<typeof readFileParamsSchema>;

function resolveInsideWorkspace(workspacePath: string, targetPath: string): string {
  const resolved = path.resolve(workspacePath, targetPath);
  if (!isWithinWorkspace(resolved, workspacePath)) {
    throw new Error(`Path outside workspace is not allowed: ${targetPath}`);
  }
  return resolved;
}

function createBashTool(workspacePath: string): AgentTool<typeof bashParamsSchema, {
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return {
    name: "bash",
    label: "Bash",
    description: "Execute a shell command in the workspace",
    parameters: bashParamsSchema,
    execute: async (_toolCallId, params, signal) => {
      const result = await runCommand(params as BashParams, workspacePath, signal);
      return {
        content: [
          {
            type: "text",
            text: result.stderr.trim().length > 0
              ? `${result.stdout.trim()}\n${result.stderr.trim()}`.trim()
              : result.stdout,
          },
        ],
        details: result,
      };
    },
  };
}

function createReadFileTool(workspacePath: string): AgentTool<typeof readFileParamsSchema, {
  path: string;
  content: string;
}> {
  return {
    name: "read_file",
    label: "Read File",
    description: "Read a UTF-8 file from workspace",
    parameters: readFileParamsSchema,
    execute: async (_toolCallId, params) => {
      const typedParams = params as ReadFileParams;
      const absolutePath = resolveInsideWorkspace(workspacePath, typedParams.path);
      const content = await readFile(absolutePath, "utf8");
      return {
        content: [
          {
            type: "text",
            text: content,
          },
        ],
        details: {
          path: typedParams.path,
          content,
        },
      };
    },
  };
}

async function runCommand(
  params: BashParams,
  workspacePath: string,
  signal?: AbortSignal,
): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return await new Promise((resolve, reject) => {
    const child = spawn(params.command, {
      cwd: workspacePath,
      shell: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });

    const onAbort = () => {
      child.kill("SIGTERM");
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (error) => {
      signal?.removeEventListener("abort", onAbort);
      reject(error);
    });

    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      resolve({ code, stdout, stderr });
    });
  });
}

function extractLastAssistantText(messages: AgentMessage[]): string {
  const assistant = [...messages].reverse().find(
    (message): message is Extract<AgentMessage, { role: "assistant" }> =>
      typeof message === "object" && message !== null && "role" in message && message.role === "assistant",
  );

  if (!assistant) {
    return "(no assistant message)";
  }

  const text = assistant.content
    .filter((content): content is Extract<typeof content, { type: "text" }> => content.type === "text")
    .map((content) => content.text)
    .join("\n")
    .trim();

  if (text.length > 0) {
    return text;
  }

  if (assistant.errorMessage) {
    return `[assistant error] ${assistant.errorMessage}`;
  }

  const toolCalls = assistant.content
    .filter((content): content is Extract<typeof content, { type: "toolCall" }> => content.type === "toolCall")
    .map((content) => `${content.name}(${JSON.stringify(content.arguments)})`)
    .join(", ");

  if (toolCalls.length > 0) {
    return `[assistant used tools] ${toolCalls}`;
  }

  return `(assistant message had no text, stopReason=${assistant.stopReason})`;
}

function parseArgs(argv: string[]): {
  live: boolean;
  prompt: string;
} {
  const live = argv.includes("--live");
  const prompt = argv
    .filter((arg) => arg !== "--live")
    .join(" ")
    .trim();

  return {
    live,
    prompt: prompt.length > 0 ? prompt : "Read package.json and tell me the package name.",
  };
}

function withSafeExampleOverrides(config: Awaited<ReturnType<typeof loadConfig>>): Awaited<ReturnType<typeof loadConfig>> {
  if (config.policy.mode === "opa") {
    config.policy.mode = "local";
  }

  if (config.intent.mode === "pi-ai") {
    config.intent.mode = "heuristic";
  }

  return config;
}

function resolveModel(provider: string, modelId: string): ReturnType<typeof getModel> {
  const known = getModel(provider as never, modelId as never);
  if (known) {
    return known;
  }

  if (provider === "google") {
    return {
      id: modelId,
      name: modelId,
      api: "google-generative-ai",
      provider: "google",
      baseUrl: "",
      reasoning: true,
      input: ["text", "image"],
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      contextWindow: 262144,
      maxTokens: 32768,
    } as ReturnType<typeof getModel>;
  }

  throw new Error(`Unknown model '${modelId}' for provider '${provider}'.`);
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const config = withSafeExampleOverrides(await loadConfig(path.resolve(process.cwd(), "configs/saf-config.json")));

  let fauxRegistration: ReturnType<typeof registerFauxProvider> | undefined;
  let shutdown: (() => Promise<void>) | undefined;

  try {
    const rawTools = [
      createBashTool(config.workspacePath),
      createReadFileTool(config.workspacePath),
    ];

    const model = parsed.live
      ? resolveModel("google", "gemma-4-26b-a4b-it")
      : (() => {
          fauxRegistration = registerFauxProvider();
          fauxRegistration.setResponses([
            fauxAssistantMessage(
              [
                fauxToolCall(
                  "bash",
                  {
                    command: "cat package.json",
                  },
                  { id: "tool-faux-1" },
                ),
              ],
              {
                stopReason: "toolUse",
              },
            ),
            fauxAssistantMessage([fauxText("The package name is semantic-action-firewall.")], {
              stopReason: "stop",
            }),
          ]);
          return fauxRegistration.getModel();
        })();

    const apiKeyEnvVar = config.intent.apiKeyEnvVar ?? "GOOGLE_GENERATIVE_AI_API_KEY";

    if (parsed.live && !process.env[apiKeyEnvVar]) {
      throw new Error(`Missing ${apiKeyEnvVar}. Set it, or run example without --live.`);
    }

    const handle = await createSAFEnabledAgent({
      config,
      systemPrompt: "You are a coding assistant. Use tools carefully and explain what you changed.",
      model,
      tools: rawTools,
      sessionId: `example-${Date.now()}`,
      agentId: "pi-agent-core-example",
      agentMode: "autonomous",
      toolExecution: "sequential",
      getApiKey: () => (parsed.live ? process.env[apiKeyEnvVar] : undefined),
    });
    const { agent } = handle;
    shutdown = handle.shutdown;

    await agent.prompt(parsed.prompt);

    const assistantText = extractLastAssistantText(agent.state.messages);
    console.log(assistantText);
  } finally {
    fauxRegistration?.unregister();
    if (shutdown) {
      await shutdown();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
