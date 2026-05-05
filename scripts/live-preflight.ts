import path from "node:path";
import { appendFile } from "node:fs/promises";

import type { AgentTool } from "@mariozechner/pi-agent-core";
import { complete, getModel } from "@mariozechner/pi-ai";
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import { Type } from "@sinclair/typebox";

import { loadConfig } from "../src/config.js";
import { createSAFEnabledAgent } from "../src/runtime/pi-agent-entrypoint.js";
import { buildSandboxConfig } from "../src/sandbox/config-generator.js";
import { ActionNormalizer } from "../src/normalizer/index.js";
import type { NormalizedAction, SAFConfig } from "../src/types.js";
import { ensureOpaEndpointHealthy } from "./opa-health.js";

interface LiveModelSelection {
  provider: string;
  model: string;
  apiKeyEnvVar: string;
  apiKey: string;
}

interface LiveNormalizerSelection {
  provider: string;
  model: string;
  apiKeyEnvVar: string;
  apiKey: string;
}

interface CheckResult {
  name: string;
  ok: boolean;
  details: string;
  durationMs: number;
}

const readFileSchema = Type.Object({
  path: Type.String(),
});

function resolveLiveModelSelection(config: SAFConfig): LiveModelSelection {
  const provider =
    process.env.SAF_LIVE_PROVIDER ?? (process.env.OPENROUTER_API_KEY ? "openrouter" : config.intent.provider ?? "google");

  const model =
    process.env.SAF_LIVE_MODEL ??
    (provider === "openrouter" ? "nvidia/nemotron-nano-9b-v2:free" : config.intent.model ?? "gemma-4-26b-a4b-it");

  const apiKeyEnvVar =
    process.env.SAF_LIVE_API_KEY_ENV ??
    (provider === "openrouter" ? "OPENROUTER_API_KEY" : config.intent.apiKeyEnvVar ?? "GOOGLE_GENERATIVE_AI_API_KEY");

  const apiKey = process.env[apiKeyEnvVar];
  if (!apiKey) {
    throw new Error(`Missing ${apiKeyEnvVar} for live model provider '${provider}'.`);
  }

  return {
    provider,
    model,
    apiKeyEnvVar,
    apiKey,
  };
}

function resolveLiveNormalizerSelection(config: SAFConfig): LiveNormalizerSelection {
  const provider = process.env.SAF_LIVE_NORMALIZER_PROVIDER ?? config.normalizer.provider ?? "google";
  const model = process.env.SAF_LIVE_NORMALIZER_MODEL ?? config.normalizer.model ?? "gemma-4-26b-a4b-it";
  const apiKeyEnvVar =
    process.env.SAF_LIVE_NORMALIZER_API_KEY_ENV ?? config.normalizer.apiKeyEnvVar ?? "GOOGLE_GENERATIVE_AI_API_KEY";
  const apiKey = process.env[apiKeyEnvVar];

  if (!apiKey) {
    throw new Error(`Missing ${apiKeyEnvVar} for live normalizer provider '${provider}'.`);
  }

  return {
    provider,
    model,
    apiKeyEnvVar,
    apiKey,
  };
}

function applyNormalizerOverrides(config: SAFConfig, normalizerSelection: LiveNormalizerSelection): void {
  const forcedMode = process.env.SAF_LIVE_NORMALIZER_MODE;
  if (forcedMode === "deterministic" || forcedMode === "hybrid" || forcedMode === "llm") {
    config.normalizer.mode = forcedMode;
  }

  config.normalizer.provider = normalizerSelection.provider;
  config.normalizer.model = normalizerSelection.model;
  config.normalizer.apiKeyEnvVar = normalizerSelection.apiKeyEnvVar;

  const timeoutOverrideRaw = process.env.SAF_LIVE_NORMALIZER_TIMEOUT_MS;
  if (timeoutOverrideRaw) {
    const parsed = Number(timeoutOverrideRaw);
    if (Number.isFinite(parsed) && parsed > 0) {
      config.normalizer.timeoutMs = Math.floor(parsed);
    }
  }
}

function applyIntentOverrides(config: SAFConfig, modelSelection: LiveModelSelection): void {
  const forcedMode = process.env.SAF_LIVE_INTENT_MODE;

  if (forcedMode === "heuristic") {
    config.intent.mode = "heuristic";
    return;
  }

  if (forcedMode === "pi-ai") {
    config.intent.mode = "pi-ai";
    config.intent.provider = process.env.SAF_LIVE_INTENT_PROVIDER ?? modelSelection.provider;
    config.intent.model = process.env.SAF_LIVE_INTENT_MODEL ?? modelSelection.model;
    config.intent.apiKeyEnvVar = process.env.SAF_LIVE_INTENT_API_KEY_ENV ?? modelSelection.apiKeyEnvVar;
    return;
  }

  if (config.intent.mode !== "pi-ai") {
    return;
  }

  const configuredKeyVar = config.intent.apiKeyEnvVar;
  const configuredKeyAvailable = Boolean(configuredKeyVar && process.env[configuredKeyVar]);
  if (configuredKeyAvailable) {
    return;
  }

  config.intent.provider = process.env.SAF_LIVE_INTENT_PROVIDER ?? modelSelection.provider;
  config.intent.model = process.env.SAF_LIVE_INTENT_MODEL ?? config.intent.model ?? modelSelection.model;
  config.intent.apiKeyEnvVar = process.env.SAF_LIVE_INTENT_API_KEY_ENV ?? modelSelection.apiKeyEnvVar;
}

function resolveLiveModel(provider: string, modelId: string): ReturnType<typeof getModel> {
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

async function runCheck(name: string, fn: () => Promise<string>): Promise<CheckResult> {
  const startedAt = performance.now();
  try {
    const details = await fn();
    return {
      name,
      ok: true,
      details,
      durationMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    return {
      name,
      ok: false,
      details,
      durationMs: Math.round(performance.now() - startedAt),
    };
  }
}

async function checkModelPing(modelSelection: LiveModelSelection): Promise<string> {
  const model = resolveLiveModel(modelSelection.provider, modelSelection.model);
  const reply = await complete(
    model,
    {
      systemPrompt: "You are a concise assistant.",
      messages: [
        {
          role: "user",
          content: "Reply with exactly: LIVE_PRECHECK_OK",
          timestamp: Date.now(),
        },
      ],
    },
    {
      apiKey: modelSelection.apiKey,
    },
  );

  const stopReason = "stopReason" in reply && typeof reply.stopReason === "string" ? reply.stopReason : "unknown";

  if (stopReason === "error" || stopReason === "aborted") {
    const errorMessage =
      "errorMessage" in reply && typeof reply.errorMessage === "string" ? reply.errorMessage : "unknown model error";
    throw new Error(`Model request failed with stopReason=${stopReason}: ${errorMessage}`);
  }

  const text = Array.isArray(reply.content)
    ? reply.content
        .filter(
          (block): block is { type: "text"; text: string } =>
            typeof block === "object" && block !== null && "type" in block && "text" in block && block.type === "text",
        )
        .map((block) => block.text)
        .join("\n")
        .trim()
    : "";

  if (!text.includes("LIVE_PRECHECK_OK")) {
    throw new Error(`Model ping did not return expected marker. stopReason=${stopReason}`);
  }

  return `Provider=${modelSelection.provider}, model=${modelSelection.model}, stopReason=${stopReason}`;
}

async function checkOpaEndpoint(config: SAFConfig, autoStartOpa: boolean): Promise<string> {
  if (config.policy.mode !== "opa") {
    return "Skipped: policy.mode is not 'opa'.";
  }

  const result = await ensureOpaEndpointHealthy({
    opaUrl: config.policy.opaUrl,
    workspacePath: config.workspacePath,
    autoStart: autoStartOpa,
    setupScriptPath: path.resolve(process.cwd(), "scripts/setup-opa.sh"),
    probeTimeoutMs: config.policy.timeoutMs,
  });

  return result.autoStarted
    ? `OPA reachable, decision=${result.decision} (auto-started via scripts/setup-opa.sh)`
    : `OPA reachable, decision=${result.decision}`;
}

async function checkSandboxRuntime(config: SAFConfig): Promise<string> {
  if (!config.sandbox.enabled) {
    return "Skipped: sandbox.enabled is false.";
  }

  const action: NormalizedAction = {
    category: "filesystem",
    operation: "read",
    target: "code/package.json",
    parser: "tool",
    metadata: {},
  };

  const runtimeConfig = buildSandboxConfig(action, config.workspacePath, ["api.github.com"]);
  await SandboxManager.initialize(runtimeConfig);

  try {
    const wrapped = await SandboxManager.wrapWithSandbox("printf preflight");
    if (typeof wrapped !== "string" || wrapped.trim().length === 0) {
      throw new Error("Sandbox wrap returned an invalid command.");
    }

    return "Sandbox initialize/wrap/reset succeeded";
  } finally {
    await SandboxManager.reset();
  }
}

async function checkAuditLogWritable(logPath: string): Promise<string> {
  await appendFile(logPath, `${JSON.stringify({ preflight: true, timestamp: Date.now() })}\n`, "utf8");
  return `Wrote probe record to ${logPath}`;
}

async function checkAgentConstruction(config: SAFConfig, modelSelection: LiveModelSelection): Promise<string> {
  const model = resolveLiveModel(modelSelection.provider, modelSelection.model);
  let readCalls = 0;

  const readFileTool: AgentTool<typeof readFileSchema, { ok: boolean }> = {
    name: "read_file",
    label: "Read File",
    description: "Read file tool for live preflight",
    parameters: readFileSchema,
    execute: async () => {
      readCalls += 1;
      return {
        content: [{ type: "text", text: "READ_OK" }],
        details: { ok: true },
      };
    },
  };

  const handle = await createSAFEnabledAgent({
    config,
    systemPrompt: "Call tool read_file exactly once with path code/package.json.",
    model,
    tools: [readFileTool],
    sessionId: `live-preflight-agent-${Date.now()}`,
    agentId: "live-preflight-agent",
    agentMode: "autonomous",
    getApiKey: (provider) => {
      if (provider === modelSelection.provider) {
        return modelSelection.apiKey;
      }

      if (config.intent.apiKeyEnvVar && provider === config.intent.provider) {
        return process.env[config.intent.apiKeyEnvVar];
      }

      return undefined;
    },
  });

  try {
    await handle.agent.prompt("Use read_file with path code/package.json.");

    if (readCalls < 1) {
      throw new Error("Agent did not execute read_file in live mode.");
    }

    return "createSAFEnabledAgent + agent.prompt succeeded";
  } finally {
    await handle.shutdown();
  }
}

async function checkLiveNormalizer(config: SAFConfig): Promise<string> {
  const normalizer = new ActionNormalizer(config.normalizer);
  const result = await normalizer.normalize({
    toolName: "bash",
    rawArgs: {
      command: "python -c \"import os; os.remove('tmp/live-preflight.txt')\"",
    },
  });

  if (result.parser !== "llm") {
    const fallbackReason =
      typeof result.metadata.flags?.reason === "string" ? result.metadata.flags.reason : "unknown fallback reason";
    throw new Error(`Expected parser=llm, got ${result.parser}. Reason: ${fallbackReason}`);
  }

  return `LLM normalizer reachable via provider=${config.normalizer.provider}, model=${config.normalizer.model}`;
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const skipModel = args.has("--skip-model");
  const skipNormalizer = args.has("--skip-normalizer");
  const skipOpa = args.has("--skip-opa");
  const skipSandbox = args.has("--skip-sandbox");
  const autoStartOpa = !args.has("--no-auto-start-opa") && process.env.SAF_LIVE_NO_AUTO_START_OPA !== "1";

  const configPath = path.resolve(process.cwd(), process.env.SAF_CONFIG_PATH ?? "configs/saf-config.json");
  const config = await loadConfig(configPath);
  const modelSelection = resolveLiveModelSelection(config);
  const normalizerSelection = resolveLiveNormalizerSelection(config);
  applyIntentOverrides(config, modelSelection);
  applyNormalizerOverrides(config, normalizerSelection);

  const runId = Date.now();
  config.auditLogPath = path.resolve(process.cwd(), `logs/live-preflight-${runId}.log`);

  const checks: Array<Promise<CheckResult>> = [];

  checks.push(
    runCheck("config", async () => {
      return `Loaded ${configPath}`;
    }),
  );

  checks.push(
    runCheck("api-key", async () => {
      return `Using ${modelSelection.apiKeyEnvVar} for provider=${modelSelection.provider}`;
    }),
  );

  checks.push(
    runCheck("normalizer-key", async () => {
      return `Using ${normalizerSelection.apiKeyEnvVar} for normalizer provider=${normalizerSelection.provider}`;
    }),
  );

  checks.push(runCheck("audit-log", async () => await checkAuditLogWritable(config.auditLogPath)));

  if (!skipModel) {
    checks.push(runCheck("model-ping", async () => await checkModelPing(modelSelection)));
    checks.push(runCheck("agent-start", async () => await checkAgentConstruction(config, modelSelection)));
  }

  if (!skipNormalizer) {
    checks.push(runCheck("normalizer-live", async () => await checkLiveNormalizer(config)));
  }

  if (!skipOpa) {
    checks.push(runCheck("opa", async () => await checkOpaEndpoint(config, autoStartOpa)));
  }

  if (!skipSandbox) {
    checks.push(runCheck("sandbox", async () => await checkSandboxRuntime(config)));
  }

  const results = await Promise.all(checks);

  console.log("Live preflight results:");
  for (const result of results) {
    const status = result.ok ? "PASS" : "FAIL";
    console.log(`- ${status} ${result.name} (${result.durationMs}ms): ${result.details}`);
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    console.log(`\nPreflight failed (${failed.length}/${results.length} checks).`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nPreflight passed (${results.length} checks).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
