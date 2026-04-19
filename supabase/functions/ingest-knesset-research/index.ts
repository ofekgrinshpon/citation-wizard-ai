import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Token-based auth against APIFY_API_TOKEN
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const expectedToken = Deno.env.get("APIFY_API_TOKEN");
    if (!expectedToken || token !== expectedToken) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const documents: Array<Record<string, unknown>> = Array.isArray(body)
      ? body
      : body.documents || [];

    if (!documents.length) {
      return new Response(JSON.stringify({ error: "No documents provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Received ${documents.length} documents for ingestion`);

    const results = {
      inserted: 0,
      skipped: 0,
      failed: [] as Array<{ title: string; error: string }>,
    };

    for (const doc of documents) {
      const title = (doc.title as string) || "ללא כותרת";
      const content = (doc.content as string) || "";
      const sourceUrl = (doc.source_url as string) || null;
      const pdfUrl = (doc.pdf_url as string) || null;
      const decisionDate = (doc.decision_date as string) || null;
      const metadata = (doc.metadata as Record<string, unknown>) || {};

      // Reject documents with placeholder/empty titles to keep the corpus clean.
      const titleTrim = title.trim();
      if (titleTrim === "" || titleTrim === "פרטי מסמך" || titleTrim === "ללא כותרת") {
        results.failed.push({ title: titleTrim || "(empty)", error: "placeholder title rejected" });
        console.log(`Rejected placeholder-titled doc (url=${sourceUrl})`);
        continue;
      }

      // Deduplicate by source_url
      if (sourceUrl) {
        const { data: existing } = await adminClient
          .from("legal_documents")
          .select("id")
          .eq("source_url", sourceUrl)
          .maybeSingle();
        if (existing) {
          results.skipped++;
          console.log(`Skipped duplicate: ${title}`);
          continue;
        }
      }

      try {
        const citation = title;
        const docFields = {
          source_type: (doc.source_type as string) || "knesset_research",
          title,
          content: content.trim().length >= 50 ? content : title,
          citation,
          metadata,
          pdf_url: pdfUrl,
          source_url: sourceUrl,
          decision_date: decisionDate,
          scraped_at: new Date().toISOString(),
          embedding: null,
        };

        if (!content || content.trim().length < 50) {
          await adminClient.from("legal_documents").insert({
            ...docFields,
            ingestion_status: "partial_failure",
            ingestion_error: "No extractable text content",
          });
          results.failed.push({ title, error: "No text – saved metadata only" });
          continue;
        }

        const { data: inserted, error: docError } = await adminClient
          .from("legal_documents")
          .insert({ ...docFields, ingestion_status: "complete" })
          .select("id")
          .single();

        if (docError) {
          results.failed.push({ title, error: `DB insert: ${docError.message}` });
          continue;
        }

        const chunks = chunkText(content);
        const chunkInserts = chunks.map((chunk, i) => ({
          document_id: inserted.id,
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
        console.error(`Failed: "${title}":`, errMsg);
      }
    }

    console.log(
      `Done: ${results.inserted} inserted, ${results.skipped} skipped, ${results.failed.length} failed`
    );

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ingest-knesset-research error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
