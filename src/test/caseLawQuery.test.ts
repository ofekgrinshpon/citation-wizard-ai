import { describe, it, expect } from "vitest";
import {
  classifyDocketCourt, buildCaseNumberQuery, buildCaseSystemPrompt, shouldRunPartyFollowup,
  mergeFollowupFields, strictSnippetEvidence, SNIPPET_EVIDENCE_DB_NAME,
} from "../../supabase/functions/_shared/caseLawQuery.ts";
import { parseDocketNumber, extractDocket, docketPatternSource } from "../../supabase/functions/_shared/trustedHosts.ts";
// Shapes recorded from the Oct 15 live experiment (snippet text as returned).
const HAARETZ = { url: "https://img.haarets.co.il/bs/00000190-bc29-de8b-adfc-bd29b0e60000/41/b2/75ac09644ffa8b1dfbc0b390f42e/dira.pdf", title: "בית המשפט המחוזי בתל אביב-יפו",
  snippet: 'עש"א \n1477-12-22\nהוצאת הקיבוץ המאוחד בע"מ נ\' מדינת ישראל–\nרשות הפטנטים,\nהעיצובים וסימני\nה\nמסחר \n1\nמתוך49\nל פני כבוד ה\nשופט  גרשון גונטובניק' };
const LANDING = [
  { url: "https://www.takdin.co.il/Search/Verdict", title: "פסיקה", snippet: "" },
  { url: "https://www.nevo.co.il/psikasearch.aspx", title: "חיפוש פסיקה - נבו", snippet: "" },
  { url: "https://judgments.org.il/judgments/", title: "ארכיון תיקים - המאגר המשפטי הטוב בישראל ובחינם", snippet: "" },
];
const fx = { t2_1477: [LANDING[0], HAARETZ, LANDING[2]], t1_1477: LANDING, t2_11487: LANDING };

const idx = (d: any) => (t: string) =>
  Array.from(t.normalize("NFKC").matchAll(new RegExp(docketPatternSource(d, { yearAliases: true }), "g")), (m) => m.index ?? 0);
const P1 = 'הוצאת הקיבוץ המאוחד בע"מ', P2 = "מדינת ישראל";

describe("court-aware case query", () => {
  it("classifies courts", () => {
    expect(classifyDocketCourt('עש"א', "1477-12-22")).toBe("lower");
    expect(classifyDocketCourt("", "1477-12-22")).toBe("lower");
    expect(classifyDocketCourt('ת״א', "5/20")).toBe("lower");
    expect(classifyDocketCourt('ע"א', "11487/03")).toBe("supreme");
    expect(classifyDocketCourt('בג״ץ', "5555/18")).toBe("supreme");
    expect(classifyDocketCourt("", "11487/03")).toBe("unknown");
  });
  it("lower-court query and prompt never ask for פ\"ד first", () => {
    const q = buildCaseNumberQuery('עש"א', "1477-12-22", "lower");
    expect(q).not.toMatch(/בדוק קודם כל|כרך, חלק/);
    expect(buildCaseSystemPrompt("lower")).not.toMatch(/עדיפות ראשונה היא לבדוק פרסום בפד"י/);
  });
  it("supreme query keeps the פ\"ד check", () => {
    expect(buildCaseNumberQuery('ע"א', "11487/03", "supreme")).toMatch(/פד"י/);
    expect(buildCaseSystemPrompt("supreme")).toMatch(/עדיפות ראשונה היא לבדוק פרסום בפד"י/);
  });
});

describe("party follow-up gate", () => {
  const base = { found: true, party1: "א", party2: "ב", date: "", databaseName: "" };
  it("fires only when parties confirmed and date/source missing", () => {
    expect(shouldRunPartyFollowup({ docketAnchored: true, partyVerification: "both", parsed: base, alreadyRan: false })).toBe(true);
    expect(shouldRunPartyFollowup({ docketAnchored: true, partyVerification: "both", parsed: base, alreadyRan: true })).toBe(false);
    expect(shouldRunPartyFollowup({ docketAnchored: false, partyVerification: "both", parsed: base, alreadyRan: false })).toBe(false);
    expect(shouldRunPartyFollowup({ docketAnchored: true, partyVerification: "no_anchor", parsed: base, alreadyRan: false })).toBe(false);
    expect(shouldRunPartyFollowup({ docketAnchored: true, partyVerification: "both", parsed: { ...base, date: "1.1.2020", databaseName: "נבו" }, alreadyRan: false })).toBe(false);
    expect(shouldRunPartyFollowup({ docketAnchored: true, partyVerification: "snippet_strict", parsed: base, alreadyRan: false })).toBe(true);
    expect(shouldRunPartyFollowup({ docketAnchored: true, partyVerification: "snippet_strict", parsed: { ...base, date: "1.1.2020", databaseName: "נבו" }, alreadyRan: false })).toBe(false);
  });
  it("merge never overwrites and never adds פ\"ד for lower courts", () => {
    const p: any = { date: "01.01.2020", databaseName: "", isPublished: false };
    const f = mergeFollowupFields(p, { date: "02.02.2021", databaseName: "נבו", isPublished: true, padi_volume: "סב(4)" }, "lower");
    expect(p.date).toBe("01.01.2020");
    expect(p.databaseName).toBe("נבו");
    expect(p.isPublished).toBe(false);
    expect(f).toEqual(["databaseName"]);
  });
});

describe("Option B strict snippet evidence (live fixtures)", () => {
  const A = parseDocketNumber("1477-12-22")!;
  it("accepts the Haaretz PDF for 1477-12-22 and labels source אר״ש", () => {
    const u = strictSnippetEvidence((fx as any).t2_1477, idx(A), P1, P2);
    expect(u).toMatch(/haarets/);
    expect(SNIPPET_EVIDENCE_DB_NAME).toBe("אר\u05F4ש");
  });
  it("neighbouring dockets never match the same snippet", () => {
    for (const s of ["1477-12-23", "1477-11-22"]) {
      expect(strictSnippetEvidence((fx as any).t2_1477, idx(parseDocketNumber(s)!), P1, P2)).toBeNull();
    }
    expect(strictSnippetEvidence((fx as any).t2_1477, idx(extractDocket('ע"א 1477/12')!), P1, P2)).toBeNull();
  });
  it("generic landing pages prove nothing", () => {
    expect(strictSnippetEvidence((fx as any).t1_1477, idx(A), P1, P2)).toBeNull();
    expect(strictSnippetEvidence((fx as any).t2_11487, idx(extractDocket('ע"א 11487/03')!), "August Storck KG", "אלפא אינטואיט")).toBeNull();
  });
  it("docket cited inside another judgment without both parties is rejected", () => {
    const r = [{ url: "https://blog.example.com/x", title: "פסק דין אחר", snippet: 'כפי שנקבע בעש"א 1477-12-22 ובע"א 2000/10 כהן נ\' לוי' }];
    expect(strictSnippetEvidence(r, idx(A), P1, P2)).toBeNull();
  });
  it("parties far from the docket are rejected", () => {
    const r = [{ url: "https://x.example/y", title: "", snippet: `1477-12-22 ${"מילה ".repeat(200)} ${P1} נ' ${P2}` }];
    expect(strictSnippetEvidence(r, idx(A), P1, P2)).toBeNull();
  });
  it("accepts case/quote/suffix variants seen in the live 11487/03 run", () => {
    const D = extractDocket('ע"א 11487/03')!;
    const live = [
      { url: "https://www.iprights.co.il/x/", title: "סימן מסחר תלת מימדי",
        snippet: "פרשת 'טופיפי' – נ' אלפא אינטואיט מוצרי מזון בע\"מ August storck kG ע\"א 11487/03, יצרנית הממתק" },
      { url: "https://www.gsip.co.il/y/", title: "התנאים לרישום סימן מסחר תלת מימדי",
        snippet: "ניתן בבית המשפט העליון פסק דין בע”א 11487/03 August Stork KG נ’ אלפא אינטואיט מוצרי מזון בע”מ אשר עסק ברישום" },
    ];
    expect(strictSnippetEvidence(live, idx(D), "August Storck KG", 'אלפא אינטואיט מוצרי מזון בע"מ')).toMatch(/iprights/);
  });
  it("still rejects when only a name core matches but the other party is absent", () => {
    const D = extractDocket('ע"א 11487/03')!;
    const r = [{ url: "https://x.example/z", title: "", snippet: 'ע"א 11487/03 August Storck KG נ’ חברה אחרת לגמרי' }];
    expect(strictSnippetEvidence(r, idx(D), "August Storck KG", 'אלפא אינטואיט מוצרי מזון בע"מ')).toBeNull();
  });
  it("accepts RTL-reversed Latin party order (live HUJI snippet)", () => {
    const D = extractDocket('ע"א 11487/03')!;
    const live = [{ url: "https://shnaton.huji.ac.il/x.pdf", title: "דיני סימני מסחר",
      snippet: "' ואח' נ' אלפא אינטואיט מוצרי מזון בע\"מ ואחKG Storck August 11487/03 ע\"א\nנ' שריג אלקטריק בע\"מV.N Electronics Philips" }];
    expect(strictSnippetEvidence(live, idx(D), "August Storck KG", 'אלפא אינטואיט מוצרי מזון בע"מ')).toMatch(/huji/);
  });
});

describe("historic district (פ\"מ)", () => {
  it("classifies pre-2007 two-part lower dockets", () => {
    expect(classifyDocketCourt('ת"א', "1234/95")).toBe("district_historic");
    expect(classifyDocketCourt('ע"ש', "12/1998")).toBe("unknown");
    expect(classifyDocketCourt('ת"א', "1234/07")).toBe("lower");
    expect(classifyDocketCourt('תא"מ', "1234/95")).toBe("lower");
    expect(classifyDocketCourt('ת"א', "1477-12-02")).toBe("lower");
  });
  it("asks for פ\"מ, never פד\"י first", () => {
    const q = buildCaseNumberQuery('ת"א', "1234/95", "district_historic");
    expect(q).toMatch(/פ"מ/);
    expect(q).not.toMatch(/בדוק קודם כל האם פסק הדין פורסם בפד"י/);
    expect(buildCaseSystemPrompt("district_historic")).not.toMatch(/עדיפות ראשונה היא לבדוק פרסום בפד"י/);
  });
  it("never merges פ\"ד volume for historic district", () => {
    const p: any = { isPublished: false };
    mergeFollowupFields(p, { isPublished: true, padi_volume: "מט(2)" }, "district_historic");
    expect(p.isPublished).toBe(false);
  });
});
