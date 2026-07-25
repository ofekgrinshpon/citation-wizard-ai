// Drafter Prompt Compression (V2.1e) — candidate validation.
// Runs 7-question set (Q01, Q02, Q04, Q08, Q09, Q13, Q18) against the
// deployed pipeline and diffs against the Step 3b full-regression baseline
// in reports/quality-audit/runs-step3b-full/*.json.

import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("missing env"); process.exit(1); }

const IDS = ["Q01","Q02","Q04","Q08","Q09","Q13","Q18"];
const golden = JSON.parse(readFileSync("reports/quality-audit/golden-set.json","utf8")).questions
  .filter((q: any) => IDS.includes(q.id));

const OUT = "reports/quality-audit/runs-drafter-compression";
const ART = "/mnt/documents/quality-audit/runs-drafter-compression";
mkdirSync(OUT,{recursive:true}); mkdirSync(ART,{recursive:true});

async function trigger(q: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method:"POST",
    headers:{Authorization:`Bearer ${SR_KEY}`,"x-smoke-mode":"1","Content-Type":"application/json"},
    body: JSON.stringify({question:q, smoke_user_id: SMOKE_USER_ID}),
  });
  return await r.json().catch(()=>({}));
}
async function poll(run_id: string, timeoutMs=900_000) {
  const h={apikey:SR_KEY,Authorization:`Bearer ${SR_KEY}`};
  const dl=Date.now()+timeoutMs;
  while(Date.now()<dl){
    const r=await fetch(`${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,metadata,answer,footnotes&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`,{headers:h});
    if(r.ok){const rows=await r.json(); if(Array.isArray(rows)&&rows.length) return rows[0];}
    await new Promise(res=>setTimeout(res,5000));
  }
  return null;
}

console.log(`[compress] triggering ${golden.length} runs...`);
const triggered:any[] = [];
for (let i=0;i<golden.length;i+=3) {
  const batch=golden.slice(i,i+3);
  const out=await Promise.all(batch.map(async(g:any)=>{
    try { const t=await trigger(g.query); console.log(`[${g.id}] run=${t.run_id}`); return {g,run_id:t.run_id??null}; }
    catch(e){ console.error(`[${g.id}]`,e); return {g,run_id:null}; }
  }));
  triggered.push(...out);
  if (i+3<golden.length) await new Promise(r=>setTimeout(r,3000));
}

console.log(`[compress] polling...`);
const results = await Promise.all(triggered.map(async ({g,run_id}:any) => {
  const base:any = {id:g.id, category:g.category, query:g.query, run_id};
  if(!run_id) return {...base,error:"trigger_failed"};
  const row = await poll(run_id);
  if(!row) return {...base,error:"poll_timeout"};
  const md:any=row.metadata??{}; const d:any=md.drafter??{};
  const answer_intent=md?.planning?.analyzer?.answer_intent ?? null;
  const raw = {
    id:g.id, category:g.category, query:g.query, run_id,
    ok: d.ok===true,
    total_ms: md.total_ms??null,
    answer_intent,
    answer: row.answer??"",
    footnotes: row.footnotes??[],
    used_sources: d.used_sources??[],
    verifier_counts: md?.verifier?.counts??null,
    quality_warnings: d?.quality_warnings ?? md?.drafter?.quality_warnings ?? [],
    structured_report: d?.structured_report ?? null,
    missing_required_anchors: md?.retrieval?.missingRequiredAnchors ?? md?.missingRequiredAnchors ?? null,
  };
  writeFileSync(`${OUT}/${g.id}.json`, JSON.stringify(raw,null,2));
  writeFileSync(`${ART}/${g.id}.json`, JSON.stringify(raw,null,2));
  console.log(`[${g.id}] ok=${raw.ok} shape=${answer_intent?.output_shape??"-"} src=${raw.used_sources.length} warn=${(raw.quality_warnings??[]).length}`);
  return raw;
}));

// ---- Report ------------------------------------------------------------
function baseline(id: string) {
  const p = `reports/quality-audit/runs-step3b-full/${id}.json`;
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p,"utf8")); } catch { return null; }
}
function isStub(s:string){ return !s || /\[stub\]|התשובה תיווצר בשלב/.test(s); }
function fabricated(a:string, fn:any[], us:any[]) {
  const n=Math.max(fn?.length??0, us?.length??0);
  return Array.from(a.matchAll(/\[(\d+)\]/g)).map(m=>+m[1]).some(x=>x>n);
}
function refDensity(bl:any[]|null){
  if(!bl) return null;
  const withRefs=bl.filter((b:any)=>Array.isArray(b.source_refs)&&b.source_refs.length>0);
  const total=bl.filter((b:any)=>b.kind==="paragraph"||b.kind==="list_item").length;
  const sum=withRefs.reduce((s:number,b:any)=>s+b.source_refs.length,0);
  return { total, cited: withRefs.length, avg_refs: withRefs.length? +(sum/withRefs.length).toFixed(2):0, max_refs: Math.max(0,...withRefs.map((b:any)=>b.source_refs.length)) };
}
function fmtSources(list:any[]){ return !list?.length?"_(none)_":list.map((s:any,i:number)=>`${i+1}. **${s.title??"?"}** — ${s.source_type??"?"} — ${s.url??""}`).join("\n"); }
function fmtFn(list:any[]){ return !list?.length?"_(none)_":list.map((f:any,i:number)=>`[${f.index??i+1}] ${f.text??f.markdown??JSON.stringify(f)}`).join("\n\n"); }
function overclaim(a:string, missing:any){
  if(!Array.isArray(missing)||missing.length===0) return false;
  return /(נקבע כי|בית המשפט קבע|החוק בטל|התקבל(ה)? על ידי בית המשפט|המסקנה היא|מכאן נובע)/.test(a);
}

const rows: string[] = [
  "| Q | shape | ok B→A | src B→A | warnings B→A | stub | fabricated | overclaim | notes |",
  "|---|---|---|---:|---|---|---|---|---|",
];
const detail: string[] = [];

for (const r of results) {
  const b=baseline(r.id);
  const aAns=r.answer??""; const bAns=b?.answer??"";
  const stub=isStub(aAns);
  const fab=fabricated(aAns, r.footnotes??[], r.used_sources??[]);
  const oc=overclaim(aAns, r.missing_required_anchors);
  const warnA=r.quality_warnings?.length??0;
  const warnB=b?.quality_warnings?.length??"?";
  const okB=b?.ok??"?"; const okA=r.ok?"ok":"FAIL";
  const notes: string[]=[];
  if(stub) notes.push("STUB");
  if(fab) notes.push("FABRICATED");
  if(oc) notes.push("OVERCLAIM?");
  if(r.id==="Q02"){
    const ref=/אין במקורות שסופקו|לא ניתן לקבוע|לא הובא פסק הדין|יש להביא את פסק הדין|חסר.*(פסק הדין|עוגן)/.test(aAns);
    notes.push(ref?"Q02-refusal-preserved":"Q02-REFUSAL-LOST");
  }
  if(r.id==="Q18"){
    const q=/זכויות היסוד של האדם בישראל מושתתות על ההכרה בערך האדם/.test(aAns);
    notes.push(q?"Q18-quote-preserved":"Q18-QUOTE-LOST");
  }
  if(aAns.length>0 && !/[\u0590-\u05FF]/.test(aAns)) notes.push("no-hebrew");
  if(aAns.length>0 && aAns.length<400) notes.push("short");
  rows.push(`| ${r.id} | ${r.answer_intent?.output_shape??"-"} | ${okB}→${okA} | ${(b?.used_sources?.length??"?")}→${r.used_sources?.length??0} | ${warnB}→${warnA} | ${stub?"YES":"no"} | ${fab?"YES":"no"} | ${oc?"MAYBE":"no"} | ${notes.join(", ")||"-"} |`);

  const densB=refDensity(b?.structured_report?.blocks ?? null);
  const densA=refDensity(r.structured_report?.blocks ?? null);
  detail.push(`---\n\n## ${r.id}\n\n**Query:**\n\n> ${r.query}\n`);
  detail.push(`- shape: \`${r.answer_intent?.output_shape??"-"}\``);
  detail.push(`- used_sources: BEFORE ${b?.used_sources?.length??"?"} → AFTER ${r.used_sources?.length??0}`);
  detail.push(`- quality_warnings AFTER: ${JSON.stringify(r.quality_warnings??[])}`);
  detail.push(`- missing_required_anchors: ${JSON.stringify(r.missing_required_anchors)}`);
  detail.push(`- ref-density BEFORE: ${JSON.stringify(densB)}`);
  detail.push(`- ref-density AFTER:  ${JSON.stringify(densA)}\n`);
  detail.push(`### Answer BEFORE\n\n<details><summary>show</summary>\n\n${bAns||"_(missing)_"}\n\n</details>\n`);
  detail.push(`### Answer AFTER\n\n<details><summary>show</summary>\n\n${aAns||"_(empty)_"}\n\n</details>\n`);
  detail.push(`### Footnotes AFTER\n\n<details><summary>show</summary>\n\n${fmtFn(r.footnotes??[])}\n\n</details>\n`);
  detail.push(`### used_sources AFTER (${r.used_sources?.length??0})\n\n<details><summary>show</summary>\n\n${fmtSources(r.used_sources??[])}\n\n</details>\n`);
}

const md = [
  `# Drafter Prompt Compression (V2.1e) — candidate validation`,
  ``,
  `Generated: ${new Date().toISOString()}`,
  ``,
  `Baseline: \`reports/quality-audit/runs-step3b-full/*.json\` (Step 3b post-approval baseline).`,
  ``,
  `## Summary`,
  ``,
  ...rows,
  ``,
  ...detail,
].join("\n");
writeFileSync("reports/quality-audit/drafter-compression-validation.md", md);
writeFileSync("/mnt/documents/quality-audit/drafter-compression-validation.md", md);
console.log(`[compress] wrote reports/quality-audit/drafter-compression-validation.md (${md.length}b)`);
