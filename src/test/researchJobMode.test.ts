import { describe, it, expect, beforeEach } from "vitest";
import {
  recordResearchJobMode,
  getRecordedResearchJobMode,
  jobModeFromResult,
  resolveResearchJobMode,
} from "@/lib/researchJobMode";

describe("researchJobMode", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("derives sources mode from a source-pack result", () => {
    expect(jobModeFromResult({ output_mode: "sources", source_pack: {} })).toBe("sources");
  });

  it("derives answer mode from an answer result", () => {
    expect(jobModeFromResult({ answer: "תשובה", footnotes: [] })).toBe("answer");
  });

  it("returns null when the mode is not knowable from the result", () => {
    expect(jobModeFromResult(null)).toBeNull();
    expect(jobModeFromResult({})).toBeNull();
  });

  it("falls back to the recorded submit-time mode for running jobs", () => {
    recordResearchJobMode("job-1", "sources");
    expect(getRecordedResearchJobMode("job-1")).toBe("sources");
    expect(resolveResearchJobMode("job-1", null)).toBe("sources");
  });

  it("prefers the result-derived mode over the recorded hint", () => {
    recordResearchJobMode("job-2", "sources");
    expect(resolveResearchJobMode("job-2", { answer: "x" })).toBe("answer");
  });
});
