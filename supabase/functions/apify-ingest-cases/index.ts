import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { unzipSync } from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function chunkText(text: string, chunkSize = 1500, overlap = 150): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = end - overlap;
  }
  return chunks;
}

async function extractTextFromDocxUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });
    if (!res.ok) {
      console.error(`DOCX fetch failed: ${res.status} for ${url}`);
      return null;
    }
    const buffer = await res.arrayBuffer();
    const unzipped = unzipSync(new Uint8Array(buffer));

    const docXmlBytes = unzipped["word/document.xml"];
    if (!docXmlBytes) {
      console.error("No word/document.xml found in DOCX");
      return null;
    }

    const xmlContent = new TextDecoder().decode(docXmlBytes);

    const textParts: string[] = [];
    const tagRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    let m;
    while ((m = tagRegex.exec(xmlContent)) !== null) {
      textParts.push(m[1]);
    }

    const rawText = textParts.join(" ");
    const cleaned = rawText.replace(/\s+/g, " ").trim();

    return cleaned || null;
  } catch (err) {
    console.error("DOCX extraction failed:", err);
    return null;
  }
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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const cases: Array<Record<string, string | null>> = Array.isArray(body) ? body : body.cases || [];

    if (!cases.length) {
      return new Response(JSON.stringify({ error: "No cases provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (cases.length > 0) {
      console.log("First item keys:", Object.keys(cases[0]).join(", "));
      console.log("First item sample:", JSON.stringify(cases[0]).slice(0, 500));
    }

    const results = { inserted: 0, skipped: 0, failed: [] as Array<{ title: string; error: string }> };

    for (const caseItem of cases) {
      const title = caseItem.title || caseItem.case_number || "ללא כותרת";

      if (title.includes("תקציר")) {
        results.skipped++;
        console.log(`Skipped summary: ${title}`);
        continue;
      }

      if (caseItem.case_number) {
        const { data: existing } = await adminClient
          .from("legal_documents")
          .select("id")
          .eq("case_number", caseItem.case_number)
          .maybeSingle();
        if (existing) {
          results.skipped++;
          console.log(`Skipped duplicate: ${title} (${caseItem.case_number})`);
          continue;
        }
      }

      try {
        let content: string | null = caseItem.page_text || null;
        if (content) {
          console.log(`Using page_text for: ${title} (${content.length} chars)`);
        }

        if (!content && caseItem.docx_url) {
          console.log(`Attempting DOCX fallback for: ${title}`);
          content = await extractTextFromDocxUrl(caseItem.docx_url);
          if (content) {
            console.log(`DOCX extracted: ${content.length} chars`);
          } else {
            console.log(`DOCX extraction failed for: ${title}`);
          }
        }

        if (!content) {
          content = caseItem.content || "";
        }

        const citation = caseItem.case_number
          ? `${caseItem.case_number}${caseItem.court ? ` (${caseItem.court})` : ""}`
          : title;

        const metadata = {
          court: caseItem.court || null,
          judges: caseItem.judges || null,
          procedure_type: caseItem.procedure_type || null,
          district: caseItem.district || null,
        };

        const docFields = {
          source_type: "caselaw",
          title,
          content: content && content.trim().length >= 50 ? content : title,
          citation,
          metadata,
          court: caseItem.court || null,
          decision_date: caseItem.decision_date || null,
          case_number: caseItem.case_number || null,
          judges: caseItem.judges || null,
          procedure_type: caseItem.procedure_type || null,
          district: caseItem.district || null,
          docx_url: caseItem.docx_url || null,
          pdf_url: caseItem.pdf_url || null,
          scraped_at: caseItem.scraped_at || new Date().toISOString(),
          source_url: caseItem.source_url || null,
          embedding: null,
        };

        if (!content || content.trim().length < 50) {
          const { error: docError } = await adminClient
            .from("legal_documents")
            .insert({
              ...docFields,
              ingestion_status: "partial_failure",
              ingestion_error: "No extractable text content",
            });

          if (docError) {
            results.failed.push({ title, error: `DB insert: ${docError.message}` });
          } else {
            results.failed.push({ title, error: "No text – saved metadata only" });
          }
          continue;
        }

        // Insert document — no embedding, mark complete immediately
        const { data: doc, error: docError } = await adminClient
          .from("legal_documents")
          .insert({
            ...docFields,
            ingestion_status: "complete",
          })
          .select("id")
          .single();

        if (docError) {
          results.failed.push({ title, error: `DB insert: ${docError.message}` });
          continue;
        }

        // Chunk text and store — no embeddings
        const chunks = chunkText(content);
        const chunkInserts = chunks.map((chunk, i) => ({
          document_id: doc.id,
          chunk_index: i,
          content: chunk,
          embedding: null,
        }));

        await adminClient.from("legal_document_chunks").insert(chunkInserts);

        results.inserted++;
        console.log(`Ingested: ${title} (${chunks.length} chunks)`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        results.failed.push({ title, error: errMsg });
        console.error(`Failed to process "${title}":`, errMsg);
      }
    }

    console.log(`Ingestion complete: ${results.inserted} inserted, ${results.skipped} skipped, ${results.failed.length} failed`);

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("apify-ingest-cases error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
