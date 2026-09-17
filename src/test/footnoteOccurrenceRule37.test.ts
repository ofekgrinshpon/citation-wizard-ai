import { describe, expect, it } from "vitest";

import {
  buildCompoundFootnotes,
  buildOccurrenceFootnotes,
  extractShortSourceLabel,
  normalizeAnswerForDisplay,
  placeMarkerAfterPunctuation,
  toSuperscript,
} from "../../supabase/functions/_shared/footnoteOccurrences";
import {
  applyOccurrenceFootnotes,
  type V1FootnoteRow,
} from "../../supabase/functions/legal-research-v1/stages/occurrenceFootnotes";
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

describe("compound citation points (one marker, one footnote, many sources)", () => {
  const pack3 = packOf([
    { id: "S1", title: A_TITLE },
    { id: "S2", title: B_TITLE },
    { id: "S3", title: C_TITLE },
  ]);
  const compoundBlocks = (groups: string[][]): DraftBlock[] =>
    groups.map((ids, i) => ({
      type: "paragraph" as const,
      text: `טענה ${i + 1}.`,
      source_ids: ids,
    }));

  it("A: one sentence with two sources → one marker, one compound footnote", () => {
    const out = renderAnswer(compoundBlocks([["S1", "S2"]]), pack3);
    const markers = out.answer_markdown.match(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/gu);
    expect(markers).toEqual(["¹"]);
    expect(out.footnotes).toHaveLength(1);
    expect(out.footnotes[0].source_ids).toEqual(["S1", "S2"]);
    expect(out.footnotes[0].sources?.map((s) => s.source_id)).toEqual(["S1", "S2"]);
    expect(out.footnotes[0].citation).toContain("בבלי");
    expect(out.footnotes[0].citation).toContain("לוי");
    expect(out.footnotes[0].citation).toContain(";");
    expect(out.invariant_errors).toEqual([]);
  });

  it("B: A → B → A+B uses explicit לעיל ה\"ש per source", () => {
    const out = renderAnswer(compoundBlocks([["S1"], ["S2"], ["S1", "S2"]]), pack3);
    expect(out.footnotes).toHaveLength(3);
    expect(out.footnotes[2].citation).toBe(
      'עניין כהן, לעיל ה"ש 1; עניין שר הפנים, לעיל ה"ש 2.',
    );
  });

  it("C: a compound repeated immediately is never a bare שם", () => {
    const out = renderAnswer(compoundBlocks([["S1", "S2"], ["S1", "S2"]]), pack3);
    expect(out.footnotes.map((f) => f.index)).toEqual([1, 2]);
    expect(out.footnotes[1].citation).not.toContain("שם");
    expect(out.footnotes[1].citation).toBe(
      'עניין כהן, לעיל ה"ש 1; עניין שר הפנים, לעיל ה"ש 1.',
    );
  });

  it("D: a single-source adjacent repeat still uses שם", () => {
    const out = renderAnswer(compoundBlocks([["S1"], ["S1"]]), pack3);
    expect(out.footnotes[1].citation).toBe("שם.");
  });

  it("E: compound followed by one of its sources is לעיל ה\"ש, not שם", () => {
    const out = renderAnswer(compoundBlocks([["S1", "S2"], ["S1"]]), pack3);
    expect(out.footnotes[1].citation).toBe('עניין כהן, לעיל ה"ש 1.');
  });

  it("F: single source followed by a compound repeats A and states B in full", () => {
    const out = renderAnswer(compoundBlocks([["S1"], ["S1", "S2"]]), pack3);
    const entries = out.footnotes[1].sources!;
    expect(entries[0].citation).toBe('עניין כהן, לעיל ה"ש 1.');
    expect(entries[1].repeat_kind).toBe("full");
    expect(entries[1].citation).toContain("לוי");
  });

  it("the nine-occurrence compound sequence follows the spec", () => {
    const out = renderAnswer(
      compoundBlocks([["S1"], ["S2"], ["S1", "S2"], ["S1", "S2"], ["S2"]]),
      pack3,
    );
    expect(out.footnotes.map((f) => f.citation)).toEqual([
      out.footnotes[0].citation,
      out.footnotes[1].citation,
      'עניין כהן, לעיל ה"ש 1; עניין שר הפנים, לעיל ה"ש 2.',
      'עניין כהן, לעיל ה"ש 1; עניין שר הפנים, לעיל ה"ש 2.',
      'עניין שר הפנים, לעיל ה"ש 2.',
    ]);
    expect(out.footnotes[0].citation).toContain("בבלי");
    expect(out.footnotes[1].citation).toContain("לוי");
  });

  it("G: keeps a per-source locator inside a compound footnote", () => {
    const built = buildCompoundFootnotes([
      [{ source_id: "A", full_citation: A_TITLE, locator: "עמ' 100" }],
      [{ source_id: "B", full_citation: B_TITLE }],
      [
        { source_id: "A", full_citation: A_TITLE, locator: "עמ' 110" },
        { source_id: "B", full_citation: B_TITLE, locator: "פסקה 5" },
      ],
    ]);
    expect(built[2].citation).toBe(
      'עניין כהן, לעיל ה"ש 1, בעמ\' 110; עניין שר הפנים, לעיל ה"ש 2, בפס\' 5.',
    );
  });

  it("H: legislation and a judgment each keep their own repeat rule", () => {
    const built = buildCompoundFootnotes([
      [{ source_id: "L", full_citation: C_TITLE, locator: "סעיף 20" }],
      [{ source_id: "J", full_citation: A_TITLE }],
      [
        { source_id: "J", full_citation: A_TITLE },
        { source_id: "L", full_citation: C_TITLE, locator: "סעיף 25" },
      ],
    ]);
    const entries = built[2].sources;
    expect(entries[0].citation).toBe('עניין כהן, לעיל ה"ש 2.');
    expect(entries[1].citation).toBe("ס' 25 לחוק הירושה.");
    expect(entries[1].citation).not.toContain('לעיל ה"ש');
  });

  it("I/J: markers are one per citation point, multi-digit numbers still valid", () => {
    const groups = Array.from({ length: 23 }, (_, i) => (i % 2 === 0 ? ["S1"] : ["S2"]));
    groups[22] = ["S1", "S2", "S3"];
    const out = renderAnswer(compoundBlocks(groups), pack3);
    const markers = out.answer_markdown.match(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/gu)!;
    // Exactly one marker per citation point, and the last one is footnote 23.
    expect(markers).toHaveLength(23);
    expect(markers[22]).toBe("²³");
    expect(out.footnotes).toHaveLength(23);
    expect(out.footnotes[22].source_ids).toEqual(["S1", "S2", "S3"]);
    expect(out.invariant_errors).toEqual([]);
  });

  it("never adds or removes an approved source relationship", () => {
    const out = renderAnswer(compoundBlocks([["S1", "S2"], ["S3"]]), pack3);
    expect(out.footnotes.map((f) => f.source_ids)).toEqual([["S1", "S2"], ["S3"]]);
  });
});

describe("V1 attachment path — compound marker runs", () => {
  it("collapses a marker run into one number with a compound footnote row", () => {
    const answer = "טענה א.¹ טענה ב.¹² טענה ג.²";
    const footnotes: V1FootnoteRow[] = [
      { number: 1, title: A_TITLE, url: "https://x/1" },
      { number: 2, title: B_TITLE, url: "https://x/2" },
    ];
    const used = [{ number: 1 }, { number: 2 }];
    const out = applyOccurrenceFootnotes(answer, footnotes, used);
    expect(out.answer_markdown).toBe("טענה א.¹ טענה ב.² טענה ג.³");
    expect(out.footnotes.map((f) => f.number)).toEqual([1, 2, 3]);
    expect(out.footnotes[1].sources).toHaveLength(2);
    expect(out.footnotes[1].title).not.toContain("שם");
    expect(out.footnotes[2].title).toBe('עניין שר הפנים, לעיל ה"ש 2.');
  });
});

describe("user-document repeat labels", () => {
  it("does not mistake 'צו' inside שצורף for legislation", () => {
    expect(extractShortSourceLabel("lease שצורף, מקטע 1")).toBe("lease שצורף");
    expect(extractShortSourceLabel("הסכם שכירות שצורף, עמ' 4")).toBe("הסכם שכירות שצורף");
  });

  it("still detects real legislation lead words", () => {
    expect(extractShortSourceLabel('חוק החוזים (תרופות), ס\' 15')).toBe("חוק החוזים (תרופות)");
    expect(extractShortSourceLabel("צו הפיקוח על מצרכים, ס' 3")).toBe("צו הפיקוח על מצרכים");
    expect(extractShortSourceLabel("פקודת הנזיקין, ס' 35")).toBe("פקודת הנזיקין");
  });

  it("keeps separate supra labels for two uploaded documents", () => {
    const fn = buildCompoundFootnotes([
      [{ source_id: "S1", full_citation: "lease שצורף, מקטע 1" }],
      [{ source_id: "S2", full_citation: "letter שצורף, מקטע 1" }],
      [
        { source_id: "S1", full_citation: "lease שצורף, מקטע 1" },
        { source_id: "S2", full_citation: "letter שצורף, מקטע 1" },
      ],
    ]);
    expect(fn[2].sources[0].citation).toBe('lease שצורף, לעיל ה"ש 1.');
    expect(fn[2].sources[1].citation).toBe('letter שצורף, לעיל ה"ש 2.');
  });
});
