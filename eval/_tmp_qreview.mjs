import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ids = ['c202919d-daab-466d-b7ca-1aad8a40e713','833a1e03-1610-4475-b0d4-2c9fdf92a7f8','5302381a-740e-4c43-84f1-a13efb114180','cc84394e-a198-4157-8c1c-b645e7bc56ee'];
const { data } = await admin.from('qa_logs').select('id, question, answer, footnotes, metadata').in('id', ids);
for (const r of data) {
  const md = r.metadata||{}; const v3 = md.v3_legal_research_plan||{};
  console.log('\n\n======================================================');
  console.log('ID:', r.id);
  console.log('QUESTION:', r.question);
  console.log('FRAME:', v3.doctrinal_frame, '| v3_path:', md.v3_path);
  console.log('ANCHORS:', JSON.stringify((v3.anchors||[]).map(a=>({name:a.name,docket:a.docket,section:a.section,type:a.type})),null,1));
  console.log('--- ANSWER ---');
  console.log(r.answer||'(empty)');
  console.log('--- FOOTNOTES ('+(r.footnotes||[]).length+') ---');
  (r.footnotes||[]).forEach((f,i)=>console.log(`[${i+1}] ${typeof f==='string'?f:(f.text||f.citation||JSON.stringify(f))}`));
}
