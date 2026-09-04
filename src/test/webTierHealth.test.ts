// research_richness_execution_unblock_v1 — web tier health + academic cues.
import { beforeEach, describe, expect, it } from "vitest";
import {
  classifyWebFailure,
  getWebTierHealth,
  recordWebCall,
  resetWebTierHealth,
} from "../../supabase/functions/legal-research-v1/lib/webTierHealth.ts";
import { classifySourceDepth } from "../../supabase/functions/legal-research-v1/stages/sourceDepthPolicy.ts";

// deno-lint-ignore no-explicit-any
const analyzer = (claims = 1): any => ({
  claims: Array.from({ length: claims }, (_, i) => ({
    claim_id: `c${i}`,
    text_he: "טענה",
  })),
});

describe("classifyWebFailure", () => {
  it("classifies an exhausted quota", () => {
    expect(
      classifyWebFailure(401, '{"error":{"type":"insufficient_quota"}}'),
    ).toBe("quota_exhausted");
  });
  it("classifies a plain rejected credential", () => {
    expect(classifyWebFailure(401, "unauthorized")).toBe("invalid_credentials");
  });
  it("classifies rate limiting and server errors", () => {
    expect(classifyWebFailure(429, "")).toBe("rate_limited");
    expect(classifyWebFailure(503, "")).toBe("server_error");
  });
  it("classifies a network failure", () => {
    expect(classifyWebFailure(null, "connection reset")).toBe("network_error");
  });
  it("classifies success", () => {
    expect(classifyWebFailure(200, "")).toBe("ok");
  });
});

describe("web tier health aggregation", () => {
  beforeEach(() => resetWebTierHealth());

  it("marks the tier disabled when every call fails on quota", () => {
    for (let i = 0; i < 3; i++) {
      recordWebCall({ status: 401, ms: 10, body: "insufficient_quota" });
    }
    const h = getWebTierHealth();
    expect(h.calls_attempted).toBe(3);
    expect(h.calls_succeeded).toBe(0);
    expect(h.safe_error_class).toBe("quota_exhausted");
    expect(h.disabled_or_misconfigured).toBe(true);
    expect(h.safe_error_message).not.toMatch(/pplx|Bearer/i);
  });

  it("stays usable when at least one call succeeds", () => {
    recordWebCall({ status: 200, ms: 10 });
    recordWebCall({ status: 429, ms: 10 });
    const h = getWebTierHealth();
    expect(h.calls_succeeded).toBe(1);
    expect(h.disabled_or_misconfigured).toBe(false);
  });
});

describe("academic cue detection", () => {
  const mode = (q: string) => classifySourceDepth({ question: q, analyzer: analyzer() }).depth_mode;

  it("detects a theoretical-background chapter", () => {
    expect(mode("כתוב פרק רקע תיאורטי על מבחני המידתיות")).toBe("academic_research");
  });
  it("detects a seminar introduction chapter", () => {
    expect(mode("כתוב פרק מבוא לעבודה על הסתמכות והבטחה מנהלית")).toBe("academic_research");
  });
  it("detects a research proposal", () => {
    expect(mode("נסח הצעת מחקר בנושא עילת הסבירות")).toBe("academic_research");
  });
  it("leaves an ordinary doctrinal question alone", () => {
    expect(mode("מה הדין לגבי פיטורי עובדת בהיריון?")).not.toBe("academic_research");
  });
});
