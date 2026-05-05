import { readFile } from "node:fs/promises";
import { z } from "zod";

import type { PolicyConfig } from "../types.js";

const scopeOpsSchema = z
  .object({
    read: z.enum(["allow", "deny", "flag_intent", "require_approval"]).optional(),
    write: z.enum(["allow", "deny", "flag_intent", "require_approval"]).optional(),
    delete: z.enum(["allow", "deny", "flag_intent", "require_approval"]).optional(),
    execute: z.enum(["allow", "deny", "flag_intent", "require_approval"]).optional(),
    connect: z.enum(["allow", "deny", "flag_intent", "require_approval"]).optional(),
    unknown: z.enum(["allow", "deny", "flag_intent", "require_approval"]).optional(),
  })
  .partial();

const policySchema = z.object({
  defaultBehavior: z.enum(["allow", "deny"]),
  scopes: z
    .object({
      filesystem: scopeOpsSchema.optional(),
      network: scopeOpsSchema.optional(),
      process: scopeOpsSchema.optional(),
      unknown: scopeOpsSchema.optional(),
    })
    .partial(),
  allowedDomains: z.array(z.string()).default([]),
  protectedPaths: z.array(z.string()).default([]),
});

export async function loadPolicyConfig(policyPath: string): Promise<PolicyConfig> {
  const content = await readFile(policyPath, "utf8");
  return policySchema.parse(JSON.parse(content));
}
