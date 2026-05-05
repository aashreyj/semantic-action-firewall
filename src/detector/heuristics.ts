import { calculateEntropy } from "./entropy.js";
import type { DetectionResult, DetectorConfig } from "../types.js";

const base64Regex = /\b(?:base64|atob|Buffer\.from\s*\([^)]*base64[^)]*\))\b/i;
const longBase64Chunk = /[A-Za-z0-9+/]{80,}={0,2}/;
const hexEscapeRegex = /\\x[0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4}/g;
const evalRegex = /\b(?:eval|exec|Function|new\s+Function)\s*\(/g;
const pipeToShellRegex = /\|\s*(?:sh|bash|zsh|ksh|python)\b/i;
const knownSignatureRegexes = [
  /\brm\s+-rf\s+\//i,
  /\bnc\s+-e\s+\/bin\/sh\b/i,
  /\bcurl\b[^\n|]*\|\s*(?:sh|bash)\b/i,
];

function countMatches(input: string, regex: RegExp): number {
  const matches = input.match(regex);
  return matches ? matches.length : 0;
}

export function detectBase64(payload: string): boolean {
  return base64Regex.test(payload) || longBase64Chunk.test(payload);
}

export function detectEvalNesting(payload: string): number {
  return countMatches(payload, evalRegex);
}

export function detectHexEscapes(payload: string): number {
  return countMatches(payload, hexEscapeRegex);
}

export function detectPipeToShell(payload: string): boolean {
  return pipeToShellRegex.test(payload);
}

export function detectKnownSignatures(payload: string): boolean {
  return knownSignatureRegexes.some((regex) => regex.test(payload));
}

export function scanPayload(payload: string, config: DetectorConfig): DetectionResult {
  const flags: string[] = [];

  if (config.base64 && detectBase64(payload)) {
    flags.push("base64-pattern");
  }

  const hexEscapeCount = detectHexEscapes(payload);
  if (config.hexEscapes && hexEscapeCount > config.maxHexEscapes) {
    flags.push("many-hex-escapes");
  }

  const evalDepth = detectEvalNesting(payload);
  if (config.evalNesting && evalDepth > config.maxEvalNesting) {
    flags.push("nested-eval-exec");
  }

  if (config.pipeToShell && detectPipeToShell(payload)) {
    flags.push("pipe-to-shell");
  }

  if (config.knownSignatures && detectKnownSignatures(payload)) {
    flags.push("known-signature");
  }

  const entropy = calculateEntropy(payload);
  if (
    config.longEncodedSegment &&
    payload.length >= config.minLengthForEntropy &&
    entropy > config.entropyThreshold
  ) {
    flags.push("high-entropy");
  }

  return {
    isSuspicious: flags.length > 0,
    flags,
    entropyScore: Number(entropy.toFixed(4)),
    details: flags.length > 0 ? `Triggered: ${flags.join(", ")}` : "No anomaly detected",
  };
}
