import { AnomalyDetector } from "./detector/index.js";
import { CapabilityEnforcer } from "./guard/enforcer.js";
import { ToolCapabilityRegistry } from "./guard/registry.js";
import { loadCapabilityConfig } from "./guard/capabilities.js";
import { IntentEngine } from "./intent/index.js";
import { AuditLogger } from "./logging/audit.js";
import { ActionNormalizer } from "./normalizer/index.js";
import { createPolicyEngine } from "./policy/index.js";
import { loadPolicyConfig } from "./policy/loader.js";
import type { PolicyEvaluator } from "./policy/contracts.js";
import { SandboxCommandRewriter } from "./sandbox/sandbox-rewriter.js";
import { SandboxViolationMonitor } from "./sandbox/violation-monitor.js";
import type { SAFConfig, SAFEvaluationInput, SAFEvaluationResult } from "./types.js";
import type { PolicyConfig } from "./types.js";

export class SAFPipeline {
  private readonly detector: AnomalyDetector;

  private readonly normalizer: ActionNormalizer;

  private readonly intentEngine: IntentEngine;

  private readonly policyEngine: PolicyEvaluator;

  private readonly capabilityEnforcer: CapabilityEnforcer;

  private readonly auditLogger: AuditLogger;

  private readonly sandboxRewriter: SandboxCommandRewriter;

  private readonly sandboxViolations: SandboxViolationMonitor;

  private constructor(
    private readonly config: SAFConfig,
    deps: {
      policyEngine: PolicyEvaluator;
      capabilityEnforcer: CapabilityEnforcer;
      policyConfig: PolicyConfig;
    },
  ) {
    this.detector = new AnomalyDetector(config.detector);
    this.normalizer = new ActionNormalizer(config.normalizer);
    this.intentEngine = new IntentEngine(config.intent);
    this.policyEngine = deps.policyEngine;
    this.capabilityEnforcer = deps.capabilityEnforcer;
    this.auditLogger = new AuditLogger(config.auditLogPath);
    this.sandboxRewriter = new SandboxCommandRewriter(config, deps.policyConfig);
    this.sandboxViolations = new SandboxViolationMonitor();
  }

  public static async create(config: SAFConfig): Promise<SAFPipeline> {
    const policyConfig = await loadPolicyConfig(config.policyFile);
    const policyEngine = await createPolicyEngine(config.policyFile, config.policy, policyConfig);

    const capabilityConfig = await loadCapabilityConfig(config.capabilityFile);
    const capabilityEnforcer = new CapabilityEnforcer(new ToolCapabilityRegistry(capabilityConfig));

    return new SAFPipeline(config, {
      policyEngine,
      capabilityEnforcer,
      policyConfig,
    });
  }

  public async evaluate(input: SAFEvaluationInput): Promise<SAFEvaluationResult> {
    const start = performance.now();
    const workspacePath = input.context?.workspacePath ?? this.config.workspacePath;
    const sessionId = input.context?.sessionId ?? this.config.defaultSessionId;
    const agentId = input.context?.agentId ?? this.config.defaultAgentId;
    const rawCall = JSON.stringify(input.rawArgs);

    const detection = this.detector.scan(rawCall);
    if (detection.isSuspicious) {
      const latencyMs = Math.round(performance.now() - start);
      const reason = `Anomaly detector blocked payload: ${detection.flags.join(", ")}`;
      await this.auditLogger.log({
        timestamp: Date.now(),
        sessionId,
        agentId,
        toolName: input.toolName,
        rawCall,
        normalized: {
          category: "unknown",
          operation: "unknown",
          target: "unknown",
          parser: "fallback",
          metadata: {
            flags: {
              detectionFlags: detection.flags,
            },
          },
        },
        policyDecision: {
          verdict: "DENY",
          matchedRule: "anomaly.detector",
          reason,
        },
        finalVerdict: "DENIED",
        reason,
        latencyMs,
      });

      return {
        verdict: "DENIED",
        reason,
        detectionResult: detection,
        latencyMs,
      };
    }

    const normalized = await this.normalizer.normalize({
      toolName: input.toolName,
      rawArgs: input.rawArgs,
    });

    const policyDecision = await this.policyEngine.evaluate(normalized, {
      workspacePath,
      toolName: input.toolName,
      sessionId,
      agentMode: input.context?.agentMode,
      actionCountThisSession: input.context?.actionCountThisSession,
    });
    if (policyDecision.verdict === "DENY") {
      const latencyMs = Math.round(performance.now() - start);
      await this.auditLogger.log({
        timestamp: Date.now(),
        sessionId,
        agentId,
        toolName: input.toolName,
        rawCall,
        normalized,
        policyDecision,
        finalVerdict: "DENIED",
        reason: policyDecision.reason,
        latencyMs,
      });

      return {
        verdict: "DENIED",
        reason: policyDecision.reason,
        normalizedAction: normalized,
        policyDecision,
        latencyMs,
      };
    }

    let intentVerdict;
    if (policyDecision.verdict === "FLAG_FOR_INTENT_CHECK" && this.config.intentCheckEnabled) {
      intentVerdict = await this.intentEngine.evaluate(normalized, input.userGoal, {
        sessionId,
      });
      if (intentVerdict.verdict === "REJECTED") {
        const latencyMs = Math.round(performance.now() - start);
        await this.auditLogger.log({
          timestamp: Date.now(),
          sessionId,
          agentId,
          toolName: input.toolName,
          rawCall,
          normalized,
          policyDecision,
          intentVerdict,
          finalVerdict: "DENIED",
          reason: intentVerdict.reason,
          latencyMs,
        });

        return {
          verdict: "DENIED",
          reason: intentVerdict.reason,
          normalizedAction: normalized,
          policyDecision,
          intentVerdict,
          latencyMs,
        };
      }

      if (intentVerdict.verdict === "REQUIRE_APPROVAL") {
        const latencyMs = Math.round(performance.now() - start);
        await this.auditLogger.log({
          timestamp: Date.now(),
          sessionId,
          agentId,
          toolName: input.toolName,
          rawCall,
          normalized,
          policyDecision,
          intentVerdict,
          finalVerdict: "REQUIRE_APPROVAL",
          reason: intentVerdict.reason,
          latencyMs,
        });

        return {
          verdict: "REQUIRE_APPROVAL",
          reason: intentVerdict.reason,
          normalizedAction: normalized,
          policyDecision,
          intentVerdict,
          latencyMs,
        };
      }
    }

    if (policyDecision.verdict === "REQUIRE_APPROVAL") {
      const latencyMs = Math.round(performance.now() - start);
      await this.auditLogger.log({
        timestamp: Date.now(),
        sessionId,
        agentId,
        toolName: input.toolName,
        rawCall,
        normalized,
        policyDecision,
        intentVerdict,
        finalVerdict: "REQUIRE_APPROVAL",
        reason: policyDecision.reason,
        latencyMs,
      });

      return {
        verdict: "REQUIRE_APPROVAL",
        reason: policyDecision.reason,
        normalizedAction: normalized,
        policyDecision,
        intentVerdict,
        latencyMs,
      };
    }

    const guard = this.capabilityEnforcer.check(input.toolName, normalized, { workspacePath });
    if (!guard.allowed) {
      const latencyMs = Math.round(performance.now() - start);
      await this.auditLogger.log({
        timestamp: Date.now(),
        sessionId,
        agentId,
        toolName: input.toolName,
        rawCall,
        normalized,
        policyDecision,
        intentVerdict,
        finalVerdict: "DENIED",
        reason: guard.reason,
        latencyMs,
      });

      return {
        verdict: "DENIED",
        reason: guard.reason,
        normalizedAction: normalized,
        policyDecision,
        intentVerdict,
        latencyMs,
      };
    }

    let rewrittenArgs: Record<string, unknown> | undefined;
    let rewrittenCall: string | undefined;

    try {
      rewrittenArgs = await this.sandboxRewriter.rewrite(
        input.toolName,
        input.rawArgs,
        normalized,
        workspacePath,
      );

      if (rewrittenArgs !== input.rawArgs) {
        rewrittenCall = JSON.stringify(rewrittenArgs);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Sandbox rewrite failed";
      const latencyMs = Math.round(performance.now() - start);

      await this.auditLogger.log({
        timestamp: Date.now(),
        sessionId,
        agentId,
        toolName: input.toolName,
        rawCall,
        normalized,
        policyDecision,
        intentVerdict,
        finalVerdict: "DENIED",
        reason,
        latencyMs,
      });

      return {
        verdict: "DENIED",
        reason,
        normalizedAction: normalized,
        policyDecision,
        intentVerdict,
        latencyMs,
      };
    }

    const latencyMs = Math.round(performance.now() - start);
    this.sandboxViolations.pullFromRuntime();
    await this.auditLogger.log({
      timestamp: Date.now(),
      sessionId,
      agentId,
      toolName: input.toolName,
      rawCall,
      normalized,
      rewrittenCall,
      policyDecision,
      intentVerdict,
      finalVerdict: "ALLOWED",
      reason: "All SAF checks passed",
      latencyMs,
    });

    return {
      verdict: "ALLOWED",
      reason: "All SAF checks passed",
      normalizedAction: normalized,
      rewrittenArgs,
      policyDecision,
      intentVerdict,
      latencyMs,
    };
  }

  public async shutdown(): Promise<void> {
    await this.sandboxRewriter.reset();
  }
}
