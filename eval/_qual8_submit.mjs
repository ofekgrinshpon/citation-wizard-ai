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

const runs = [];
for (let i = 0; i < QS.length; i++) {
  const q = QS[i];
  const evalRunId = `qual8-${i+1}-${randomUUID().slice(0,6)}`;
  console.log(`[${i+1}] submitting: ${q.slice(0,60)}...`);
  // fire and don't wait for body
  fetch(`${SUPABASE_URL}/functions/v1/legal-qa`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: ANON_KEY },
    body: JSON.stringify({ question: q, taskMode: "research", depth: "deep", evalRunId, requestId: `eval:${evalRunId}` }),
  }).then(r=>r.text()).catch(e=>console.log(`  fire err ${i+1}: ${e.message}`));
  runs.push({ idx: i+1, q, evalRunId });
  await new Promise(r=>setTimeout(r, 1500));
}
console.log("\nSUBMITTED:");
console.log(JSON.stringify(runs, null, 2));
