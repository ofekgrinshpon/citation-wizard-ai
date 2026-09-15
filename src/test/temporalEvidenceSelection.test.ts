import { describe, expect, it } from "vitest";
import {
  buildClaimTemporalEvidence,
  extractSectionTokens,
  prefixExcerpt,
  renderClaimEvidence,
  TEMPORAL_EVIDENCE_LIMITS,
} from "../../supabase/functions/legal-research-v2/verification/temporalEvidence.ts";
import {
  isCurrentLawCapable,
  isTemporallySensitive,
} from "../../supabase/functions/legal-research-v2/verification/temporalValidity.ts";
import type {
  EvidenceSource,
  VerifiedClaim,
} from "../../supabase/functions/legal-research-v2/types.ts";
import type { EvidenceStore } from "../../supabase/functions/legal-research-v2/evidence/evidenceStore.ts";

function src(over: Partial<EvidenceSource> = {}): EvidenceSource {
  const text = over.extracted_text ?? "חוק כלשהו";
  return {
    source_id: "S1",
    title: "חוק רישוי עסקים, התשכ\"ח-1968",
    url: "https://main.knesset.gov.il/Activity/Legislation/Laws/licensing.aspx",
    sha256: "x",
    fetch_status: "ok",
    text_length: text.length,
    identity_fields: { dockets: [], statutes: ["חוק רישוי עסקים"], sections: [] },
    is_actual_document: true,
    origin: "web",
    fetched_at: new Date().toISOString(),
    ...over,
    extracted_text: text,
  };
}

function storeOf(sources: EvidenceSource[]): EvidenceStore {
  return {
    get: (id: string) => sources.find((s) => s.source_id === id) ?? null,
    all: () => sources,
    readable: () => sources.filter((s) => s.fetch_status === "ok" && s.is_actual_document),
  } as unknown as EvidenceStore;
}

const SECTION_7G =
  "7ג. בעל עסק טעון רישוי יציג את הרישיון במקום בולט בבית העסק, ולא יעסיק אדם בלא היתר.";

/** A statute body where §7ג sits well past the old 2,500-char prefix window. */
function longStatuteBody(): string {
  const filler = Array.from(
    { length: 900 },
    (_, i) => `${i % 90}. הוראה כללית בדבר רישוי עסקים וסדרי מינהל בעניין זה, פסקה ${i}.`,
  ).join("\n");
  return `חוק רישוי עסקים, התשכ"ח-1968\nנוסח משולב\n${filler}\n${SECTION_7G}\n${filler}`;
}

function claim(over: Partial<VerifiedClaim> = {}): VerifiedClaim {
  return {
    claim_id: "C1",
    proposition: "כיום סעיף 7ג לחוק רישוי עסקים מחייב הצגת רישיון במקום בולט",
    importance: "core",
    support_status: "supported",
    sources: [{
      source_id: "S1",
      display_title: "חוק רישוי עסקים",
      verified_span: SECTION_7G,
      support: "supports",
    }],
    ...over,
  };
}

describe("temporal evidence — section tokens", () => {
  it("extracts section tokens named by a claim", () => {
    expect(extractSectionTokens("סעיף 7ג לחוק רישוי עסקים")).toEqual(["7ג"]);
    expect(extractSectionTokens("סעיף 13(א) וגם סעיף 25")).toEqual(["13(א)", "25"]);
    expect(extractSectionTokens("הלכת השיתוף חלה")).toEqual([]);
  });
});

describe("temporal evidence — Q29 shape", () => {
  const body = longStatuteBody();
  const source = src({ extracted_text: body });
  const store = storeOf([source]);

  it("statute body is genuinely longer than the old prefix window", () => {
    expect(body.indexOf(SECTION_7G)).toBeGreaterThan(50_000);
    expect(body.slice(0, 2_500).includes("7ג.")).toBe(false);
  });

  it("gives the temporal checker the located section text, not the prefix", () => {
    const ev = buildClaimTemporalEvidence(claim(), store);
    const section = ev.excerpts.find((e) => e.kind === "statute_section");
    expect(section).toBeTruthy();
    expect(section!.section).toBe("7ג");
    expect(section!.text).toContain("יציג את הרישיון");
    expect(ev.fallback_prefix).toBe(false);
    expect(ev.source_ids).toEqual(["S1"]);
  });

  it("includes the exact verified span supporting the claim", () => {
    const ev = buildClaimTemporalEvidence(claim(), store);
    const span = ev.excerpts.find((e) => e.kind === "verified_span");
    expect(span).toBeTruthy();
    expect(span!.text).toContain("יציג את הרישיון במקום בולט");
  });

  it("never dumps the full body into the model", () => {
    const ev = buildClaimTemporalEvidence(claim(), store);
    for (const e of ev.excerpts) {
      expect(e.text.length).toBeLessThanOrEqual(TEMPORAL_EVIDENCE_LIMITS.MAX_CHARS_PER_EXCERPT);
    }
    expect(renderClaimEvidence(ev).length).toBeLessThan(body.length / 3);
    expect(ev.excerpts.length).toBeLessThanOrEqual(
      TEMPORAL_EVIDENCE_LIMITS.MAX_EXCERPTS_PER_CLAIM,
    );
  });
});

describe("temporal evidence — strictness preserved", () => {
  it("a genuinely absent section yields no section excerpt (stays unresolvable)", () => {
    const store = storeOf([src({ extracted_text: longStatuteBody() })]);
    const c = claim({
      claim_id: "C9",
      proposition: "כיום סעיף 412 לחוק רישוי עסקים קובע חובת דיווח",
    });
    const ev = buildClaimTemporalEvidence(c, store);
    expect(ev.excerpts.some((e) => e.kind === "statute_section")).toBe(false);
  });

  it("a non-capable supporting source contributes nothing", () => {
    const blog = src({
      source_id: "S2",
      url: "https://some-blog.example.com/p",
      title: "סקירה",
      extracted_text: `סקירה משפטית\n${SECTION_7G}`,
    });
    expect(isCurrentLawCapable(blog)).toBe(false);
    const c = claim({ sources: [{ ...claim().sources[0], source_id: "S2" }] });
    const ev = buildClaimTemporalEvidence(c, storeOf([blog]));
    expect(ev.excerpts).toHaveLength(0);
  });

  it("contradicting official text still reaches the checker verbatim", () => {
    const repealed = src({
      source_id: "S3",
      extracted_text:
        `חוק רישוי עסקים\nתיקון מס' 34\nסעיף 7ג - בוטל.\nההוראה בדבר הצגת רישיון בוטלה בתיקון זה.`,
    });
    const c = claim({
      sources: [{
        source_id: "S3",
        display_title: "תיקון",
        verified_span: "ההוראה בדבר הצגת רישיון בוטלה בתיקון זה",
        support: "supports",
      }],
    });
    const ev = buildClaimTemporalEvidence(c, storeOf([repealed]));
    expect(renderClaimEvidence(ev)).toContain("בוטל");
  });
});

describe("temporal evidence — no cross-claim contamination", () => {
  const licensing = src({ source_id: "S1", extracted_text: longStatuteBody() });
  const penal = src({
    source_id: "S4",
    title: "חוק העונשין, התשל\"ז-1977",
    url: "https://main.knesset.gov.il/Activity/Legislation/Laws/penal.aspx",
    extracted_text: "חוק העונשין\n428א. סחיטת דמי חסות - מאסר שש שנים.",
    identity_fields: { dockets: [], statutes: ["חוק העונשין"], sections: [] },
  });
  const store = storeOf([licensing, penal]);

  it("each claim gets only its own supporting evidence", () => {
    const a = buildClaimTemporalEvidence(claim(), store);
    const b = buildClaimTemporalEvidence(
      claim({
        claim_id: "C2",
        proposition: "כיום סעיף 428א לחוק העונשין קובע עונש של שש שנות מאסר",
        sources: [{
          source_id: "S4",
          display_title: "חוק העונשין",
          verified_span: "סחיטת דמי חסות - מאסר שש שנים",
          support: "supports",
        }],
      }),
      store,
    );
    expect(a.source_ids).toEqual(["S1"]);
    expect(b.source_ids).toEqual(["S4"]);
    expect(renderClaimEvidence(a)).not.toContain("סחיטת דמי חסות");
    expect(renderClaimEvidence(b)).not.toContain("יציג את הרישיון");
  });

  it("an unrelated official source cannot be attached to a claim it did not support", () => {
    const ev = buildClaimTemporalEvidence(claim(), store);
    expect(ev.source_ids).not.toContain("S4");
  });
});

describe("temporal evidence — unchanged behaviours", () => {
  it("historical, non-sensitive claims are still not temporally sensitive", () => {
    expect(
      isTemporallySensitive({
        proposition: "בשנת 2008 קבע בית המשפט כי הלכת השיתוף חלה",
      }),
    ).toBe(false);
  });

  it("bounded prefix fallback keeps the previous behaviour when nothing is claim-specific", () => {
    const source = src({ extracted_text: longStatuteBody() });
    const p = prefixExcerpt(source);
    expect(p.kind).toBe("source_prefix");
    expect(p.text.length).toBeLessThanOrEqual(TEMPORAL_EVIDENCE_LIMITS.PREFIX_CHARS);
    expect(p.text).toBe(source.extracted_text.slice(0, TEMPORAL_EVIDENCE_LIMITS.PREFIX_CHARS));
  });

  it("a claim with no supporting sources produces an empty packet", () => {
    const ev = buildClaimTemporalEvidence(claim({ sources: [] }), storeOf([src()]));
    expect(ev.excerpts).toHaveLength(0);
    expect(ev.source_ids).toHaveLength(0);
  });
});
