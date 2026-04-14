import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BATCH_SIZE = 500;
const SUB_BATCH_SIZE = 50;
const MAX_RETRIES = 3;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getEmbeddingsBatch(
  texts: string[],
  apiKey: string
): Promise<(number[] | null)[]> {
  const truncated = texts.map((t) => t.slice(0, 8000));

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
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

      if (res.status === 429) {
        const errBody = await res.text();
        const waitMatch = errBody.match(/try again in ([\d.]+)s/i);
        const waitSec = waitMatch ? parseFloat(waitMatch[1]) : 2;
        const backoff = Math.min(waitSec * 1000 + Math.random() * 500, 10000);
        console.warn(
          `Rate limited (attempt ${attempt + 1}/${MAX_RETRIES + 1}), waiting ${(backoff / 1000).toFixed(1)}s`
        );
        if (attempt < MAX_RETRIES) {
          await sleep(backoff);
          continue;
        }
        console.error("Rate limit retries exhausted");
        return texts.map(() => null);
      }

      if (!res.ok) {
        const errText = await res.text();
        console.error("Embedding batch error:", res.status, errText);
        return texts.map(() => null);
      }

      const data = await res.json();
      const sorted = data.data.sort((a: any, b: any) => a.index - b.index);
      return sorted.map((item: any) => item.embedding);
    } catch (err) {
      console.error(`Embedding fetch error (attempt ${attempt + 1}):`, err);
      if (attempt < MAX_RETRIES) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      return texts.map(() => null);
    }
  }
  return texts.map(() => null);
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

    // Use anon client for auth check
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await anonClient.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roleData } = await anonClient
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

    // Service role client for DB operations
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch chunks that need embeddings (only id + content needed now)
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

      return new Response(
        JSON.stringify({
          processed: 0,
          failed: 0,
          remaining: count ?? 0,
          batch_size: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let processed = 0;
    let failed = 0;

    for (let start = 0; start < chunks.length; start += SUB_BATCH_SIZE) {
      const subChunks = chunks.slice(start, start + SUB_BATCH_SIZE);
      const texts = subChunks.map((c) => c.content);
      const embeddings = await getEmbeddingsBatch(texts, OPENAI_API_KEY);

      // Build compact payload: only id + embedding
      const payload: { id: string; embedding: string }[] = [];
      let subFailed = 0;
      for (let i = 0; i < subChunks.length; i++) {
        if (embeddings[i]) {
          payload.push({
            id: subChunks[i].id,
            embedding: JSON.stringify(embeddings[i]),
          });
        } else {
          subFailed++;
        }
      }

      if (payload.length > 0) {
        // Call the lightweight RPC instead of heavy upsert
        const { data: updatedCount, error: rpcErr } = await adminClient.rpc(
          "bulk_update_legal_chunk_embeddings",
          { payload: JSON.stringify(payload) }
        );

        if (rpcErr) {
          console.error("RPC bulk_update error:", rpcErr);
          failed += payload.length;
        } else {
          processed += Number(updatedCount) || payload.length;
        }
      }

      failed += subFailed;

      // Delay between sub-batches to avoid rate limits
      if (start + SUB_BATCH_SIZE < chunks.length) {
        await sleep(1000);
      }
    }

    // Get accurate remaining count
    const { count: remainingCount, error: countErr } = await adminClient
      .from("legal_document_chunks")
      .select("id", { count: "exact", head: true })
      .is("embedding", null);

    if (countErr) {
      console.error("Count query error:", countErr);
    }

    const remaining = remainingCount ?? null;

    console.log(
      `Batch complete: ${processed} processed, ${failed} failed, ${remaining} remaining`
    );

    return new Response(
      JSON.stringify({
        processed,
        failed,
        remaining,
        batch_size: chunks.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("batch-embed-chunks error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
