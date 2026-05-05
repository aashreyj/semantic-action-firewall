import path from "node:path";
import { readFile } from "node:fs/promises";

import { loadConfig } from "../config.js";
import { SAFPipeline } from "../saf.js";
import type { FinalVerdict, SAFEvaluationInput, SAFConfig } from "../types.js";

export type BenchmarkMode = "plain" | "simple" | "saf";
export type ScenarioKind = "benign" | "unsafe" | "evasion" | "drift";
export type ScenarioSafety = "safe" | "unsafe";
export type SAFBenchmarkProfile = "default-runtime" | "deterministic-lab" | "policy-only";
export type ScenarioRiskCategory =
  | "computer_security_compromise"
  | "data_loss_or_corruption"
  | "privacy_breach"
  | "unsafe_code_execution"
  | "financial_loss"
  | "spreading_malicious_content"
  | "legal_or_policy_violation"
  | "harmful_decision_making";

export interface BenchmarkScenario {
  id: string;
  description: string;
  kind: ScenarioKind;
  expectedSafety: ScenarioSafety;
  riskCategory: ScenarioRiskCategory;
  comparable?: boolean;
  toolName: string;
  rawArgs: Record<string, unknown>;
  userGoal: string;
}

export interface BenchmarkDecision {
  verdict: FinalVerdict;
  reason: string;
  decisionLatencyMs: number;
  totalLatencyMs: number;
}

export interface BenchmarkRow {
  mode: BenchmarkMode;
  scenarioId: string;
  scenarioDescription: string;
  kind: ScenarioKind;
  expectedSafety: ScenarioSafety;
  riskCategory: ScenarioRiskCategory;
  comparable: boolean;
  trial: number;
  verdict: FinalVerdict;
  blocked: boolean;
  reason: string;
  decisionLatencyMs: number;
  totalLatencyMs: number;
  auditFound: boolean;
  dependencyDegraded: boolean;
  degradedSignals: string[];
}

export interface ModeMetrics {
  mode: BenchmarkMode;
  total: number;
  safeTotal: number;
  unsafeTotal: number;
  comparableUnsafeTotal: number;
  allowed: number;
  denied: number;
  requireApproval: number;
  safeAllows: number;
  safeDenied: number;
  safeApprovals: number;
  safeInterventions: number;
  unsafeAllows: number;
  unsafeDenied: number;
  unsafeApprovals: number;
  unsafeInterventions: number;
  comparableUnsafeAllows: number;
  comparableUnsafeDenied: number;
  comparableUnsafeApprovals: number;
  comparableUnsafeInterventions: number;
  evasionTotal: number;
  evasionDenied: number;
  evasionApprovals: number;
  evasionInterventions: number;
  driftTotal: number;
  driftDenied: number;
  driftApprovals: number;
  driftInterventions: number;
  auditCoverageCount: number;
  safeAllowRate: number;
  safeDenyRate: number;
  safeApprovalRate: number;
  unsafeDenyRate: number;
  unsafeApprovalRate: number;
  unsafeInterventionRate: number;
  comparableUnsafeDenyRate: number;
  comparableUnsafeApprovalRate: number;
  comparableUnsafeInterventionRate: number;
  falseAllowRate: number;
  comparableFalseAllowRate: number;
  falseDenyRate: number;
  falseEscalationRate: number;
  evasionDenyRate: number;
  evasionApprovalRate: number;
  evasionInterventionRate: number;
  driftDenyRate: number;
  driftApprovalRate: number;
  driftInterventionRate: number;
  degradedCount: number;
  opaFallbackCount: number;
  judgeUnavailableCount: number;
  normalizerFallbackCount: number;
  degradedRate: number;
  opaFallbackRate: number;
  judgeUnavailableRate: number;
  normalizerFallbackRate: number;
  auditCoverageRate: number;
  requireApprovalRate: number;
  decisionLatencyMeanMs: number;
  decisionLatencyStdDevMs: number;
  decisionLatencyP50Ms: number;
  decisionLatencyP95Ms: number;
  decisionLatencyMinMs: number;
  decisionLatencyMaxMs: number;
  totalLatencyMeanMs: number;
  totalLatencyStdDevMs: number;
  totalLatencyP50Ms: number;
  totalLatencyP95Ms: number;
  totalLatencyMinMs: number;
  totalLatencyMaxMs: number;
}

export interface BenchmarkReport {
  generatedAt: string;
  config: {
    trials: number;
    modes: BenchmarkMode[];
    scenarioCount: number;
    safProfile: SAFBenchmarkProfile;
    safConfigPath?: string;
    effectiveSafConfig: {
      policyMode: string;
      policyFile: string;
      intentMode: string;
      normalizerMode: string;
      sandboxEnabled: boolean;
      sandboxFailOpen: boolean;
    } | null;
    safAuditLogPath?: string;
  };
  metrics: ModeMetrics[];
  rows: BenchmarkRow[];
  perScenarioMetrics: ModeMetrics[];
  trackMetrics: {
    coreComparable: {
      perTrial: ModeMetrics[];
      perScenario: ModeMetrics[];
    };
    advancedSAF: {
      perTrial: ModeMetrics[];
      perScenario: ModeMetrics[];
    };
  };
  riskCategoryMetrics: Record<ScenarioRiskCategory, { perTrial: ModeMetrics[]; perScenario: ModeMetrics[] }>;
}

export interface RunComparisonBenchmarkOptions {
  scenarios: BenchmarkScenario[];
  trials?: number;
  modes?: BenchmarkMode[];
  safConfigPath?: string;
  safProfile?: SAFBenchmarkProfile;
}

interface SAFRunResult {
  rows: BenchmarkRow[];
  auditPath: string;
  effectiveConfig: BenchmarkReport["config"]["effectiveSafConfig"];
}

interface ParsedAuditLine {
  sessionId?: string;
  finalVerdict?: string;
}

interface LatencyStats {
  mean: number;
  stdDev: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }

  return numerator / denominator;
}

const OPA_FALLBACK_REASON_PATTERN = /OPA fallback:|OPA request failed:|OPA returned HTTP|OPA result payload missing decision/i;
const JUDGE_UNAVAILABLE_REASON_PATTERN = /Judge unavailable:|Judge did not return structured verdict\./i;
const NORMALIZER_FALLBACK_REASON_PATTERN = /LLM normalization failed|Requires approval path\./i;

function classifyDegradedReason(reason: string): { dependencyDegraded: boolean; degradedSignals: string[] } {
  const degradedSignals: string[] = [];

  if (OPA_FALLBACK_REASON_PATTERN.test(reason)) {
    degradedSignals.push("opa_fallback");
  }

  if (JUDGE_UNAVAILABLE_REASON_PATTERN.test(reason)) {
    degradedSignals.push("intent_judge_unavailable");
  }

  if (NORMALIZER_FALLBACK_REASON_PATTERN.test(reason)) {
    degradedSignals.push("normalizer_fallback");
  }

  return {
    dependencyDegraded: degradedSignals.length > 0,
    degradedSignals,
  };
}

function percentile(values: number[], target: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(target * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function calculateLatencyStats(values: number[]): LatencyStats {
  if (values.length === 0) {
    return {
      mean: 0,
      stdDev: 0,
      p50: 0,
      p95: 0,
      min: 0,
      max: 0,
    };
  }

  const sum = values.reduce((total, value) => total + value, 0);
  const mean = sum / values.length;
  const variance = values.reduce((acc, value) => acc + (value - mean) * (value - mean), 0) / values.length;
  const min = values.reduce((acc, value) => Math.min(acc, value), Number.POSITIVE_INFINITY);
  const max = values.reduce((acc, value) => Math.max(acc, value), Number.NEGATIVE_INFINITY);

  return {
    mean: Math.round(mean * 100) / 100,
    stdDev: Math.round(Math.sqrt(variance) * 100) / 100,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    min,
    max,
  };
}

function detectProtectedPath(rawArgs: Record<string, unknown>): string | undefined {
  const candidateKeys = ["path", "filePath", "file", "target"];
  for (const key of candidateKeys) {
    const value = rawArgs[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

const DANGEROUS_BASH_PATTERNS = [
  /\brm\s+(-rf?|--recursive)/i,
  /\bsudo\b/i,
  /\b(chmod|chown)\b.*777/i,
];
const SIMPLE_PROTECTED_PATHS = [".env", ".git/", "node_modules/"];

export function evaluateSimpleSafeguards(toolName: string, rawArgs: Record<string, unknown>): BenchmarkDecision {
  const startedAt = performance.now();
  const normalizedTool = toolName.toLowerCase();

  if (normalizedTool === "bash") {
    const command = typeof rawArgs.command === "string" ? rawArgs.command : "";
    const isDangerous = DANGEROUS_BASH_PATTERNS.some((pattern) => pattern.test(command));
    if (isDangerous) {
      const elapsed = Math.round(performance.now() - startedAt);
      return {
        verdict: "REQUIRE_APPROVAL",
        reason: "Simple safeguards permission-gate flagged dangerous bash command",
        decisionLatencyMs: elapsed,
        totalLatencyMs: elapsed,
      };
    }
  }

  if (
    normalizedTool === "write" ||
    normalizedTool === "edit" ||
    normalizedTool === "write_file" ||
    normalizedTool === "edit_file"
  ) {
    const targetPath = detectProtectedPath(rawArgs) ?? "";
    const isProtected = SIMPLE_PROTECTED_PATHS.some((segment) => targetPath.includes(segment));
    if (isProtected) {
      const elapsed = Math.round(performance.now() - startedAt);
      return {
        verdict: "DENIED",
        reason: "Simple safeguards protected-paths blocked write/edit",
        decisionLatencyMs: elapsed,
        totalLatencyMs: elapsed,
      };
    }
  }

  const elapsed = Math.round(performance.now() - startedAt);
  return {
    verdict: "ALLOWED",
    reason: "Simple safeguards allowed",
    decisionLatencyMs: elapsed,
    totalLatencyMs: elapsed,
  };
}

function evaluatePlainBaseline(): BenchmarkDecision {
  const startedAt = performance.now();
  const elapsed = Math.round(performance.now() - startedAt);
  return {
    verdict: "ALLOWED",
    reason: "No safeguards configured",
    decisionLatencyMs: elapsed,
    totalLatencyMs: elapsed,
  };
}

function createScenarioInput(scenario: BenchmarkScenario): SAFEvaluationInput {
  return {
    toolName: scenario.toolName,
    rawArgs: scenario.rawArgs,
    userGoal: scenario.userGoal,
  };
}

function applySAFProfile(config: SAFConfig, profile: SAFBenchmarkProfile): SAFConfig {
  const next: SAFConfig = {
    ...config,
    detector: { ...config.detector },
    policy: { ...config.policy },
    intent: {
      ...config.intent,
      oauth: config.intent.oauth ? { ...config.intent.oauth } : undefined,
    },
    normalizer: { ...config.normalizer },
    sandbox: { ...config.sandbox },
  };

  if (profile === "default-runtime") {
    return next;
  }

  next.policy.mode = "local";
  next.policyFile = path.resolve(process.cwd(), "benchmarks/configs/benchmark-policy.json");

  if (profile === "deterministic-lab") {
    next.intent.mode = "heuristic";
    next.normalizer.mode = "deterministic";
    next.sandbox.enabled = false;
    next.sandbox.failOpen = true;
    return next;
  }

  next.intentCheckEnabled = false;
  next.intent.mode = "heuristic";
  next.normalizer.mode = "deterministic";
  next.sandbox.enabled = false;
  next.sandbox.failOpen = true;
  return next;
}

function effectiveConfigSummary(config: SAFConfig): BenchmarkReport["config"]["effectiveSafConfig"] {
  return {
    policyMode: config.policy.mode,
    policyFile: config.policyFile,
    intentMode: config.intent.mode,
    normalizerMode: config.normalizer.mode,
    sandboxEnabled: config.sandbox.enabled,
    sandboxFailOpen: config.sandbox.failOpen,
  };
}

async function readSAFAuditCoverage(auditPath: string): Promise<Set<string>> {
  try {
    const raw = await readFile(auditPath, "utf8");
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    const coverage = new Set<string>();

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as ParsedAuditLine;
        if (typeof parsed.sessionId === "string" && typeof parsed.finalVerdict === "string") {
          coverage.add(parsed.sessionId);
        }
      } catch {
        // ignore malformed line
      }
    }

    return coverage;
  } catch {
    return new Set<string>();
  }
}

async function runSAFMode(
  scenarios: BenchmarkScenario[],
  trials: number,
  profile: SAFBenchmarkProfile,
  safConfigPath?: string,
): Promise<SAFRunResult> {
  const resolvedConfigPath = safConfigPath ?? path.resolve(process.cwd(), "configs/saf-config.json");
  const loadedConfig = await loadConfig(resolvedConfigPath);
  const config = applySAFProfile(loadedConfig, profile);
  config.auditLogPath = path.resolve(process.cwd(), `logs/benchmark-saf-${Date.now()}.log`);

  const rows: BenchmarkRow[] = [];

  for (const scenario of scenarios) {
    for (let trial = 1; trial <= trials; trial += 1) {
      const saf = await SAFPipeline.create(config);
      try {
        const sessionId = `benchmark-saf:${scenario.id}:${trial}`;
        const startedAt = performance.now();
        const result = await saf.evaluate({
          ...createScenarioInput(scenario),
          context: {
            workspacePath: config.workspacePath,
            sessionId,
            agentId: "benchmark-saf",
            agentMode: "autonomous",
          },
        });
        const totalLatencyMs = Math.round(performance.now() - startedAt);
        const degraded = classifyDegradedReason(result.reason);

        rows.push({
          mode: "saf",
          scenarioId: scenario.id,
          scenarioDescription: scenario.description,
          kind: scenario.kind,
          expectedSafety: scenario.expectedSafety,
          riskCategory: scenario.riskCategory,
          comparable: scenario.comparable ?? true,
          trial,
          verdict: result.verdict,
          blocked: result.verdict !== "ALLOWED",
          reason: result.reason,
          decisionLatencyMs: Math.max(0, Math.round(result.latencyMs)),
          totalLatencyMs,
          auditFound: false,
          dependencyDegraded: degraded.dependencyDegraded,
          degradedSignals: degraded.degradedSignals,
        });
      } finally {
        await saf.shutdown();
      }
    }
  }

  const auditedSessionIds = await readSAFAuditCoverage(config.auditLogPath);
  for (const row of rows) {
    const sessionId = `benchmark-saf:${row.scenarioId}:${row.trial}`;
    row.auditFound = auditedSessionIds.has(sessionId);
  }

  return {
    rows,
    auditPath: config.auditLogPath,
    effectiveConfig: effectiveConfigSummary(config),
  };
}

function runBaselineMode(mode: "plain" | "simple", scenarios: BenchmarkScenario[], trials: number): BenchmarkRow[] {
  const rows: BenchmarkRow[] = [];

  for (const scenario of scenarios) {
    for (let trial = 1; trial <= trials; trial += 1) {
      const decision =
        mode === "plain" ? evaluatePlainBaseline() : evaluateSimpleSafeguards(scenario.toolName, scenario.rawArgs);

      rows.push({
        mode,
        scenarioId: scenario.id,
        scenarioDescription: scenario.description,
        kind: scenario.kind,
        expectedSafety: scenario.expectedSafety,
        riskCategory: scenario.riskCategory,
        comparable: scenario.comparable ?? true,
        trial,
        verdict: decision.verdict,
        blocked: decision.verdict !== "ALLOWED",
        reason: decision.reason,
        decisionLatencyMs: decision.decisionLatencyMs,
        totalLatencyMs: decision.totalLatencyMs,
        auditFound: false,
        dependencyDegraded: false,
        degradedSignals: [],
      });
    }
  }

  return rows;
}

function mapRowsToScenarioSummary(rows: BenchmarkRow[]): BenchmarkRow[] {
  const grouped = new Map<string, BenchmarkRow[]>();

  for (const row of rows) {
    const key = `${row.mode}::${row.scenarioId}`;
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      grouped.set(key, [row]);
    }
  }

  const summaries: BenchmarkRow[] = [];

  for (const bucket of grouped.values()) {
    const first = bucket[0];
    if (!first) {
      continue;
    }

    let verdict: FinalVerdict = "ALLOWED";
    if (bucket.some((row) => row.verdict === "DENIED")) {
      verdict = "DENIED";
    } else if (bucket.some((row) => row.verdict === "REQUIRE_APPROVAL")) {
      verdict = "REQUIRE_APPROVAL";
    }

    const decisionLatencyMs = Math.round(bucket.reduce((sum, row) => sum + row.decisionLatencyMs, 0) / bucket.length);
    const totalLatencyMs = Math.round(bucket.reduce((sum, row) => sum + row.totalLatencyMs, 0) / bucket.length);
    const degradedSignalSet = new Set<string>();
    for (const row of bucket) {
      for (const signal of row.degradedSignals) {
        degradedSignalSet.add(signal);
      }
    }

    summaries.push({
      mode: first.mode,
      scenarioId: first.scenarioId,
      scenarioDescription: first.scenarioDescription,
      kind: first.kind,
      expectedSafety: first.expectedSafety,
      riskCategory: first.riskCategory,
      comparable: first.comparable,
      trial: 1,
      verdict,
      blocked: verdict !== "ALLOWED",
      reason: bucket.find((row) => row.reason.trim().length > 0)?.reason ?? "",
      decisionLatencyMs,
      totalLatencyMs,
      auditFound: bucket.some((row) => row.auditFound),
      dependencyDegraded: bucket.some((row) => row.dependencyDegraded),
      degradedSignals: [...degradedSignalSet].sort(),
    });
  }

  return summaries;
}

function selectCoreComparableRows(rows: BenchmarkRow[]): BenchmarkRow[] {
  return rows.filter((row) => row.comparable);
}

function selectAdvancedSAFRows(rows: BenchmarkRow[]): BenchmarkRow[] {
  return rows.filter((row) => !row.comparable);
}

function computeMetricsForModes(modes: BenchmarkMode[], rows: BenchmarkRow[]): ModeMetrics[] {
  return modes.map((mode) => computeModeMetrics(mode, rows.filter((row) => row.mode === mode)));
}

function groupRowsByRiskCategory(rows: BenchmarkRow[]): Record<ScenarioRiskCategory, BenchmarkRow[]> {
  return {
    computer_security_compromise: rows.filter((row) => row.riskCategory === "computer_security_compromise"),
    data_loss_or_corruption: rows.filter((row) => row.riskCategory === "data_loss_or_corruption"),
    privacy_breach: rows.filter((row) => row.riskCategory === "privacy_breach"),
    unsafe_code_execution: rows.filter((row) => row.riskCategory === "unsafe_code_execution"),
    financial_loss: rows.filter((row) => row.riskCategory === "financial_loss"),
    spreading_malicious_content: rows.filter((row) => row.riskCategory === "spreading_malicious_content"),
    legal_or_policy_violation: rows.filter((row) => row.riskCategory === "legal_or_policy_violation"),
    harmful_decision_making: rows.filter((row) => row.riskCategory === "harmful_decision_making"),
  };
}

function computeRiskCategoryMetrics(
  modes: BenchmarkMode[],
  rows: BenchmarkRow[],
  scenarioRows: BenchmarkRow[],
): BenchmarkReport["riskCategoryMetrics"] {
  const perTrialGroups = groupRowsByRiskCategory(rows);
  const perScenarioGroups = groupRowsByRiskCategory(scenarioRows);

  return {
    computer_security_compromise: {
      perTrial: computeMetricsForModes(modes, perTrialGroups.computer_security_compromise),
      perScenario: computeMetricsForModes(modes, perScenarioGroups.computer_security_compromise),
    },
    data_loss_or_corruption: {
      perTrial: computeMetricsForModes(modes, perTrialGroups.data_loss_or_corruption),
      perScenario: computeMetricsForModes(modes, perScenarioGroups.data_loss_or_corruption),
    },
    privacy_breach: {
      perTrial: computeMetricsForModes(modes, perTrialGroups.privacy_breach),
      perScenario: computeMetricsForModes(modes, perScenarioGroups.privacy_breach),
    },
    unsafe_code_execution: {
      perTrial: computeMetricsForModes(modes, perTrialGroups.unsafe_code_execution),
      perScenario: computeMetricsForModes(modes, perScenarioGroups.unsafe_code_execution),
    },
    financial_loss: {
      perTrial: computeMetricsForModes(modes, perTrialGroups.financial_loss),
      perScenario: computeMetricsForModes(modes, perScenarioGroups.financial_loss),
    },
    spreading_malicious_content: {
      perTrial: computeMetricsForModes(modes, perTrialGroups.spreading_malicious_content),
      perScenario: computeMetricsForModes(modes, perScenarioGroups.spreading_malicious_content),
    },
    legal_or_policy_violation: {
      perTrial: computeMetricsForModes(modes, perTrialGroups.legal_or_policy_violation),
      perScenario: computeMetricsForModes(modes, perScenarioGroups.legal_or_policy_violation),
    },
    harmful_decision_making: {
      perTrial: computeMetricsForModes(modes, perTrialGroups.harmful_decision_making),
      perScenario: computeMetricsForModes(modes, perScenarioGroups.harmful_decision_making),
    },
  };
}

export function computeModeMetrics(mode: BenchmarkMode, rows: BenchmarkRow[]): ModeMetrics {
  const safeRows = rows.filter((row) => row.expectedSafety === "safe");
  const unsafeRows = rows.filter((row) => row.expectedSafety === "unsafe");
  const comparableUnsafeRows = unsafeRows.filter((row) => row.comparable);
  const evasionRows = rows.filter((row) => row.kind === "evasion");
  const driftRows = rows.filter((row) => row.kind === "drift");

  const allowedRows = rows.filter((row) => row.verdict === "ALLOWED");
  const deniedRows = rows.filter((row) => row.verdict === "DENIED");
  const approvalRows = rows.filter((row) => row.verdict === "REQUIRE_APPROVAL");

  const safeAllows = safeRows.filter((row) => row.verdict === "ALLOWED").length;
  const safeDenied = safeRows.filter((row) => row.verdict === "DENIED").length;
  const safeApprovals = safeRows.filter((row) => row.verdict === "REQUIRE_APPROVAL").length;
  const safeInterventions = safeRows.filter((row) => row.verdict !== "ALLOWED").length;

  const unsafeAllows = unsafeRows.filter((row) => row.verdict === "ALLOWED").length;
  const unsafeDenied = unsafeRows.filter((row) => row.verdict === "DENIED").length;
  const unsafeApprovals = unsafeRows.filter((row) => row.verdict === "REQUIRE_APPROVAL").length;
  const unsafeInterventions = unsafeRows.filter((row) => row.verdict !== "ALLOWED").length;

  const comparableUnsafeAllows = comparableUnsafeRows.filter((row) => row.verdict === "ALLOWED").length;
  const comparableUnsafeDenied = comparableUnsafeRows.filter((row) => row.verdict === "DENIED").length;
  const comparableUnsafeApprovals = comparableUnsafeRows.filter((row) => row.verdict === "REQUIRE_APPROVAL").length;
  const comparableUnsafeInterventions = comparableUnsafeRows.filter((row) => row.verdict !== "ALLOWED").length;

  const evasionDenied = evasionRows.filter((row) => row.verdict === "DENIED").length;
  const evasionApprovals = evasionRows.filter((row) => row.verdict === "REQUIRE_APPROVAL").length;
  const evasionInterventions = evasionRows.filter((row) => row.verdict !== "ALLOWED").length;

  const driftDenied = driftRows.filter((row) => row.verdict === "DENIED").length;
  const driftApprovals = driftRows.filter((row) => row.verdict === "REQUIRE_APPROVAL").length;
  const driftInterventions = driftRows.filter((row) => row.verdict !== "ALLOWED").length;

  const auditCoverageCount = rows.filter((row) => row.auditFound).length;
  const degradedRows = rows.filter((row) => row.dependencyDegraded);
  const opaFallbackRows = rows.filter((row) => row.degradedSignals.includes("opa_fallback"));
  const judgeUnavailableRows = rows.filter((row) => row.degradedSignals.includes("intent_judge_unavailable"));
  const normalizerFallbackRows = rows.filter((row) => row.degradedSignals.includes("normalizer_fallback"));
  const decisionLatencies = rows.map((row) => row.decisionLatencyMs);
  const totalLatencies = rows.map((row) => row.totalLatencyMs);

  const decisionStats = calculateLatencyStats(decisionLatencies);
  const totalStats = calculateLatencyStats(totalLatencies);

  return {
    mode,
    total: rows.length,
    safeTotal: safeRows.length,
    unsafeTotal: unsafeRows.length,
    comparableUnsafeTotal: comparableUnsafeRows.length,
    allowed: allowedRows.length,
    denied: deniedRows.length,
    requireApproval: approvalRows.length,
    safeAllows,
    safeDenied,
    safeApprovals,
    safeInterventions,
    unsafeAllows,
    unsafeDenied,
    unsafeApprovals,
    unsafeInterventions,
    comparableUnsafeAllows,
    comparableUnsafeDenied,
    comparableUnsafeApprovals,
    comparableUnsafeInterventions,
    evasionTotal: evasionRows.length,
    evasionDenied,
    evasionApprovals,
    evasionInterventions,
    driftTotal: driftRows.length,
    driftDenied,
    driftApprovals,
    driftInterventions,
    auditCoverageCount,
    safeAllowRate: ratio(safeAllows, safeRows.length),
    safeDenyRate: ratio(safeDenied, safeRows.length),
    safeApprovalRate: ratio(safeApprovals, safeRows.length),
    unsafeDenyRate: ratio(unsafeDenied, unsafeRows.length),
    unsafeApprovalRate: ratio(unsafeApprovals, unsafeRows.length),
    unsafeInterventionRate: ratio(unsafeInterventions, unsafeRows.length),
    comparableUnsafeDenyRate: ratio(comparableUnsafeDenied, comparableUnsafeRows.length),
    comparableUnsafeApprovalRate: ratio(comparableUnsafeApprovals, comparableUnsafeRows.length),
    comparableUnsafeInterventionRate: ratio(comparableUnsafeInterventions, comparableUnsafeRows.length),
    falseAllowRate: ratio(unsafeAllows, unsafeRows.length),
    comparableFalseAllowRate: ratio(comparableUnsafeAllows, comparableUnsafeRows.length),
    falseDenyRate: ratio(safeDenied, safeRows.length),
    falseEscalationRate: ratio(safeApprovals, safeRows.length),
    evasionDenyRate: ratio(evasionDenied, evasionRows.length),
    evasionApprovalRate: ratio(evasionApprovals, evasionRows.length),
    evasionInterventionRate: ratio(evasionInterventions, evasionRows.length),
    driftDenyRate: ratio(driftDenied, driftRows.length),
    driftApprovalRate: ratio(driftApprovals, driftRows.length),
    driftInterventionRate: ratio(driftInterventions, driftRows.length),
    degradedCount: degradedRows.length,
    opaFallbackCount: opaFallbackRows.length,
    judgeUnavailableCount: judgeUnavailableRows.length,
    normalizerFallbackCount: normalizerFallbackRows.length,
    degradedRate: ratio(degradedRows.length, rows.length),
    opaFallbackRate: ratio(opaFallbackRows.length, rows.length),
    judgeUnavailableRate: ratio(judgeUnavailableRows.length, rows.length),
    normalizerFallbackRate: ratio(normalizerFallbackRows.length, rows.length),
    auditCoverageRate: ratio(auditCoverageCount, rows.length),
    requireApprovalRate: ratio(approvalRows.length, rows.length),
    decisionLatencyMeanMs: decisionStats.mean,
    decisionLatencyStdDevMs: decisionStats.stdDev,
    decisionLatencyP50Ms: decisionStats.p50,
    decisionLatencyP95Ms: decisionStats.p95,
    decisionLatencyMinMs: decisionStats.min,
    decisionLatencyMaxMs: decisionStats.max,
    totalLatencyMeanMs: totalStats.mean,
    totalLatencyStdDevMs: totalStats.stdDev,
    totalLatencyP50Ms: totalStats.p50,
    totalLatencyP95Ms: totalStats.p95,
    totalLatencyMinMs: totalStats.min,
    totalLatencyMaxMs: totalStats.max,
  };
}

export async function runComparisonBenchmark(options: RunComparisonBenchmarkOptions): Promise<BenchmarkReport> {
  const trials = options.trials ?? 3;
  const modes = options.modes ?? ["plain", "simple", "saf"];
  const safModeEnabled = modes.includes("saf");
  if (safModeEnabled && !options.safProfile) {
    throw new Error(
      "safProfile is required when running saf mode. Use one of: default-runtime, deterministic-lab, policy-only.",
    );
  }
  const safProfile = options.safProfile ?? "deterministic-lab";

  const rows: BenchmarkRow[] = [];
  let safAuditLogPath: string | undefined;
  let effectiveSafConfig: BenchmarkReport["config"]["effectiveSafConfig"] = null;

  for (const mode of modes) {
    if (mode === "plain" || mode === "simple") {
      rows.push(...runBaselineMode(mode, options.scenarios, trials));
      continue;
    }

    const safResult = await runSAFMode(options.scenarios, trials, safProfile, options.safConfigPath);
    safAuditLogPath = safResult.auditPath;
    effectiveSafConfig = safResult.effectiveConfig;
    rows.push(...safResult.rows);
  }

  const metrics = computeMetricsForModes(modes, rows);
  const scenarioSummaryRows = mapRowsToScenarioSummary(rows);
  const perScenarioMetrics = computeMetricsForModes(modes, scenarioSummaryRows);
  const coreComparableRows = selectCoreComparableRows(rows);
  const advancedSAFRows = selectAdvancedSAFRows(rows);
  const coreComparableScenarioRows = selectCoreComparableRows(scenarioSummaryRows);
  const advancedSAFScenarioRows = selectAdvancedSAFRows(scenarioSummaryRows);
  const riskCategoryMetrics = computeRiskCategoryMetrics(modes, rows, scenarioSummaryRows);

  return {
    generatedAt: new Date().toISOString(),
    config: {
      trials,
      modes,
      scenarioCount: options.scenarios.length,
      safProfile,
      safConfigPath: options.safConfigPath,
      effectiveSafConfig,
      safAuditLogPath,
    },
    metrics,
    rows,
    perScenarioMetrics,
    trackMetrics: {
      coreComparable: {
        perTrial: computeMetricsForModes(modes, coreComparableRows),
        perScenario: computeMetricsForModes(modes, coreComparableScenarioRows),
      },
      advancedSAF: {
        perTrial: computeMetricsForModes(modes, advancedSAFRows),
        perScenario: computeMetricsForModes(modes, advancedSAFScenarioRows),
      },
    },
    riskCategoryMetrics,
  };
}

export async function loadBenchmarkScenarios(filePath: string): Promise<BenchmarkScenario[]> {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error(`Benchmark scenarios at ${filePath} must be a JSON array.`);
  }

  return parsed.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`Scenario at index ${index} is not an object.`);
    }

    const record = entry as Record<string, unknown>;
    const id = record.id;
    const description = record.description;
    const kind = record.kind;
    const expectedSafety = record.expectedSafety;
    const riskCategory = record.riskCategory;
    const comparable = record.comparable;
    const toolName = record.toolName;
    const rawArgs = record.rawArgs;
    const userGoal = record.userGoal;

    if (typeof id !== "string" || id.trim().length === 0) {
      throw new Error(`Scenario at index ${index} is missing a valid id.`);
    }

    if (typeof description !== "string" || description.trim().length === 0) {
      throw new Error(`Scenario '${id}' is missing a valid description.`);
    }

    if (kind !== "benign" && kind !== "unsafe" && kind !== "evasion" && kind !== "drift") {
      throw new Error(`Scenario '${id}' has invalid kind '${String(kind)}'.`);
    }

    if (expectedSafety !== "safe" && expectedSafety !== "unsafe") {
      throw new Error(`Scenario '${id}' has invalid expectedSafety '${String(expectedSafety)}'.`);
    }

    const supportedRiskCategories: ScenarioRiskCategory[] = [
      "computer_security_compromise",
      "data_loss_or_corruption",
      "privacy_breach",
      "unsafe_code_execution",
      "financial_loss",
      "spreading_malicious_content",
      "legal_or_policy_violation",
      "harmful_decision_making",
    ];

    if (!supportedRiskCategories.includes(riskCategory as ScenarioRiskCategory)) {
      throw new Error(`Scenario '${id}' has invalid riskCategory '${String(riskCategory)}'.`);
    }

    if (typeof comparable !== "undefined" && typeof comparable !== "boolean") {
      throw new Error(`Scenario '${id}' has invalid comparable flag '${String(comparable)}'.`);
    }

    if (typeof toolName !== "string" || toolName.trim().length === 0) {
      throw new Error(`Scenario '${id}' is missing a valid toolName.`);
    }

    if (typeof rawArgs !== "object" || rawArgs === null || Array.isArray(rawArgs)) {
      throw new Error(`Scenario '${id}' must define rawArgs as an object.`);
    }

    if (typeof userGoal !== "string" || userGoal.trim().length === 0) {
      throw new Error(`Scenario '${id}' is missing a valid userGoal.`);
    }

    return {
      id,
      description,
      kind,
      expectedSafety,
      riskCategory: riskCategory as ScenarioRiskCategory,
      comparable: comparable ?? true,
      toolName,
      rawArgs: rawArgs as Record<string, unknown>,
      userGoal,
    } satisfies BenchmarkScenario;
  });
}

function asPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatMetricRow(row: ModeMetrics): string {
  return [
    row.mode,
    asPercent(row.safeAllowRate),
    asPercent(row.unsafeDenyRate),
    asPercent(row.unsafeApprovalRate),
    asPercent(row.unsafeInterventionRate),
    asPercent(row.comparableUnsafeInterventionRate),
    asPercent(row.falseAllowRate),
    asPercent(row.comparableFalseAllowRate),
    asPercent(row.falseDenyRate),
    asPercent(row.falseEscalationRate),
    asPercent(row.evasionInterventionRate),
    asPercent(row.driftInterventionRate),
    asPercent(row.degradedRate),
    asPercent(row.opaFallbackRate),
    asPercent(row.judgeUnavailableRate),
    asPercent(row.normalizerFallbackRate),
    asPercent(row.auditCoverageRate),
    asPercent(row.requireApprovalRate),
    row.decisionLatencyMeanMs.toFixed(2),
    row.decisionLatencyStdDevMs.toFixed(2),
    row.decisionLatencyP50Ms.toFixed(0),
    row.decisionLatencyP95Ms.toFixed(0),
    row.totalLatencyMeanMs.toFixed(2),
    row.totalLatencyStdDevMs.toFixed(2),
    row.totalLatencyP50Ms.toFixed(0),
    row.totalLatencyP95Ms.toFixed(0),
  ].join("\t");
}

export function formatMetricsTable(metrics: ModeMetrics[]): string {
  const header = [
    "mode",
    "safe_allow",
    "unsafe_deny",
    "unsafe_approval",
    "unsafe_intervention",
    "comparable_unsafe_intervention",
    "false_allow",
    "comparable_false_allow",
    "false_deny",
    "false_escalation",
    "evasion_intervention",
    "drift_intervention",
    "degraded",
    "opa_fallback",
    "judge_unavailable",
    "normalizer_fallback",
    "audit_cov",
    "approval_rate",
    "decision_mean_ms",
    "decision_stddev_ms",
    "decision_p50_ms",
    "decision_p95_ms",
    "total_mean_ms",
    "total_stddev_ms",
    "total_p50_ms",
    "total_p95_ms",
  ];

  const lines = [header.join("\t")];
  for (const row of metrics) {
    lines.push(formatMetricRow(row));
  }

  return lines.join("\n");
}

export function formatDualMetricsTables(report: BenchmarkReport): string {
  const sections: string[] = [];
  sections.push("[per-trial]");
  sections.push(formatMetricsTable(report.metrics));
  sections.push("");
  sections.push("[per-scenario]");
  sections.push(formatMetricsTable(report.perScenarioMetrics));
  sections.push("");
  sections.push("[core-comparable per-trial]");
  sections.push(formatMetricsTable(report.trackMetrics.coreComparable.perTrial));
  sections.push("");
  sections.push("[core-comparable per-scenario]");
  sections.push(formatMetricsTable(report.trackMetrics.coreComparable.perScenario));
  sections.push("");
  sections.push("[advanced-saf per-trial]");
  sections.push(formatMetricsTable(report.trackMetrics.advancedSAF.perTrial));
  sections.push("");
  sections.push("[advanced-saf per-scenario]");
  sections.push(formatMetricsTable(report.trackMetrics.advancedSAF.perScenario));

  for (const [riskCategory, metrics] of Object.entries(report.riskCategoryMetrics)) {
    sections.push("");
    sections.push(`[risk-category:${riskCategory} per-trial]`);
    sections.push(formatMetricsTable(metrics.perTrial));
    sections.push("");
    sections.push(`[risk-category:${riskCategory} per-scenario]`);
    sections.push(formatMetricsTable(metrics.perScenario));
  }
  return sections.join("\n");
}
