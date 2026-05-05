import { describe, expect, it } from "vitest";

import { AnomalyDetector } from "../src/detector/index.js";

describe("AnomalyDetector", () => {
  it("flags base64 payloads", () => {
    const detector = new AnomalyDetector();
    const result = detector.scan("echo 'cm0gLXJmIC8=' | base64 -d | sh");
    expect(result.isSuspicious).toBe(true);
    expect(result.flags).toContain("base64-pattern");
  });

  it("does not flag simple read command", () => {
    const detector = new AnomalyDetector();
    const result = detector.scan("cat src/index.ts");
    expect(result.isSuspicious).toBe(false);
  });

  it("flags known attack signatures", () => {
    const detector = new AnomalyDetector();
    const result = detector.scan("python -c \"import os; os.system('rm -rf /')\"");

    expect(result.isSuspicious).toBe(true);
    expect(result.flags).toContain("known-signature");
  });
});
