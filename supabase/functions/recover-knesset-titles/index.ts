import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HEBREW_MONTHS = [
  "ינואר","פברואר","מרץ","מרס","אפריל","מאי","יוני","יולי",
  "אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר",
];

// Lines we never accept as titles
const BOILERPLATE_PATTERNS: RegExp[] = [
  /^הכנסת\s*$/,
  /^מרכז\s+המחקר\s+והמידע\s*$/,
  /מרכז\s+המחקר\s+והמידע\s+של\s+הכנסת/,
  /knesset\.gov\.il/i,
  /^כתיבה\s*[:|]/,
  /^אישור\s*[:|]/,
  /^עריכ(ה|ת)\s+(לשון|לשונית)/,
  /^תאריך\s*[:|]/,
  /^תוכן\s+(ה?עניינים|ענייני)/,
  /^מבוא(\s|$)/,
  /^תמצית(\s|$)/,
  /^רקע(\s|$)/,
  /^סקירה(\s+(משפטית|כלכלית|השוואתית|משווה))?$/,
  /^מבט\s+משווה$/,
  /^נייר\s+רקע$/,
  /^ניתוח\s+(תקציבי|כלכלי|משפטי)$/,
  /^מסמך\s+רקע(\s+לדיון)?(\s+בנושא:?)?$/,
  /^מסמך\s+זה\s+(נכתב|מוגש|עוסק)/,
  /^הוכן\s+(עבור|ל)/,
  /^מוגש\s+ל/,
  /^בסקירה\s+זו/,
  /^המשך\s+ישיבת/,
  /^קריית\s+בן/,
  /^טל['׳]?\s*:/,
  /^פקס\s*:/,
  /^ירושלים/,
  /^\d+(\.\d+)*\.?\s*$/,
  /^[.\s\-–—_=]+$/,
  /^עמוד\s*\d+/,
  /^www\./i,
  /^\d{1,2}\s+ב?(ינואר|פברואר|מרץ|מרס|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)\s+\d{4}/,
  /^[יכלמנסעפצקרשת]['"״׳][אבגדהוזחטיכלמנסעפצקרשת]?\s+ב/, // "כ"ג בסיוון..."
  /^חוקרת?$/,
  /^ראש\s+צוות$/,
  /^מנהלת?\s+הממ/,
];

const isBoilerplate = (line: string): boolean =>
  BOILERPLATE_PATTERNS.some((p) => p.test(line));

const hasHebrew = (s: string): boolean => /[\u0590-\u05FF]/.test(s);

// Detect scrambled / reversed Hebrew text from old broken PDFs.
// Indicators:
//  - Latin/symbol noise mixed inside Hebrew (ñ, &, control chars, lone Latin letters)
//  - Digits appearing INSIDE Hebrew words (e.g., "התשנ"ו;1996" without proper format)
//  - Punctuation BEFORE words instead of after (",מרכז" / ":מי")
//  - Weird character density
function looksScrambled(line: string): boolean {
  // Latin letters mixed into Hebrew (excluding standalone ASCII fragments)
  const hebrewChars = (line.match(/[\u0590-\u05FF]/g) || []).length;
  if (hebrewChars < 4) return true;
  // Noise characters
  if (/[ñ&§¶†‡µ]/.test(line)) return true;
  // Comma/colon/semicolon BEFORE a Hebrew letter (RTL artifact)
  if (/[,:;][\u0590-\u05FF]/.test(line)) return true;
  // Digit immediately followed by Hebrew letter without space (RTL artifact, e.g., "5רקע")
  if (/\d[\u0590-\u05FF]/.test(line)) return true;
  // Hebrew letter immediately followed by digit (e.g., "התשנ"ו;1996")
  if (/[\u0590-\u05FF];?\d/.test(line)) return true;
  // Lone Latin letters mixed in
  if (/[\u0590-\u05FF]\s*[A-Za-z]\s*[\u0590-\u05FF]/.test(line)) return true;
  // Quotation marks in odd positions (e.g., 'ד "תשס')
  if (/['"][\u0590-\u05FF]+\s+[\u0590-\u05FF]+["']/.test(line) && /\s/.test(line)) {
    // not necessarily scrambled — let other checks decide
  }
  return false;
}

// Strip noise: bullet markers, leading/trailing punctuation, control chars
function cleanLine(raw: string): string {
  return raw
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[•·\-–—*\s]+/, "")
    .replace(/[\s.]+$/, "")
    .trim();
}

interface Extraction {
  title: string;
  authors?: string;
  year?: string;
  date?: string;
  method: string;
}

function extractDate(text: string): string | undefined {
  const m1 = text.match(
    new RegExp(`\\b\\d{1,2}\\s+ב?(${HEBREW_MONTHS.join("|")})\\s+\\d{4}\\b`),
  );
  if (m1) return m1[0].replace(/\s+/g, " ").trim();
  const m2 = text.match(/\b\d{1,2}\.\d{1,2}\.\d{4}\b/);
  if (m2) return m2[0];
  return undefined;
}

function extractYear(text: string): string | undefined {
  // Find first 4-digit year between 1990-2099 in the head
  const m = text.match(/\b(19[9]\d|20\d{2})\b/);
  return m ? m[1] : undefined;
}

// Strip academic / professional titles per Rule 23.2.3
function cleanAuthorName(raw: string): string {
  return raw
    .replace(/\b(ד["״']ר|פרופ['׳]|פרופסור|עו["״']ד|רו["״']ח|השופט|השופטת|המנוח|ז["״']ל|מר|גב['׳])\s+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Extract author(s) from "כתיבה: X" line. Handles:
//   "כתיבה: דינה צדוק"
//   "כתיבה: ד"ר אילה אליהו ואהוד בקר"
//   "כתיבה: אמיר פרגר  |אישור: ..."
function extractAuthors(text: string): string | undefined {
  // Modern format: "כתיבה: NAME" possibly followed by "|" or "אישור" or newline
  const m = text.match(/כתיבה\s*:\s*([^|\n\r]+?)(?:\s*\|\s*אישור|\s+אישור\s*:|[\n\r])/);
  if (!m) return undefined;
  let raw = m[1].trim();
  // Drop trailing role descriptors like ", חוקרת" / "מ"מ ראש צוות"
  raw = raw.replace(/\s*,\s*(חוקר|חוקרת|עובד|עובדת|מתמחה|ראש\s+צוות|מנהל|מנהלת).*/i, "");
  raw = cleanAuthorName(raw);
  if (looksScrambled(raw)) return undefined;
  if (raw.length < 3 || raw.length > 80) return undefined;
  if (!hasHebrew(raw)) return undefined;
  return raw;
}

function extractTitle(content: string): Extraction | null {
  const head = content.slice(0, 3000);
  const rawLines = head.split(/\r?\n/).map(cleanLine).filter((l) => l.length > 0);

  // Hard reject if the head text is mostly scrambled (old broken PDF)
  const sampleLines = rawLines.slice(0, 25);
  const scrambledCount = sampleLines.filter((l) => looksScrambled(l)).length;
  if (sampleLines.length > 0 && scrambledCount / sampleLines.length > 0.4) {
    return null; // → caller will flag broken_title
  }

  const date = extractDate(head);
  const year = extractYear(head);
  const authors = extractAuthors(head);

  // Build candidate pool
  const candidates: { line: string; idx: number }[] = [];
  rawLines.forEach((line, idx) => {
    if (line.length < 8 || line.length > 180) return;
    if (!hasHebrew(line)) return;
    if (isBoilerplate(line)) return;
    if (looksScrambled(line)) return;
    const dotCount = (line.match(/\./g) || []).length;
    if (dotCount > 6) return;
    if (/^\d/.test(line)) return;
    // Reject lines that are mostly digits / non-Hebrew
    const heChars = (line.match(/[\u0590-\u05FF]/g) || []).length;
    if (heChars / line.length < 0.5) return;
    candidates.push({ line, idx });
  });

  if (candidates.length === 0) return null;

  // Strategy 1: title appears AFTER a label line ("סקירה", "מבט משווה", "מסמך רקע", "נייר רקע")
  const LABEL_REGEX = /^(סקירה(\s+(משפטית|כלכלית|השוואתית|משווה))?|מבט\s+משווה|מסמך\s+רקע(\s+לדיון)?(\s+בנושא:?)?|נייר\s+רקע|דברי\s+הסבר)\s*$/;
  for (let i = 0; i < rawLines.length - 1; i++) {
    if (LABEL_REGEX.test(rawLines[i])) {
      for (let j = i + 1; j < Math.min(i + 4, rawLines.length); j++) {
        const cand = candidates.find((c) => c.idx === j);
        if (cand) {
          return { title: cand.line, authors, year, date, method: "after_section_label" };
        }
      }
    }
  }

  // Strategy 2: title appears AFTER "כתיבה:" / "אישור:" header block (modern format)
  for (let i = 0; i < rawLines.length - 1; i++) {
    if (/^כתיבה\s*:/.test(rawLines[i]) || /^עריכ(ה|ת)\s+ל?שון/.test(rawLines[i])) {
      for (let j = i + 1; j < Math.min(i + 6, rawLines.length); j++) {
        const cand = candidates.find((c) => c.idx === j);
        if (cand) {
          return { title: cand.line, authors, year, date, method: "after_kativa_header" };
        }
      }
    }
  }

  // Strategy 3: longest valid candidate within first 12 candidates
  const topPool = candidates.slice(0, 12);
  topPool.sort((a, b) => b.line.length - a.line.length);
  return { title: topPool[0].line, authors, year, date, method: "longest_top_candidate" };
}

// Build citation per Rule 23.11 (article in book) format requested by user:
//   "{author(s)} {title} (הכנסת, מרכז מחקר ומידע {year})."
function buildCitation(extraction: Extraction): string {
  const { title, authors, year, date } = extraction;
  const yearForCite = year || (date?.match(/\d{4}/)?.[0]);
  const tail = yearForCite
    ? `(הכנסת, מרכז מחקר ומידע ${yearForCite})`
    : `(הכנסת, מרכז מחקר ומידע)`;
  if (authors) {
    return `${authors} ${title} ${tail}`;
  }
  return `${title} ${tail}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Forbidden — admins only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const batchSize = Math.min(Math.max(Number(body?.batch_size) || 50, 1), 200);

    const { data: docs, error: fetchErr } = await admin
      .from("legal_documents")
      .select("id, title, citation, metadata, source_url")
      .eq("source_type", "knesset_research")
      .eq("title", "פרטי מסמך")
      .limit(batchSize);

    if (fetchErr) {
      return new Response(JSON.stringify({ error: fetchErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!docs || docs.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0, recovered: 0, flagged_broken: 0, failed: 0, remaining: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let recovered = 0;
    let flaggedBroken = 0;
    let failed = 0;

    for (const doc of docs) {
      try {
        const { data: chunk } = await admin
          .from("legal_document_chunks")
          .select("content")
          .eq("document_id", doc.id)
          .eq("chunk_index", 0)
          .maybeSingle();

        const content = (chunk?.content as string | undefined) || "";
        const extraction = content ? extractTitle(content) : null;

        if (extraction && extraction.title.length >= 8) {
          const newCitation = buildCitation(extraction);
          const newMeta = {
            ...((doc.metadata as Record<string, unknown>) || {}),
            recovered_title: true,
            recovery_method: extraction.method,
            recovered_at: new Date().toISOString(),
            ...(extraction.authors ? { authors: extraction.authors } : {}),
            ...(extraction.year ? { publication_year: extraction.year } : {}),
            ...(extraction.date ? { publication_date: extraction.date } : {}),
          };

          const { error: updErr } = await admin
            .from("legal_documents")
            .update({
              title: extraction.title,
              citation: newCitation,
              metadata: newMeta,
            })
            .eq("id", doc.id);
          if (updErr) throw updErr;
          recovered++;
          console.log(`Recovered: ${doc.id} → "${extraction.title}" [${extraction.method}]${extraction.authors ? ` by ${extraction.authors}` : ""}`);
        } else {
          const newMeta = {
            ...((doc.metadata as Record<string, unknown>) || {}),
            broken_title: true,
            broken_title_checked_at: new Date().toISOString(),
          };
          const { error: updErr } = await admin
            .from("legal_documents")
            .update({ metadata: newMeta })
            .eq("id", doc.id);
          if (updErr) throw updErr;
          flaggedBroken++;
        }
      } catch (e) {
        failed++;
        console.error(`Doc ${doc.id} failed:`, e instanceof Error ? e.message : e);
      }
    }

    const { count: remaining } = await admin
      .from("legal_documents")
      .select("id", { count: "exact", head: true })
      .eq("source_type", "knesset_research")
      .eq("title", "פרטי מסמך");

    return new Response(
      JSON.stringify({
        processed: docs.length,
        recovered,
        flagged_broken: flaggedBroken,
        failed,
        remaining: remaining ?? 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("recover-knesset-titles error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
