// citation-refill: Given an existing citation that has [חסר: ...] placeholders
// or visibly missing fields, ask Perplexity (sonar-pro) to find ONLY the
// missing fields and return a single corrected citation string. Used by the
// Citation Review panel in Legal QA after the answer renders.
//
// JWT-protected. One call = one Perplexity request; no DB writes.
//
// HARDENING (Bug fix — refill must not invent parties):
//  1. Strip trailing `(<host>)` debug suffix from the input before sending
//     so the model doesn't treat a domain name as bibliographic content.
//  2. When the input is "docket-only" (a case number with no `נ'` and no
//     party-shaped Hebrew text), switch to a strict docket-lookup prompt
//     that forbids inventing parties and requires the cited URL to contain
//     the exact docket number.
//  3. Server-side verification: at least one URL in `citations[]` must
//     literally contain the docket (handles `/`, `-`, `%2F`). If not,
//     the model's output is discarded and the sanitized input is returned
//     with `verified: false` + a Hebrew note.
//  4. For non-docket inputs: if the model's response changed the docket
//     number, reject it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_DOMAINS = [
  "supremedecisions.court.gov.il",
  "court.gov.il",
  "nevo.co.il",
  "takdin.co.il",
  "lite.takdin.co.il",
  "psakdin.co.il",
  "din.org.il",
  "knesset.gov.il",
  "reshumot.gov.il",
  "gov.il",
  "mishpatim.tau.ac.il",
];

// Accept ASCII " and Hebrew ״ ׳ between the prefix letters.
const DOCKET_RE = /([א-ת]{1,4}(?:["״׳']?[א-ת]?)?)\s*(\d{1,6})\s*[\/\-\u2013]\s*(\d{2,4})/;
const PARTY_RE = /\sנ['׳]\s/;

interface RefillBody {
  current_citation: string;
  source_type?: string;
  missing_fields?: string[];
  raw_hint?: string;
}

function stripHostSuffix(s: string): string {
  // Drop a trailing ` (host.tld[/...])` that the old passthrough used to inject.
  return s.replace(/\s*\(\s*(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^)]*)?\s*\)\s*$/i, "").trim();
}

function extractDocket(s: string): { full: string; num: string; year: string } | null {
  const m = s.match(DOCKET_RE);
  if (!m) return null;
  return { full: `${m[2]}/${m[3]}`, num: m[2], year: m[3] };
}

function urlContainsDocket(url: string, docket: { num: string; year: string }): boolean {
  if (!url) return false;
  const u = decodeURIComponent(url).toLowerCase();
  const patterns = [
    `${docket.num}/${docket.year}`,
    `${docket.num}-${docket.year}`,
    `${docket.num}_${docket.year}`,
    `${docket.num}%2f${docket.year}`,
  ];
  return patterns.some((p) => u.includes(p));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Auth ────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return json({ error: "missing_authorization" }, 401);
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const sb = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "unauthorized" }, 401);
    }

    // ── Input ───────────────────────────────────────────────────────────
    let body: RefillBody;
    try {
      body = (await req.json()) as RefillBody;
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    const rawCurrent = (body.current_citation ?? "").trim();
    if (!rawCurrent || rawCurrent.length > 2000) {
      return json({ error: "invalid_current_citation" }, 400);
    }
    const current = stripHostSuffix(rawCurrent);
    const sourceType = (body.source_type ?? "").trim().slice(0, 64);
    const missing = Array.isArray(body.missing_fields)
      ? body.missing_fields.filter((s) => typeof s === "string").slice(0, 8)
      : [];
    const rawHint = (body.raw_hint ?? "").trim().slice(0, 500);

    const inputDocket = extractDocket(current);
    const hasParties = PARTY_RE.test(current);
    const docketOnly = !!inputDocket && !hasParties;

    // ── Perplexity call ────────────────────────────────────────────────
    const pplxKey = Deno.env.get("PERPLEXITY_API_KEY");
    if (!pplxKey) {
      return json({ error: "perplexity_not_configured" }, 500);
    }

    const missingHebrew = missing.length
      ? missing.join(", ")
      : "כל שדה ביבליוגרפי חסר (שנה, כרך, עמוד פתיחה, פרטי פרסום רשמיים)";

    const baseSystem =
      "אתה עוזר מחקר משפטי ישראלי. עליך להחזיר אך ורק את הציטוט המתוקן בשורה אחת, " +
      "בהתאם לכללי האזכור האחיד (2021). אל תוסיף הסברים, אל תשתמש ב-Markdown, " +
      "אל תוסיף מרכאות עוטפות. אם לא ניתן למצוא שדה מסוים, השאר עבורו [חסר: <שם השדה>] " +
      "ואל תמציא נתונים.";

    const docketSystem = baseSystem +
      "\n\n*** כללי בטיחות חמורים — חיפוש לפי מספר תיק ***\n" +
      `1. מספר התיק בקלט הוא בדיוק: ${inputDocket?.full ?? ""}. אל תחליף אותו.\n` +
      "2. מצא את התיק לפי מספר תיק מדויק בלבד. אסור להמציא שמות צדדים.\n" +
      "3. אם לא מצאת את התיק עם בדיוק אותו מספר — החזר את הקלט כפי שהוא, " +
      "ללא הוספת שמות צדדים. השאר [חסר: שמות צדדים].\n" +
      "4. ה-URL שתחזיר חייב להכיל את מספר התיק עצמו. אחרת — אל תחזיר שמות צדדים.\n" +
      "5. אל תחליף תיק אחד באחר רק מפני שהמספר \"דומה\".";

    const systemPrompt = docketOnly ? docketSystem : baseSystem;

    const userPrompt = [
      `סוג מקור: ${sourceType || "לא ידוע"}`,
      rawHint ? `קלט מקורי של המשתמש: ${rawHint}` : "",
      docketOnly
        ? `הציטוט הנוכחי מכיל רק מספר תיק (${inputDocket?.full}). מצא את הצדדים, השנה ופרטי הפרסום של בדיוק התיק הזה.`
        : `הציטוט הנוכחי (חסרים בו: ${missingHebrew}):`,
      current,
      "",
      "החזר אך ורק את הציטוט המתוקן בשורה אחת, מלא ככל האפשר על פי כללי האזכור האחיד.",
    ].filter(Boolean).join("\n");

    const pplxRes = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pplxKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 400,
        search_domain_filter: ALLOWED_DOMAINS,
      }),
    });

    if (!pplxRes.ok) {
      const txt = await pplxRes.text().catch(() => "");
      return json({ error: "perplexity_failed", status: pplxRes.status, detail: txt.slice(0, 300) }, 502);
    }
    const pplxJson = await pplxRes.json();
    const raw: string = pplxJson?.choices?.[0]?.message?.content ?? "";
    const citations: string[] = Array.isArray(pplxJson?.citations) ? pplxJson.citations : [];

    // Clean: strip leading list markers, code fences, surrounding quotes,
    // collapse whitespace, take first non-empty line.
    const cleaned = raw
      .replace(/^```[\w]*\n?|\n?```$/g, "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)[0] ?? "";
    let final = cleaned
      .replace(/^["'״׳`]+|["'״׳`]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    // Also strip any host suffix the model parroted back.
    final = stripHostSuffix(final);

    if (!final) {
      return json({ error: "empty_response", raw }, 502);
    }

    // ── Verification ────────────────────────────────────────────────────
    let verified = true;
    let verifyNote: string | undefined;

    if (inputDocket) {
      const outDocket = extractDocket(final);
      // Reject if docket disappeared or was silently changed.
      if (!outDocket || outDocket.full !== inputDocket.full) {
        verified = false;
        verifyNote = "המודל שינה את מספר התיק — נדחה.";
      } else if (docketOnly) {
        // Output now claims parties; require an anchoring URL.
        const outHasParties = PARTY_RE.test(final);
        const anchored = citations.some((u) => urlContainsDocket(u, inputDocket));
        if (outHasParties && !anchored) {
          verified = false;
          verifyNote =
            "לא נמצא URL מאמת המכיל את מספר התיק — שמות הצדדים לא אומתו.";
        }
      }
    }

    if (!verified) {
      // Return the sanitized input unchanged so the UI can show a warning.
      return json({
        ok: true,
        updated_citation: current,
        filled_count: 0,
        still_missing: (current.match(/\[חסר:\s*[^\]]+\]/g) ?? []).length,
        sources: citations.slice(0, 5),
        verified: false,
        warning: verifyNote ?? "לא ניתן לאמת — הקלט הוחזר ללא שינוי.",
        rejected_model_output: final,
      }, 200);
    }

    // Which placeholders did we resolve?
    const originalMissing = (current.match(/\[חסר:\s*[^\]]+\]/g) ?? []).length;
    const remainingMissing = (final.match(/\[חסר:\s*[^\]]+\]/g) ?? []).length;
    const filled_count = Math.max(0, originalMissing - remainingMissing);

    return json({
      ok: true,
      updated_citation: final,
      filled_count,
      still_missing: remainingMissing,
      sources: citations.slice(0, 5),
      verified: true,
    }, 200);
  } catch (err) {
    return json({ error: "exception", message: (err as Error).message }, 500);
  }
});

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
