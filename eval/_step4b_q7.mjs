import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
const URL=process.env.SUPABASE_URL, SR=process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON=process.env.SUPABASE_ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY;
const EMAIL="ofekgrinshpon@gmail.com", UID="c6b2fdbf-a50c-411f-9941-41f9dff80eba";
const admin=createClient(URL,SR,{auth:{persistSession:false}});
const {data:link}=await admin.auth.admin.generateLink({type:"magiclink",email:EMAIL});
const anon=createClient(URL,ANON,{auth:{persistSession:false}});
const v=await anon.auth.verifyOtp({token_hash:link.properties.hashed_token,type:"magiclink"});
const jwt=v.data.session.access_token;
const evalRunId=`step4b-Q7-${randomUUID().slice(0,8)}`;
console.log("eval_run_id=",evalRunId);
const t0=Date.now();
const r=await fetch(`${URL}/functions/v1/legal-qa`,{method:"POST",
  headers:{"Content-Type":"application/json",Authorization:`Bearer ${jwt}`,apikey:ANON},
  body:JSON.stringify({question:"מהי דוקטרינת מיצוי ההליכים במשפט המינהלי הישראלי ומתי בית המשפט יידחה עתירה בשל אי-מיצוי?",taskMode:"research",depth:"deep",evalRunId,requestId:`eval:${evalRunId}`})});
// drain SSE to keep connection alive until completion
const reader=r.body.getReader();let bytes=0;
while(true){const{done,value}=await reader.read();if(done)break;bytes+=value.length;}
console.log(`stream done http=${r.status} bytes=${bytes} wall=${Date.now()-t0}ms`);
let row=null;
for(let i=0;i<40;i++){
  await new Promise(rr=>setTimeout(rr,3000));
  const{data}=await admin.from("qa_logs").select("id,footnotes,metadata,answer,created_at")
    .eq("user_id",UID).filter("metadata->>eval_run_id","eq",evalRunId)
    .order("created_at",{ascending:false}).limit(1);
  if(data?.[0]?.metadata?.v3_path){row=data[0];break;}
}
if(!row){console.log("NO ROW WITH v3_path");process.exit(1);}
const md=row.metadata||{}, mat=md.v3_anchor_materialization||{};
const target=(mat.per_anchor||[]).find(p=>/בתי\s*משפט\s*לענ/.test(p.name||""));
const cited=(mat.per_anchor||[]).filter(p=>p.cited_after_step3>0);
const out={
  v3_path: md.v3_path,
  v1_fallback: !!md.v1_fallback || md.drafting_path==="v1_legacy",
  totals: mat.totals,
  target_anchor: target ? {
    name: target.name, type: target.type,
    local_exact_found: target.local_exact_found,
    matched_by: target.exact_lookup_detail?.matched_by,
    lookup_queries_attempted: target.exact_lookup_detail?.lookup_queries_attempted,
    local_confidence: target.local_confidence ?? target.exact_lookup_detail?.confidence,
    perplexity_called: target.perplexity_called,
    candidates_added_to_pack: target.candidates_added_to_pack,
    verified_direct: target.verified_direct,
    verified_partial: target.verified_partial,
    rejected: target.rejected,
    cited_after_step3: target.cited_after_step3,
    outcome: target.outcome,
  } : "NOT_FOUND_IN_PLAN",
  cited_anchors_with_counters: cited.map(p=>({name:p.name,vd:p.verified_direct,vp:p.verified_partial,rj:p.rejected,cited:p.cited_after_step3})),
  all_per_anchor_brief: (mat.per_anchor||[]).map(p=>({name:p.name.slice(0,50),type:p.type,found:p.local_exact_found,matched_by:p.exact_lookup_detail?.matched_by,ppl:p.perplexity_called,vd:p.verified_direct,vp:p.verified_partial,cited:p.cited_after_step3,outcome:p.outcome})),
  missing_expected_anchors: mat.missing_expected_anchors,
  footnotes_count: (row.footnotes||[]).length,
  footnotes: (row.footnotes||[]).map(f=>(typeof f==="string"?f:f.text||f.citation||JSON.stringify(f)).slice(0,260)),
};
console.log(JSON.stringify(out,null,2));
