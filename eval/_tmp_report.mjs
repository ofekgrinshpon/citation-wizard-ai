import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const META = {
  "a2557386-9a8e-4062-be08-8c79c37fd19d": { id: "Q1", label: "temporary injunction", kw: [["תקנה 95","תקנות סדר הדין"],["סעיף 75","חוק בתי המשפט"],["צו מניעה זמני","סעד זמני"]], min:1 },
  "e1046f8c-2fd3-4859-8d7b-247420e019fd": { id: "Q5", label: "Apropim / contract", kw: [["אפרופים"],["מגדלי הירקות"],["סעיף 25","חוק החוזים"]], min:2 },
  "0be99c59-7f90-4d84-b3af-5a89bfe2422a": { id: "Q7", label: "exhaustion of remedies", kw: [["פסטרנק"],["חוק בתי משפט לעניינים מינהליים","בתי משפט לעניינים מינהליים"],["זמיר"]], min:1 },
};
const ids = Object.keys(META);
const { data } = await admin.from("qa_logs").select("id, footnotes, metadata, answer").in("id", ids);
const out = [];
for (const r of data) {
  const m = META[r.id]; const md = r.metadata || {};
  const fns = r.footnotes || [];
  const fnText = fns.map(f => typeof f==="string"?f:(f.text||f.citation||JSON.stringify(f))).join("\n");
  const ans = r.answer || "";
  const v3 = md.v3_legal_research_plan || {};
  const fb = md.v3_anchor_fallback || {};
  const expected = v3.anchors || [];
  const pa = fb.per_anchor || [];
  const coverage = m.kw.map(alts => ({ keys:alts, in_fn: alts.some(k=>fnText.includes(k)), in_ans: alts.some(k=>ans.includes(k)) }));
  const hits = coverage.filter(c=>c.in_fn||c.in_ans).length;
  // detect raw open-web citations: footnotes with http(s) NOT on tier-A
  const TIER_A = ["nevo.co.il","supremedecisions.court.gov.il","gov.il","knesset.gov.il","takdin.co.il","lite.takdin.co.il","mishpatim.tau.ac.il","court.gov.il","justice.gov.il"];
  const urls = []; for (const f of fns) { const s=typeof f==="string"?f:(f.text||f.citation||""); const u=s.match(/https?:\/\/[^\s)]+/g)||[]; urls.push(...u); }
  const rawOpenWeb = urls.filter(u => !TIER_A.some(d => u.includes(d)));
  out.push({
    id: m.id, label: m.label, qa_log_id: r.id,
    v3_path: md.v3_path, v1_fallback: !!md.v1_fallback || md.drafting_path==="v1_legacy",
    v2_telemetry: { research_plan_v2: !!md.research_plan_v2, retrieval_v2: !!md.retrieval_v2, verification_v2: !!md.verification_v2, ledger_v2: !!md.ledger_v2, drafter: !!md.drafter || !!md.models_used?.drafting },
    v3_plan_status: v3.status, expected_anchor_count: expected.length,
    expected_anchors: expected.map(a=>({ id:a.id, type:a.type, name:a.name, docket:a.docket, section:a.section, centrality:a.centrality })),
    per_anchor: pa.map(p=>({ id:p.anchor_id, name:p.anchor_name, local_found:p.local_found, pplx:p.perplexity_called, approved_found:p.approved_found, candidate_added:p.candidate_added, verified:p.verified, cited:p.cited, not_found_reason:p.not_found_reason })),
    cited_anchor_ids: pa.filter(p=>(p.cited||0)>0).map(p=>p.anchor_id),
    missing_expected: pa.filter(p=>(p.local_found||0)===0 && (p.approved_found||0)===0).map(p=>({ id:p.anchor_id, name:p.anchor_name, reason:p.not_found_reason })),
    total_footnotes: fns.length,
    footnotes: fns.map((f,i)=>`${i+1}. ${(typeof f==="string"?f:(f.text||f.citation||JSON.stringify(f))).slice(0,280)}`),
    keyword_coverage: coverage,
    raw_open_web_urls: rawOpenWeb,
    acceptance: {
      keyword_min: hits >= m.min,
      footnotes_5_8: fns.length >= 5 && fns.length <= 8,
      no_v1_fallback: !(md.v1_fallback || md.drafting_path==="v1_legacy"),
      no_raw_open_web: rawOpenWeb.length === 0,
    },
  });
}
out.sort((a,b)=>a.id.localeCompare(b.id));
console.log(JSON.stringify(out, null, 2));
console.log("\n=== AGGREGATE ===");
console.log(JSON.stringify(out.map(r=>({ id:r.id, v3_path:r.v3_path, expected:r.expected_anchor_count, cited:r.cited_anchor_ids.length, footnotes:r.total_footnotes, v1_fallback:r.v1_fallback, accept:r.acceptance })), null, 2));
