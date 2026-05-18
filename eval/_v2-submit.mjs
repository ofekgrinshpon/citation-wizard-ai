// Submit ONE Deep V2 query, return run_id + eval_run_id, confirm qa_logs row exists.
// Usage: ID=Q2 node eval/_v2-submit.mjs
// Prints: SUBMIT_OK <run_id> <eval_run_id>
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const ADMIN_EMAIL = "ofekgrinshpon@gmail.com";
const ADMIN_USER_ID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";

const ALL = {
  Q1: "מהם התנאים למתן צו מניעה זמני?",
  Q2: "דוקטרינת הסיכול בדיני חוזים — תנאים ויישום",
  Q3: "מבחנים לפסילת חוק בלתי חוקתי",
  Q4: "מחדל חקיקתי ודמי חסות — חובת המחוקק לפעול",
  Q5: "הלכת אפרופים ותיקון 2 לחוק החוזים — פרשנות חוזה",
  Q6: "פסקת ההגבלה וזכויות חוקתיות בחוקי היסוד",
  Q7: 'מהי דרישת מיצוי הליכים בעתירה לבג"ץ?',
};
const id = process.env.ID;
const q = ALL[id];
if (!q) { console.error(`Unknown ID=${id}`); process.exit(1); }

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: ADMIN_EMAIL });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const v = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
const jwt = v.data.session.access_token;

const evalRunId = `v2one-${id}-${randomUUID().slice(0, 6)}`;
console.log(`══════════ SUBMIT ${id}: ${q}`);
console.log(`eval_run_id=${evalRunId}`);

const t0 = Date.now();
const ctrl = new AbortController();
const watchdog = setTimeout(() => ctrl.abort(), 90_000); // ample for 202 ack
let runId = null;
try {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/legal-qa`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: ANON_KEY },
    body: JSON.stringify({ question: q, taskMode: "research", depth: "deep", evalRunId, requestId: `eval:${evalRunId}` }),
    signal: ctrl.signal,
  });
  clearTimeout(watchdog);
  const text = await resp.text();
  let json = {};
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  runId = json.run_id || json.runId || null;
  console.log(`submit_wall=${Date.now() - t0}ms status=${resp.status} run_id=${runId || "(none in body)"}`);
  if (!runId && text) console.log(`body_head=${text.slice(0, 200)}`);
} catch (e) {
  clearTimeout(watchdog);
  console.log(`submit_aborted_or_error=${e.message} wall=${Date.now() - t0}ms (row may still be created)`);
}

// Confirm row exists (poll up to 30s).
let row = null;
for (let k = 0; k < 15; k++) {
  await new Promise((r) => setTimeout(r, 2000));
  const { data } = await admin.from("qa_logs")
    .select("id, metadata->>checkpoint as cp, metadata->>v2_path as v2p, created_at")
    .eq("user_id", ADMIN_USER_ID)
    .filter("metadata->>eval_run_id", "eq", evalRunId)
    .order("created_at", { ascending: false }).limit(1);
  if (data?.[0]) { row = data[0]; break; }
}
if (!row) {
  console.log(`⚠ NO qa_logs row appeared within 30s for eval_run_id=${evalRunId}`);
  process.exit(2);
}
console.log(`row_id=${row.id} checkpoint=${row.cp || "(none)"} v2_path=${row.v2p || "(none)"}`);
console.log(`SUBMIT_OK ${row.id} ${evalRunId}`);
