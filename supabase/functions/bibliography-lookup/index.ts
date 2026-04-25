import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  HEBREW_JOURNALS,
  JOURNAL_HINT_RE,
  findJournalInText,
  validateArticleCitation,
} from "../_shared/articleCitationValidator.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const normalizeSearchableText = (text: string) =>
  text
    .toLowerCase()
    .replace(/["״׳'.,()[\]{}:;!?/\\|–—-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenizeSearchTerms = (text: string) =>
  Array.from(new Set(normalizeSearchableText(text).split(" ").filter((w) => w.length >= 2)));

const scoreVerifiedMatch = (
  query: string,
  candidate: { source_name: string; full_citation: string },
) => {
  const normalizedQuery = normalizeSearchableText(query);
  const normalizedSourceName = normalizeSearchableText(candidate.source_name);
  const normalizedCandidate = normalizeSearchableText(`${candidate.source_name} ${candidate.full_citation}`);
  const words = tokenizeSearchTerms(query);

  const matchesExactName = normalizedSourceName === normalizedQuery;
  const matchesAllWords = words.length > 1 && words.every((w) => normalizedCandidate.includes(w));
  const matchesSingleWord = words.length === 1 && normalizedQuery.length >= 4 && normalizedSourceName.includes(normalizedQuery);

  if (!matchesExactName && !matchesAllWords && !matchesSingleWord) return -1;

  let score = 0;
  if (matchesExactName) score += 200;
  if (matchesAllWords) score += 100;
  if (matchesSingleWord) score += 40;
  if (normalizedCandidate.includes(normalizedQuery)) score += 20;
  score += words.reduce((t, w) => t + (normalizedCandidate.includes(w) ? 10 : 0), 0);
  return score;
};

const PERPLEXITY_SYSTEM = `אתה מומחה לכללי האזכור האחיד הישראלי (מהדורה שלישית, 2021).
המשתמש יספק שם של מקור משפטי (חוק, תקנה, פסק דין, ספר או מאמר). תפקידך:
1. לאתר את הפרטים הביבליוגרפיים המלאים של המקור.
2. להחזיר את האזכור התקני המלא בשורה אחת בלבד, ללא קיצור, ללא "שם", ללא "לעיל", עם כל הרכיבים הנדרשים:
   - חקיקה ראשית: שם מלא, שנה עברית–לועזית, ס"ח עמוד פתיחה. למשל: חוק החוזים (חלק כללי), התשל"ג–1973, ס"ח 118.
   - חוק יסוד: חוק-יסוד: {שם}, ס"ח עמוד. למשל: חוק-יסוד: כבוד האדם וחירותו, ס"ח התשנ"ב 150.
   - חקיקת משנה: שם, שנה עברית–לועזית, ק"ת עמוד.
   - פסיקה: סוג הליך מספר/שנה **צד א'** נ' **צד ב'**, פ"ד כרך(חלק) עמוד (שנה).
   - ספרים: מחבר **שם הספר** כרך (שנה עברית). למשל: דניאל פרידמן ונילי כהן **חוזים** כרך א (התשנ"א).
   - מאמרים בכתבי עת (כלל 24) — חובה לעמוד בפורמט הבא בדיוק:
       מחבר "שם המאמר" שם-כתב-העת כרך עמוד-פתיחה (שנה עברית).
     • כותרת המאמר חייבת להופיע בתוך מירכאות כפולות ישרות "...".
     • שם כתב העת (משפטים, עיוני משפט, הפרקליט, מחקרי משפט, דין ודברים, מאזני משפט וכד') חובה — מיד אחרי הכותרת, **ללא** מירכאות.
     • מספר הכרך הוא אות עברית בודדת/מצומדת או ספרה (נו, מח, יב, 12) — **אסור** לעטוף ב-"(כרך X)".
     • עמוד פתיחה הוא ספרות — חובה.
     • שנה בעברית עם קידומת ה' בסוגריים: (התשפ"ה), (התשע"ב). שנה לועזית רק אם השנה העברית באמת לא ידועה.
     דוגמה תקנית: נטע ברק-קורן, חני לרנר ותרצה קלמן "הקמת אסיפה מכוננת לפתרון המשבר החוקתי בישראל" משפטים נו 1 (התשפ"ה).
   - מאמרים באנגלית (Rule 24 equivalent): Author, *Title*, Journal Volume Page (Year). שם כתב העת מלא; כרך ועמוד פתיחה חובה.
3. אם רכיב חובה (שם כתב עת, עמוד פתיחה, שנה) חסר ולא ניתן לאמתו — שלב במקומו placeholder מפורש: [חסר: שם כתב העת], [חסר: עמוד פתיחה], [חסר: שנה]. **אל תמציא** ערכים, ואל תשמיט בשקט את הרכיב.
4. **אסור** לעטוף את הכרך ב-"(כרך X)" במאמרים. אם זיהית מאמר בכתב עת — הכרך תמיד יופיע כאות/ספרה חשופה אחרי שם כתב העת.
5. אם מספר פסקי דין שונים תואמים את התיאור, החזר רשימה ממוספרת של עד 4 חלופות.
6. אם נדרש מידע שלא ניתן לאמת ואינו מהווה רכיב חובה — השמט את הרכיב במקום להמציא.

החזר תשובה כ-JSON עם המבנה הבא בלבד (ללא הסברים, ללא markdown):
{ "isDisambiguation": false, "citation": "...", "options": [] }
אם isDisambiguation=true, השאר citation ריק ומלא את options ברשימת המועמדים.`;

const HEBREW_JOURNALS = [
  "משפטים",
  "עיוני משפט",
  "הפרקליט",
  "מחקרי משפט",
  "דין ודברים",
  "מאזני משפט",
  "משפט וממשל",
  "משפט ועסקים",
  "המשפט",
  "משפט חברה ותרבות",
  "עלי משפט",
  "ספר השנה של המשפט בישראל",
];

const JOURNAL_HINT_RE = new RegExp(`(?:${HEBREW_JOURNALS.join("|")}|כתב[\\s-]?עת)`);

function findJournalInText(text: string): string | null {
  for (const j of HEBREW_JOURNALS) {
    if (text.includes(j)) return j;
  }
  return null;
}

/**
 * Conservative validator for article-shaped citations.
 * - Strips "(כרך X)" wrapper → bare X
 * - Ensures the title is wrapped in straight quotes when a journal token is present
 * - If journal name is missing but appeared in the user's raw input, splices it back in
 *   (otherwise inserts [חסר: שם כתב העת])
 * - If opening page is missing after the volume, appends [חסר: עמוד פתיחה]
 */
function validateArticleCitation(citation: string, rawSource: string): string {
  if (!citation) return citation;
  const rawJournal = findJournalInText(rawSource);
  const citJournal = findJournalInText(citation);
  const looksLikeArticle =
    /["'״׳].+?["'״׳]/.test(citation) || rawJournal !== null || JOURNAL_HINT_RE.test(citation);
  if (!looksLikeArticle) return citation;

  let out = citation.trim();

  // 1. Strip "(כרך X)" → bare X
  out = out.replace(/\(\s*כרך\s+([^)]+?)\s*\)/g, "$1");

  // 2. Ensure quotes around title when we have a journal token to anchor on
  const journal = citJournal || rawJournal;
  if (journal && !/["״]/.test(out)) {
    // Try: "<author block> <title> <journal> ..."
    const idx = out.indexOf(journal);
    if (idx > 0) {
      const before = out.slice(0, idx).trimEnd();
      const after = out.slice(idx);
      // Heuristic: split before-block at the last "name-like" token (Hebrew word seq).
      // Simplest safe approach: assume first 1–6 words are author block; rest is title.
      const tokens = before.split(/\s+/);
      if (tokens.length >= 3) {
        // Take last ~60% of tokens as title; first ~40% as authors. Capped: author block ≥ 1 word.
        const splitAt = Math.max(1, Math.min(tokens.length - 1, Math.ceil(tokens.length * 0.4)));
        const authorBlock = tokens.slice(0, splitAt).join(" ");
        const titleBlock = tokens.slice(splitAt).join(" ").replace(/[,]\s*$/, "");
        out = `${authorBlock} "${titleBlock}" ${after}`.replace(/\s+/g, " ").trim();
      }
    }
  }

  // 3. Splice journal name back if missing but raw input had it
  if (!citJournal && rawJournal && !out.includes(rawJournal)) {
    // Insert after the closing quote of the title if present, else at end-ish.
    const closingQuote = out.lastIndexOf('"');
    if (closingQuote > 0 && closingQuote < out.length - 1) {
      out = `${out.slice(0, closingQuote + 1)} ${rawJournal}${out.slice(closingQuote + 1)}`;
    } else {
      out = `${out} ${rawJournal}`;
    }
  } else if (!citJournal && !rawJournal && /["״].+?["״]/.test(out)) {
    // Quoted title but no journal anywhere — flag.
    const closingQuote = out.lastIndexOf('"');
    if (closingQuote > 0) {
      out = `${out.slice(0, closingQuote + 1)} [חסר: שם כתב העת]${out.slice(closingQuote + 1)}`;
    }
  }

  // 4. Ensure opening page exists after the volume (number after journal+volume).
  // Pattern: <journal> <volume token> <page digits>?  — if no digits follow within ~2 tokens, mark missing.
  const finalJournal = findJournalInText(out);
  if (finalJournal) {
    const re = new RegExp(`${finalJournal}\\s+([^\\s()]+)(?:\\s+([^\\s()]+))?`);
    const m = out.match(re);
    if (m) {
      const tokenAfterVolume = m[2] || "";
      const hasPageDigits = /^\d+$/.test(tokenAfterVolume);
      if (!hasPageDigits && !out.includes("[חסר: עמוד פתיחה]")) {
        // Insert placeholder right after the volume token.
        const insertion = `${finalJournal} ${m[1]} [חסר: עמוד פתיחה]`;
        out = out.replace(`${finalJournal} ${m[1]}`, insertion);
      }
    }
  }

  // Collapse extra spaces.
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

async function callPerplexity(rawSource: string): Promise<{ isDisambiguation: boolean; citation: string; options: string[] }> {
  const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
  if (!PERPLEXITY_API_KEY) throw new Error("PERPLEXITY_API_KEY is not configured");

  const response = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [
        { role: "system", content: PERPLEXITY_SYSTEM },
        { role: "user", content: `המקור הוא: ${rawSource}` },
      ],
      temperature: 0.1,
      response_format: {
        type: "json_schema",
        json_schema: {
          schema: {
            type: "object",
            properties: {
              isDisambiguation: { type: "boolean" },
              citation: { type: "string" },
              options: { type: "array", items: { type: "string" } },
            },
            required: ["isDisambiguation", "citation", "options"],
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const t = await response.text();
    throw new Error(`Perplexity error ${response.status}: ${t}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content || "{}";
  try {
    const parsed = JSON.parse(content);
    return {
      isDisambiguation: Boolean(parsed.isDisambiguation),
      citation: String(parsed.citation || "").trim(),
      options: Array.isArray(parsed.options) ? parsed.options.map(String).filter(Boolean) : [],
    };
  } catch {
    // Fallback: treat content as a single citation string
    return { isDisambiguation: false, citation: content.trim(), options: [] };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // ── Auth gate ──
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid Authorization header" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
  if (claimsError || !claimsData?.claims) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let creditRequestId: string | null = null;
  try {
    const body = await req.json();
    const rawSource: string = (body?.rawSource ?? "").toString().trim();
    const requestId: string = (body?.requestId ?? crypto.randomUUID()).toString();
    creditRequestId = requestId;

    if (!rawSource || rawSource.length < 2) {
      return new Response(
        JSON.stringify({ error: "INVALID_INPUT" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 1. Verified-source lookup (free) ──
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const words = tokenizeSearchTerms(rawSource);
    const caseNumberParts = (rawSource.match(/\d+(?:\/\d+)?/g) || []).filter((p) => p.length >= 2);
    const allTerms = Array.from(new Set([...words, ...caseNumberParts]));

    if (allTerms.length > 0) {
      const orConditions = allTerms
        .flatMap((w) => [
          `search_text.ilike.%${w}%`,
          `source_name.ilike.%${w}%`,
          `full_citation.ilike.%${w}%`,
        ])
        .join(",");

      const { data: verified } = await sb
        .from("verified_sources")
        .select("source_name, full_citation, source_type, year")
        .eq("verification_status", "verified")
        .or(orConditions)
        .limit(12);

      if (verified && verified.length > 0) {
        const ranked = verified
          .map((c) => ({ c, score: scoreVerifiedMatch(rawSource, c as { source_name: string; full_citation: string }) }))
          .filter((r) => r.score >= 0)
          .sort((a, b) => b.score - a.score);

        const best = ranked[0]?.c as { full_citation: string } | undefined;
        if (best) {
          return new Response(
            JSON.stringify({ citation: best.full_citation, isVerified: true, isDisambiguation: false, options: [] }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }
    }

    // ── 2. Consume 1 credit before Perplexity ──
    const consumeRes = await userClient.rpc("consume_credits", {
      _amount: 1,
      _reason: "bibliography-lookup",
      _request_id: requestId,
    });
    const consumeData = (consumeRes.data ?? {}) as Record<string, unknown>;
    if (consumeRes.error || !consumeData.ok) {
      if (consumeData.error === "INSUFFICIENT_CREDITS") {
        return new Response(
          JSON.stringify({
            error: "INSUFFICIENT_CREDITS",
            required: 1,
            remaining_included: consumeData.remaining_included ?? 0,
            remaining_topup: consumeData.remaining_topup ?? 0,
          }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      console.error("consume_credits failed:", consumeRes.error, consumeData);
      creditRequestId = null;
    }

    // ── 3. Perplexity fallback ──
    try {
      const result = await callPerplexity(rawSource);
      const validatedCitation = result.isDisambiguation
        ? result.citation
        : validateArticleCitation(result.citation, rawSource);
      const validatedOptions = result.isDisambiguation
        ? result.options.map((o) => validateArticleCitation(o, rawSource))
        : result.options;
      return new Response(
        JSON.stringify({
          citation: validatedCitation,
          isVerified: false,
          isDisambiguation: result.isDisambiguation,
          options: validatedOptions,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } catch (e) {
      // Refund on failure
      if (creditRequestId) {
        await userClient.rpc("refund_credits", {
          _request_id: creditRequestId,
          _reason: "bibliography-lookup-failed",
        });
      }
      console.error("Perplexity call failed:", e);
      return new Response(
        JSON.stringify({ error: "LOOKUP_FAILED", details: e instanceof Error ? e.message : "unknown" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  } catch (e) {
    console.error("bibliography-lookup error:", e);
    if (creditRequestId) {
      await userClient.rpc("refund_credits", {
        _request_id: creditRequestId,
        _reason: "bibliography-lookup-error",
      });
    }
    return new Response(
      JSON.stringify({ error: "INTERNAL_ERROR", details: e instanceof Error ? e.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
