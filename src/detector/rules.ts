import type { DetectorConfig } from "../types.js";

export const defaultDetectorConfig: DetectorConfig = {
  base64: true,
  hexEscapes: true,
  evalNesting: true,
  pipeToShell: true,
  knownSignatures: true,
  longEncodedSegment: true,
  maxHexEscapes: 5,
  maxEvalNesting: 1,
  entropyThreshold: 4.5,
  minLengthForEntropy: 48,
};
