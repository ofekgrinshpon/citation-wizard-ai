import { describe, expect, it } from "vitest";
import { validateCitationInput } from "@/lib/citationInputValidation";

describe("validateCitationInput — short English case names", () => {
  it("accepts 'GEMA v. Suno Inc.' (17 chars) as a case name", () => {
    expect(validateCitationInput("GEMA v. Suno Inc.").valid).toBe(true);
  });

  it("accepts 'Roe v Wade' without a period", () => {
    expect(validateCitationInput("Roe v Wade").valid).toBe(true);
  });

  it("accepts 'vs.' as the separator", () => {
    expect(validateCitationInput("Smith vs. Jones").valid).toBe(true);
  });

  it("still rejects short Latin text with no case separator", () => {
    expect(validateCitationInput("hello world").reason).toBe("latin_garbage");
  });

  it("still rejects stray single letters around 'v'", () => {
    expect(validateCitationInput("x v y").valid).toBe(false);
  });

  it("keeps the Israeli separator working", () => {
    expect(validateCitationInput("כהן נ' לוי").valid).toBe(true);
  });
});
