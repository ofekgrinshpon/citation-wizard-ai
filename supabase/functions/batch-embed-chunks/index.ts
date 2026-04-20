import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BATCH_SIZE = 200;                  // chunks fetched per invocation
const MAX_TOKENS_PER_REQUEST = 250_000;  // safety margin under OpenAI's 300K hard cap
const TPM_BUDGET = 800_000;              // safety margin under 1M TPM limit
const MAX_RETRIES_429 = 3;

// Hebrew-aware estimator: ~3.5 chars/token
function estimateTokens(text: string): number {
  return Math.ceil(Math.min(text.length, 8000) / 3.5);
}

interface EmbedResult {
  embeddings: (number[] | null)[];
  rateLimited: number; // count of chunks that hit unrecoverable 429
  tokensUsed: number;  // tokens actually consumed (for TPM tracking)
}

async function embedSubBatch(
  texts: string[],
  apiKey: string,
  estimatedTokens: number,
): Promise<EmbedResult> {
  const truncated = texts.map((t) => t.slice(0, 8000));

  for (let attempt = 0; attempt < MAX_RETRIES_429; attempt++) {
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

      if (res.ok) {
        const data = await res.json();
        const sorted = data.data.sort((a: any, b: any) => a.index - b.index);
        return {
          embeddings: sorted.map((item: any) => item.embedding),
          rateLimited: 0,
          tokensUsed: estimatedTokens,
        };
      }

      const errText = await res.text();

      if (res.status === 429) {
        // Parse "Please try again in X.Xs" or "in Xms"
        let delayMs = 1000;
        const secMatch = errText.match(/try again in ([\d.]+)s/);
        const msMatch = errText.match(/try again in ([\d.]+)ms/);
        if (msMatch) delayMs = Math.ceil(parseFloat(msMatch[1]));
        else if (secMatch) delayMs = Math.ceil(parseFloat(secMatch[1]) * 1000);
        delayMs += 500; // jitter

        console.warn(`429 rate-limited, attempt ${attempt + 1}/${MAX_RETRIES_429}, sleeping ${delayMs}ms`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      // Non-429 error (e.g. 400, 500): no retry
      console.error("Embedding batch error:", res.status, errText);
      return { embeddings: texts.map(() => null), rateLimited: 0, tokensUsed: 0 };
    } catch (err) {
      console.error("Embedding batch failed (network):", err);
      return { embeddings: texts.map(() => null), rateLimited: 0, tokensUsed: 0 };
    }
  }

  // Exhausted retries on 429
  console.error(`429 retries exhausted for sub-batch of ${texts.length}`);
  return { embeddings: texts.map(() => null), rateLimited: texts.length, tokensUsed: 0 };
}

// Pack chunks into sub-batches by token budget (≤ MAX_TOKENS_PER_REQUEST each)
function packSubBatches<T extends { content: string }>(chunks: T[]): { items: T[]; tokens: number }[] {
  const batches: { items: T[]; tokens: number }[] = [];
  let current: T[] = [];
  let currentTokens = 0;

  for (const chunk of chunks) {
    const t = estimateTokens(chunk.content);
    // If a single chunk exceeds the budget, send it alone (will be truncated to 8K chars anyway)
    if (t > MAX_TOKENS_PER_REQUEST) {
      if (current.length) {
        batches.push({ items: current, tokens: currentTokens });
        current = [];
        currentTokens = 0;
      }
      batches.push({ items: [chunk], tokens: Math.min(t, MAX_TOKENS_PER_REQUEST) });
      continue;
    }
    if (currentTokens + t > MAX_TOKENS_PER_REQUEST && current.length > 0) {
      batches.push({ items: current, tokens: currentTokens });
      current = [];
      currentTokens = 0;
    }
    current.push(chunk);
    currentTokens += t;
  }
  if (current.length) batches.push({ items: current, tokens: currentTokens });
  return batches;
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
        rate_limited: 0,
        remaining: count || 0,
        batch_size: 0,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const subBatches = packSubBatches(chunks);

    let processed = 0;
    let failed = 0;
    let rateLimited = 0;

    // Rolling 60s token-usage window for TPM budget
    const tokenWindow: { ts: number; tokens: number }[] = [];
    const usedInLast60s = () => {
      const cutoff = Date.now() - 60_000;
      while (tokenWindow.length && tokenWindow[0].ts < cutoff) tokenWindow.shift();
      return tokenWindow.reduce((s, e) => s + e.tokens, 0);
    };

    for (const sb of subBatches) {
      // TPM budget gate
      const used = usedInLast60s();
      if (used + sb.tokens > TPM_BUDGET) {
        const oldest = tokenWindow[0]?.ts ?? Date.now();
        const waitMs = Math.max(500, 60_000 - (Date.now() - oldest) + 500);
        console.log(`TPM budget gate: used=${used}, need=${sb.tokens}, waiting ${waitMs}ms`);
        await new Promise((r) => setTimeout(r, Math.min(waitMs, 60_000)));
      }

      const texts = sb.items.map((c) => c.content);
      const result = await embedSubBatch(texts, OPENAI_API_KEY, sb.tokens);

      if (result.tokensUsed > 0) {
        tokenWindow.push({ ts: Date.now(), tokens: result.tokensUsed });
      }
      rateLimited += result.rateLimited;

      // Update DB for successful embeddings
      for (let i = 0; i < sb.items.length; i++) {
        if (result.embeddings[i]) {
          const { error: updateErr } = await adminClient
            .from("legal_document_chunks")
            .update({ embedding: JSON.stringify(result.embeddings[i]) })
            .eq("id", sb.items[i].id);

          if (updateErr) {
            console.error(`Update error for chunk ${sb.items[i].id}:`, updateErr);
            failed++;
          } else {
            processed++;
          }
        } else if (result.rateLimited === 0) {
          // Genuine non-429 failure (400, 500, network)
          failed++;
        }
        // If rateLimited > 0, those chunks stay embedding IS NULL → next invocation picks them up.
        // Don't count them as "failed" — they're retryable.
      }
    }

    const { count: remaining } = await adminClient
      .from("legal_document_chunks")
      .select("id", { count: "exact", head: true })
      .is("embedding", null);

    console.log(`Batch complete: ${processed} processed, ${failed} failed, ${rateLimited} rate-limited, ${remaining} remaining`);

    return new Response(JSON.stringify({
      processed,
      failed,
      rate_limited: rateLimited,
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
