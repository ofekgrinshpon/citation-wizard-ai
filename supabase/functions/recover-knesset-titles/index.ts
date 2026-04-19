import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PLACEHOLDER_TITLES = new Set(["פרטי מסמך", "ללא כותרת", ""]);

const HEBREW_MONTHS = [
  "ינואר","פברואר","מרץ","מרס","אפריל","מאי","יוני","יולי",
  "אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר",
];

// Lines we never accept as titles
const BOILERPLATE_PATTERNS: RegExp[] = [
  /מרכז\s+המחקר\s+והמידע/,
  /knesset\.gov\.il/i,
  /^כתיבה\s*[:|]/,
  /^אישור\s*[:|]/,
  /^עריכה\s+לשונית/,
  /^תאריך\s*[:|]/,
  /^תוכן\s+(ה?עניינים|ענייני)/,
  /^מבוא(\s|$)/,
  /^תמצית(\s|$)/,
  /^רקע(\s|$)/,
  /^סקירה(\s+(משפטית|כלכלית|השוואתית|משווה))?$/,
  /^ניתוח\s+(תקציבי|כלכלי|משפטי)$/,
  /^מסמך\s+רקע$/,
  /^מסמך\s+זה\s+נכתב/,
  /^הוכן\s+(עבור|ל)/,
  /^\d+(\.\d+)*\.?\s*$/,                    // pure numbering "1.", "1.2"
  /^[.\s\-–—_=]+$/,                          // separators / dots
  /^עמוד\s*\d+/,
  /^www\./i,
];

const isBoilerplate = (line: string): boolean =>
  BOILERPLATE_PATTERNS.some((p) => p.test(line));

// Hebrew letter present
const hasHebrew = (s: string): boolean => /[\u0590-\u05FF]/.test(s);

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
  date?: string;
  method: string;
}

function extractDate(text: string): string | undefined {
  // 12 בנובמבר 2024  /  6 בספטמבר 2022
  const m1 = text.match(
    new RegExp(`\\b\\d{1,2}\\s+ב?(${HEBREW_MONTHS.join("|")})\\s+\\d{4}\\b`),
  );
  if (m1) return m1[0].replace(/\s+/g, " ").trim();
  // 30.10.2022
  const m2 = text.match(/\b\d{1,2}\.\d{1,2}\.\d{4}\b/);
  if (m2) return m2[0];
  return undefined;
}

function extractTitle(content: string): Extraction | null {
  const head = content.slice(0, 2500);
  const rawLines = head.split(/\r?\n/).map(cleanLine).filter((l) => l.length > 0);

  const date = extractDate(head);

  // Build a candidate pool: lines that look like a real title.
  // A "good" title line: 12–180 chars, has Hebrew, not boilerplate, not mostly digits.
  const candidates: { line: string; idx: number }[] = [];
  rawLines.forEach((line, idx) => {
    if (line.length < 12 || line.length > 180) return;
    if (!hasHebrew(line)) return;
    if (isBoilerplate(line)) return;
    // skip lines that are mostly dots/digits (TOC entries)
    const dotCount = (line.match(/\./g) || []).length;
    if (dotCount > 6) return;
    if (/^\d/.test(line)) return;
    candidates.push({ line, idx });
  });

  if (candidates.length === 0) return null;

  // Strategy 1: line that comes RIGHT AFTER a "מרכז המחקר והמידע" line
  for (let i = 0; i < rawLines.length - 1; i++) {
    if (/מרכז\s+המחקר\s+והמידע/.test(rawLines[i])) {
      // look at the next 1-3 lines for the first valid candidate
      for (let j = i + 1; j < Math.min(i + 5, rawLines.length); j++) {
        const cand = candidates.find((c) => c.idx === j);
        if (cand) {
          return { title: cand.line, date, method: "after_mmm_header" };
        }
      }
    }
  }

  // Strategy 2: longest candidate within first 15 candidates (the substantive title
  // is usually longer than category labels like "סקירה")
  const topPool = candidates.slice(0, 15);
  topPool.sort((a, b) => b.line.length - a.line.length);
  return { title: topPool[0].line, date, method: "longest_top_candidate" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Admin-only: validate JWT and check role
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

    // Fetch a batch of broken-title knesset docs that haven't been flagged yet
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

        if (extraction && extraction.title.length >= 12) {
          const dateSuffix = extraction.date ? `, ${extraction.date}` : "";
          const newCitation = `${extraction.title} (מרכז המחקר והמידע של הכנסת${dateSuffix})`;
          const newMeta = {
            ...((doc.metadata as Record<string, unknown>) || {}),
            recovered_title: true,
            recovery_method: extraction.method,
            recovered_at: new Date().toISOString(),
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
          console.log(`Recovered: ${doc.id} → "${extraction.title}" [${extraction.method}]`);
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
          console.log(`Flagged broken: ${doc.id}`);
        }
      } catch (e) {
        failed++;
        console.error(`Doc ${doc.id} failed:`, e instanceof Error ? e.message : e);
      }
    }

    // Count remaining unprocessed (still placeholder + not yet flagged)
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
