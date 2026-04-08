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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roleData } = await supabase
      .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleData) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get failed documents
    const { data: failedDocs, error: fetchErr } = await adminClient
      .from("legal_documents")
      .select("id, title, content")
      .eq("ingestion_status", "partial_failure")
      .limit(50);

    if (fetchErr) throw new Error(`Failed to fetch: ${fetchErr.message}`);
    if (!failedDocs?.length) {
      return new Response(JSON.stringify({ retried: 0, succeeded: 0, still_failed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let succeeded = 0;
    let stillFailed = 0;

    for (const doc of failedDocs) {
      try {
        // Delete any existing chunks for this doc (partial state)
        await adminClient.from("legal_document_chunks").delete().eq("document_id", doc.id);

        const docEmbedding = await getEmbedding(`${doc.title}\n\n${doc.content.slice(0, 3000)}`, LOVABLE_API_KEY);
        const chunks = chunkText(doc.content);
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
        await adminClient.from("legal_documents").update({
          embedding: docEmbedding ? JSON.stringify(docEmbedding) : null,
          ingestion_status: "complete",
          ingestion_error: null,
        }).eq("id", doc.id);

        succeeded++;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        await adminClient.from("legal_documents").update({
          ingestion_error: errMsg,
        }).eq("id", doc.id);
        stillFailed++;
      }
    }

    return new Response(JSON.stringify({ retried: failedDocs.length, succeeded, still_failed: stillFailed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("retry-failed-ingestion error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
