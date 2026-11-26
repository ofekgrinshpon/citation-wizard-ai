import { describe, expect, it } from "vitest";
import { activePassSummary, sidebarCitationPassLabel } from "@/lib/citationPassHeader";
import type { CitationPassStatus } from "@/lib/citationPassClient";

const now = Date.parse("2026-11-25T12:00:00Z");
const pass = (o: Partial<CitationPassStatus>): CitationPassStatus => ({ id: "p", offerId: "citation_week_pass_v1", status: "active", activatedAt: "2026-11-24T00:00:00Z", expiresAt: "2026-12-01T00:00:00Z", usedRatio: 0, ...o });

describe("header remaining count for purchased passes", () => {
  it("shows the exact remaining sources of an active weekly pass", () => {
    expect(activePassSummary([pass({ usedRatio: 0.03 })], now)).toEqual({ remaining: 97 });
  });
  it("recovers exact counts for the 250-source monthly pass", () => {
    expect(activePassSummary([pass({ offerId: "citation_month_pass_v1", usedRatio: 0.004 })], now)).toEqual({ remaining: 249 });
  });
  it("pools remaining free/referral sources into the pass count", () => {
    expect(activePassSummary([pass({ usedRatio: 0.02 })], now, 10)).toEqual({ remaining: 108 });
    expect(activePassSummary([pass({ status: "exhausted", usedRatio: 1 })], now, 10)).toEqual({ remaining: 10 });
  });
  it("shows 0 for an exhausted pass with no free sources left", () => {
    expect(activePassSummary([pass({ status: "exhausted", usedRatio: 1 })], now)).toEqual({ remaining: 0 });
  });
  it("adds up several unexpired passes", () => {
    expect(activePassSummary([pass({ id: "a", usedRatio: 0.5 }), pass({ id: "b", offerId: "citation_month_pass_v1", usedRatio: 0 })], now)).toEqual({ remaining: 300 });
  });
  it("returns nothing for pending, expired or past-expiry passes, keeping the free-trial view", () => {
    expect(activePassSummary([pass({ status: "pending", expiresAt: null }), pass({ status: "expired" }), pass({ expiresAt: "2026-11-25T11:00:00Z" })], now)).toBeNull();
    expect(activePassSummary([], now)).toBeNull();
  });
});

describe("sidebar paid package label", () => {
  it("names weekly and monthly passes, ignoring pending orders", () => {
    expect(sidebarCitationPassLabel([pass({}), pass({ status: "pending", expiresAt: null })], now)).toBe("חבילה שבועית פעילה");
    expect(sidebarCitationPassLabel([pass({ offerId: "citation_month_pass_v1" })], now)).toBe("חבילה חודשית פעילה");
  });
  it("describes exhausted quota until the exact expiry without calling it free", () => {
    const exhausted = pass({ status: "exhausted", usedRatio: 1 });
    expect(sidebarCitationPassLabel([exhausted], now)).toBe("חבילה שבועית · המכסה נוצלה");
    expect(sidebarCitationPassLabel([exhausted], Date.parse(exhausted.expiresAt!))).toBeNull();
  });
  it("shows both overlapping active packages but not a past expiry", () => {
    const month = pass({ offerId: "citation_month_pass_v1", expiresAt: "2026-12-24T00:00:00Z" });
    expect(sidebarCitationPassLabel([pass({}), month], now)).toBe("2 חבילות אזכורים פעילות");
    expect(sidebarCitationPassLabel([pass({}), month], Date.parse("2026-12-01T00:00:00Z"))).toBe("חבילה חודשית פעילה");
  });
});
