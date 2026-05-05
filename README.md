# Semantic Action Firewall (SAF)

Runtime security layer for agent tool calls.

This project implements a working SAF pipeline that:

- inspects raw tool payloads with an anomaly detector,
- normalizes actions into semantic operations,
- evaluates deterministic policy rules (local engine or OPA sidecar),
- checks intent alignment for flagged actions (heuristic or pi-ai judge),
- enforces per-tool capabilities,
- writes audit records for allow, deny, and require-approval outcomes.

## Quick start

```bash
npm install
npm run lint
npm test
npm run live:preflight
npm run benchmark:compare -- --saf-profile default-runtime
```

`npm run demo:mock-flow` is a demo-only mock flow:

- constructs a sample `beforeToolCall` input
- applies SAF checks
- resolves block vs rewrite contract
- executes the resolved command and prints execution output

## Current structure

- `src/saf.ts`: end-to-end pipeline orchestration
- `src/interceptor/*`: hook adapter for Pi agent `beforeToolCall`
- `src/detector/*`: anomaly and evasion heuristics
- `src/normalizer/*`: shell/python/typescript normalizers
- `src/policy/*`: local policy engine + policy loaders
- `src/intent/*`: goal extraction and heuristic/pi-ai intent judge
- `src/guard/*`: capability registry and enforcement
- `src/sandbox/*`: sandbox config + execution runner scaffolding
- `src/logging/*`: JSON audit logging

## Config files

- `configs/saf-config.json`: global SAF configuration
- `configs/default-policy.json`: deterministic policy configuration
- `configs/tool-capabilities.json`: per-tool capabilities
- `configs/srt-settings.json`: sandbox baseline settings

## OPA policy mode

Set the following in `configs/saf-config.json`:

```json
{
  "policy": {
    "mode": "opa",
    "opaUrl": "http://localhost:8181/v1/data/saf/result",
    "timeoutMs": 100,
    "fallback": "local"
  }
}
```

Run OPA locally:

```bash
./scripts/setup-opa.sh
```

Smoke-test OPA endpoint after startup:

```bash
curl -sS -X POST http://localhost:8181/v1/data/saf/result \
  -H "content-type: application/json" \
  -d '{"input":{"action":{"category":"filesystem","operation":"read","target":"src/index.ts"},"context":{"workspacePath":"/workspace"},"policy":{"defaultBehavior":"deny","allowedDomains":["api.github.com"],"protectedPaths":["/","/etc"]}}}'
```

Fallback behavior is configurable:

- `fallback: "local"` => use local deterministic policy engine if OPA times out/fails
- `fallback: "deny"` => fail closed on OPA failure
- `fallback: "require_approval"` => fail to human approval path on OPA failure

## pi-ai intent mode

Set the following in `configs/saf-config.json`:

```json
{
  "intent": {
    "mode": "pi-ai",
    "provider": "google",
    "model": "gemma-4-26b-a4b-it",
    "apiKeyEnvVar": "GOOGLE_GENERATIVE_AI_API_KEY",
    "timeoutMs": 15000,
    "doubleCheck": true
  }
}
```

For OAuth-based providers, use:

```json
{
  "intent": {
    "mode": "pi-ai",
    "provider": "github-copilot",
    "model": "gpt-4o-mini",
    "doubleCheck": true,
    "oauth": {
      "providerId": "github-copilot",
      "authFile": "./auth.json"
    }
  }
}
```

The OAuth `auth.json` file is expected to contain pi-ai OAuth credentials for the selected provider.

When using OAuth mode, the SAF judge refreshes OAuth tokens automatically and persists refreshed credentials back to `auth.json`.

Current default profile in this repo is `intent.mode = "pi-ai"`.

Important: this mode requires a valid model key unless you override to heuristic mode in local tests.

## LLM normalizer mode

Set the following in `configs/saf-config.json`:

```json
{
  "normalizer": {
    "mode": "hybrid",
    "provider": "google",
    "model": "gemma-4-26b-a4b-it",
    "apiKeyEnvVar": "GOOGLE_GENERATIVE_AI_API_KEY",
    "timeoutMs": 15000,
    "maxPayloadChars": 8000,
    "cacheEnabled": true,
    "cacheMaxEntries": 500
  }
}
```

Behavior:

- `mode: "deterministic"` => use tool/shell/python/typescript parsers only
- `mode: "hybrid"` => deterministic parser first, then LLM for complex/ambiguous payloads
- `mode: "llm"` => force LLM normalization for all non-tool invocations

Failure handling:

- if LLM normalization succeeds, SAF uses `parser: "llm"`
- if LLM normalization fails after escalation, SAF now falls back to `unknown` and approval-path handling (not permissive deterministic downgrade)
- fallback reason is captured in normalized metadata for audit/debug

Current default profile in this repo is hybrid LLM normalization with Gemma (`provider=google`, `model=gemma-4-26b-a4b-it`).

## Sandbox command rewrite

Enable in `configs/saf-config.json`:

```json
{
  "sandbox": {
    "enabled": true,
    "failOpen": true,
    "timeoutMs": 30000
  }
}
```

Behavior:

- for shell tool calls (`bash`), SAF rewrites `args.command` using `SandboxManager.wrapWithSandbox(...)`
- rewritten args are returned from `beforeToolCall`, so the agent executes the sandboxed command
- if rewrite fails:
  - `failOpen: true` => original command proceeds (logged)
  - `failOpen: false` => SAF denies the action
- note: `sandbox.timeoutMs` is currently reserved for future execution-stage wiring; command rewrite itself does not enforce runtime timeout.

Current default profile in this repo is strict sandbox mode (`enabled: true`, `failOpen: false`).

## Pi hook contract example

The interceptor supports three outcomes from `beforeToolCall`:

- `undefined` => allow and keep original args
- `{ block: true, reason }` => block tool execution
- `{ requireApproval: true, reason }` => signal manual approval is required
- `{ args: rewrittenArgs }` => allow with rewritten args

Use `resolveBeforeToolCallResult(...)` to normalize these outcomes before invoking the tool.

## Pi Agent Core adapter (typed)

For direct integration with `@mariozechner/pi-agent-core`, use the typed adapter in
`src/interceptor/pi-agent-core-adapter.ts`.

It provides:

- `beforeToolCall` / `afterToolCall` handlers matching pi-agent-core hook signatures
- `wrapTool(...)` / `wrapTools(...)` helpers that apply SAF rewritten args at execution time
- `shutdown()` for cleanup

Example usage:

```ts
import { Agent } from "@mariozechner/pi-agent-core";
import { loadConfig, createPiAgentCoreAdapter } from "semantic-action-firewall";

const config = await loadConfig("./configs/saf-config.json");
const adapter = await createPiAgentCoreAdapter(config, {
  sessionId: "session-1",
  agentId: "agent-1",
  agentMode: "autonomous",
});

const wrappedTools = adapter.wrapTools(tools);

const agent = new Agent({
  initialState: {
    systemPrompt: "You are a coding assistant.",
    model,
    tools: wrappedTools,
  },
  beforeToolCall: adapter.beforeToolCall,
  afterToolCall: adapter.afterToolCall,
});
```

For less boilerplate, you can use `createSAFEnabledAgent(...)` which returns `{ agent, adapter, shutdown }` and wires everything for you.

Ready-to-run example:

- file: `examples/pi-agent-core.ts`
- command: `npm run example:pi-agent -- "Read package.json and tell me the package name"`
- live model command: `npm run example:pi-agent -- --live "Read package.json and tell me the package name"`

Notes:

- default mode uses pi-ai faux provider and local policy override for deterministic local runs
- `--live` mode uses a real model and expects a provider API key in your environment (for Google: `GOOGLE_GENERATIVE_AI_API_KEY`)
- if `configs/saf-config.json` is switched to OAuth intent mode, SAF will request OAuth credentials when needed

## Live E2E (pi-agent-core)

This repo includes a live-runtime preflight and scenario runner for `@mariozechner/pi-agent-core`.

Prerequisites:

- start OPA (`./scripts/setup-opa.sh`) when `policy.mode = "opa"`
- set API key for your chosen live provider
  - OpenRouter default in these scripts: `OPENROUTER_API_KEY`
  - Google alternative: `GOOGLE_GENERATIVE_AI_API_KEY`

Run preflight:

```bash
npm run live:preflight
```

Run live scenarios:

```bash
npm run live:scenarios
```

Run both in sequence:

```bash
npm run live:all
```

Useful overrides:

- `SAF_LIVE_PROVIDER` (e.g. `openrouter`, `google`)
- `SAF_LIVE_MODEL` (example free model: `nvidia/nemotron-nano-9b-v2:free`)
- `SAF_LIVE_API_KEY_ENV` (e.g. `OPENROUTER_API_KEY`)
- `SAF_CONFIG_PATH` for alternate config path
- `SAF_ASSUME_SANDBOX_READY=1` to enforce normal expectations for allow-path scenarios when sandbox deps are installed
- `SAF_LIVE_NORMALIZER_MODE` (`deterministic`, `hybrid`, `llm`)
- `SAF_LIVE_NORMALIZER_PROVIDER` / `SAF_LIVE_NORMALIZER_MODEL`
- `SAF_LIVE_NORMALIZER_API_KEY_ENV` (defaults to `GOOGLE_GENERATIVE_AI_API_KEY`)
- `SAF_LIVE_NORMALIZER_TIMEOUT_MS` (override normalizer timeout for live checks)
- `--no-auto-start-opa` (on `live:preflight` or `live:scenarios`) to disable automatic local OPA startup
- `SAF_LIVE_NO_AUTO_START_OPA=1` to disable automatic local OPA startup via env

Notes:

- `REQUIRE_APPROVAL` is expected to block execution in `pi-agent-core` and include a human-approval-required reason.
- live scenario runs now use the real `pi-agent-core` agent loop (not direct `SAFPipeline.evaluate(...)`) with real tool execution in a disposable workspace.
- live scenario checks assert non-fallback OPA decisions, sandbox rewrite on allow-path bash execution, and audit log presence.
- preflight is strict: model check fails if the provider returns `stopReason=error|aborted`.

## Capability hardening

`configs/tool-capabilities.json` has been tightened:

- `bash`: only `filesystem.read` + `process.execute`
- `write_file`: only `filesystem.write`
- added explicit profiles for `python`, `python3`, `edit_file`, and `list_directory`

Review these capabilities against your real agent tool names before deployment.

## Run adversarial scenarios

```bash
npx tsx scripts/run-eval.ts
```

## Run comparative benchmark (plain vs simple vs SAF)

This repo now includes a reproducible benchmark harness that compares:

- plain Pi-style baseline (no safeguards),
- Pi with simple safeguards aligned to pi-mono lifecycle safety examples (`permission-gate`, `protected-paths`),
- Pi with SAF framework.

Run:

```bash
npm run benchmark:compare -- --saf-profile default-runtime
```

Useful flags:

- `--trials 10` (default is 3)
- `--modes plain,simple,saf`
- `--scenarios benchmarks/scenarios/comparison-scenarios.json`
- `--out-dir benchmarks/results`
- `--saf-config configs/saf-config.json`
- `--saf-profile default-runtime|deterministic-lab|policy-only`
- `--allow-degraded-deps` (optional; bypass dependency health gate for default-runtime)
- `--no-auto-start-opa` (optional; disable automatic local OPA startup for default-runtime preflight)

`--saf-profile` is required so benchmark reports always declare which SAF runtime shape was tested.

For `--saf-profile default-runtime`, the benchmark now runs dependency preflight and fails if OPA/model dependencies are degraded or fallback signals are observed, unless `--allow-degraded-deps` is provided.

Outputs:

- JSON report: `benchmarks/results/comparison-report-<timestamp>.json`
- TSV metrics table: `benchmarks/results/comparison-metrics-<timestamp>.tsv`

The report now contains two views:

- `metrics` (per-trial)
- `perScenarioMetrics` (scenario-level aggregation)

and two comparison tracks:

- `trackMetrics.coreComparable`: shared plain/simple/SAF comparison slice
- `trackMetrics.advancedSAF`: SAF-leaning scenarios such as drift or intent-heavy cases

and includes profile metadata:

- selected SAF benchmark profile
- effective SAF modes (policy/intent/normalizer/sandbox)

Primary metrics include:

- safe allow rate
- unsafe deny / approval / intervention rates
- false allow / false deny / false escalation rates
- comparable-only unsafe intervention + false allow rates
- evasion and drift intervention rates
- approval rate
- decision and total latency stats (mean/stddev/p50/p95)
- audit coverage (for SAF mode)

Notes on SAF profiles:

- `default-runtime`: uses the provided SAF config as-is (closest to real deployment)
- `deterministic-lab`: local policy + heuristic intent + deterministic normalizer + sandbox off (stable lab comparison)
- `policy-only`: local policy + no intent checks + deterministic normalizer + sandbox off

Important caveats:

- `deterministic-lab` is for controlled comparison, not deployment realism.
- `default-runtime` results can be dominated by external dependency health such as OPA or model availability.
- `coreComparable` is the fairest three-way slice; `advancedSAF` captures SAF-specific reasoning strengths and costs.

## Notes

- This implementation prioritizes correctness and composable structure.
- Sandbox-runtime execution wiring is scaffolded and can be connected next.
