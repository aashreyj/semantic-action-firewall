import { complete, getModel, Type } from "@mariozechner/pi-ai";
import type { AssistantMessage, ToolCall } from "@mariozechner/pi-ai";

import { ActionCategorySchema, ActionOperationSchema, type NormalizedAction, type NormalizerConfig } from "../types.js";
import type { LLMNormalizationResult } from "./index.js";

const normalizeTool = {
  name: "normalize_action",
  description: "Normalize a tool invocation into one security-relevant semantic action.",
  parameters: Type.Object({
    category: ActionCategorySchema,
    operation: ActionOperationSchema,
    target: Type.String(),
    metadata: Type.Optional(
      Type.Object(
        {
          recursive: Type.Optional(Type.Boolean()),
          force: Type.Optional(Type.Boolean()),
          envVars: Type.Optional(Type.Array(Type.String())),
          pipedCommands: Type.Optional(Type.Array(Type.String())),
          redirectedTo: Type.Optional(Type.String()),
          flags: Type.Optional(Type.Record(Type.String(), Type.Any())),
        },
        { additionalProperties: true },
      ),
    ),
  }),
};

interface LLMNormalizeInput {
  toolName: string;
  rawArgs: Record<string, unknown>;
  payload: string;
}

function buildPrompt(input: LLMNormalizeInput): string {
  return [
    "You are a strict security normalizer for tool calls.",
    "Infer the highest-risk effective action from the payload.",
    "If uncertain, return category=unknown and operation=unknown.",
    "Return exactly one normalize_action tool call.",
    `Tool name: ${input.toolName}`,
    `Raw args JSON: ${JSON.stringify(input.rawArgs)}`,
    `Inferred payload: ${input.payload}`,
  ].join("\n");
}

function extractToolCall(message: AssistantMessage): ToolCall | undefined {
  return message.content.find(
    (content): content is ToolCall => content.type === "toolCall" && content.name === "normalize_action",
  );
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return items.length > 0 ? items : undefined;
}

function sanitizeTarget(value: unknown): string {
  if (typeof value !== "string") {
    return "unknown";
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 256) : "unknown";
}

function toNormalizedAction(toolCall: ToolCall): NormalizedAction {
  const args = toolCall.arguments as Record<string, unknown>;
  const category =
    args.category === "filesystem" || args.category === "network" || args.category === "process" || args.category === "unknown"
      ? args.category
      : "unknown";

  const operation =
    args.operation === "read" ||
    args.operation === "write" ||
    args.operation === "delete" ||
    args.operation === "execute" ||
    args.operation === "connect" ||
    args.operation === "unknown"
      ? args.operation
      : "unknown";

  const metadataRecord =
    typeof args.metadata === "object" && args.metadata !== null ? (args.metadata as Record<string, unknown>) : undefined;

  const recursive = metadataRecord?.recursive;
  const force = metadataRecord?.force;
  const redirectedTo = metadataRecord?.redirectedTo;
  const flags = metadataRecord?.flags;

  return {
    category,
    operation,
    target: sanitizeTarget(args.target),
    parser: "llm",
    metadata: {
      ...(typeof recursive === "boolean" ? { recursive } : {}),
      ...(typeof force === "boolean" ? { force } : {}),
      ...(typeof redirectedTo === "string" && redirectedTo.trim().length > 0 ? { redirectedTo } : {}),
      ...(asStringArray(metadataRecord?.envVars) ? { envVars: asStringArray(metadataRecord?.envVars) } : {}),
      ...(asStringArray(metadataRecord?.pipedCommands) ? { pipedCommands: asStringArray(metadataRecord?.pipedCommands) } : {}),
      ...(typeof flags === "object" && flags !== null ? { flags: { ...(flags as Record<string, unknown>) } } : {}),
    },
  };
}

export class PiAINormalizer {
  private readonly timeoutMs: number;

  public constructor(private readonly config: NormalizerConfig) {
    this.timeoutMs = config.timeoutMs;
  }

  public async normalize(input: LLMNormalizeInput): Promise<LLMNormalizationResult> {
    const provider = this.config.provider ?? "google";
    const modelId = this.config.model ?? "gemma-4-26b-a4b-it";
    const apiKey = this.resolveApiKey();

    if (!apiKey) {
      return {
        action: null,
        error: `Missing ${this.config.apiKeyEnvVar ?? "normalizer API key"}`,
      };
    }

    const model = this.resolveModel(provider, modelId);
    if (!model) {
      return {
        action: null,
        error: `Unknown model '${modelId}' for provider '${provider}'`,
      };
    }

    const prompt = buildPrompt(input);

    try {
      const reply = await this.completeWithTimeout(
        model,
        {
          systemPrompt:
            "You normalize tool calls for a security firewall. Output exactly one normalize_action tool call and no free-form text.",
          messages: [
            {
              role: "user",
              content: prompt,
              timestamp: Date.now(),
            },
          ],
          tools: [normalizeTool],
        },
        {
          apiKey,
        },
      );

      const toolCall = extractToolCall(reply);
      if (!toolCall) {
        return {
          action: null,
          error: "LLM did not return normalize_action tool call",
        };
      }

      const action = toNormalizedAction(toolCall);
      return { action };
    } catch (error) {
      return {
        action: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async completeWithTimeout(
    model: ReturnType<typeof getModel>,
    request: Parameters<typeof complete>[1],
    options: Parameters<typeof complete>[2],
  ): Promise<AssistantMessage> {
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Normalizer timeout after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
    });

    try {
      return (await Promise.race([complete(model, request, options), timeoutPromise])) as AssistantMessage;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private resolveApiKey(): string | undefined {
    if (this.config.apiKeyEnvVar) {
      return process.env[this.config.apiKeyEnvVar];
    }

    return undefined;
  }

  private resolveModel(provider: string, modelId: string): ReturnType<typeof getModel> | undefined {
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

    return undefined;
  }
}
