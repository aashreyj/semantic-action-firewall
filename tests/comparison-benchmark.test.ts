import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  computeModeMetrics,
  evaluateSimpleSafeguards,
  formatDualMetricsTables,
  loadBenchmarkScenarios,
  runComparisonBenchmark,
  type BenchmarkRow,
} from "../src/benchmark/comparison.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("comparison benchmark helpers", () => {
  it("applies simple safeguard rules for dangerous bash and protected writes", () => {
    const dangerous = evaluateSimpleSafeguards("bash", { command: "rm -rf /tmp/cache" });
    expect(dangerous.verdict).toBe("REQUIRE_APPROVAL");

    const protectedWrite = evaluateSimpleSafeguards("write_file", { path: ".env", content: "A=1" });
    expect(protectedWrite.verdict).toBe("DENIED");

    const network = evaluateSimpleSafeguards("bash", { command: "curl https://example.com" });
    expect(network.verdict).toBe("ALLOWED");

    const safe = evaluateSimpleSafeguards("read_file", { path: "src/index.ts" });
    expect(safe.verdict).toBe("ALLOWED");
  });

  it("computes expected aggregate rates", () => {
    const rows: BenchmarkRow[] = [
      {
        mode: "simple",
        scenarioId: "s1",
        scenarioDescription: "safe allow",
        kind: "benign",
        expectedSafety: "safe",
        riskCategory: "harmful_decision_making",
        comparable: true,
        trial: 1,
        verdict: "ALLOWED",
        blocked: false,
        reason: "ok",
        decisionLatencyMs: 1,
        totalLatencyMs: 1,
        auditFound: false,
        dependencyDegraded: false,
        degradedSignals: [],
      },
      {
        mode: "simple",
        scenarioId: "u1",
        scenarioDescription: "unsafe blocked",
        kind: "unsafe",
        expectedSafety: "unsafe",
        riskCategory: "data_loss_or_corruption",
        comparable: true,
        trial: 1,
        verdict: "DENIED",
        blocked: true,
        reason: "blocked",
        decisionLatencyMs: 2,
        totalLatencyMs: 2,
        auditFound: false,
        dependencyDegraded: false,
        degradedSignals: [],
      },
      {
        mode: "simple",
        scenarioId: "u2",
        scenarioDescription: "unsafe missed",
        kind: "evasion",
        expectedSafety: "unsafe",
        riskCategory: "unsafe_code_execution",
        comparable: true,
        trial: 1,
        verdict: "ALLOWED",
        blocked: false,
        reason: "missed",
        decisionLatencyMs: 3,
        totalLatencyMs: 3,
        auditFound: false,
        dependencyDegraded: false,
        degradedSignals: [],
      },
      {
        mode: "simple",
        scenarioId: "d1",
        scenarioDescription: "drift blocked",
        kind: "drift",
        expectedSafety: "unsafe",
        riskCategory: "legal_or_policy_violation",
        comparable: false,
        trial: 1,
        verdict: "REQUIRE_APPROVAL",
        blocked: true,
        reason: "approval",
        decisionLatencyMs: 4,
        totalLatencyMs: 4,
        auditFound: false,
        dependencyDegraded: false,
        degradedSignals: [],
      },
    ];

    const metrics = computeModeMetrics("simple", rows);
    expect(metrics.safeAllowRate).toBe(1);
    expect(metrics.unsafeInterventionRate).toBeCloseTo(2 / 3, 6);
    expect(metrics.unsafeDenyRate).toBeCloseTo(1 / 3, 6);
    expect(metrics.unsafeApprovalRate).toBeCloseTo(1 / 3, 6);
    expect(metrics.falseAllowRate).toBeCloseTo(1 / 3, 6);
    expect(metrics.evasionInterventionRate).toBe(0);
    expect(metrics.driftInterventionRate).toBe(1);
    expect(metrics.requireApproval).toBe(1);
    expect(metrics.decisionLatencyP95Ms).toBe(4);
    expect(metrics.totalLatencyP95Ms).toBe(4);
  });

  it("runs plain/simple comparison over scenario file", async () => {
    const scenariosPath = path.resolve(__dirname, "../benchmarks/scenarios/comparison-scenarios.json");
    const scenarios = await loadBenchmarkScenarios(scenariosPath);
    const report = await runComparisonBenchmark({
      scenarios,
      trials: 1,
      modes: ["plain", "simple"],
      safProfile: "deterministic-lab",
    });

    expect(report.metrics).toHaveLength(2);
    const plain = report.metrics.find((metric) => metric.mode === "plain");
    const simple = report.metrics.find((metric) => metric.mode === "simple");

    expect(plain).toBeDefined();
    expect(simple).toBeDefined();
    expect(plain?.safeAllowRate).toBe(1);
    expect(plain?.unsafeInterventionRate).toBe(0);
    expect(simple?.unsafeInterventionRate).toBeGreaterThan(0);
    expect(report.perScenarioMetrics).toHaveLength(2);
    expect(report.trackMetrics.coreComparable.perTrial).toHaveLength(2);
    expect(report.trackMetrics.advancedSAF.perScenario).toHaveLength(2);
    expect(report.riskCategoryMetrics.harmful_decision_making.perTrial).toHaveLength(2);
  });

  it("requires saf profile when saf mode is selected", async () => {
    const scenariosPath = path.resolve(__dirname, "../benchmarks/scenarios/comparison-scenarios.json");
    const scenarios = await loadBenchmarkScenarios(scenariosPath);

    await expect(
      runComparisonBenchmark({
        scenarios,
        trials: 1,
        modes: ["saf"],
      }),
    ).rejects.toThrow("safProfile is required when running saf mode");
  });

  it("prints degraded metric columns in dual table output", () => {
    const rows: BenchmarkRow[] = [
      {
        mode: "saf",
        scenarioId: "u1",
        scenarioDescription: "unsafe blocked",
        kind: "unsafe",
        expectedSafety: "unsafe",
        riskCategory: "computer_security_compromise",
        comparable: true,
        trial: 1,
        verdict: "DENIED",
        blocked: true,
        reason: "OPA fallback: timeout",
        decisionLatencyMs: 12,
        totalLatencyMs: 15,
        auditFound: true,
        dependencyDegraded: true,
        degradedSignals: ["opa_fallback"],
      },
    ];

    const metrics = computeModeMetrics("saf", rows);
    const text = formatDualMetricsTables({
      generatedAt: new Date().toISOString(),
      config: {
        trials: 1,
        modes: ["saf"],
        scenarioCount: 1,
        safProfile: "default-runtime",
        effectiveSafConfig: {
          policyMode: "opa",
          policyFile: "benchmarks/configs/benchmark-policy.json",
          intentMode: "pi-ai",
          normalizerMode: "hybrid",
          sandboxEnabled: true,
          sandboxFailOpen: false,
        },
      },
      metrics: [metrics],
      rows,
      perScenarioMetrics: [metrics],
      trackMetrics: {
        coreComparable: {
          perTrial: [metrics],
          perScenario: [metrics],
        },
        advancedSAF: {
          perTrial: [computeModeMetrics("saf", [])],
          perScenario: [computeModeMetrics("saf", [])],
        },
      },
      riskCategoryMetrics: {
        computer_security_compromise: {
          perTrial: [metrics],
          perScenario: [metrics],
        },
        data_loss_or_corruption: {
          perTrial: [computeModeMetrics("saf", [])],
          perScenario: [computeModeMetrics("saf", [])],
        },
        privacy_breach: {
          perTrial: [computeModeMetrics("saf", [])],
          perScenario: [computeModeMetrics("saf", [])],
        },
        unsafe_code_execution: {
          perTrial: [computeModeMetrics("saf", [])],
          perScenario: [computeModeMetrics("saf", [])],
        },
        financial_loss: {
          perTrial: [computeModeMetrics("saf", [])],
          perScenario: [computeModeMetrics("saf", [])],
        },
        spreading_malicious_content: {
          perTrial: [computeModeMetrics("saf", [])],
          perScenario: [computeModeMetrics("saf", [])],
        },
        legal_or_policy_violation: {
          perTrial: [computeModeMetrics("saf", [])],
          perScenario: [computeModeMetrics("saf", [])],
        },
        harmful_decision_making: {
          perTrial: [computeModeMetrics("saf", [])],
          perScenario: [computeModeMetrics("saf", [])],
        },
      },
    });

    expect(text).toContain("opa_fallback");
    expect(text).toContain("judge_unavailable");
    expect(text).toContain("normalizer_fallback");
    expect(text).toContain("[risk-category:computer_security_compromise per-trial]");
  });
});
