// direct_authority_variety_cap_survival_v1 — bounded survival of strongly
// identified, directly relevant authorities against variety / rank caps.
import { describe, expect, it } from "vitest";
import { buildCandidatePool } from "../../supabase/functions/legal-research-v1/stages/candidatePool.ts";
import {
  DIRECT_AUTHORITY_EXEMPTION_BUDGET,
  directAuthorityEvidence,
  selectDirectAuthorities,
} from "../../supabase/functions/legal-research-v1/stages/directAuthoritySurvival.ts";

const QUESTION =
  'בסוגייה של חלוקת רכוש לאחר גירושי בני זוג, מה היא אמת המידה לביקורת שיפוטית של בג״ץ כאשר בית הדין הרבני הסתמך על שיקול חיצוני לדין האזרחי?';

// deno-lint-ignore-file no-explicit-any
function cand(over: Record<string, unknown>): any {
  return {
    candidate_id: String(over.candidate_id ?? Math.random()),
    claim_id: "c1",
    role: "binding_case_law",
    origin: "local_db",
    retrieval_method: "text",
    title: "כותרת",
    source_type: "caselaw",
    document_id: null,
    source_url: null,
    snippet: "טקסט משפטי",
    query_he: "ביקורת שיפוטית",
    score: 0.5,
    metadata: {},
    ...over,
  };
}

function weakLocals(n: number) {
  return Array.from({ length: n }, (_, i) =>
    cand({
      candidate_id: `w${i}`,
      retrieval_method: "vector",
      title: `החלטה שולית ${i}`,
      source_url: `https://local.example.co.il/doc-${i}`,
      claim_id: `c${i % 6}`,
      score: 0.45,
    }));
}

/** A strongly identified, directly relevant judgment (docket + topical fit). */
function bavli(id = "bavli", url = "https://www.daat.ac.il/daat/maamar.asp?id=151") {
  return cand({
    candidate_id: id,
    origin: "perplexity",
    retrieval_method: "perplexity",
    title: 'בג"ץ 1000/92 בבלי נ\' בית הדין הרבני הגדול',
    source_url: url,
    score: 0.2,
    snippet:
      "פסק הדין קובע את אמת המידה לביקורת שיפוטית על בית הדין הרבני בחלוקת רכוש בין בני זוג לאחר גירושין",
    metadata: { docket_match: true, classified_source_class: "court_case" },
  });
}

const signalsOf = () => ({ listing_like: false });

describe("direct authority variety cap survival", () => {
  it("A. a strong direct authority ranked past the trimming threshold survives", () => {
    const pool = buildCandidatePool([...weakLocals(140), bavli()], {
      task_intent: "doctrinal_explanation",
      question: QUESTION,
    });
    const ids = pool.candidates.map((c) => c.candidate_id);
    expect(ids).toContain("bavli");
    const row = pool.direct_authority_survival.rows.find((r) => r.candidate_id === "bavli");
    expect(row?.representation_kept).toBe(true);
    expect(row?.next_stage_reached).toBe("pool_admitted");
  });

  it("B. a registry-listed but topically unrelated authority gets no exemption", () => {
    const unrelated = cand({
      candidate_id: "unrelated",
      origin: "perplexity",
      title: 'ע"פ 4988/08 מדינת ישראל נ\' פלוני',
      source_url: "https://supremedecisions.court.gov.il/x.pdf",
      snippet: "הרשעה בעבירות סמים וענישה",
      metadata: { canonical_registry_listed: true },
    });
    const sel = selectDirectAuthorities([unrelated], signalsOf, [
      "גירושין",
      "רבני",
      "רכוש",
    ]);
    expect(sel.used).toBe(0);
  });

  it("C. a generic judgment with weak similarity gets no exemption", () => {
    const generic = cand({
      candidate_id: "generic",
      title: "פסק דין",
      source_url: "https://example.com/x",
      snippet: "החלטה",
    });
    const ev = directAuthorityEvidence(generic, { listing_like: false }, ["גירושין"]);
    expect(ev.eligible).toBe(false);
  });

  it("D. three representations of one authority keep only the strongest", () => {
    const sel = selectDirectAuthorities(
      [bavli("b1"), bavli("b2", "https://x.co.il/a?id=2"), bavli("b3", "https://y.co.il/b")],
      signalsOf,
      ["גירושין", "רבני", "רכוש", "שיפוטית"],
    );
    expect(sel.used).toBe(1);
    expect([...sel.protectedById.keys()]).toEqual(["b1"]);
    expect(sel.rows.filter((r) => r.skipped_reason === "duplicate_representation").length).toBe(2);
  });

  it("E. two strong authorities may both consume the bounded budget", () => {
    const other = cand({
      candidate_id: "amir",
      origin: "perplexity",
      title: 'בג"ץ 8638/03 סימה אמיר נ\' בית הדין הרבני הגדול',
      source_url: "https://supremedecisions.court.gov.il/amir.pdf",
      snippet: "ביקורת שיפוטית על בית הדין הרבני בענייני רכוש בני זוג לאחר גירושין",
      metadata: { docket_match: true },
    });
    const sel = selectDirectAuthorities([bavli(), other], signalsOf, [
      "גירושין",
      "רבני",
      "רכוש",
      "שיפוטית",
    ]);
    expect(sel.used).toBe(2);
  });

  it("F. more strong authorities than the budget stay bounded", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      cand({
        candidate_id: `a${i}`,
        origin: "perplexity",
        title: `בג"ץ ${2000 + i}/07 פלוני נ' בית הדין הרבני הגדול`,
        source_url: `https://supremedecisions.court.gov.il/case-${i}.pdf`,
        snippet: "ביקורת שיפוטית על בית הדין הרבני בחלוקת רכוש לאחר גירושין",
        metadata: { docket_match: true },
      }));
    const sel = selectDirectAuthorities(many, signalsOf, ["גירושין", "רבני", "רכוש"]);
    expect(sel.used).toBe(DIRECT_AUTHORITY_EXEMPTION_BUDGET);
    expect(sel.rows.filter((r) => r.skipped_reason === "exemption_budget_exhausted").length)
      .toBe(8 - DIRECT_AUTHORITY_EXEMPTION_BUDGET);
  });

  it("G. listing-like or integrity-rejected authorities are still rejected", () => {
    const ev = directAuthorityEvidence(bavli(), {
      listing_like: false,
      integrity_reject: true,
    }, ["גירושין", "רבני", "רכוש"]);
    expect(ev.eligible).toBe(false);
    expect(ev.ineligible_reason).toBe("integrity_reject");
  });

  it("ordinary candidates remain subject to the caps", () => {
    const pool = buildCandidatePool(weakLocals(140), {
      task_intent: "doctrinal_explanation",
      question: QUESTION,
    });
    expect(pool.candidates.length).toBeLessThanOrEqual(30);
    expect(pool.direct_authority_survival.used).toBe(0);
  });
});
