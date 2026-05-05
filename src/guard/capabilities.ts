import { readFile } from "node:fs/promises";
import { z } from "zod";

import type { ToolCapabilityConfig } from "../types.js";

const profileSchema = z.object({
  capabilities: z.array(z.string()),
  workspaceOnly: z.boolean().optional(),
  allowedDomains: z.array(z.string()).optional(),
});

const schema = z.object({
  tools: z.record(profileSchema),
});

export async function loadCapabilityConfig(filePath: string): Promise<ToolCapabilityConfig> {
  const content = await readFile(filePath, "utf8");
  return schema.parse(JSON.parse(content));
}
