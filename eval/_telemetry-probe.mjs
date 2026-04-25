import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const ADMIN_EMAIL = "ofekgrinshpon@gmail.com";
const ADMIN_USER_ID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: ADMIN_EMAIL });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const v = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
const jwt = v.data.session.access_token;
const evalRunId = `telemetry-probe-${randomUUID().slice(0,8)}`;
const Q2_OUTLINE = `**מבוא**
- שאלת המחקר: מה קובע סעיף 17 לחוק שירות המדינה (מינויים)?
- התזה המרכזית: סעיף 17 מקנה לוועדת השירות סמכות מהותית.
**רשימת הפרקים**
1. **לשונו של סעיף 17** – הדין המצוי
   - הרחבה: ניתוח לשוני וההיסטוריה החקיקתית.
   - טיעוני נגד אפשריים: ...`;
const start = Date.now();
const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-qa`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: ANON_KEY },
  body: JSON.stringify({
    question: "מה קובע סעיף 17 לחוק שירות המדינה (מינויים)?",
    taskMode: "academic_writing", academicStep: "write_chapter",
    researchQuestion: "מה קובע סעיף 17 לחוק שירות המדינה (מינויים)?",
    outline: Q2_OUTLINE, chapterTitle: "לשונו של סעיף 17", chapterIndex: 1,
    previousChapters: [], isAbstract: false,
    evalRunId, requestId: `eval:${evalRunId}`,
  }),
});
console.log("status", r.status, "wall", Date.now()-start, "ms");
const json = await r.json();
console.log("answer_words", (json.answer||"").split(/\s+/).filter(Boolean).length, "fn", (json.footnotes||[]).length);
// Wait + fetch row
await new Promise(r => setTimeout(r, 2000));
const { data } = await admin.from("qa_logs")
  .select("id, metadata")
  .eq("user_id", ADMIN_USER_ID)
  .filter("metadata->>eval_run_id", "eq", evalRunId)
  .order("created_at", { ascending: false }).limit(1);
const row = data?.[0];
if (!row) { console.log("NO ROW"); process.exit(0); }
const md = row.metadata || {};
console.log("\n--- metadata keys ---");
console.log(Object.keys(md).filter(k => k.startsWith("chapter_") || k.startsWith("profile_") || k === "drafting_path").sort());
console.log("\nprofile_used_academic:", JSON.stringify(md.profile_used_academic, null, 2));
console.log("chapter_qa_guard:", JSON.stringify(md.chapter_qa_guard, null, 2));
console.log("chapter_engine:", JSON.stringify(md.chapter_engine, null, 2));
