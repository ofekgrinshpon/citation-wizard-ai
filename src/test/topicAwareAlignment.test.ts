import { describe, expect, it } from "vitest";
import {
  applySourceRoleSanity,
  applyTopicAwareBlockAlignment,
  assessLimitationNoteAlignment,
  classifySource,
  judgmentLegalAreaFit,
} from "../../supabase/functions/legal-research-v1/stages/topicAwareAlignment.ts";

// deno-lint-ignore no-explicit-any
const src = (o: Record<string, unknown>): any => ({
  ref: "s1",
  candidate_id: "c1",
  title: "",
  raw_title: "",
  title_status: "ok",
  title_hygiene_reasons: [],
  url: null,
  source_type: "other",
  role: "unknown",
  origin: "local_db",
  best_support: "direct",
  supported_points: [],
  claim_ids: [],
  snippet: null,
  ...o,
});

describe("source role sanity", () => {
  it("never labels a judgment as scholarship", () => {
    const s = src({ ref: "s1", citable_as: "judgment", source_type: "caselaw", role: "scholarship", title: 'בג"ץ 5658/23' });
    const rep = applySourceRoleSanity([s]);
    expect(s.role).toBe("binding_case_law");
    expect(rep.rows[0].changed).toBe(true);
  });

  it("never labels scholarship as primary_statute", () => {
    const s = src({ citable_as: "scholarship", source_type: "journal_article", role: "primary_statute" });
    applySourceRoleSanity([s]);
    expect(s.role).toBe("scholarship");
  });

  it("keeps a compatible statute role", () => {
    const s = src({ citable_as: "statute", source_type: "israeli_law", role: "primary_statute" });
    const rep = applySourceRoleSanity([s]);
    expect(rep.changed).toBe(0);
  });

  it("classifies faculty pdfs as academic", () => {
    expect(classifySource(src({ source_type: "faculty_pdf" }))).toBe("academic");
  });
});

describe("judgment legal-area fit", () => {
  const prison = src({
    ref: "s9",
    citable_as: "judgment",
    source_type: "caselaw",
    title: 'בג"ץ 4634/04 תנאי מאסר של אסירים',
    snippet: "תנאי מאסר, צפיפות בבית סוהר וכליאה",
  });

  it("blocks a prison-conditions judgment for a reliance claim", () => {
    const fit = judgmentLegalAreaFit(
      "הבטחה מנהלית והסתמכות",
      "ההסתמכות של הפרט על הבטחה מנהלית מקימה ציפייה לגיטימית",
      prison,
      "c1",
      true,
    );
    expect(fit.direct_doctrine_match).toBe(false);
    expect(fit.blocked).toBe(true);
  });

  it("allows a proportionality judgment for a proportionality claim", () => {
    const prop = src({
      citable_as: "judgment",
      source_type: "caselaw",
      title: "פסק דין בעניין מידתיות",
      snippet: "פסקת ההגבלה ומבחני המידתיות, תכלית ראויה ופגיעה בזכות",
    });
    const fit = judgmentLegalAreaFit(
      "מידתיות בביקורת חוקתית",
      "מבחני המידתיות ופסקת ההגבלה",
      prop,
      "c1",
      true,
    );
    expect(fit.direct_doctrine_match).toBe(true);
    expect(fit.blocked).toBe(false);
  });
});

describe("block alignment", () => {
  const draft = {
    blocks: [
      {
        kind: "paragraph" as const,
        text: "ההסתמכות על הבטחה מנהלית מקימה ציפייה לגיטימית של הפרט",
        source_refs: ["s9", "s2"],
        proposition_type: "black_letter_rule" as const,
      },
    ],
  };
  const sources = [
    src({
      ref: "s9",
      citable_as: "judgment",
      source_type: "caselaw",
      title: 'בג"ץ 4634/04 תנאי מאסר',
      snippet: "תנאי מאסר וכליאה בבית סוהר",
    }),
    src({
      ref: "s2",
      citable_as: "scholarship",
      source_type: "journal_article",
      title: "הבטחה מנהלית והסתמכות במשפט המנהלי",
      snippet: "ציפייה לגיטימית, הסתמכות ושינוי מדיניות",
      body_acquired: true,
    }),
  ];

  it("drops the off-doctrine judgment and keeps the on-point scholarship", () => {
    const out = applyTopicAwareBlockAlignment(draft, sources, "הבטחה מנהלית והסתמכות", {
      academicMode: true,
    });
    const refs = (out.draft!.blocks[0] as { source_refs: string[] }).source_refs;
    expect(refs).not.toContain("s9");
    expect(refs).toContain("s2");
    expect(out.report.applied).toBe(true);
  });

  it("does not add sources that are not already in the draft", () => {
    const out = applyTopicAwareBlockAlignment(draft, sources, "הבטחה מנהלית", {
      academicMode: true,
    });
    const refs = (out.draft!.blocks[0] as { source_refs: string[] }).source_refs;
    for (const r of refs) expect(["s9", "s2"]).toContain(r);
  });

  it("splits compound footnotes of weak companions", () => {
    const compound = {
      blocks: [{
        kind: "paragraph" as const,
        text: "מידתיות בביקורת חוקתית ופסקת ההגבלה",
        source_refs: ["a1", "a2", "a3"],
      }],
    };
    const pack = [
      src({ ref: "a1", citable_as: "scholarship", source_type: "journal_article", title: "מידתיות ופסקת ההגבלה בביקורת חוקתית", snippet: "מבחני מידתיות, פסקת ההגבלה, ביקורת חוקתית", body_acquired: true }),
      src({ ref: "a2", citable_as: "scholarship", source_type: "journal_article", title: "דיני מכרזים", snippet: "מכרז ציבורי" }),
      src({ ref: "a3", citable_as: "scholarship", source_type: "journal_article", title: "דיני עבודה", snippet: "פיטורים" }),
    ];
    const out = applyTopicAwareBlockAlignment(compound, pack, "מידתיות בביקורת חוקתית", {
      academicMode: true,
    });
    const refs = (out.draft!.blocks[0] as { source_refs: string[] }).source_refs;
    expect(refs).toEqual(["a1"]);
    expect(out.report.compound_footnote_guard[0].removed_sources.sort()).toEqual(["a2", "a3"]);
  });
});

describe("limitation note alignment", () => {
  it("adds a specific note when judgments are adjacent only", () => {
    const report = {
      ...applyTopicAwareBlockAlignment(null, [], "q", { academicMode: true }).report,
      judgment_legal_area_fit: [{
        source_id: "s9",
        title: "t",
        claim_id: "c1",
        claim_topic_terms: [],
        judgment_topic_terms: [],
        direct_doctrine_match: false,
        adjacent_area_only: true,
        allowed_use: "example_only" as const,
        blocked: true,
        reason: "adjacent_legal_area_only",
      }],
    };
    const out = assessLimitationNoteAlignment(
      "a",
      [src({ citable_as: "judgment", source_type: "caselaw" })],
      report,
      "",
    );
    expect(out.revised).toBe(true);
    expect(out.limitation_note).toContain("לא אותר פסק דין");
  });
});
