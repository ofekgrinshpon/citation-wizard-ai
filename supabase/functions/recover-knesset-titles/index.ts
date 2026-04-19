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

const HEBREW_CAL_MONTHS = [
  "ניסן","אייר","סיון","סיוון","תמוז","אב","אלול",
  "תשרי","חשון","חשוון","כסלו","טבת","שבט","אדר",
];

// Lines we never accept as titles
const BOILERPLATE_PATTERNS: RegExp[] = [
  /^הכנסת\s*$/,
  /^מרכז\s+המחקר\s+והמידע\s*$/,
  /מרכז\s+המחקר\s+והמידע\s+של\s+הכנסת/,
  /^הכנסת,?\s+מרכז\s+המחקר/,
  /knesset\.gov\.il/i,
  /^כתיבה\s*[:|]/,
  /^אישור\s*[:|]/,
  /^עריכ(ה|ת)\s+(לשון|לשונית)/,
  /^לשונית\s+עריכה/,
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
  // Hebrew calendar dates: "ט"ז אדר ב' תשע"ד" / "ד 'בטבת תשס"ח" / "כ"ג בסיוון..."
  new RegExp(
    `^[יכלמנסעפצקרשתבגדהוזחטא]['"״׳]?[א-ת]?\\s*['׳]?\\s*ב?(?:${HEBREW_CAL_MONTHS.join("|")})(\\s+[אב]['׳])?\\s+ת?ש[א-ת]+`,
  ),
  // Reversed RTL date variant: "תשע"ד אדר ט"ז"
  new RegExp(`(?:${HEBREW_CAL_MONTHS.join("|")})\\s+[יכלמנסעפצקרשתבגדהוזחטא]['"״׳]`),
  /^חוקרת?$/,
  /^ראש\s+צוות$/,
  /^מנהלת?\s+הממ/,
  /^המחלקה\s+ל/,
  /^מערכת\s*["״]?דברי/,
  /דברי["״]?\s*הכנסת/,
  // Pure Hebrew year only
  /^ת?ש[א-ת]['"״׳][א-ת]?\s*[–-]?\s*\d{0,4}\s*$/,
];

const isBoilerplate = (line: string): boolean =>
  BOILERPLATE_PATTERNS.some((p) => p.test(line));

const hasHebrew = (s: string): boolean => /[\u0590-\u05FF]/.test(s);

// Mid-sentence cutoff words at line end → indicates paragraph fragment
const SENTENCE_TAIL_RE = /\s(של|את|הוא|היא|הם|הן|או|וגם|אך|אם|כי|אשר|לפי|בין|לבין|תוך|עם|על|אל|מן|לפני|אחרי|בעת|בגין|בשל|בנוגע|לגבי|לצורך|כדי|כך|לכן|אולם|למרות|בעוד|כאשר|בעקבות|במסגרת|במהלך|לקראת|בנושא|לעניין|לרבות|וכן|וכד['׳]?|וכו['׳]?|ב|ל|מ|ו|ה|כ|ש)$/;

const PREPOSITION_PREFIX_RE = /^(ב|ל|מ|כ|מה|לה|בה|כה|מן|אל|על|עם|בין|לפני|אחרי|בעת|תוך|בנוגע|לגבי)[א-ת]/;

// Detect scrambled / reversed Hebrew text from old broken PDFs.
function looksScrambled(line: string): boolean {
  const hebrewChars = (line.match(/[\u0590-\u05FF]/g) || []).length;
  if (hebrewChars < 4) return true;
  if (/[ñ&§¶†‡µ]/.test(line)) return true;
  if (/[,:;][\u0590-\u05FF]/.test(line)) return true;
  if (/\d[\u0590-\u05FF]/.test(line)) return true;
  if (/[\u0590-\u05FF];?\d/.test(line)) return true;
  if (/[\u0590-\u05FF]\s*[A-Za-z]\s*[\u0590-\u05FF]/.test(line)) return true;
  return false;
}

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

// Validate or repair a year, accepting only 1990–2026.
// If reversed (e.g. "0200"), try flipping; otherwise return undefined.
function normalizeYear(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return undefined;
  if (n >= 1990 && n <= 2026) return String(n);
  const reversed = raw.split("").reverse().join("");
  const r = parseInt(reversed, 10);
  if (Number.isFinite(r) && r >= 1990 && r <= 2026) return String(r);
  return undefined;
}

function extractDate(text: string): string | undefined {
  const m1 = text.match(
    new RegExp(`\\b\\d{1,2}\\s+ב?(${HEBREW_MONTHS.join("|")})\\s+\\d{4}\\b`),
  );
  if (m1) {
    const yr = m1[0].match(/\d{4}/)?.[0];
    if (normalizeYear(yr)) return m1[0].replace(/\s+/g, " ").trim();
  }
  const m2 = text.match(/\b\d{1,2}\.\d{1,2}\.\d{4}\b/);
  if (m2) {
    const yr = m2[0].match(/\d{4}$/)?.[0];
    if (normalizeYear(yr)) return m2[0];
  }
  return undefined;
}

function extractYear(text: string): string | undefined {
  // Collect ALL 4-digit numbers and pick the first that normalizes to a valid year.
  const all = text.match(/\b\d{4}\b/g) || [];
  for (const candidate of all) {
    const v = normalizeYear(candidate);
    if (v) return v;
  }
  return undefined;
}

function cleanAuthorName(raw: string): string {
  return raw
    .replace(/\b(ד["״']ר|פרופ['׳]|פרופסור|עו["״']ד|רו["״']ח|השופט|השופטת|המנוח|ז["״']ל|מר|גב['׳])\s+/g, "")
    // Strip trailing role suffixes
    .replace(/\s*,\s*(כלכלן(ית)?|חוקר(ת)?|עובד(ת)?|מתמחה|ראש\s+צוות|מנהל(ת)?|יועץ(ת)?|כותב(ת)?|אנליסט(ית)?|רכז(ת)?).*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAuthors(text: string): string | undefined {
  const m = text.match(/כתיבה\s*:\s*([^|\n\r]+?)(?:\s*\|\s*אישור|\s+אישור\s*:|[\n\r])/);
  if (!m) return undefined;
  let raw = m[1].trim();
  raw = cleanAuthorName(raw);
  if (looksScrambled(raw)) return undefined;
  if (raw.length < 3 || raw.length > 80) return undefined;
  if (!hasHebrew(raw)) return undefined;
  return raw;
}

// Final gate before accepting a title candidate.
function isValidTitle(line: string): boolean {
  if (!line) return false;
  if (line.length < 8 || line.length > 120) return false;
  if (!hasHebrew(line)) return false;
  if (looksScrambled(line)) return false;
  if (isBoilerplate(line)) return false;
  // Must have at least 3 Hebrew "words"
  const hebrewWords = (line.match(/[\u0590-\u05FF]+/g) || []).filter((w) => w.length >= 2);
  if (hebrewWords.length < 3) return false;
  // Reject paragraph fragments — colon mid-sentence
  if (/[\u0590-\u05FF]+\s*:\s*\S/.test(line)) return false;
  // Reject mid-sentence cutoff endings
  if (SENTENCE_TAIL_RE.test(line)) return false;
  // Reject lines that end with a comma (clearly cut off)
  if (/,\s*$/.test(line)) return false;
  // Reject prepositional starts (paragraph fragments)
  if (PREPOSITION_PREFIX_RE.test(line)) return false;
  // Heuristic: digit density should be low (titles aren't mostly numbers)
  const digits = (line.match(/\d/g) || []).length;
  if (digits / line.length > 0.2) return false;
  return true;
}

function extractTitle(content: string): Extraction | null {
  const head = content.slice(0, 3000);
  const rawLines = head.split(/\r?\n/).map(cleanLine).filter((l) => l.length > 0);

  const sampleLines = rawLines.slice(0, 25);
  const scrambledCount = sampleLines.filter((l) => looksScrambled(l)).length;
  if (sampleLines.length > 0 && scrambledCount / sampleLines.length > 0.4) {
    return null;
  }

  const date = extractDate(head);
  const year = extractYear(head);
  const authors = extractAuthors(head);

  // Build candidate pool — already validated by isValidTitle
  const candidates: { line: string; idx: number }[] = [];
  rawLines.forEach((line, idx) => {
    if (isValidTitle(line)) candidates.push({ line, idx });
  });

  if (candidates.length === 0) return null;

  // Strategy 1: title appears AFTER a label line
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

  // Strategy 2: title appears AFTER "כתיבה:" / "עריכה לשונית" header block.
  // CRITICAL: must skip date-like lines that happen to follow.
  for (let i = 0; i < rawLines.length - 1; i++) {
    if (/^כתיבה\s*:/.test(rawLines[i]) || /^עריכ(ה|ת)\s+ל?שון/.test(rawLines[i])) {
      for (let j = i + 1; j < Math.min(i + 8, rawLines.length); j++) {
        const cand = candidates.find((c) => c.idx === j);
        if (cand) {
          return { title: cand.line, authors, year, date, method: "after_kativa_header" };
        }
      }
    }
  }

  // No `longest_top_candidate` fallback — flag broken instead of guessing.
  return null;
}

function buildCitation(extraction: Extraction): string {
  const { title, authors, year, date } = extraction;
  const yearForCite = year || normalizeYear(date?.match(/\d{4}/)?.[0]);
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

        // Re-validate the chosen title through the same gate to catch edge cases.
        if (extraction && isValidTitle(extraction.title)) {
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
          console.log(`Recovered: ${doc.id} → "${extraction.title}" [${extraction.method}]${extraction.authors ? ` by ${extraction.authors}` : ""}${extraction.year ? ` (${extraction.year})` : ""}`);
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
