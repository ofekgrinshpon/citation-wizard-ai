import { describe, expect, it } from "vitest";
import {
  classifyWebLegalSource,
  isUsableWebClass,
} from "../../supabase/functions/legal-research-v1/stages/webLegalSourceClassifier.ts";
import {
  applyStatuteDominance,
  isStatutoryQuestion,
} from "../../supabase/functions/legal-research-v1/stages/statuteDominance.ts";
import {
  applyAuthorityPriority,
  tierOf,
} from "../../supabase/functions/legal-research-v1/stages/authoritySourcePriority.ts";
import { collectDiscoveryUrlsFor } from "../../supabase/functions/legal-research-v1/lib/canonicalDiscoveryUrls.ts";
import { detectDockets } from "../../supabase/functions/legal-research-v1/stages/docketDetection.ts";
import { buildClaimSourcePlan } from "../../supabase/functions/legal-research-v1/stages/claimSourcePlanning.ts";

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

describe("web legal source classifier", () => {
  it("promotes a foreign supreme court judgment as persuasive only", () => {
    const c = classifyWebLegalSource({
      url: "https://decisions.scc-csc.ca/scc-csc/scc-csc/en/item/117/index.do",
      title: "R. v. Oakes - Judgment of the Court, [1986] 1 S.C.R. 103",
    });
    expect(c.semantic_class).toBe("foreign_case_law");
    expect(c.jurisdiction).toBe("foreign");
    expect(c.source_role).toBe("persuasive_case_law");
    expect(c.pipeline_class).toBe("court_case");
    expect(isUsableWebClass(c)).toBe(true);
  });

  it("treats a foreign statute as comparative context, never a primary anchor", () => {
    const c = classifyWebLegalSource({
      url: "https://www.legislation.gov.uk/ukpga/1998/42/section/3",
      title: "Human Rights Act 1998, section 3 - legislation",
    });
    expect(c.semantic_class).toBe("foreign_statute");
    expect(c.citable_as).toBe("commentary");
    expect(c.source_role).not.toBe("primary_statute");
  });

  it("admits academic legal scholarship", () => {
    const c = classifyWebLegalSource({
      url: "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=123",
      title: "Proportionality and the Culture of Justification - Law Review, Volume 12",
      snippet: "Abstract: this article in a law journal argues…",
    });
    expect(c.pipeline_class).toBe("academic");
    expect(isUsableWebClass(c)).toBe(true);
  });

  it("rejects wikipedia, marketing and listing pages", () => {
    expect(classifyWebLegalSource({ url: "https://he.wikipedia.org/wiki/מידתיות", title: "מידתיות" })
      .pipeline_class).toBe("bad");
    const firm = classifyWebLegalSource({
      url: "https://example.com/article",
      title: "עורך דין מנהלי — ייעוץ משפטי חינם",
    });
    expect(isUsableWebClass(firm)).toBe(false);
    const listing = classifyWebLegalSource({
      url: "https://courts.example.gov/search?q=x",
      title: "Search results",
    });
    expect(isUsableWebClass(listing)).toBe(false);
  });

  it("keeps low-signal pages unknown", () => {
    const c = classifyWebLegalSource({ url: "https://randomsite.com/page", title: "מידע כללי" });
    expect(c.pipeline_class).toBe("unknown");
    expect(isUsableWebClass(c)).toBe(false);
  });
});

describe("statute dominance", () => {
  const statute = src({
    ref: "S1",
    source_type: "israeli_law",
    citable_as: "statute",
    title: "חוק-יסוד: כבוד האדם וחירותו",
  });
  const judgment = src({
    ref: "S2",
    source_type: "caselaw",
    citable_as: "judgment",
    title: "בג\"ץ 6427/02",
  });

  it("detects a statutory question", () => {
    expect(isStatutoryQuestion("מה קובע חוק-יסוד: כבוד האדם וחירותו?").hit).toBe(true);
    expect(isStatutoryQuestion("מהי דוקטרינת ההסתמכות?").hit).toBe(false);
  });

  it("promotes the statute to lead on statutory claims", () => {
    const preferred = new Map([["c1", ["S2", "S1"]]]);
    const report = applyStatuteDominance({
      question: "מה קובע חוק-יסוד: כבוד האדם וחירותו בסעיף 8?",
      claims: [{ claim_id: "c1", text_he: "סעיף 8 לחוק-יסוד קובע את פסקת ההגבלה" }],
      sources: [judgment, statute],
      preferredByClaim: preferred,
    });
    expect(preferred.get("c1")![0]).toBe("S1");
    expect(report.promoted_refs.length).toBe(1);
  });

  it("declares absence honestly when no statute source exists", () => {
    const preferred = new Map([["c1", ["S2"]]]);
    const report = applyStatuteDominance({
      question: "מה קובע חוק-יסוד: כבוד האדם וחירותו בסעיף 8?",
      claims: [{ claim_id: "c1", text_he: "סעיף 8 לחוק-יסוד" }],
      sources: [judgment],
      preferredByClaim: preferred,
    });
    expect(report.statute_absent_declared).toBe(true);
    expect(report.notice_he).toBeTruthy();
    expect(preferred.get("c1")).toEqual(["S2"]);
  });

  it("keeps the statute in the plan even without lexical overlap", () => {
    const plan = buildClaimSourcePlan(
      "מה קובע חוק-יסוד: כבוד האדם וחירותו בסעיף 8?",
      [{ claim_id: "c1", text_he: "סעיף 8 לחוק-יסוד קובע את תנאי פסקת ההגבלה" }],
      [statute],
      { academicMode: false },
    );
    expect(plan.rows[0].preferred_source_ids).toContain("S1");
    expect(plan.statute_dominance?.statutory_question).toBe(true);
  });
});

describe("authority priority", () => {
  it("ranks direct primary above secondary background", () => {
    const direct = src({ ref: "A", source_type: "caselaw", best_support: "direct" });
    const secondary = src({ ref: "B", source_type: "journal_article", best_support: "indirect" });
    expect(tierOf(direct).tier).toBe("direct_primary");
    expect(tierOf(secondary).tier).toBe("role_compatible_secondary");
    const preferred = new Map([["c1", ["B", "A"]]]);
    const report = applyAuthorityPriority({
      claims: [{ claim_id: "c1" }],
      sources: [direct, secondary],
      preferredByClaim: preferred,
    });
    expect(preferred.get("c1")![0]).toBe("A");
    expect(report.rows[0].reordered).toBe(true);
  });

  it("keeps one representative per source class in the lead", () => {
    const j1 = src({ ref: "J1", source_type: "caselaw", best_support: "direct" });
    const j2 = src({ ref: "J2", source_type: "caselaw", best_support: "direct" });
    const a1 = src({ ref: "A1", source_type: "journal_article" });
    const preferred = new Map([["c1", ["J1", "J2", "A1"]]]);
    applyAuthorityPriority({
      claims: [{ claim_id: "c1" }],
      sources: [j1, j2, a1],
      preferredByClaim: preferred,
    });
    expect(preferred.get("c1")!.slice(0, 2)).toEqual(["J1", "A1"]);
  });
});

describe("discovery-fed canonical acquisition", () => {
  const docket = detectDockets("בג\"ץ 6821/93")[0];

  it("uses a discovered official URL that carries the docket", () => {
    const urls = collectDiscoveryUrlsFor(
      [{
        url: "https://supremedecisions.court.gov.il/Home/Download?path=x&fileName=93068210.txt",
        title: "בג\"ץ 6821/93 בנק המזרחי",
        discovery_source: "search_first_official",
      }],
      [],
      docket,
    );
    expect(urls.length).toBe(1);
  });

  it("ignores discovered URLs for a different docket", () => {
    const urls = collectDiscoveryUrlsFor(
      [{
        url: "https://supremedecisions.court.gov.il/Home/Download?fileName=other.txt",
        title: "בג\"ץ 1111/11 אחר",
        discovery_source: "search_first_official",
      }],
      [],
      docket,
    );
    expect(urls.length).toBe(0);
  });
});
