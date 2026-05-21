// citation-refill: Given an existing citation that has [חסר: ...] placeholders
// or visibly missing fields, ask Perplexity (sonar-pro) to find ONLY the
// missing fields and return a single corrected citation string. Used by the
// Citation Review panel in Legal QA after the answer renders.
//
// JWT-protected. One call = one Perplexity request; no DB writes.

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

interface RefillBody {
  current_citation: string;
  source_type?: string;
  missing_fields?: string[];
  raw_hint?: string;
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
    const current = (body.current_citation ?? "").trim();
    if (!current || current.length > 2000) {
      return json({ error: "invalid_current_citation" }, 400);
    }
    const sourceType = (body.source_type ?? "").trim().slice(0, 64);
    const missing = Array.isArray(body.missing_fields)
      ? body.missing_fields.filter((s) => typeof s === "string").slice(0, 8)
      : [];
    const rawHint = (body.raw_hint ?? "").trim().slice(0, 500);

    // ── Perplexity call ────────────────────────────────────────────────
    const pplxKey = Deno.env.get("PERPLEXITY_API_KEY");
    if (!pplxKey) {
      return json({ error: "perplexity_not_configured" }, 500);
    }

    const missingHebrew = missing.length
      ? missing.join(", ")
      : "כל שדה ביבליוגרפי חסר (שנה, כרך, עמוד פתיחה, פרטי פרסום רשמיים)";

    const systemPrompt =
      "אתה עוזר מחקר משפטי ישראלי. עליך להחזיר אך ורק את הציטוט המתוקן בשורה אחת, " +
      "בהתאם לכללי האזכור האחיד (2021). אל תוסיף הסברים, אל תשתמש ב-Markdown, " +
      "אל תוסיף מרכאות עוטפות. אם לא ניתן למצוא שדה מסוים, השאר עבורו [חסר: <שם השדה>] " +
      "ואל תמציא נתונים.";

    const userPrompt = [
      `סוג מקור: ${sourceType || "לא ידוע"}`,
      rawHint ? `קלט מקורי של המשתמש: ${rawHint}` : "",
      `הציטוט הנוכחי (חסרים בו: ${missingHebrew}):`,
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
    const final = cleaned
      .replace(/^["'״׳`]+|["'״׳`]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!final) {
      return json({ error: "empty_response", raw }, 502);
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
