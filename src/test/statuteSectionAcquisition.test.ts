import { describe, expect, it } from "vitest";
import {
  locateSection,
  normalizeSectionToken,
  sectionCoverage,
  sectionMissingInstruction,
} from "../../supabase/functions/legal-research-v2/evidence/sectionLocator";
import {
  AcquisitionLedger,
  NO_YIELD_EXHAUSTION_THRESHOLD,
} from "../../supabase/functions/legal-research-v2/tools/acquisitionLedger";
import { buildDrafterInput } from "../../supabase/functions/legal-research-v2/drafting/draft";

const STATUTE = [
  "חוק החוזים (חלק כללי), התשל\"ג-1973",
  "1. חוזה נכרת בדרך של הצעה וקיבול.",
  "12. במשא ומתן לקראת כריתתו של חוזה חייב אדם לנהוג בדרך מקובלת ובתום לב.",
  "14. מי שהתקשר בחוזה עקב טעות רשאי לבטל את החוזה.",
  "25. (א) חוזה יפורש לפי אומד דעתם של הצדדים, כפי שהוא משתמע מתוך החוזה ומנסיבות העניין.",
  "26. פרטים שלא נקבעו בחוזה יהיו לפי הנוהג.",
].join("\n");

describe("targeted statute section retrieval", () => {
  it("normalizes section tokens", () => {
    expect(normalizeSectionToken("סעיף 25(א)")).toBe("25(א)");
    expect(normalizeSectionToken("25.")).toBe("25");
    expect(normalizeSectionToken("")).toBeNull();
  });

  it("finds a section far beyond the first text window", () => {
    const res = locateSection(STATUTE, "סעיף 25");
    expect(res.found).toBe(true);
    expect(res.windows.join("")).toContain("אומד דעתם");
  });

  it("prefers a window containing the requested subsection", () => {
    const res = locateSection(STATUTE, "25(א)");
    expect(res.found).toBe(true);
    expect(res.windows[0]).toContain("(א)");
  });

  it("reports coverage and a pivot instruction when the section is absent", () => {
    const truncated = STATUTE.split("\n").slice(0, 4).join("\n");
    const res = locateSection(truncated, "25");
    expect(res.found).toBe(false);
    expect(res.coverage.last).toBe("14");
    const msg = sectionMissingInstruction(res, "S2");
    expect(msg).toContain("S2");
    expect(msg).toContain("14");
  });

  it("reads coverage bounds from a body", () => {
    expect(sectionCoverage(STATUTE).first).toBe("1");
    expect(sectionCoverage(STATUTE).last).toBe("26");
  });
});

describe("same-source no-yield exhaustion", () => {
  it("marks a source exhausted after repeated no-yield reads", () => {
    const l = new AcquisitionLedger();
    for (let i = 0; i < NO_YIELD_EXHAUSTION_THRESHOLD - 1; i++) {
      expect(l.noteRead("S2", { yielded: false, locator: `q${i}` }).exhausted).toBe(false);
    }
    expect(l.noteRead("S2", { yielded: false, locator: "qN" }).exhausted).toBe(true);
    expect(l.knownMissingLocator("S2", "q0")).toBe(true);
  });

  it("a yielding read resets exhaustion and does not block new locators", () => {
    const l = new AcquisitionLedger();
    l.noteRead("S3", { yielded: false, locator: "25" });
    l.noteRead("S3", { yielded: true });
    expect(l.readState("S3")?.exhausted).toBe(false);
    expect(l.readState("S3")?.no_yield).toBe(0);
    expect(l.knownMissingLocator("S3", "31")).toBe(false);
  });

  it("survives serialization", () => {
    const l = new AcquisitionLedger();
    l.noteRead("S4", { yielded: false, locator: "25" });
    const back = AcquisitionLedger.fromJSON(JSON.parse(JSON.stringify(l.toJSON())));
    expect(back.knownMissingLocator("S4", "25")).toBe(true);
  });
});

describe("refusal never recites unsupported propositions", () => {
  it("omits rejected proposition text from the drafter input", () => {
    const secret = "חוזה עסקי יפורש לפי לשונו בלבד";
    const input = buildDrafterInput(
      "מה אומר תיקון מס' 3 לחוק החוזים?",
      {
        claims: [],
        unsupported_claims: [
          { claim_id: "C1", proposition: secret, importance: "core" },
        ] as never,
      } as never,
      [],
      ["לא הושג נוסח קריא עבור: statute:חוק החוזים#25."],
    );
    expect(input).not.toContain(secret);
    expect(input).toContain("לא הושג נוסח קריא");
    expect(input).toContain("1 נושאים");
  });
});
