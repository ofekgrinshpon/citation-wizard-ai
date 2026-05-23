import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ADMIN_EMAIL = "ofekgrinshpon@gmail.com";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: ADMIN_EMAIL });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const v = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
const jwt = v.data.session.access_token;

const QS = [
  "האם כישלון מערכתי באכיפת עבירת גביית דמי חסות (פרוטקשן) יכולה להוות מחדל חקיקתי חלקי בהגנה על הזכות לחיים וביטחון?",
  "מהם התנאים למתן צו מניעה זמני?",
  "מהי חובת תום הלב במשא ומתן לפי סעיף 12 לחוק החוזים, ומתי ניתן לפסוק פיצויי קיום?",
  "כיצד מפרשים חוזה לאחר הלכת אפרופים ותיקון סעיף 25 לחוק החוזים?",
  "מהי דוקטרינת הבטלות היחסית במשפט המנהלי?",
  "מהי חובת השימוע של רשות מנהלית לפני החלטה הפוגעת באדם?",
  "מהי עילת הסבירות ומה היקף הביקורת השיפוטית עליה?",
  "מהי דרישת מיצוי ההליכים והסעד החלופי בעתירה לבג\"ץ?",
];

async function submitOne(i, q, evalRunId, retry = false) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 120000);
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: ANON_KEY },
      body: JSON.stringify({ question: q, taskMode: "research", depth: "deep", evalRunId, requestId: `eval:${evalRunId}` }),
      signal: ctrl.signal,
    });
    const text = await r.text();
    console.log(`[${i}] status=${r.status} body=${text.slice(0, 400)}`);
    if (!r.ok && !retry) {
      console.log(`[${i}] retrying once...`);
      await new Promise(r => setTimeout(r, 2000));
      return submitOne(i, q, evalRunId, true);
    }
    return { ok: r.ok, status: r.status, body: text };
  } catch (e) {
    console.log(`[${i}] ERR ${e.message}`);
    if (!retry) {
      await new Promise(r => setTimeout(r, 2000));
      return submitOne(i, q, evalRunId, true);
    }
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(to);
  }
}

const runs = [];
for (let i = 0; i < QS.length; i++) {
  const evalRunId = `qual8-${i + 1}-${randomUUID().slice(0, 6)}`;
  console.log(`\n[${i + 1}/${QS.length}] submitting: ${QS[i].slice(0, 60)}...  eid=${evalRunId}`);
  const res = await submitOne(i + 1, QS[i], evalRunId);
  runs.push({ idx: i + 1, q: QS[i], evalRunId, res });
  await new Promise(r => setTimeout(r, 1000));
}

console.log("\n\nSUBMITTED:");
console.log(JSON.stringify(runs.map(r => ({ idx: r.idx, evalRunId: r.evalRunId, ok: r.res?.ok, status: r.res?.status })), null, 2));

// Poll for rows
console.log("\nPolling qa_logs for qual8-% rows...");
const start = Date.now();
while (Date.now() - start < 60000) {
  const { count } = await admin.from("qa_logs").select("id", { count: "exact", head: true }).like("metadata->>eval_run_id", "qual8-%").gte("created_at", new Date(start - 5 * 60000).toISOString());
  console.log(`t=${Math.round((Date.now() - start) / 1000)}s rows_with_qual8_eid=${count}`);
  if ((count ?? 0) >= QS.length) break;
  await new Promise(r => setTimeout(r, 5000));
}

console.log("\nEIDs for poller:");
console.log(runs.map(r => `["${r.evalRunId}", ${r.idx}]`).join(", "));
