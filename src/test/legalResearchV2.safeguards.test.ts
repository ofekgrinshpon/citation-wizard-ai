import { describe, expect, it } from "vitest";
import {
  applyTemporalGate,
  isCurrentLawCapable,
  isCurrentStateProposition,
  isTemporallySensitive,
} from "../../supabase/functions/legal-research-v2/verification/temporalValidity.ts";
import {
  assessPrimaryGap,
  buildDerivativeDisclosure,
  classifyProvenance,
  isAuthoritativeDerivative,
  isPrimaryRepresentation,
  shouldAttemptDerivativeFallback,
} from "../../supabase/functions/legal-research-v2/verification/primaryProvenance.ts";
import type {
  EvidenceSource,
  VerifiedEvidencePack,
} from "../../supabase/functions/legal-research-v2/types.ts";
import type { EvidenceStore } from "../../supabase/functions/legal-research-v2/evidence/evidenceStore.ts";

function src(over: Partial<EvidenceSource> = {}): EvidenceSource {
  return {
    source_id: "S1",
    title: "מסמך",
    sha256: "x",
    fetch_status: "ok",
    extracted_text: "טקסט",
    text_length: 5,
    identity_fields: { dockets: [], statutes: [], sections: [] },
    is_actual_document: true,
    origin: "web",
    fetched_at: new Date().toISOString(),
    ...over,
  };
}

function storeOf(sources: EvidenceSource[]): EvidenceStore {
  return {
    get: (id: string) => sources.find((s) => s.source_id === id) ?? null,
    all: () => sources,
    readable: () => sources.filter((s) => s.fetch_status === "ok" && s.is_actual_document),
  } as unknown as EvidenceStore;
}

describe("safeguard A — temporal claim classification", () => {
  it("flags present-state legal propositions", () => {
    expect(
      isCurrentStateProposition("בישראל כיום אין עבירה פלילית ייחודית לסחיטת דמי חסות"),
    ).toBe(true);
    expect(isCurrentStateProposition("טרם נחקק הסדר ייעודי בסוגיה")).toBe(true);
  });

  it("does not flag a historical / doctrinal proposition", () => {
    expect(
      isCurrentStateProposition(
        'בבג"ץ 1000/92 בבלי נקבע כי הלכת השיתוף חלה גם בבית הדין הרבני',
      ),
    ).toBe(false);
    expect(
      isCurrentStateProposition("אמת המידה להתערבות היא חריגה מסמכות או טעות בדין האזרחי"),
    ).toBe(false);
  });

  it("honours the agent-declared flag as an independent signal", () => {
    expect(
      isTemporallySensitive({ proposition: "העונש הוא שבע שנות מאסר", current_state_claim: true }),
    ).toBe(true);
  });

  it("treats only official legislation-bearing documents as current-law capable", () => {
    expect(
      isCurrentLawCapable(
        src({
          url: "https://main.knesset.gov.il/Activity/Legislation/Laws/x.aspx",
          title: "חוק העונשין",
          extracted_text: "תיקון מס' 5 לחוק העונשין",
        }),
      ),
    ).toBe(true);
    // Old but authoritative material is not rejected for being old...
    expect(
      isCurrentLawCapable(
        src({ url: "https://www.daat.ac.il/x.htm", title: "מאמר", extracted_text: "חוק" }),
      ),
    ).toBe(false);
  });
});

describe("safeguard A — gate", () => {
  const pack: VerifiedEvidencePack = {
    claims: [
      {
        claim_id: "C1",
        proposition: "כיום אין בישראל עבירה ייחודית",
        importance: "core",
        support_status: "supported",
        sources: [{
          source_id: "S1",
          display_title: "מסמך",
          verified_span: "ציטוט",
          support: "supports",
        }],
      },
      {
        claim_id: "C2",
        proposition: "הלכת בבלי חלה על חלוקת רכוש",
        importance: "core",
        support_status: "supported",
        sources: [{
          source_id: "S2",
          display_title: "פסק דין",
          verified_span: "ציטוט",
          support: "supports",
        }],
      },
    ],
    unsupported_claims: [],
  };

  it("removes an unverified current-state claim and advises disclosure", () => {
    const out = applyTemporalGate(pack, [
      { claim_id: "C1", temporal_status: "unresolved", detail: "אין מקור עדכני", checked_source_ids: [] },
    ]);
    expect(out.pack.claims.map((c) => c.claim_id)).toEqual(["C2"]);
    expect(out.pack.unsupported_claims[0].reasons[0]).toContain("temporal_unresolved");
    expect(out.advisories[0]).toContain("לא אומת");
  });

  it("rejects a contradicted current-state claim", () => {
    const out = applyTemporalGate(pack, [
      { claim_id: "C1", temporal_status: "contradicted", detail: "נחקקה הוראה", checked_source_ids: ["S9"] },
    ]);
    expect(out.pack.claims).toHaveLength(1);
    expect(out.advisories[0]).toContain("נסתרה");
  });

  it("leaves old-but-valid doctrinal claims untouched", () => {
    const out = applyTemporalGate(pack, []);
    expect(out.pack.claims).toHaveLength(2);
    expect(out.advisories).toHaveLength(0);
  });
});

describe("safeguard B — unreadable primary fallback", () => {
  const DOCKET = 'בג"ץ 1000/92';
  const original = src({
    source_id: "S1",
    title: 'בג"ץ 1000/92 בבלי נ\' בית הדין הרבני הגדול',
    url: "https://supremedecisions.court.gov.il/x.pdf",
  });
  const later = src({
    source_id: "S2",
    title: 'דנג"ץ 8537/18 פלונית',
    url: "https://supremedecisions.court.gov.il/y.pdf",
    extracted_text: 'כפי שנקבע בבג"ץ 1000/92 בבלי, הלכת השיתוף חלה',
  });
  const blog = src({
    source_id: "S3",
    title: "סיכום פסקי דין",
    url: "https://some-blog.example.com/p",
    extracted_text: 'בג"ץ 1000/92 בבלי',
  });

  it("distinguishes the original, an authoritative derivative and a blog", () => {
    expect(isPrimaryRepresentation(original, DOCKET)).toBe(true);
    expect(isAuthoritativeDerivative(later, DOCKET)).toBe(true);
    expect(isAuthoritativeDerivative(blog, DOCKET)).toBe(false);
    expect(classifyProvenance(later, DOCKET)).toBe("authoritative_derivative");
  });

  it("triggers fallback only when the original text was never verified", () => {
    const empty: VerifiedEvidencePack = { claims: [], unsupported_claims: [] };
    expect(shouldAttemptDerivativeFallback(assessPrimaryGap(empty, storeOf([original]), [DOCKET])))
      .toBe(true);

    const direct: VerifiedEvidencePack = {
      claims: [{
        claim_id: "C1",
        proposition: "p",
        importance: "core",
        support_status: "supported",
        sources: [{
          source_id: "S1",
          display_title: original.title,
          verified_span: "x",
          support: "supports",
        }],
      }],
      unsupported_claims: [],
    };
    expect(shouldAttemptDerivativeFallback(assessPrimaryGap(direct, storeOf([original]), [DOCKET])))
      .toBe(false);
  });

  it("reports derivative support and produces the disclosure sentence", () => {
    const viaLater: VerifiedEvidencePack = {
      claims: [{
        claim_id: "C1",
        proposition: "p",
        importance: "core",
        support_status: "supported",
        sources: [{
          source_id: "S2",
          display_title: later.title,
          verified_span: "x",
          support: "supports",
        }],
      }],
      unsupported_claims: [],
    };
    const gap = assessPrimaryGap(viaLater, storeOf([original, later]), [DOCKET]);
    expect(gap.unreadable).toEqual([DOCKET]);
    expect(gap.derivative).toEqual([DOCKET]);
    expect(shouldAttemptDerivativeFallback(gap)).toBe(false);
    expect(buildDerivativeDisclosure(gap.derivative)).toContain("לא הצלחתי לאמת ישירות");
  });
});
