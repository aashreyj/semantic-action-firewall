import type { NormalizedAction } from "../types.js";

export interface SessionSnapshot {
  recentActions: NormalizedAction[];
}

export class IntentSessionStore {
  private readonly maxEntries: number;

  private readonly actionsBySession = new Map<string, NormalizedAction[]>();

  public constructor(maxEntries = 20) {
    this.maxEntries = maxEntries;
  }

  public add(sessionId: string | undefined, action: NormalizedAction): void {
    const key = sessionId ?? "default";
    const actions = this.actionsBySession.get(key) ?? [];
    actions.push(action);
    if (actions.length > this.maxEntries) {
      actions.shift();
    }

    this.actionsBySession.set(key, actions);
  }

  public snapshot(sessionId?: string): SessionSnapshot {
    const key = sessionId ?? "default";
    return {
      recentActions: [...(this.actionsBySession.get(key) ?? [])],
    };
  }
}
