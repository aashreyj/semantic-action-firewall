import { loadPolicyConfig } from "./loader.js";
import { LocalPolicyEngine } from "./engine.js";
import { OPAPolicyEngine } from "./opa-engine.js";
import type { PolicyConfig, PolicyRuntimeConfig } from "../types.js";
import type { PolicyEvaluator } from "./contracts.js";

export async function createPolicyEngine(
  policyPath: string,
  policyRuntime: PolicyRuntimeConfig,
  preloadedPolicyConfig?: PolicyConfig,
): Promise<PolicyEvaluator> {
  const config = preloadedPolicyConfig ?? (await loadPolicyConfig(policyPath));
  const local = new LocalPolicyEngine(config);

  if (policyRuntime.mode === "local") {
    return local;
  }

  return new OPAPolicyEngine(
    policyRuntime.opaUrl,
    policyRuntime.timeoutMs,
    policyRuntime.fallback,
    config,
    local,
  );
}
