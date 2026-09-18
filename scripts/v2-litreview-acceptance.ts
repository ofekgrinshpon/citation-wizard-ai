/**
 * ReLex V2 — Literature Review Acceptance launcher.
 *
 * Launches exactly ONE prompt per invocation against the deployed
 * legal-research-v2 internal entry point in background mode. Read-only with
 * respect to product code; results are read from v2_eval_runs by label.
 *
 * Usage: bun scripts/v2-litreview-acceptance.ts L1
 */

export const PROMPTS: Record<string, string> = {
  L1:
    "תעשה לי סקירת ספרות על עילת הסבירות במשפט הישראלי. אני רוצה להבין את הגישות המרכזיות, את המחלוקות ואת האופן שבו הדיון השתנה לאורך השנים.",
  L2:
    "אני מנסה להבין על מה החוקרים חלוקים ביחס להבטחה מנהלית ולציפייה לגיטימית, ואילו גישות מרכזיות קיימות בנושא.",
  L3:
    "למה במשפט הישראלי משתמשים גם בסבירות וגם במידתיות, ואיך היחסים ביניהן השתנו לאורך השנים?",
  L4:
    "איך השתנתה תפיסת חובת תום הלב בדיני החוזים בישראל מאז שנות התשעים, ומהן הגישות המרכזיות בספרות כיום?",
  L5:
    "אני כותב עבודה על בעיית הנציג בחברות. תעשה לי סקירה של הגישות המרכזיות בספרות לגבי הדרכים שבהן דיני החברות מנסים להתמודד עם ניגודי עניינים של בעלי שליטה.",
  L6:
    "אני רוצה להבין את הוויכוח האקדמי בישראל סביב ביקורת שיפוטית על חוקי יסוד. תעשה לי מיפוי של הגישות המרכזיות ומה עומד מאחוריהן.",
  L7:
    "תעשה לי סקירת ספרות על זכויות יוצרים בקעקועים שמופיעים במשחקי וידאו, כולל הגישות המרכזיות והמחלוקות שעולות מהספרות.",
  L8:
    "איך הספרות המשפטית בישראל ובאנגליה מתייחסת להבטחה מנהלית ולציפייה לגיטימית, ומה ההבדלים המרכזיים בגישות?",
  N1: "מה קובע סעיף 12 לחוק החוזים (חלק כללי)?",
  N2: 'מה נקבע ברע"א 3365/20?',
};

if (import.meta.main) {
  const BASE = process.env.SUPABASE_URL as string;
  const ANON = (process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY) as string;
  const TOKEN = process.env.V2_EVAL_TOKEN_D as string;
  const id = process.argv[2];
  if (!PROMPTS[id]) throw new Error(`unknown prompt ${id}`);
  const label = `litrev-${id}-${Date.now()}`;
  const r = await fetch(`${BASE}/functions/v1/legal-research-v2`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ANON}`,
      apikey: ANON,
      "x-smoke-mode": "1",
      "x-smoke-token": TOKEN,
    },
    body: JSON.stringify({ question: PROMPTS[id], background: true, label }),
  });
  console.log(id, "launch", r.status, (await r.text()).slice(0, 300));
  console.log("label", label);
}
