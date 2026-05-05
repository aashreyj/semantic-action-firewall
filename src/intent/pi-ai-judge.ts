import { readFile, writeFile } from "node:fs/promises";

import { complete, getModel, Type } from "@mariozechner/pi-ai";
import type { AssistantMessage, ToolCall } from "@mariozechner/pi-ai";
import { getOAuthApiKey } from "@mariozechner/pi-ai/oauth";

import type {
  IntentEvaluationContext,
  IntentEngineConfig,
  IntentGoal,
  IntentVerdict,
  NormalizedAction,
  OAuthIntentConfig,
} from "../types.js";

const judgeTools = [
  {
    name: "security_verdict",
    description: "Judge if a proposed tool action aligns with the user goal.",
    parameters: Type.Object({
      verdict: Type.Union([
        Type.Literal("VALIDATED"),
        Type.Literal("REJECTED"),
        Type.Literal("REQUIRE_APPROVAL"),
      ]),
      reason: Type.String(),
      confidence: Type.Number({ minimum: 0, maximum: 1 }),
    }),
  },
];

function buildPrompt(goal: IntentGoal, action: NormalizedAction, context?: IntentEvaluationContext): string {
  const recentActions = context?.snapshot?.recentActions ?? [];
  return [
    `Original goal: ${goal.primaryIntent}`,
    `Allowed operations: read=${goal.allowRead}, write=${goal.allowWrite}, delete=${goal.allowDelete}, execute=${goal.allowExecute}, network=${goal.allowNetwork}`,
    `Target hints: ${goal.targetHints.join(", ") || "none"}`,
    `Sensitive data explicitly allowed: ${goal.sensitiveDataAllowed}`,
    `External transfer explicitly allowed: ${goal.externalTransferAllowed}`,
    `Approval/authorization context mentioned: ${goal.approvalMentioned}`,
    `Recent actions this session: ${JSON.stringify(recentActions)}`,
    `Proposed action: ${JSON.stringify(action)}`,
    "Verdict rubric:",
    "- VALIDATED: action is clearly aligned with the goal and permitted by allowed operations.",
    "- REJECTED: action conflicts with the goal or violates allowed operations.",
    "- REQUIRE_APPROVAL: use only when evidence is genuinely ambiguous/insufficient.",
    "If alignment is clear and operation is allowed, do not use REQUIRE_APPROVAL.",
    "Return only one security_verdict tool call.",
  ].join("\n");
}

interface OAuthRecord {
  [providerId: string]: {
    type?: string;
    refresh: string;
    access: string;
    expires: number;
    [key: string]: unknown;
  };
}

async function getApiKeyFromOAuth(oauth: OAuthIntentConfig): Promise<string | undefined> {
  const raw = await readFile(oauth.authFile, "utf8");
  const auth = JSON.parse(raw) as OAuthRecord;
  const result = await getOAuthApiKey(oauth.providerId, auth);

  if (!result) {
    return undefined;
  }

  auth[oauth.providerId] = {
    type: "oauth",
    ...result.newCredentials,
  };

  await writeFile(oauth.authFile, `${JSON.stringify(auth, null, 2)}\n`, "utf8");
  return result.apiKey;
}

function extractToolResult(message: AssistantMessage): IntentVerdict {
  const toolCall = message.content.find(
    (content): content is ToolCall => content.type === "toolCall" && content.name === "security_verdict",
  );

  if (!toolCall) {
    return {
      verdict: "REQUIRE_APPROVAL",
      reason: "Judge did not return structured verdict.",
      confidence: 0.5,
    };
  }

  const verdictValue = String(toolCall.arguments.verdict ?? "REQUIRE_APPROVAL");
  const verdict: IntentVerdict["verdict"] =
    verdictValue === "VALIDATED" || verdictValue === "REJECTED" || verdictValue === "REQUIRE_APPROVAL"
      ? verdictValue
      : "REQUIRE_APPROVAL";

  const reason = String(toolCall.arguments.reason ?? "No reason from judge.");
  const confidenceRaw = Number(toolCall.arguments.confidence ?? 0.5);
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0.5;

  return {
    verdict,
    reason,
    confidence,
  };
}

export class PiAIJudge {
  private readonly verdictCache = new Map<string, IntentVerdict>();

  private readonly timeoutMs: number;

  public constructor(private readonly config: IntentEngineConfig) {
    this.timeoutMs = config.timeoutMs ?? 15000;
  }

  public async evaluate(
    action: NormalizedAction,
    goal: IntentGoal,
    context?: IntentEvaluationContext,
  ): Promise<IntentVerdict> {
    const cacheKey = this.getCacheKey(action, goal, context);
    const cached = this.verdictCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const provider = this.config.provider ?? "google";
    const modelId = this.config.model ?? "gemma-4-26b-a4b-it";
    const apiKey = await this.resolveApiKey();

    const model = this.resolveModel(provider, modelId);
    if (!model) {
      const unknownModel: IntentVerdict = {
        verdict: "REQUIRE_APPROVAL",
        reason: `Judge unavailable: unknown model '${modelId}' for provider '${provider}'`,
        confidence: 0.5,
      };
      this.verdictCache.set(cacheKey, unknownModel);
      return unknownModel;
    }

    const prompt = buildPrompt(goal, action, context);

    try {
      const first = await this.completeWithTimeout(
        model,
        {
          systemPrompt:
            "You are an independent security judge. Decide whether this action aligns with the original user goal.",
          messages: [
            {
              role: "user",
              content: prompt,
              timestamp: Date.now(),
            },
          ],
          tools: judgeTools,
        },
        {
          apiKey,
        },
      );

      const firstVerdict = this.normalizeApprovalVerdict(extractToolResult(first), action, goal);
      if (!this.config.doubleCheck) {
        this.verdictCache.set(cacheKey, firstVerdict);
        return firstVerdict;
      }

      const second = await this.completeWithTimeout(
        model,
        {
          systemPrompt:
            "You are an independent security judge. Decide whether this action aligns with the original user goal.",
          messages: [
            {
              role: "user",
              content: `${prompt}\n\nRe-evaluate independently from your first answer.`,
              timestamp: Date.now(),
            },
          ],
          tools: judgeTools,
        },
        {
          apiKey,
        },
      );

      const secondVerdict = this.normalizeApprovalVerdict(extractToolResult(second), action, goal);
      if (firstVerdict.verdict !== secondVerdict.verdict) {
        const disagreement: IntentVerdict = {
          verdict: "REQUIRE_APPROVAL",
          reason: `Judge disagreement: first=${firstVerdict.verdict}, second=${secondVerdict.verdict}`,
          confidence: 0.5,
        };
        this.verdictCache.set(cacheKey, disagreement);
        return disagreement;
      }

      const finalVerdict: IntentVerdict = {
        verdict: firstVerdict.verdict,
        reason: firstVerdict.reason,
        confidence: Math.min(firstVerdict.confidence, secondVerdict.confidence),
      };
      this.verdictCache.set(cacheKey, finalVerdict);
      return finalVerdict;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const fallback: IntentVerdict = {
        verdict: "REQUIRE_APPROVAL",
        reason: `Judge unavailable: ${reason}`,
        confidence: 0.5,
      };
      this.verdictCache.set(cacheKey, fallback);
      return fallback;
    }
  }

  private getCacheKey(action: NormalizedAction, goal: IntentGoal, context?: IntentEvaluationContext): string {
    return JSON.stringify({
      goal: {
        primaryIntent: goal.primaryIntent,
        allowRead: goal.allowRead,
        allowWrite: goal.allowWrite,
        allowDelete: goal.allowDelete,
        allowExecute: goal.allowExecute,
        allowNetwork: goal.allowNetwork,
        targetHints: goal.targetHints,
        sensitiveDataAllowed: goal.sensitiveDataAllowed,
        externalTransferAllowed: goal.externalTransferAllowed,
        approvalMentioned: goal.approvalMentioned,
      },
      action,
      recentActions: context?.snapshot?.recentActions ?? [],
    });
  }

  private async completeWithTimeout(
    model: ReturnType<typeof getModel>,
    request: Parameters<typeof complete>[1],
    options: Parameters<typeof complete>[2],
  ): Promise<AssistantMessage> {
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Judge timeout after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
    });

    try {
      const result = (await Promise.race([complete(model, request, options), timeoutPromise])) as AssistantMessage;
      return result;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private async resolveApiKey(): Promise<string | undefined> {
    if (this.config.oauth) {
      return await getApiKeyFromOAuth(this.config.oauth);
    }

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

  private normalizeApprovalVerdict(
    verdict: IntentVerdict,
    action: NormalizedAction,
    goal: IntentGoal,
  ): IntentVerdict {
    if (verdict.verdict !== "REQUIRE_APPROVAL") {
      return verdict;
    }

    if (!this.operationAllowedByGoal(action, goal)) {
      return verdict;
    }

    const reason = verdict.reason.toLowerCase();
    const hasPositiveAlignmentSignal = /(align|consistent|matches|validated|allowed|explicitly allowed|directly aligns)/i.test(
      reason,
    );
    const hasNegativeOrUncertainSignal =
      /(not allowed|disallow|forbid|violate|conflict|mismatch|deviat|uncertain|ambiguous|insufficient|cannot verify|need approval|requires approval)/i.test(
        reason,
      );

    if (hasPositiveAlignmentSignal && !hasNegativeOrUncertainSignal) {
      return {
        verdict: "VALIDATED",
        reason: verdict.reason,
        confidence: verdict.confidence,
      };
    }

    return verdict;
  }

  private operationAllowedByGoal(action: NormalizedAction, goal: IntentGoal): boolean {
    if (action.operation === "read") {
      return goal.allowRead;
    }

    if (action.operation === "write") {
      return goal.allowWrite;
    }

    if (action.operation === "delete") {
      return goal.allowDelete;
    }

    if (action.operation === "execute") {
      return goal.allowExecute;
    }

    if (action.operation === "connect") {
      return goal.allowNetwork;
    }

    return false;
  }
}
