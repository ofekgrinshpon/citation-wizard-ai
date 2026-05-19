import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ids = ['f49a4a1c-df1e-469a-93e0-b731ea418e85','e140e08e-2a5f-4fc2-a1e3-6df7d1d94607','36a1c72f-1ce2-4db6-b1a6-ed1186a168d5','986cd97d-4a7d-4cab-9391-2ab3374e902f'];
const labels = { 'f49a4a1c-df1e-469a-93e0-b731ea418e85':'Q1','e140e08e-2a5f-4fc2-a1e3-6df7d1d94607':'Q3','36a1c72f-1ce2-4db6-b1a6-ed1186a168d5':'Q5','986cd97d-4a7d-4cab-9391-2ab3374e902f':'Q7' };
for (let i = 0; i < 180; i++) {
  const { data } = await admin.from('qa_logs').select('id, answer').in('id', ids);
  const done = data.filter(r => r.answer !== null).length;
  console.log(`t=${i*5}s done=${done}/4`);
  if (done === 4) break;
  await new Promise(r => setTimeout(r, 5000));
}
const { data } = await admin.from('qa_logs').select('id, metadata, footnotes, answer, total_footnotes').in('id', ids);
for (const r of data.sort((a,b)=>labels[a.id].localeCompare(labels[b.id]))) {
  const md = r.metadata || {};
  const v3 = md.v3_legal_research_plan || {};
  const af = md.v3_anchor_first_enforcement || null;
  console.log(`\n========== ${labels[r.id]} (${r.id}) ==========`);
  console.log(`v3_path=${md.v3_path}`);
  console.log(`v1_fallback=${!!md.v1_fallback}  drafting_path=${md.drafting_path}`);
  console.log(`doctrinal_frame=${v3.doctrinal_frame}`);
  console.log(`answer_len=${(r.answer||'').length}  total_footnotes=${r.total_footnotes}`);
  console.log(`anchors planned:`, JSON.stringify((v3.anchors||[]).map(a=>({id:a.id,type:a.type,name:a.name,docket:a.docket,section:a.section})), null, 2));
  console.log(`\n--- anchor_first_enforcement ---`);
  if (!af) { console.log('  MISSING'); }
  else {
    console.log('totals:', JSON.stringify(af.totals));
    const interesting = (af.per_claim||[]).filter(p => p.action !== 'kept' && p.action !== 'no_anchor_available');
    console.log(`per_claim total=${(af.per_claim||[]).length}  interesting=${interesting.length}`);
    for (const p of interesting) {
      console.log(`  claim=${p.claim_id} action=${p.action}`);
      console.log(`    before: ${JSON.stringify(p.before_order)}`);
      console.log(`    after:  ${JSON.stringify(p.after_order)}`);
    }
    // also show a couple kept samples
    const kept = (af.per_claim||[]).filter(p=>p.action==='kept').slice(0,2);
    for (const p of kept) {
      console.log(`  [kept] claim=${p.claim_id} order=${JSON.stringify(p.before_order)}`);
    }
  }
  console.log(`\n--- footnotes (${(r.footnotes||[]).length}) ---`);
  for (const [i,f] of (r.footnotes||[]).entries()) {
    const t = (f.formatted_citation || f.citation || f.text || '').slice(0,180);
    console.log(`  [${i+1}] ${t}`);
  }
}
