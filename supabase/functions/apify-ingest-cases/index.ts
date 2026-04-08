import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

async function getEmbedding(text: string, apiKey: string): Promise<number[] | null> {
  try {
    const truncated = text.slice(0, 2000);
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content: `You are an embedding generator. Given text, output ONLY a JSON array of exactly 768 floating-point numbers between -1 and 1 that represent the semantic meaning of the text. Output nothing else — no explanation, no markdown, just the raw JSON array.`,
          },
          { role: "user", content: truncated },
        ],
        temperature: 0,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) return null;
    const arr = JSON.parse(match[0]);
    if (!Array.isArray(arr) || arr.length !== 768) return null;
    return arr;
  } catch {
    return null;
  }
}

async function extractTextFromDocxUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    // Use mammoth via esm.sh
    const mammoth = await import("https://esm.sh/mammoth@1.12.0");
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return result.value || null;
  } catch (err) {
    console.error("DOCX extraction failed:", err);
    return null;
  }
}

async function extractTextFromPdfUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    // Simple fallback: return null since PDF extraction in Deno is complex
    // The docx path is the primary one
    console.log("PDF extraction not implemented server-side, skipping");
    return null;
  } catch {
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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

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

    const results = { inserted: 0, skipped: 0, failed: [] as Array<{ title: string; error: string }> };

    for (const caseItem of cases) {
      const title = caseItem.title || caseItem.case_number || "ללא כותרת";

      // Skip summaries (תקציר)
      if (title.includes("תקציר")) {
        results.skipped++;
        console.log(`Skipped summary: ${title}`);
        continue;
      }

      try {
        // Extract text from docx (preferred) or pdf
        let content: string | null = null;
        if (caseItem.docx_url) {
          content = await extractTextFromDocxUrl(caseItem.docx_url);
        }
        if (!content && caseItem.pdf_url) {
          content = await extractTextFromPdfUrl(caseItem.pdf_url);
        }
        if (!content) {
          // Use whatever text we have from the scraped page
          content = caseItem.page_text || caseItem.content || "";
        }
        if (!content || content.trim().length < 50) {
          results.failed.push({ title, error: "No extractable text content" });
          continue;
        }

        // Build citation string
        const citation = caseItem.case_number
          ? `${caseItem.case_number}${caseItem.court ? ` (${caseItem.court})` : ""}`
          : title;

        // Insert document with pending status
        const { data: doc, error: docError } = await adminClient
          .from("legal_documents")
          .insert({
            source_type: "caselaw",
            title,
            content,
            citation,
            metadata: {
              court: caseItem.court || null,
              judges: caseItem.judges || null,
              procedure_type: caseItem.procedure_type || null,
              district: caseItem.district || null,
            },
            court: caseItem.court || null,
            decision_date: caseItem.decision_date || null,
            case_number: caseItem.case_number || null,
            judges: caseItem.judges || null,
            procedure_type: caseItem.procedure_type || null,
            district: caseItem.district || null,
            docx_url: caseItem.docx_url || null,
            pdf_url: caseItem.pdf_url || null,
            scraped_at: caseItem.scraped_at || new Date().toISOString(),
            ingestion_status: "pending",
            source_url: caseItem.source_url || null,
          })
          .select("id")
          .single();

        if (docError) {
          results.failed.push({ title, error: `DB insert: ${docError.message}` });
          continue;
        }

        // Attempt chunking + embedding
        try {
          const docEmbedding = await getEmbedding(`${title}\n\n${content.slice(0, 3000)}`, LOVABLE_API_KEY);
          const chunks = chunkText(content);
          const chunkInserts = [];

          for (let i = 0; i < chunks.length; i++) {
            let chunkEmbedding: number[] | null = null;
            if (docEmbedding) {
              chunkEmbedding = await getEmbedding(chunks[i], LOVABLE_API_KEY);
              if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, 300));
            }
            chunkInserts.push({
              document_id: doc.id,
              chunk_index: i,
              content: chunks[i],
              embedding: chunkEmbedding ? JSON.stringify(chunkEmbedding) : null,
            });
          }

          await adminClient.from("legal_document_chunks").insert(chunkInserts);

          // Update document embedding and status to complete
          await adminClient
            .from("legal_documents")
            .update({
              embedding: docEmbedding ? JSON.stringify(docEmbedding) : null,
              ingestion_status: "complete",
              ingestion_error: null,
            })
            .eq("id", doc.id);

          results.inserted++;
          console.log(`Ingested: ${title} (${chunks.length} chunks)`);
        } catch (embeddingErr) {
          // Document inserted but embedding failed — mark as partial_failure
          const errMsg = embeddingErr instanceof Error ? embeddingErr.message : "Unknown embedding error";
          await adminClient
            .from("legal_documents")
            .update({
              ingestion_status: "partial_failure",
              ingestion_error: errMsg,
            })
            .eq("id", doc.id);

          results.failed.push({ title, error: `Embedding: ${errMsg}` });
          console.error(`Partial failure for "${title}":`, errMsg);
        }
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
