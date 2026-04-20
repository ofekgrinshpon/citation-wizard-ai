// verify-case-fulltext
// Source-of-truth gate for the "סיכום פסיקה" (Case Summary) feature.
// Returns whether the full text of a case is available, and from where.
//
// Response shape:
// {
//   source: "user" | "local" | "external" | "none",
//   fullText?: string,
//   metadata?: { title, citation, court, decision_date, case_number, parties, year, source_url },
//   refusal_message?: string  // only when source === "none"
// }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { unzipSync, strFromU8 } from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const REFUSAL_MESSAGE =
  "פסק הדין אינו קיים במערכת ולא ניתן היה לאתר את הטקסט המלא שלו. כדי שאוכל לסכם אותו עבורך, אנא העלה את הקובץ או הדבק את הטקסט בתיבת הטקסט.";

const MIN_USER_TEXT = 1500;
const MIN_LOCAL_TEXT = 3000;
const MIN_EXTERNAL_TEXT = 3000;

// Hebrew case-number prefixes (extend as needed)
const CASE_NUM_REGEX =
  /(?:בג["״]ץ|ע["״]א|ע["״]פ|רע["״]א|רע["״]פ|דנ["״]א|דנ["״]פ|בש["״]פ|עע["״]מ|בר["״]ם|תפ["״]ח|ת["״]א|ת["״]פ|ה["״]פ|עמ["״]ה)\s*([0-9]{1,6}\/[0-9]{2,4})/;

function extractCaseNumber(text: string): string | null {
  const m = text.match(CASE_NUM_REGEX);
  if (!m) return null;
  return m[1].trim();
}

async function fetchWithTimeout(url: string, opts: RequestInit, ms: number): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

function buildMetadata(doc: Record<string, unknown>) {
  const md = (doc.metadata as Record<string, unknown> | null) || {};
  return {
    title: doc.title as string,
    citation: doc.citation as string,
    court: (doc.court as string) || (md.court as string) || null,
    decision_date: (doc.decision_date as string) || null,
    case_number: (doc.case_number as string) || null,
    parties: (md.parties as string) || (doc.title as string) || null,
    year: (() => {
      const d = doc.decision_date as string | null;
      if (d && /\d{4}/.test(d)) return d.match(/\d{4}/)![0];
      const t = doc.title as string;
      const ym = t?.match(/\((\d{4})\)/);
      return ym ? ym[1] : null;
    })(),
    source_url: (doc.source_url as string) || null,
  };
}

// Extract Hebrew/plain text from a DOCX byte buffer (proven approach from apify-ingest-cases).
function extractDocxText(bytes: Uint8Array): string {
  try {
    const files = unzipSync(bytes);
    const docXml = files["word/document.xml"];
    if (!docXml) return "";
    const xml = strFromU8(docXml);
    // Concatenate all <w:t ...>text</w:t> runs; treat </w:p> as line breaks.
    const paragraphs = xml.split(/<\/w:p>/);
    const lines: string[] = [];
    for (const p of paragraphs) {
      const matches = p.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
      const txt = matches
        .map((m) => m.replace(/<w:t[^>]*>/, "").replace(/<\/w:t>$/, ""))
        .join("");
      if (txt.trim()) lines.push(txt);
    }
    return lines
      .join("\n")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .trim();
  } catch (e) {
    console.warn("DOCX extraction failed:", e instanceof Error ? e.message : e);
    return "";
  }
}

function hebrewRatio(text: string): number {
  const sample = text.slice(0, 20000);
  const total = sample.length || 1;
  const hebrew = (sample.match(/[\u0590-\u05FF]/g) || []).length;
  return hebrew / total;
}

function looksLikeDocxUrl(url: string): boolean {
  return /\.docx(\?|$)/i.test(url) || /type=4\b/i.test(url) || /Download\?/i.test(url);
}

function looksLikePdfUrl(url: string): boolean {
  return /\.pdf(\?|$)/i.test(url) || /type=3\b/i.test(url);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = await req.json();
    const question: string = (body.question || "").toString();
    const userText: string = (body.userText || "").toString();

    if (!question.trim() && !userText.trim()) {
      return new Response(JSON.stringify({
        source: "none", refusal_message: REFUSAL_MESSAGE,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---------- Source 1: User-supplied full text ----------
    if (userText && userText.trim().length >= MIN_USER_TEXT) {
      console.log(`verify-case-fulltext: user-supplied (${userText.length} chars)`);
      return new Response(JSON.stringify({
        source: "user",
        fullText: userText,
        metadata: { title: null, citation: null, court: null, decision_date: null, case_number: extractCaseNumber(question) || null, parties: null, year: null, source_url: null },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---------- Source 2: Local DB ----------
    const caseNum = extractCaseNumber(question);
    let localDoc: Record<string, unknown> | null = null;

    if (caseNum) {
      const { data } = await adminClient
        .from("legal_documents")
        .select("id, title, citation, content, court, decision_date, case_number, source_url, source_type, metadata")
        .in("source_type", ["case_law", "case_law_database"])
        .eq("case_number", caseNum)
        .order("created_at", { ascending: false })
        .limit(1);
      if (data && data.length > 0) localDoc = data[0] as Record<string, unknown>;
    }

    // Fallback: search by title/citation text
    if (!localDoc) {
      const q = question.replace(/[?!.,;:]/g, " ").trim();
      const { data } = await adminClient
        .from("legal_documents")
        .select("id, title, citation, content, court, decision_date, case_number, source_url, source_type, metadata")
        .in("source_type", ["case_law", "case_law_database"])
        .or(`title.ilike.%${q.slice(0, 80)}%,citation.ilike.%${q.slice(0, 80)}%`)
        .limit(5);
      if (data && data.length > 0) {
        const sorted = data
          .filter((d: any) => typeof d.content === "string" && d.content.length >= MIN_LOCAL_TEXT)
          .sort((a: any, b: any) => (b.content?.length || 0) - (a.content?.length || 0));
        if (sorted.length > 0) localDoc = sorted[0] as Record<string, unknown>;
      }
    }

    if (localDoc && typeof localDoc.content === "string" && (localDoc.content as string).length >= MIN_LOCAL_TEXT) {
      const content = localDoc.content as string;
      console.log(`verify-case-fulltext: local match (${content.length} chars, doc=${localDoc.id})`);
      return new Response(JSON.stringify({
        source: "local",
        fullText: content,
        metadata: buildMetadata(localDoc),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---------- Source 3: External retrieval via Perplexity + URL fetch ----------
    const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
    if (PERPLEXITY_API_KEY) {
      try {
        const ppRes = await fetchWithTimeout("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "sonar",
            messages: [
              { role: "system", content: "You return ONLY a JSON object with keys: case_number, parties, court, year, source_url. No prose." },
              { role: "user", content: `מצא את פסק הדין הישראלי הבא והחזר רק JSON: ${question}` },
            ],
            search_domain_filter: ["nevo.co.il", "court.gov.il", "supreme.court.gov.il", "takdin.co.il", "psakdin.co.il"],
          }),
        }, 8000);

        if (ppRes.ok) {
          const pp = await ppRes.json();
          const txt: string = pp.choices?.[0]?.message?.content || "";
          const cites: string[] = pp.citations || [];
          let parsed: Record<string, unknown> = {};
          try {
            const j = txt.match(/\{[\s\S]*\}/);
            if (j) parsed = JSON.parse(j[0]);
          } catch { /* ignore */ }

          const url = (parsed.source_url as string) || cites[0] || "";
          if (url) {
            try {
              const txtRes = await fetchWithTimeout(url, { method: "GET" }, 10000);
              if (txtRes.ok) {
                const html = await txtRes.text();
                const plain = html
                  .replace(/<script[\s\S]*?<\/script>/gi, " ")
                  .replace(/<style[\s\S]*?<\/style>/gi, " ")
                  .replace(/<[^>]+>/g, " ")
                  .replace(/&nbsp;/g, " ")
                  .replace(/\s+/g, " ")
                  .trim();
                if (plain.length >= MIN_EXTERNAL_TEXT) {
                  console.log(`verify-case-fulltext: external match (${plain.length} chars from ${url})`);
                  return new Response(JSON.stringify({
                    source: "external",
                    fullText: plain.slice(0, 60000),
                    metadata: {
                      title: (parsed.parties as string) || null,
                      citation: null,
                      court: (parsed.court as string) || null,
                      decision_date: null,
                      case_number: (parsed.case_number as string) || caseNum || null,
                      parties: (parsed.parties as string) || null,
                      year: (parsed.year as string) || null,
                      source_url: url,
                    },
                  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }
              }
            } catch (e) {
              console.warn("External URL fetch failed:", e instanceof Error ? e.message : e);
            }
          }
        }
      } catch (e) {
        console.warn("Perplexity verify failed:", e instanceof Error ? e.message : e);
      }
    }

    // ---------- Not found ----------
    console.log("verify-case-fulltext: not found");
    return new Response(JSON.stringify({
      source: "none",
      refusal_message: REFUSAL_MESSAGE,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("verify-case-fulltext error:", e);
    return new Response(JSON.stringify({ error: "internal" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
