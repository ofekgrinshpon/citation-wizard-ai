import { readFileSync, writeFileSync, readdirSync } from "fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const dir = "reports/secondary-web-body";
const files = readdirSync(dir).filter(f => f.endsWith(".json") && f !== "_all.json");
const runs = files.map(f => ({ ...JSON.parse(readFileSync(`${dir}/${f}`, "utf8")), file: f }));

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function getLog(runId: string, launchIso: string) {
  for (let i = 0; i < 60; i++) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,metadata,answer,footnotes` +
      `&metadata->>run_id=eq.${runId}&created_at=gte.${launchIso}&order=created_at.desc&limit=1`,
      { headers: { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` } });
    const rows = await r.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    const body = String(row?.answer ?? "").trim();
    if (row && body.length > 40 && !/placeholder|STUB/i.test(body)) return row;
    await sleep(4000);
  }
  return null;
}

let out = `# secondary_web_body_acquisition_v1 — Full Answers Export\n\nGenerated: ${new Date().toISOString()}\n\n`;
for (const run of runs) {
  const row = await getLog(run.run_id, new Date(Date.now() - 6 * 3600e3).toISOString());
  out += `\n---\n\n## ${run.id}\n\n**Question:** ${run.question}\n\n**Mode:** ${run.depth_mode} · **run_id:** ${run.run_id}\n\n`;
  if (!row) { out += `*(no answer row found)*\n`; continue; }
  out += `### Answer\n\n${String(row.answer).trim()}\n`;
  const fn = row.footnotes;
  if (fn && String(fn).trim()) out += `\n### Footnotes\n\n${typeof fn === "string" ? fn : JSON.stringify(fn, null, 2)}\n`;
  console.log(run.id, "ok", String(row.answer).length);
}
writeFileSync("/mnt/documents/secondary-web-answers.md", out);
console.log("written /mnt/documents/secondary-web-answers.md", out.length);
