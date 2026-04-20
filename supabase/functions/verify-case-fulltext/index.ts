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

// Bare procedural numbers: "18225-06-25" (case-month-year) or "1234/05" (case/year)
const BARE_SLASH_REGEX = /\b([0-9]{1,6}\/[0-9]{2,4})\b/;
const BARE_HYPHEN_REGEX = /\b([0-9]{1,6})-([0-9]{1,2})-([0-9]{2,4})\b/;

function extractCaseNumber(text: string): string | null {
  // Bare hyphen FIRST (most specific): 18225-06-25 → keep raw hyphenated form
  const h = text.match(BARE_HYPHEN_REGEX);
  if (h) return `${h[1]}-${h[2]}-${h[3]}`;
  // Prefixed style: בג"ץ 1234/05
  const m = text.match(CASE_NUM_REGEX);
  if (m) return m[1].trim();
  // Bare slash: 1234/05
  const s = text.match(BARE_SLASH_REGEX);
  if (s) return s[1].trim();
  return null;
}

// Returns all candidate forms a case number might appear as in the DB.
function caseNumberVariants(input: string): string[] {
  const out = new Set<string>();
  const trimmed = input.trim();
  out.add(trimmed);
  // Hyphenated form: 18225-06-25 → also try 18225/06 and 18225-06
  const h = trimmed.match(/^([0-9]{1,6})-([0-9]{1,2})-([0-9]{2,4})$/);
  if (h) {
    out.add(`${h[1]}/${h[2]}`);
    out.add(`${h[1]}-${h[2]}`);
  }
  // Slash form: 18225/06 → also try 18225-06 (without day)
  const s = trimmed.match(/^([0-9]{1,6})\/([0-9]{2,4})$/);
  if (s) {
    out.add(`${s[1]}-${s[2]}`);
  }
  // Short hyphen: 18225-06 → also try 18225/06
  const sh = trimmed.match(/^([0-9]{1,6})-([0-9]{1,2})$/);
  if (sh) {
    out.add(`${sh[1]}/${sh[2]}`);
  }
  return Array.from(out);
}

// Browser-like headers for court servers that reject default fetch UA.
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf,text/html;q=0.9,*/*;q=0.8",
  "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
};

// True if the first bytes look like a real ZIP/DOCX (PK\x03\x04).
function looksLikeZip(buf: Uint8Array): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

// True if the first bytes look like a PDF (%PDF-).
function looksLikePdfMagic(buf: Uint8Array): boolean {
  return buf.length >= 5 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d;
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

// Convert a PDF byte buffer to plain text via ConvertAPI (pdf/to/txt).
// Returns "" on any failure so the caller can fall through gracefully.
async function extractPdfTextViaConvertApi(bytes: Uint8Array, filename = "case.pdf"): Promise<string> {
  const CONVERTAPI_SECRET = Deno.env.get("CONVERTAPI_SECRET");
  if (!CONVERTAPI_SECRET) {
    console.warn("extractPdfTextViaConvertApi: CONVERTAPI_SECRET not configured");
    return "";
  }
  try {
    const form = new FormData();
    form.append("File", new Blob([bytes], { type: "application/pdf" }), filename);
    form.append("StoreFile", "true");

    const res = await fetchWithTimeout(
      "https://v2.convertapi.com/convert/pdf/to/txt",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${CONVERTAPI_SECRET}` },
        body: form,
      },
      25000,
    );
    if (!res.ok) {
      console.warn(`ConvertAPI pdf→txt failed: ${res.status}`);
      return "";
    }
    const json = await res.json();
    const fileUrl = json?.Files?.[0]?.Url;
    if (!fileUrl) return "";
    const txtRes = await fetchWithTimeout(fileUrl, { method: "GET" }, 15000);
    if (!txtRes.ok) return "";
    return (await txtRes.text()).trim();
  } catch (e) {
    console.warn("extractPdfTextViaConvertApi error:", e instanceof Error ? e.message : e);
    return "";
  }
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
      const variants = caseNumberVariants(caseNum);
      console.log(`verify-case-fulltext: local lookup variants=${JSON.stringify(variants)}`);
      const { data } = await adminClient
        .from("legal_documents")
        .select("id, title, citation, content, court, decision_date, case_number, source_url, source_type, metadata")
        .in("source_type", ["caselaw", "case_law", "case_law_database"])
        .in("case_number", variants)
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
              const txtRes = await fetchWithTimeout(url, {
                method: "GET",
                headers: BROWSER_HEADERS,
                redirect: "follow",
              }, 15000);
              if (!txtRes.ok) {
                console.warn(`verify-case-fulltext: external fetch HTTP ${txtRes.status} — ${url}`);
              } else {
                const ct = (txtRes.headers.get("content-type") || "").toLowerCase();
                const cd = (txtRes.headers.get("content-disposition") || "").toLowerCase();
                const isDocxByCt = ct.includes("officedocument.wordprocessingml") || ct.includes("application/vnd.openxmlformats");
                const isPdfByCt = ct.includes("application/pdf");
                const isHtmlByCt = ct.includes("text/html") || ct.includes("application/xhtml");
                const cdMentionsDocx = /\.docx\b/.test(cd);
                const cdMentionsPdf = /\.pdf\b/.test(cd);

                let plain = "";
                const urlSuggestsDocx = looksLikeDocxUrl(url);
                const urlSuggestsPdf = looksLikePdfUrl(url);

                // Prefer magic-byte sniffing over server-provided content-type, since court
                // servers commonly mislabel DOCX downloads as text/html or octet-stream.
                if (isDocxByCt || cdMentionsDocx || (!isHtmlByCt && urlSuggestsDocx) || (!isHtmlByCt && !isPdfByCt && !urlSuggestsPdf)) {
                  const buf = new Uint8Array(await txtRes.arrayBuffer());
                  if (looksLikeZip(buf)) {
                    plain = extractDocxText(buf);
                    console.log(`verify-case-fulltext: external DOCX (${plain.length} chars, ${buf.length}B from ${url})`);
                  } else if (looksLikePdfMagic(buf)) {
                    plain = await extractPdfTextViaConvertApi(buf);
                    console.log(`verify-case-fulltext: external PDF via magic (${plain.length} chars, ${buf.length}B from ${url})`);
                  } else {
                    // Not a real binary — try treating buffer as HTML/text fallback.
                    const raw = new TextDecoder("utf-8", { fatal: false }).decode(buf);
                    const looksHtml = /^\s*<(!doctype|html|\?xml)/i.test(raw.slice(0, 200));
                    if (looksHtml) {
                      plain = raw
                        .replace(/<script[\s\S]*?<\/script>/gi, " ")
                        .replace(/<style[\s\S]*?<\/style>/gi, " ")
                        .replace(/<[^>]+>/g, " ")
                        .replace(/&nbsp;/g, " ")
                        .replace(/\s+/g, " ")
                        .trim();
                      console.log(`verify-case-fulltext: external HTML interstitial fallback (${plain.length} chars from ${url})`);
                    } else {
                      console.warn(`verify-case-fulltext: rejected — not zip/pdf/html (ct=${ct} cd=${cd} bytes=${buf.length} first4=${Array.from(buf.slice(0,4)).map(b=>b.toString(16)).join(' ')}) — ${url}`);
                    }
                  }
                } else if (isPdfByCt || cdMentionsPdf || urlSuggestsPdf) {
                  const buf = new Uint8Array(await txtRes.arrayBuffer());
                  if (looksLikePdfMagic(buf) || looksLikeZip(buf)) {
                    plain = looksLikeZip(buf) ? extractDocxText(buf) : await extractPdfTextViaConvertApi(buf);
                    console.log(`verify-case-fulltext: external PDF (${plain.length} chars, ${buf.length}B from ${url})`);
                  } else {
                    console.warn(`verify-case-fulltext: rejected PDF — bad magic (bytes=${buf.length}) — ${url}`);
                  }
                } else {
                  // HTML / unknown text path
                  const raw = await txtRes.text();
                  const looksHtml = isHtmlByCt || /^\s*<(!doctype|html|\?xml)/i.test(raw.slice(0, 200));
                  if (looksHtml) {
                    plain = raw
                      .replace(/<script[\s\S]*?<\/script>/gi, " ")
                      .replace(/<style[\s\S]*?<\/style>/gi, " ")
                      .replace(/<[^>]+>/g, " ")
                      .replace(/&nbsp;/g, " ")
                      .replace(/\s+/g, " ")
                      .trim();
                  } else {
                    console.log(`verify-case-fulltext: external response not HTML/DOCX/PDF (ct=${ct}) — ${url}`);
                  }
                }

                // Hebrew-ratio sanity gate — guards against binary garbage that
                // happens to exceed the length threshold.
                if (plain.length >= MIN_EXTERNAL_TEXT) {
                  const ratio = hebrewRatio(plain);
                  if (ratio < 0.05) {
                    console.warn(`verify-case-fulltext: external text failed Hebrew-ratio gate (${(ratio * 100).toFixed(2)}%) — discarding`);
                  } else {
                    console.log(`verify-case-fulltext: external match (${plain.length} chars, hebrew=${(ratio * 100).toFixed(1)}%, from ${url})`);
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
