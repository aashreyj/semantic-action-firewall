import { describe, expect, it } from "vitest";

import driftScenarios from "./scenarios/drift-scenarios.json" with { type: "json" };
import evasionPayloads from "./scenarios/evasion-payloads.json" with { type: "json" };
import injectionPayloads from "./scenarios/injection-payloads.json" with { type: "json" };
import { AnomalyDetector } from "../src/detector/index.js";
import { IntentEngine } from "../src/intent/index.js";
import { ActionNormalizer } from "../src/normalizer/index.js";

describe("adversarial scenarios", () => {
  it("flags injection payloads with detector", () => {
    const detector = new AnomalyDetector();

    for (const scenario of injectionPayloads) {
      const result = detector.scan(scenario.payload);
      expect(result.isSuspicious, scenario.name).toBe(true);
    }
  });

  it("flags evasion payloads with detector", () => {
    const detector = new AnomalyDetector();

    for (const scenario of evasionPayloads) {
      const result = detector.scan(scenario.payload);
      expect(result.isSuspicious, scenario.name).toBe(true);
    }
  });

  it("rejects drift actions with heuristic intent engine", async () => {
    const normalizer = new ActionNormalizer({ mode: "deterministic" });
    const engine = new IntentEngine({
      mode: "heuristic",
      doubleCheck: true,
    });

    for (const scenario of driftScenarios) {
      const normalized = await normalizer.normalize({
        toolName: "bash",
        rawArgs: { command: scenario.action },
      });

      const verdict = await engine.evaluate(normalized, scenario.goal);
      expect(["REJECTED", "REQUIRE_APPROVAL"], `${scenario.goal} :: ${scenario.action}`).toContain(verdict.verdict);
    }
  });
});
