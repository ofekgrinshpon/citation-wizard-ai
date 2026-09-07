import { mkdirSync, writeFileSync } from "node:fs";
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
const Q = `בסוגייה של חלוקת רכוש לאחר גירושי בני זוג, מה היא אמת המידה לביקורת שיפוטית של בג״ץ כאשר יש חשד שבית הדין הרבני הסתמך על שיקול חיצוני לדין האזרחי?`;
const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
  method: "POST",
  headers: { Authorization: `Bearer ${SR_KEY}`, "x-smoke-mode": "1", "Content-Type": "application/json" },
  body: JSON.stringify({ question: Q, smoke_user_id: SMOKE_USER_ID }),
});
const t = await r.json() as any;
console.log("run_id", t.run_id);
const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
const deadline = Date.now() + 900_000;
let row: any = null;
while (Date.now() < deadline) {
  const q = await fetch(`${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,metadata,answer,footnotes&metadata->>run_id=eq.${t.run_id}&order=created_at.desc&limit=1`, { headers });
  if (q.ok) { const rows = await q.json(); if (Array.isArray(rows) && rows.length) { row = rows[0]; break; } }
  await new Promise((x) => setTimeout(x, 5000));
}
mkdirSync("reports/web-judgment-source-classification-v1", { recursive: true });
writeFileSync("reports/web-judgment-source-classification-v1/run.json", JSON.stringify({ run_id: t.run_id, row }, null, 2));
console.log("done", !!row);
