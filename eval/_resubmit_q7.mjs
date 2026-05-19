// Resubmit Q7 (deep) and capture new qa_log id.
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const ADMIN_EMAIL = "ofekgrinshpon@gmail.com";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: ADMIN_EMAIL });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const v = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
const jwt = v.data.session.access_token;

const evalRunId = `s3-Q7-${randomUUID().slice(0, 8)}`;
console.log(`evalRunId=${evalRunId}`);

// Fire and forget — don't await full response; just submit.
const ctl = new AbortController();
const t = setTimeout(() => ctl.abort(), 8000); // submit & detach
try {
  await fetch(`${SUPABASE_URL}/functions/v1/legal-qa`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: ANON_KEY },
    body: JSON.stringify({
      question: "מהי דוקטרינת מיצוי ההליכים במשפט המינהלי הישראלי ומתי בית המשפט יידחה עתירה בשל אי-מיצוי?",
      taskMode: "research", depth: "deep",
      evalRunId, requestId: `eval:${evalRunId}`,
    }),
    signal: ctl.signal,
  });
} catch (e) {
  console.log(`submit detach (expected): ${e.message}`);
}
clearTimeout(t);
console.log(`submitted at ${new Date().toISOString()} — eval_run_id=${evalRunId}`);
