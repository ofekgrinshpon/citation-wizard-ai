import { describe, it, expect } from "vitest";
import { shouldRunUnanchoredFollowup, strictSnippetEvidence } from "../../supabase/functions/_shared/caseLawQuery.ts";
import { parseDocketNumber, docketPatternSource } from "../../supabase/functions/_shared/trustedHosts.ts";

const idx = (num: string) => {
  const d = parseDocketNumber(num)!;
  const re = new RegExp(docketPatternSource(d), "g");
  return (t: string) => [...t.matchAll(re)].map((m) => m.index ?? 0);
};

// Shape returned live on Oct 16 for the party follow-up of ע"א 11487/03.
const SIVAN = { url: "https://www.sivan-law.com/x", title: "סימני מסחר",
  snippet: 'כפי שמסביר בית-המשפט ב-ע"א 11487/03 August Storck KG נ\' אלפא אינטואיט מוצרי מזון בע"מ (לא פורסם, [פורסם בנבו], 23.3.2008)' };

describe("unanchored party follow-up", () => {
  it("runs only with two candidate parties", () => {
    expect(shouldRunUnanchoredFollowup(null)).toBe(false);
    expect(shouldRunUnanchoredFollowup({ party1: "", party2: "אלפא" })).toBe(false);
    expect(shouldRunUnanchoredFollowup({ party1: "August Storck KG", party2: "אלפא אינטואיט" })).toBe(true);
  });
  it("accepts a follow-up result with exact docket and both parties", () => {
    expect(strictSnippetEvidence([SIVAN], idx("11487/03"), "August Storck KG", 'אלפא אינטואיט מוצרי מזון בע"מ')).toBe(SIVAN.url);
  });
  it("rejects when the model's candidate parties are wrong", () => {
    expect(strictSnippetEvidence([SIVAN], idx("11487/03"), "שטראוס", "אוסם")).toBeNull();
  });
  it("rejects the same parties next to a different docket", () => {
    const other = { ...SIVAN, snippet: SIVAN.snippet.replace("11487/03", "11487/04") };
    expect(strictSnippetEvidence([other], idx("11487/03"), "August Storck KG", "אלפא אינטואיט")).toBeNull();
  });
});
