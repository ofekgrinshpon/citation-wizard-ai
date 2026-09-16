import { describe, expect, it } from "vitest";

import {
  buildOccurrenceFootnotes,
  normalizeAnswerForDisplay,
  placeMarkerAfterPunctuation,
  toSuperscript,
} from "../../supabase/functions/_shared/footnoteOccurrences";
import { applyOccurrenceFootnotes } from "../../supabase/functions/legal-research-v1/stages/occurrenceFootnotes";
import { renderAnswer } from "../../supabase/functions/legal-research-v2/drafting/render";
import type { DraftBlock, VerifiedEvidencePack } from "../../supabase/functions/legal-research-v2/types";

const A_TITLE = 'ע"א 1000/92 בבלי נ\' כהן';
const B_TITLE = 'בג"ץ 5678/10 לוי נ\' שר הפנים';
const C_TITLE = "חוק הירושה, התשכ\"ה-1965";

function packOf(entries: Array<{ id: string; title: string; locator?: string; url?: string }>): VerifiedEvidencePack {
  return {
    claims: entries.map((e, i) => ({
      claim_id: `C${i + 1}`,
      proposition: `טענה ${i + 1}`,
      importance: "core" as const,
      support_status: "supported" as const,
      sources: [{
        source_id: e.id,
        display_title: e.title,
        url: e.url,
        verified_span: "ציטוט מאומת ארוך דיו",
        locator: e.locator,
        support: "supports" as const,
      }],
    })),
    unsupported_claims: [],
  };
}

function blocksOf(ids: string[]): DraftBlock[] {
  return ids.map((id, i) => ({
    type: "paragraph" as const,
    text: `טענה ${i + 1}.`,
    source_ids: [id],
  }));
}

describe("superscript conversion", () => {
  it("renders single and multi digit markers", () => {
    expect(toSuperscript(1)).toBe("¹");
    expect(toSuperscript(10)).toBe("¹⁰");
    expect(toSuperscript(12)).toBe("¹²");
    expect(toSuperscript(27)).toBe("²⁷");
  });
});

describe("marker placement — punctuation first", () => {
  it("keeps the punctuation before the marker", () => {
    expect(placeMarkerAfterPunctuation("הכלל חל במקרה זה.", "¹")).toBe("הכלל חל במקרה זה.¹");
    expect(placeMarkerAfterPunctuation("הכלל נקבע בפסיקה,", "²")).toBe("הכלל נקבע בפסיקה,²");
    expect(placeMarkerAfterPunctuation("הטענה נדחתה;", "³")).toBe("הטענה נדחתה;³");
    expect(placeMarkerAfterPunctuation("האם זה נכון?", "⁴")).toBe("האם זה נכון?⁴");
  });

  it("adds a period when the segment has none", () => {
    expect(placeMarkerAfterPunctuation("הטענה נתמכת במקור", "¹")).toBe("הטענה נתמכת במקור.¹");
  });

  it("supports a multi digit marker after punctuation", () => {
    expect(placeMarkerAfterPunctuation("טענה.", toSuperscript(12))).toBe("טענה.¹²");
  });
});

describe("rule 37 occurrence sequence A,A,B,A,B,B,B,C,A", () => {
  const ids = ["S1", "S1", "S2", "S1", "S2", "S2", "S2", "S3", "S1"];
  const pack = packOf([
    { id: "S1", title: A_TITLE },
    { id: "S2", title: B_TITLE },
    { id: "S3", title: C_TITLE },
  ]);
  const out = renderAnswer(blocksOf(ids), pack);

  it("numbers every occurrence chronologically", () => {
    expect(out.footnotes.map((f) => f.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(out.footnotes).toHaveLength(ids.length);
    expect(out.invariant_errors).toEqual([]);
  });

  it("applies full / שם / לעיל ה\"ש exactly", () => {
    const texts = out.footnotes.map((f) => f.citation);
    expect(texts[0]).toContain("בבלי");
    expect(texts[1]).toBe("שם.");
    expect(texts[2]).toContain("לוי");
    expect(texts[3]).toBe('עניין כהן, לעיל ה"ש 1.');
    expect(texts[4]).toBe('עניין שר הפנים, לעיל ה"ש 3.');
    expect(texts[5]).toBe("שם.");
    expect(texts[6]).toBe("שם.");
    expect(texts[7]).toContain("חוק הירושה");
    expect(texts[8]).toBe('עניין כהן, לעיל ה"ש 1.');
  });

  it("emits superscript markers in textual order, after punctuation", () => {
    const markers = out.answer_markdown.match(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/gu);
    expect(markers).toEqual(["¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"]);
    expect(out.answer_markdown).toContain("טענה 1.¹");
    expect(out.answer_markdown).not.toMatch(/טענה 1¹\./);
  });

  it("never appends footnote definitions to the body", () => {
    expect(out.answer_markdown).not.toContain("[^");
  });
});

describe("rule 37 variants", () => {
  it("three consecutive uses of one source → full, שם, שם", () => {
    const out = renderAnswer(blocksOf(["S1", "S1", "S1"]), packOf([{ id: "S1", title: A_TITLE }]));
    expect(out.footnotes.map((f) => f.repeat_kind)).toEqual(["full", "ibid", "ibid"]);
    expect(out.footnotes[1].citation).toBe("שם.");
  });

  it("A → B → A uses לעיל ה\"ש for the third occurrence", () => {
    const pack = packOf([{ id: "S1", title: A_TITLE }, { id: "S2", title: B_TITLE }]);
    const out = renderAnswer(blocksOf(["S1", "S2", "S1"]), pack);
    expect(out.footnotes[2].citation).toBe('עניין כהן, לעיל ה"ש 1.');
  });

  it("carries a changed locator into שם / לעיל ה\"ש", () => {
    const built = buildOccurrenceFootnotes([
      { source_id: "A", full_citation: `${A_TITLE}, בעמ' 100`, locator: "עמ' 100" },
      { source_id: "A", full_citation: `${A_TITLE}, בעמ' 100`, locator: "עמ' 105" },
      { source_id: "B", full_citation: B_TITLE },
      { source_id: "A", full_citation: `${A_TITLE}, בעמ' 100`, locator: "עמ' 110" },
    ]);
    expect(built[1].citation).toBe("שם, בעמ' 105.");
    expect(built[3].citation).toBe('עניין כהן, לעיל ה"ש 1, בעמ\' 110.');
  });

  it("legislation repeats follow rule 37.5 rather than case-law לעיל ה\"ש", () => {
    const built = buildOccurrenceFootnotes([
      { source_id: "L", full_citation: C_TITLE, locator: "סעיף 20" },
      { source_id: "X", full_citation: B_TITLE },
      { source_id: "L", full_citation: C_TITLE, locator: "סעיף 25" },
    ]);
    expect(built[2].repeat_kind).toBe("supra");
    expect(built[2].citation).toBe("ס' 25 לחוק הירושה.");
    expect(built[2].citation).not.toContain('לעיל ה"ש');
  });

  it("numbers beyond nine render as multi digit superscripts", () => {
    const ids = Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? "S1" : "S2"));
    const pack = packOf([{ id: "S1", title: A_TITLE }, { id: "S2", title: B_TITLE }]);
    const out = renderAnswer(blocksOf(ids), pack);
    expect(out.footnotes).toHaveLength(12);
    expect(out.answer_markdown).toContain("¹²");
  });

  it("does not add or remove a source relationship", () => {
    const pack = packOf([{ id: "S1", title: A_TITLE }, { id: "S2", title: B_TITLE }]);
    const out = renderAnswer(blocksOf(["S1", "S2", "S1"]), pack);
    expect(out.footnotes.map((f) => f.source_id)).toEqual(["S1", "S2", "S1"]);
    expect(out.cited_source_ids).toEqual(["S1", "S2"]);
  });
});

describe("legacy answer compatibility (display / copy)", () => {
  const legacy = [
    "פסקה ראשונה[^1]",
    "",
    "פסקה שנייה[^2]",
    "",
    "[^1]: מקור א",
    "[^2]: מקור ב",
  ].join("\n");

  it("strips the trailing definition block and superscripts the markers", () => {
    const out = normalizeAnswerForDisplay(legacy);
    expect(out).toBe("פסקה ראשונה¹\n\nפסקה שנייה²");
    expect(out).not.toContain("[^");
  });

  it("leaves a modern answer untouched", () => {
    const modern = "טענה.¹ טענה נוספת.²";
    expect(normalizeAnswerForDisplay(modern)).toBe(modern);
  });
});

describe("V1 attachment path parity", () => {
  it("expands repeated markers into occurrence footnotes with rule 37 text", () => {
    const answer = "טענה א.¹ טענה ב.¹ טענה ג.² טענה ד.¹";
    const footnotes = [
      { number: 1, title: A_TITLE, url: "https://x/1", source_type: "case" },
      { number: 2, title: B_TITLE, url: "https://x/2", source_type: "case" },
    ];
    const used = [
      { number: 1, candidate_id: "a" },
      { number: 2, candidate_id: "b" },
    ];
    const out = applyOccurrenceFootnotes(answer, footnotes, used);
    expect(out.answer_markdown).toBe("טענה א.¹ טענה ב.² טענה ג.³ טענה ד.⁴");
    expect(out.footnotes.map((f) => f.number)).toEqual([1, 2, 3, 4]);
    expect(out.footnotes[1].title).toBe("שם.");
    expect(out.footnotes[2].title).toBe(B_TITLE);
    expect(out.footnotes[3].title).toBe('עניין כהן, לעיל ה"ש 1.');
    expect(out.used_sources.map((u) => u.number)).toEqual([1, 3]);
  });
});
