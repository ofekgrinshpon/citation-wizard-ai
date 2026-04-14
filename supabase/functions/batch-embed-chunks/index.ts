import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BATCH_SIZE = 2048;

async function getEmbeddingsBatch(texts: string[], apiKey: string): Promise<(number[] | null)[]> {
  try {
    const truncated = texts.map(t => t.slice(0, 8000));
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: truncated,
        dimensions: 768,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Embedding batch error:", res.status, errText);
      return texts.map(() => null);
    }

    const data = await res.json();
    // OpenAI returns embeddings sorted by index
    const sorted = data.data.sort((a: any, b: any) => a.index - b.index);
    return sorted.map((item: any) => item.embedding);
  } catch (err) {
    console.error("Embedding batch failed:", err);
    return texts.map(() => null);
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

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: chunks, error: fetchErr } = await adminClient
      .from("legal_document_chunks")
      .select("id, content")
      .is("embedding", null)
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (fetchErr) throw new Error(`Failed to fetch chunks: ${fetchErr.message}`);

    if (!chunks || chunks.length === 0) {
      const { count } = await adminClient
        .from("legal_document_chunks")
        .select("id", { count: "exact", head: true })
        .is("embedding", null);

      return new Response(JSON.stringify({
        processed: 0,
        failed: 0,
        remaining: count || 0,
        batch_size: 0,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Single batch API call for all chunks
    const texts = chunks.map(c => c.content);
    const embeddings = await getEmbeddingsBatch(texts, OPENAI_API_KEY);

    let processed = 0;
    let failed = 0;

    // Update all chunks with their embeddings
    for (let i = 0; i < chunks.length; i++) {
      if (embeddings[i]) {
        const { error: updateErr } = await adminClient
          .from("legal_document_chunks")
          .update({ embedding: JSON.stringify(embeddings[i]) })
          .eq("id", chunks[i].id);

        if (updateErr) {
          console.error(`Update error for chunk ${chunks[i].id}:`, updateErr);
          failed++;
        } else {
          processed++;
        }
      } else {
        failed++;
      }
    }

    const { count: remaining } = await adminClient
      .from("legal_document_chunks")
      .select("id", { count: "exact", head: true })
      .is("embedding", null);

    console.log(`Batch complete: ${processed} processed, ${failed} failed, ${remaining} remaining`);

    return new Response(JSON.stringify({
      processed,
      failed,
      remaining: remaining || 0,
      batch_size: chunks.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("batch-embed-chunks error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
