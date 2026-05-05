import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import {
  formatDualMetricsTables,
  loadBenchmarkScenarios,
  runComparisonBenchmark,
  type BenchmarkMode,
  type SAFBenchmarkProfile,
} from "../src/benchmark/comparison.js";
import { loadConfig } from "../src/config.js";
import { ensureOpaEndpointHealthy } from "./opa-health.js";

interface DependencyPreflightOptions {
  autoStartOpa: boolean;
}

async function assertDefaultRuntimeDependenciesHealthy(
  safConfigPath: string | undefined,
  options: DependencyPreflightOptions,
): Promise<void> {
  const configPath = safConfigPath ?? path.resolve(process.cwd(), "configs/saf-config.json");
  const config = await loadConfig(configPath);
  const issues: string[] = [];

  if (config.policy.mode === "opa") {
    try {
      await ensureOpaEndpointHealthy({
        opaUrl: config.policy.opaUrl,
        workspacePath: config.workspacePath,
        autoStart: options.autoStartOpa,
        setupScriptPath: path.resolve(process.cwd(), "scripts/setup-opa.sh"),
        probeTimeoutMs: config.policy.timeoutMs,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      issues.push(reason);
    }
  }

  if (config.intentCheckEnabled && config.intent.mode === "pi-ai" && !config.intent.oauth) {
    if (!config.intent.apiKeyEnvVar) {
      issues.push("intent.mode=pi-ai requires intent.apiKeyEnvVar when oauth is not configured");
    } else if (!process.env[config.intent.apiKeyEnvVar]) {
      issues.push(`missing env var ${config.intent.apiKeyEnvVar} for intent provider '${config.intent.provider ?? "unknown"}'`);
    }
  }

  if (config.normalizer.mode !== "deterministic") {
    if (!config.normalizer.apiKeyEnvVar) {
      issues.push("normalizer.mode requires normalizer.apiKeyEnvVar for LLM access");
    } else if (!process.env[config.normalizer.apiKeyEnvVar]) {
      issues.push(
        `missing env var ${config.normalizer.apiKeyEnvVar} for normalizer provider '${config.normalizer.provider ?? "unknown"}'`,
      );
    }
  }

  if (issues.length > 0) {
    throw new Error([
      "Default-runtime dependency preflight failed:",
      ...issues.map((issue) => `- ${issue}`),
      "Fix runtime dependencies, or rerun with --allow-degraded-deps to benchmark with fallback/degraded signals.",
    ].join("\n"));
  }
}

function parseModes(value: string | undefined): BenchmarkMode[] {
  if (!value || value.trim().length === 0) {
    return ["plain", "simple", "saf"];
  }

  const values = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const supported: BenchmarkMode[] = ["plain", "simple", "saf"];
  const modes: BenchmarkMode[] = [];

  for (const item of values) {
    if (!supported.includes(item as BenchmarkMode)) {
      throw new Error(`Unsupported benchmark mode '${item}'. Supported modes: plain,simple,saf`);
    }

    modes.push(item as BenchmarkMode);
  }

  return modes;
}

function parseProfile(value: string | undefined): SAFBenchmarkProfile {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(
      "Missing --saf-profile. Choose one of: default-runtime, deterministic-lab, policy-only. " +
        "Use default-runtime for real-world comparisons.",
    );
  }

  const supported: SAFBenchmarkProfile[] = ["default-runtime", "deterministic-lab", "policy-only"];
  if (!supported.includes(normalized as SAFBenchmarkProfile)) {
    throw new Error(
      `Unsupported --saf-profile '${normalized}'. Supported profiles: default-runtime,deterministic-lab,policy-only`,
    );
  }

  return normalized as SAFBenchmarkProfile;
}

function parseNumberFlag(name: string, raw: string | undefined, fallback: number): number {
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for ${name}: '${raw}'. Must be a positive integer.`);
  }

  return parsed;
}

function parseArgs(argv: string[]): {
  scenarioPath: string;
  outputDir: string;
  trials: number;
  modes: BenchmarkMode[];
  safConfigPath?: string;
  safProfile: SAFBenchmarkProfile;
  allowDegradedDeps: boolean;
  autoStartOpa: boolean;
} {
  let scenarioPath = path.resolve(process.cwd(), "benchmarks/scenarios/comparison-scenarios.json");
  let outputDir = path.resolve(process.cwd(), "benchmarks/results");
  let trials = 3;
  let modes: BenchmarkMode[] = ["plain", "simple", "saf"];
  let safConfigPath: string | undefined;
  let safProfile: SAFBenchmarkProfile | undefined;
  let allowDegradedDeps = false;
  let autoStartOpa = true;

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];

    if (current === "--scenarios") {
      if (!next) {
        throw new Error("Missing value for --scenarios");
      }
      scenarioPath = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }

    if (current === "--out-dir") {
      if (!next) {
        throw new Error("Missing value for --out-dir");
      }
      outputDir = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }

    if (current === "--trials") {
      trials = parseNumberFlag("--trials", next, trials);
      i += 1;
      continue;
    }

    if (current === "--modes") {
      modes = parseModes(next);
      i += 1;
      continue;
    }

    if (current === "--saf-config") {
      if (!next) {
        throw new Error("Missing value for --saf-config");
      }
      safConfigPath = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }

    if (current === "--saf-profile") {
      safProfile = parseProfile(next);
      i += 1;
      continue;
    }

    if (current === "--allow-degraded-deps") {
      allowDegradedDeps = true;
      continue;
    }

    if (current === "--no-auto-start-opa") {
      autoStartOpa = false;
      continue;
    }

    if (current === "--help" || current === "-h") {
      console.log([
        "Usage: npm run benchmark:compare -- [options]",
        "",
        "Options:",
        "  --scenarios <path>       Scenario JSON path (default: benchmarks/scenarios/comparison-scenarios.json)",
        "  --out-dir <path>         Output directory (default: benchmarks/results)",
        "  --trials <n>             Trials per scenario and mode (default: 3)",
        "  --modes <list>           Comma-separated modes: plain,simple,saf (default: all)",
        "  --saf-config <path>      SAF config path override",
        "  --saf-profile <profile>  REQUIRED. SAF profile: default-runtime|deterministic-lab|policy-only",
        "  --allow-degraded-deps    Allow fallback/degraded dependency signals in SAF default-runtime runs",
        "  --no-auto-start-opa      Disable auto-start attempt when OPA is down on localhost",
      ].join("\n"));
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${current}`);
  }

  return {
    scenarioPath,
    outputDir,
    trials,
    modes,
    safConfigPath,
    safProfile: parseProfile(safProfile),
    allowDegradedDeps,
    autoStartOpa,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const scenarios = await loadBenchmarkScenarios(args.scenarioPath);

  if (args.modes.includes("saf") && args.safProfile === "default-runtime" && !args.allowDegradedDeps) {
    await assertDefaultRuntimeDependenciesHealthy(args.safConfigPath, {
      autoStartOpa: args.autoStartOpa,
    });
  }

  const report = await runComparisonBenchmark({
    scenarios,
    trials: args.trials,
    modes: args.modes,
    safConfigPath: args.safConfigPath,
    safProfile: args.safProfile,
  });

  if (args.modes.includes("saf") && args.safProfile === "default-runtime" && !args.allowDegradedDeps) {
    const safMetrics = report.metrics.find((metric) => metric.mode === "saf");
    if (safMetrics && safMetrics.degradedCount > 0) {
      throw new Error(
        "Default-runtime SAF benchmark detected degraded dependencies " +
          `(opa_fallback=${safMetrics.opaFallbackCount}, ` +
          `intent_judge_unavailable=${safMetrics.judgeUnavailableCount}, ` +
          `normalizer_fallback=${safMetrics.normalizerFallbackCount}). ` +
          "Fix dependency health and rerun, or pass --allow-degraded-deps.",
      );
    }
  }

  await mkdir(args.outputDir, { recursive: true });

  const runTag = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(args.outputDir, `comparison-report-${runTag}.json`);
  const tablePath = path.join(args.outputDir, `comparison-metrics-${runTag}.tsv`);

  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const metricsText = formatDualMetricsTables(report);
  await writeFile(tablePath, `${metricsText}\n`, "utf8");

  console.log("Comparison benchmark completed.");
  console.log(`Scenarios: ${scenarios.length}`);
  console.log(`Modes: ${args.modes.join(",")}`);
  console.log(`Trials per scenario: ${args.trials}`);
  console.log(`SAF profile: ${args.safProfile}`);
  if (report.config.effectiveSafConfig) {
    console.log(`Effective SAF policy mode: ${report.config.effectiveSafConfig.policyMode}`);
    console.log(`Effective SAF intent mode: ${report.config.effectiveSafConfig.intentMode}`);
    console.log(`Effective SAF normalizer mode: ${report.config.effectiveSafConfig.normalizerMode}`);
    console.log(`Effective SAF sandbox enabled: ${String(report.config.effectiveSafConfig.sandboxEnabled)}`);
  }
  console.log("\nMetrics:");
  console.log(metricsText);
  console.log("\nArtifacts:");
  console.log(`- ${reportPath}`);
  console.log(`- ${tablePath}`);
  if (report.config.safAuditLogPath) {
    console.log(`- ${report.config.safAuditLogPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
