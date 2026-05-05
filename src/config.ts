import path from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";

import type { SAFConfig } from "./types.js";

const detectorSchema = z.object({
  base64: z.boolean().default(true),
  hexEscapes: z.boolean().default(true),
  evalNesting: z.boolean().default(true),
  pipeToShell: z.boolean().default(true),
  knownSignatures: z.boolean().default(true),
  longEncodedSegment: z.boolean().default(true),
  maxHexEscapes: z.number().int().positive().default(5),
  maxEvalNesting: z.number().int().positive().default(1),
  entropyThreshold: z.number().positive().default(4.5),
  minLengthForEntropy: z.number().int().positive().default(48),
});

const schema = z.object({
  workspacePath: z.string(),
  detector: detectorSchema,
  policy: z
    .object({
      mode: z.enum(["local", "opa"]).default("local"),
      opaUrl: z.string().url().default("http://localhost:8181/v1/data/saf/decision"),
      timeoutMs: z.number().int().positive().default(100),
      fallback: z.enum(["local", "deny", "require_approval"]).default("local"),
    })
    .default({
      mode: "local",
      opaUrl: "http://localhost:8181/v1/data/saf/decision",
      timeoutMs: 100,
      fallback: "local",
    }),
  policyFile: z.string(),
  capabilityFile: z.string(),
  auditLogPath: z.string(),
  intentCheckEnabled: z.boolean().default(true),
  intent: z
    .object({
      mode: z.enum(["heuristic", "pi-ai"]).default("heuristic"),
      provider: z.string().optional(),
      model: z.string().optional(),
      apiKeyEnvVar: z.string().optional(),
      timeoutMs: z.number().int().positive().default(15000),
      doubleCheck: z.boolean().default(true),
      oauth: z
        .object({
          providerId: z.string(),
          authFile: z.string(),
        })
        .optional(),
    })
    .default({
      mode: "heuristic",
      timeoutMs: 15000,
      doubleCheck: true,
    }),
  normalizer: z
    .object({
      mode: z.enum(["deterministic", "hybrid", "llm"]).default("hybrid"),
      provider: z.string().optional(),
      model: z.string().optional(),
      apiKeyEnvVar: z.string().optional(),
      timeoutMs: z.number().int().positive().default(15000),
      maxPayloadChars: z.number().int().positive().default(8000),
      cacheEnabled: z.boolean().default(true),
      cacheMaxEntries: z.number().int().positive().default(500),
    })
    .default({
      mode: "hybrid",
      provider: "google",
      model: "gemma-4-26b-a4b-it",
      apiKeyEnvVar: "GOOGLE_GENERATIVE_AI_API_KEY",
      timeoutMs: 15000,
      maxPayloadChars: 8000,
      cacheEnabled: true,
      cacheMaxEntries: 500,
    }),
  sandbox: z
    .object({
      enabled: z.boolean().default(false),
      failOpen: z.boolean().default(true),
      timeoutMs: z.number().int().positive().default(30_000),
    })
    .default({
      enabled: false,
      failOpen: true,
      timeoutMs: 30_000,
    }),
  defaultSessionId: z.string().default("session-default"),
  defaultAgentId: z.string().default("agent-default"),
});

function resolveMaybeRelative(basePath: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(basePath, value);
}

export async function loadConfig(configPath: string): Promise<SAFConfig> {
  const raw = await readFile(configPath, "utf8");
  const parsed = schema.parse(JSON.parse(raw));
  const baseDir = path.dirname(configPath);

  return {
    ...parsed,
    workspacePath: resolveMaybeRelative(baseDir, parsed.workspacePath),
    policy: {
      ...parsed.policy,
    },
    policyFile: resolveMaybeRelative(baseDir, parsed.policyFile),
    capabilityFile: resolveMaybeRelative(baseDir, parsed.capabilityFile),
    auditLogPath: resolveMaybeRelative(baseDir, parsed.auditLogPath),
    intent: {
      ...parsed.intent,
      oauth: parsed.intent.oauth
        ? {
            ...parsed.intent.oauth,
            authFile: resolveMaybeRelative(baseDir, parsed.intent.oauth.authFile),
          }
        : undefined,
    },
    normalizer: {
      ...parsed.normalizer,
    },
    sandbox: {
      ...parsed.sandbox,
    },
  };
}
