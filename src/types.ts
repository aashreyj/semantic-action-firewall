import { Type, type Static } from "@sinclair/typebox";

export const ActionCategorySchema = Type.Union([
  Type.Literal("filesystem"),
  Type.Literal("network"),
  Type.Literal("process"),
  Type.Literal("unknown"),
]);

export const ActionOperationSchema = Type.Union([
  Type.Literal("read"),
  Type.Literal("write"),
  Type.Literal("delete"),
  Type.Literal("execute"),
  Type.Literal("connect"),
  Type.Literal("unknown"),
]);

export const PolicyVerdictSchema = Type.Union([
  Type.Literal("ALLOW"),
  Type.Literal("DENY"),
  Type.Literal("FLAG_FOR_INTENT_CHECK"),
  Type.Literal("REQUIRE_APPROVAL"),
]);

export const IntentVerdictSchema = Type.Union([
  Type.Literal("VALIDATED"),
  Type.Literal("REJECTED"),
  Type.Literal("REQUIRE_APPROVAL"),
]);

export const FinalVerdictSchema = Type.Union([
  Type.Literal("ALLOWED"),
  Type.Literal("DENIED"),
  Type.Literal("REQUIRE_APPROVAL"),
]);

export type ActionCategory = Static<typeof ActionCategorySchema>;
export type ActionOperation = Static<typeof ActionOperationSchema>;
export type PolicyVerdict = Static<typeof PolicyVerdictSchema>;
export type IntentVerdictType = Static<typeof IntentVerdictSchema>;
export type FinalVerdict = Static<typeof FinalVerdictSchema>;

export interface ActionMetadata {
  recursive?: boolean;
  force?: boolean;
  envVars?: string[];
  pipedCommands?: string[];
  redirectedTo?: string;
  flags?: Record<string, unknown>;
}

export interface NormalizedAction {
  category: ActionCategory;
  operation: ActionOperation;
  target: string;
  metadata: ActionMetadata;
  parser: "shell" | "python" | "typescript" | "tool" | "llm" | "fallback";
}

export interface DetectionResult {
  isSuspicious: boolean;
  flags: string[];
  entropyScore: number;
  details: string;
}

export interface PolicyDecision {
  verdict: PolicyVerdict;
  matchedRule: string;
  reason: string;
}

export interface IntentGoal {
  primaryIntent: string;
  allowRead: boolean;
  allowWrite: boolean;
  allowDelete: boolean;
  allowExecute: boolean;
  allowNetwork: boolean;
  targetHints: string[];
  sensitiveDataAllowed: boolean;
  externalTransferAllowed: boolean;
  approvalMentioned: boolean;
}

export interface IntentVerdict {
  verdict: IntentVerdictType;
  reason: string;
  confidence: number;
}

export interface IntentSessionSnapshot {
  recentActions: NormalizedAction[];
}

export interface IntentEvaluationContext {
  sessionId?: string;
  snapshot?: IntentSessionSnapshot;
}

export interface GuardDecision {
  allowed: boolean;
  reason: string;
  requiredCapability: string;
}

export interface ActionRecord {
  timestamp: number;
  sessionId: string;
  agentId: string;
  toolName: string;
  rawCall: string;
  normalized: NormalizedAction;
  rewrittenCall?: string;
  policyDecision: PolicyDecision;
  intentVerdict?: IntentVerdict;
  finalVerdict: FinalVerdict;
  reason: string;
  latencyMs: number;
}

export interface SAFEvaluationContext {
  workspacePath?: string;
  sessionId?: string;
  agentId?: string;
  agentMode?: "autonomous" | "interactive";
  actionCountThisSession?: number;
}

export interface SAFEvaluationInput {
  toolName: string;
  rawArgs: Record<string, unknown>;
  userGoal?: string;
  context?: SAFEvaluationContext;
}

export interface SAFEvaluationResult {
  verdict: FinalVerdict;
  reason: string;
  normalizedAction?: NormalizedAction;
  rewrittenArgs?: Record<string, unknown>;
  policyDecision?: PolicyDecision;
  intentVerdict?: IntentVerdict;
  detectionResult?: DetectionResult;
  latencyMs: number;
}

export type PolicyMode = "allow" | "deny" | "flag_intent" | "require_approval";

export interface PolicyConfig {
  defaultBehavior: "allow" | "deny";
  scopes: Partial<Record<ActionCategory, Partial<Record<ActionOperation, PolicyMode>>>>;
  allowedDomains: string[];
  protectedPaths: string[];
}

export interface ToolCapabilityProfile {
  capabilities: string[];
  workspaceOnly?: boolean;
  allowedDomains?: string[];
}

export interface ToolCapabilityConfig {
  tools: Record<string, ToolCapabilityProfile>;
}

export interface DetectorConfig {
  base64: boolean;
  hexEscapes: boolean;
  evalNesting: boolean;
  pipeToShell: boolean;
  knownSignatures: boolean;
  longEncodedSegment: boolean;
  maxHexEscapes: number;
  maxEvalNesting: number;
  entropyThreshold: number;
  minLengthForEntropy: number;
}

export interface PolicyRuntimeConfig {
  mode: "local" | "opa";
  opaUrl: string;
  timeoutMs: number;
  fallback: "local" | "deny" | "require_approval";
}

export interface OAuthIntentConfig {
  providerId: string;
  authFile: string;
}

export interface IntentEngineConfig {
  mode: "heuristic" | "pi-ai";
  provider?: string;
  model?: string;
  apiKeyEnvVar?: string;
  timeoutMs?: number;
  doubleCheck: boolean;
  oauth?: OAuthIntentConfig;
}

export interface NormalizerConfig {
  mode: "deterministic" | "hybrid" | "llm";
  provider?: string;
  model?: string;
  apiKeyEnvVar?: string;
  timeoutMs: number;
  maxPayloadChars: number;
  cacheEnabled: boolean;
  cacheMaxEntries: number;
}

export interface SandboxConfig {
  enabled: boolean;
  failOpen: boolean;
  timeoutMs: number;
}

export interface SAFConfig {
  workspacePath: string;
  detector: DetectorConfig;
  policy: PolicyRuntimeConfig;
  policyFile: string;
  capabilityFile: string;
  auditLogPath: string;
  intentCheckEnabled: boolean;
  intent: IntentEngineConfig;
  normalizer: NormalizerConfig;
  sandbox: SandboxConfig;
  defaultSessionId: string;
  defaultAgentId: string;
}
