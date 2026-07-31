// C2 case-law synthesis diagnostic (read-only).
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const QUERY = `מה הפסיקה אומרת על הלכת השיתוף?`;
const OUT = "reports/c2-synthesis-diagnostic";
mkdirSync(OUT, { recursive: true });

const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
  method: "POST",
  headers: { Authorization: `Bearer ${SR_KEY}`, "x-smoke-mode": "1", "Content-Type": "application/json" },
  body: JSON.stringify({ question: QUERY, smoke_user_id: SMOKE_USER_ID }),
});
const { run_id } = (await r.json()) as { run_id?: string };
console.log("run_id", run_id);
if (!run_id) process.exit(1);

const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
let row: any = null;
const deadline = Date.now() + 900_000;
while (Date.now() < deadline) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/qa_logs?select=id,metadata,answer,created_at&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`, { headers });
  if (res.ok) { const rows = await res.json(); if (Array.isArray(rows) && rows.length) { row = rows[0]; break; } }
  await new Promise((s) => setTimeout(s, 5000));
}
if (!row) { console.error("timeout"); process.exit(1); }
writeFileSync(`${OUT}/C2-raw.json`, JSON.stringify(row, null, 2));
const md = row.metadata ?? {};
console.log("metadata top keys:", Object.keys(md));
console.log("drafter keys:", Object.keys(md.drafter ?? {}));
console.log("answer_len", (row.answer ?? "").length);
