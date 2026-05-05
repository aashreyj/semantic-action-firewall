import type { DetectionResult, DetectorConfig } from "../types.js";
import { defaultDetectorConfig } from "./rules.js";
import { scanPayload } from "./heuristics.js";

export class AnomalyDetector {
  private readonly config: DetectorConfig;

  public constructor(config?: Partial<DetectorConfig>) {
    this.config = { ...defaultDetectorConfig, ...config };
  }

  public scan(payload: string): DetectionResult {
    return scanPayload(payload, this.config);
  }
}
