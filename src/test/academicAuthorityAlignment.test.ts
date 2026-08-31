import { describe, expect, it } from "vitest";
import {
  categoryAccepts,
  deriveClaimCategory,
  detectBindingLawLanguage,
  isAcademicClaimCategory,
  type SourceSupportProfile,
} from "../../supabase/functions/legal-research-v1/stages/claimSupportCategory.ts";
import {
  academicTopicalFit,
  guardPrimaryLanguage,
  isCategoricalClaim,
} from "../../supabase/functions/legal-research-v1/stages/academicAuthorityAlignment.ts";

const doctrinal: SourceSupportProfile = {
  ref: "s1",
  judgment_authority: false,
  statutory_authority: false,
  doctrinal_authority: true,
  background_only: false,
  eligibility_reason: "eligible",
};
const backgroundOnly: SourceSupportProfile = { ...doctrinal, doctrinal_authority: false, background_only: true };
const judgment: SourceSupportProfile = { ...doctrinal, doctrinal_authority: false, judgment_authority: true };

describe("academic claim categories", () => {
  it("accepts doctrinal secondary for academic categories", () => {
    for (
      const c of [
        "doctrinal_background",
        "academic_framing",
        "theoretical_explanation",
        "literature_synthesis",
        "critique_or_counterposition",
        "methodological_framing",
      ] as const
    ) {
      expect(isAcademicClaimCategory(c)).toBe(true);
      expect(categoryAccepts(c, doctrinal)).toBe(true);
      expect(categoryAccepts(c, backgroundOnly)).toBe(false);
    }
  });

  it("never accepts doctrinal secondary for holdings or statutory text", () => {
    expect(categoryAccepts("court_holding", doctrinal)).toBe(false);
    expect(categoryAccepts("statutory", doctrinal)).toBe(false);
    expect(categoryAccepts("court_holding", judgment)).toBe(true);
  });

  it("maps academic blocks to academic categories", () => {
    const r = deriveClaimCategory({
      propositionType: "black_letter_rule",
      text: "מסגרת תיאורטית לעקרון המידתיות",
      academicMode: true,
    });
    expect(r.category).toBe("theoretical_explanation");
  });

  it("escalates binding-law wording back to primary-required", () => {
    const caselaw = deriveClaimCategory({
      propositionType: "background",
      text: "בית המשפט קבע כי יש להחיל את מבחן המידתיות",
      academicMode: true,
    });
    expect(caselaw.category).toBe("court_holding");
    const statutory = deriveClaimCategory({
      propositionType: "background",
      text: "החוק קובע כי הרשות חייבת לשקול שיקולים ענייניים",
      academicMode: true,
    });
    expect(statutory.category).toBe("statutory");
  });

  it("keeps docket escalation in academic mode", () => {
    const r = deriveClaimCategory({
      propositionType: "background",
      text: "בבג\"ץ 1715/97 נדונה סוגיית המידתיות",
      academicMode: true,
    });
    expect(r.category).toBe("court_holding");
  });
});

describe("primary language guard", () => {
  it("detects binding-law wording", () => {
    expect(detectBindingLawLanguage("ההלכה היא כי כך").binding).toBe(true);
    expect(detectBindingLawLanguage("בספרות ניתן למסגר את הסוגיה").binding).toBe(false);
  });

  it("rewrites only local safe forms", () => {
    const g = guardPrimaryLanguage("ההלכה היא כי יש לבחון מידתיות.", 0);
    expect(g.report?.action).toBe("rewritten");
    expect(g.text).toContain("בספרות מקובל לראות כי");
    expect(detectBindingLawLanguage(g.text).binding).toBe(false);
  });

  it("reports instead of mangling when no safe substitution exists", () => {
    const g = guardPrimaryLanguage("בית המשפט קבע, לאחר דיון ארוך, את ההסדר.", 2);
    expect(g.report?.action).toBe("reported_unsupported");
    expect(g.text).toBe("בית המשפט קבע, לאחר דיון ארוך, את ההסדר.");
  });

  it("leaves clean academic prose untouched", () => {
    const g = guardPrimaryLanguage("הדיון הדוקטרינרי מציג שתי גישות מרכזיות.", 1);
    expect(g.report).toBeNull();
  });
});

describe("categorical claims and topical fit", () => {
  it("flags categorical wording", () => {
    expect(isCategoricalClaim("תמיד יש להתערב בהחלטת הרשות")).toBe(true);
    expect(isCategoricalClaim("ניתן לטעון כי ראוי להתערב במקרים חריגים")).toBe(false);
  });

  it("rejects a generally-legal but off-topic source", () => {
    const src = {
      ref: "s9",
      title: "על ערעורי-ביניים, סמכות עניינית ועלות שיפוטית שקועה",
      snippet: "דיון בסדרי דין אזרחיים",
      supported_points: [],
      // deno-lint-ignore no-explicit-any
    } as any;
    const fit = academicTopicalFit("דוקטרינת ההבטחה המנהלית והסתמכות הציבור", "הבטחה מנהלית והסתמכות", src);
    expect(fit.fit).toBe(false);
  });

  it("accepts an on-topic doctrinal source", () => {
    const src = {
      ref: "s2",
      title: "ההבטחה המנהלית והסתמכות הפרט על הרשות",
      snippet: "ניתוח דוקטרינת ההבטחה המנהלית",
      supported_points: ["הסתמכות"],
      // deno-lint-ignore no-explicit-any
    } as any;
    const fit = academicTopicalFit("דוקטרינת ההבטחה המנהלית והסתמכות הציבור", "הבטחה מנהלית", src);
    expect(fit.fit).toBe(true);
  });
});

// ── academic_declared_category_remap_and_body_acquisition_v2 ────────────────
describe("declared category remap in academic mode", () => {
  it("remaps a declared court_holding on framing prose to an academic category", () => {
    const r = deriveClaimCategory({
      declared: "court_holding",
      propositionType: "background",
      text: "פרק זה מציג את הרקע התיאורטי לדוקטרינה ואת מקורותיה בספרות.",
      academicMode: true,
    });
    expect(isAcademicClaimCategory(r.category)).toBe(true);
    expect(r.remapped_from).toBe("court_holding");
  });

  it("keeps primary requirement when the prose asserts binding law", () => {
    const r = deriveClaimCategory({
      declared: "court_holding",
      propositionType: "background",
      text: "בית המשפט קבע כי הסעד החוקתי מותר.",
      academicMode: true,
    });
    expect(r.category).toBe("court_holding");
  });

  it("keeps primary requirement when the block names a docket", () => {
    const r = deriveClaimCategory({
      declared: "scholarly_commentary",
      propositionType: "background",
      text: "בפרשה 1234/56 נדונה סוגיה זו.",
      academicMode: true,
    });
    expect(r.category).toBe("court_holding");
  });

  it("does not remap declared categories outside academic mode", () => {
    const r = deriveClaimCategory({
      declared: "court_holding",
      propositionType: "background",
      text: "פרק זה מציג רקע.",
    });
    expect(r.category).toBe("court_holding");
    expect(r.remapped_from).toBeUndefined();
  });
});
