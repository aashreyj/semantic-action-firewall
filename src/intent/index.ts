import { extractGoal } from "./goal-extractor.js";
import { IntentJudge } from "./judge.js";
import { PiAIJudge } from "./pi-ai-judge.js";
import { IntentSessionStore } from "./session.js";
import type { IntentEngineConfig, IntentEvaluationContext, IntentVerdict, NormalizedAction } from "../types.js";

export class IntentEngine {
  private readonly heuristicJudge = new IntentJudge();

  private readonly piAiJudge?: PiAIJudge;

  private readonly store = new IntentSessionStore();

  public constructor(private readonly config: IntentEngineConfig) {
    if (config.mode === "pi-ai") {
      this.piAiJudge = new PiAIJudge(config);
    }
  }

  public async evaluate(
    action: NormalizedAction,
    userGoal: string | undefined,
    context?: IntentEvaluationContext,
  ): Promise<IntentVerdict> {
    const goal = extractGoal(userGoal);
    const snapshot = context?.snapshot ?? this.store.snapshot(context?.sessionId);
    const evaluationContext = {
      ...context,
      snapshot,
    } satisfies IntentEvaluationContext;
    const verdict =
      this.config.mode === "pi-ai" && this.piAiJudge
        ? await this.piAiJudge.evaluate(action, goal, evaluationContext)
        : this.heuristicJudge.evaluate(action, goal, evaluationContext);

    this.store.add(context?.sessionId, action);
    return verdict;
  }
}
