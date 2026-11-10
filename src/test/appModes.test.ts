import { describe, expect, it } from "vitest";
import { effectiveAppMode, isLegalAssistantLink, visibleAppModes, DEFAULT_APP_MODE } from "@/lib/appModes";

describe("legal assistant is admin-only", () => {
  it("regular users see only the three citation tabs", () => {
    expect(visibleAppModes(false)).toEqual(["freetext", "batch", "bibliography"]);
  });

  it("admins also see the legal assistant tab", () => {
    expect(visibleAppModes(true)).toContain("legalqa");
  });

  it("a regular user asking for the legal assistant gets the uniform citation tab", () => {
    expect(effectiveAppMode("legalqa", false)).toBe("freetext");
  });

  it("an admin keeps the legal assistant", () => {
    expect(effectiveAppMode("legalqa", true)).toBe("legalqa");
  });

  it("everyone starts on the uniform citation tab", () => {
    expect(DEFAULT_APP_MODE).toBe("freetext");
  });

  it("recognises legal assistant deep links", () => {
    expect(isLegalAssistantLink("conv-1", "")).toBe(true);
    expect(isLegalAssistantLink(undefined, "?mode=legalqa")).toBe(true);
    expect(isLegalAssistantLink(undefined, "?job=abc")).toBe(true);
    expect(isLegalAssistantLink(undefined, "?addin=1")).toBe(false);
  });
});
