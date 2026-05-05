import { fallbackNormalize } from "./llm-fallback.js";
import { parsePythonPayload } from "./python-parser.js";
import { PiAINormalizer } from "./pi-ai-normalizer.js";
import { parseShellCommand } from "./shell-parser.js";
import { parseToolInvocation } from "./tool-parser.js";
import { parseTypeScriptPayload } from "./typescript-parser.js";
import type { NormalizedAction, NormalizerConfig } from "../types.js";

export interface NormalizeInput {
  toolName: string;
  rawArgs: Record<string, unknown>;
}

export interface LLMActionNormalizer {
  normalize(input: {
    toolName: string;
    rawArgs: Record<string, unknown>;
    payload: string;
  }): Promise<LLMNormalizationResult>;
}

export interface LLMNormalizationResult {
  action: NormalizedAction | null;
  error?: string;
}

function inferPayload(toolName: string, rawArgs: Record<string, unknown>): string {
  if (toolName === "bash" && typeof rawArgs.command === "string") {
    return rawArgs.command;
  }

  if (typeof rawArgs.code === "string") {
    return rawArgs.code;
  }

  if (typeof rawArgs.content === "string") {
    return rawArgs.content;
  }

  return JSON.stringify(rawArgs);
}

function truncatePayload(payload: string, maxPayloadChars: number): string {
  if (payload.length <= maxPayloadChars) {
    return payload;
  }

  return payload.slice(0, maxPayloadChars);
}

type EscalationReason =
  | "none"
  | "llm-mode"
  | "deterministic-no-match"
  | "deterministic-unknown"
  | "deterministic-process-execute"
  | "complex-payload";

function getEscalationReason(
  toolName: string,
  payload: string,
  deterministic: NormalizedAction | null,
  mode: NormalizerConfig["mode"],
): EscalationReason {
  const lowered = payload.toLowerCase();

  if (mode === "deterministic") {
    return "none";
  }

  if (mode === "llm") {
    return "llm-mode";
  }

  if (!deterministic) {
    return "deterministic-no-match";
  }

  if (deterministic.category === "unknown" || deterministic.operation === "unknown") {
    return "deterministic-unknown";
  }

  const normalizedTool = toolName.toLowerCase();
  if (normalizedTool !== "bash" && normalizedTool !== "python" && normalizedTool !== "python3") {
    return "none";
  }

  if (deterministic.category === "process" && deterministic.operation === "execute") {
    const executeRiskSignals = [" -c", "|", ";", "&&", "||", "exec(", "eval(", "subprocess", "os.system"];
    return executeRiskSignals.some((signal) => lowered.includes(signal)) ? "deterministic-process-execute" : "none";
  }

  const complexitySignals = [
    "|",
    ";",
    "&&",
    "||",
    "python -c",
    "bash -c",
    "sh -c",
    "node -e",
    "exec(",
    "eval(",
    "subprocess",
    "os.system",
  ];

  return complexitySignals.some((signal) => lowered.includes(signal)) ? "complex-payload" : "none";
}

const defaultConfig: NormalizerConfig = {
  mode: "hybrid",
  provider: "google",
  model: "gemma-4-26b-a4b-it",
  apiKeyEnvVar: "GOOGLE_GENERATIVE_AI_API_KEY",
  timeoutMs: 15000,
  maxPayloadChars: 8000,
  cacheEnabled: true,
  cacheMaxEntries: 500,
};

export class ActionNormalizer {
  private readonly config: NormalizerConfig;

  private readonly llmNormalizer: LLMActionNormalizer;

  private readonly llmCache = new Map<string, NormalizedAction>();

  public constructor(config?: Partial<NormalizerConfig>, llmNormalizer?: LLMActionNormalizer) {
    this.config = {
      ...defaultConfig,
      ...config,
    };
    this.llmNormalizer = llmNormalizer ?? new PiAINormalizer(this.config);
  }

  public async normalize(input: NormalizeInput): Promise<NormalizedAction> {
    const toolAction = parseToolInvocation(input.toolName, input.rawArgs);
    if (toolAction) {
      return toolAction;
    }

    const payload = truncatePayload(inferPayload(input.toolName, input.rawArgs), this.config.maxPayloadChars);

    const shell = parseShellCommand(payload);
    const python = parsePythonPayload(payload);
    const ts = parseTypeScriptPayload(payload);
    const deterministic = shell ?? python ?? ts;
    const escalationReason = getEscalationReason(input.toolName, payload, deterministic, this.config.mode);

    if (escalationReason !== "none") {
      const llmCacheKey = JSON.stringify({
        provider: this.config.provider,
        model: this.config.model,
        toolName: input.toolName,
        payload,
        rawArgs: input.rawArgs,
      });

      if (this.config.cacheEnabled) {
        const cached = this.llmCache.get(llmCacheKey);
        if (cached) {
          return cached;
        }
      }

      const llmResult = await this.llmNormalizer.normalize({
        toolName: input.toolName,
        rawArgs: input.rawArgs,
        payload,
      });

      if (llmResult.action) {
        if (this.config.cacheEnabled) {
          this.cacheSet(llmCacheKey, llmResult.action);
        }
        return llmResult.action;
      }

      const baseMessage = this.config.mode === "llm" ? "LLM-only normalization failed" : "Escalated LLM normalization failed";
      const reasonMessage = llmResult.error ? `${baseMessage}: ${llmResult.error}` : `${baseMessage}.`;
      const escalatedReasonMessage = `${reasonMessage} escalation=${escalationReason}. Requires approval path.`;
      return fallbackNormalize(payload, escalatedReasonMessage);
    }

    if (deterministic) {
      return deterministic;
    }

    return fallbackNormalize(payload);
  }

  private cacheSet(key: string, value: NormalizedAction): void {
    if (this.llmCache.has(key)) {
      this.llmCache.delete(key);
    }

    this.llmCache.set(key, value);
    while (this.llmCache.size > this.config.cacheMaxEntries) {
      const oldest = this.llmCache.keys().next().value;
      if (!oldest) {
        break;
      }

      this.llmCache.delete(oldest);
    }
  }
}
