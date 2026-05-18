import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ids = ['c202919d-daab-466d-b7ca-1aad8a40e713','833a1e03-1610-4475-b0d4-2c9fdf92a7f8','5302381a-740e-4c43-84f1-a13efb114180','cc84394e-a198-4157-8c1c-b645e7bc56ee'];
for (let i = 0; i < 120; i++) {
  const { data } = await admin.from('qa_logs').select('id, metadata, footnotes, answer').in('id', ids);
  const done = data.filter(r => r.answer !== null || r.metadata?.v3_legal_research_plan).length;
  console.log(`t=${i*5}s done=${done}/4`);
  if (done === 4) break;
  await new Promise(r => setTimeout(r, 5000));
}
const { data } = await admin.from('qa_logs').select('id, metadata, footnotes, answer').in('id', ids);
for (const r of data) {
  const md = r.metadata || {};
  const v3 = md.v3_legal_research_plan || {};
  console.log(`\n=== ${r.id} ===`);
  console.log(`v3_path=${md.v3_path} v1_fb=${!!md.v1_fallback} drafting_path=${md.drafting_path}`);
  console.log(`doctrinal_frame=${v3.doctrinal_frame} anchors=${(v3.anchors||[]).length} dropped=${(v3.frame_mismatch_dropped||[]).length} kept_w_reason=${v3.constitutional_anchors_kept_with_reason}`);
  console.log(`footnotes=${(r.footnotes||[]).length}`);
  console.log('anchors:', JSON.stringify((v3.anchors||[]).map(a=>({id:a.id,type:a.type,name:a.name,docket:a.docket,section:a.section,crr:a.constitutional_relevance_reason})), null, 2));
  console.log('dropped:', JSON.stringify(v3.frame_mismatch_dropped||[], null, 2));
}
