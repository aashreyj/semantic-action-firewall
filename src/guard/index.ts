import { loadCapabilityConfig } from "./capabilities.js";
import { CapabilityEnforcer } from "./enforcer.js";
import { ToolCapabilityRegistry } from "./registry.js";

export async function createCapabilityEnforcer(capabilityFile: string): Promise<CapabilityEnforcer> {
  const config = await loadCapabilityConfig(capabilityFile);
  const registry = new ToolCapabilityRegistry(config);
  return new CapabilityEnforcer(registry);
}
