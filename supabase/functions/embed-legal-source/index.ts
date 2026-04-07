import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Chunk text into ~500 token windows with 50-token overlap
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

async function getEmbedding(text: string, apiKey: string): Promise<number[]> {
  // Use Lovable AI Gateway with Gemini to generate embeddings
  // We'll use a completion-based approach to extract embeddings
  const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text,
      dimensions: 768,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("Embedding error:", res.status, errText);
    throw new Error(`Embedding failed: ${res.status}`);
  }

  const data = await res.json();
  return data.data[0].embedding;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth gate - admin only
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

    // Check admin role
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

    const body = await req.json();
    const { source_type, title, content, citation, metadata, source_url } = body;

    if (!source_type || !title || !content || !citation) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: source_type, title, content, citation" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use service role for inserting (bypasses RLS)
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    console.log(`Embedding document: "${title}" (${source_type})`);

    // Generate embedding for full document
    const docEmbedding = await getEmbedding(`${title}\n\n${content.slice(0, 3000)}`, LOVABLE_API_KEY);

    // Insert document
    const { data: doc, error: docError } = await adminClient
      .from("legal_documents")
      .insert({
        source_type,
        title,
        content,
        citation,
        metadata: metadata || {},
        embedding: JSON.stringify(docEmbedding),
        source_url: source_url || null,
      })
      .select("id")
      .single();

    if (docError) {
      console.error("Document insert error:", docError);
      throw new Error(`Failed to insert document: ${docError.message}`);
    }

    // Chunk and embed
    const chunks = chunkText(content);
    console.log(`Processing ${chunks.length} chunks...`);

    const chunkInserts = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunkEmbedding = await getEmbedding(chunks[i], LOVABLE_API_KEY);
      chunkInserts.push({
        document_id: doc.id,
        chunk_index: i,
        content: chunks[i],
        embedding: JSON.stringify(chunkEmbedding),
      });

      // Small delay to avoid rate limiting
      if (i < chunks.length - 1) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    const { error: chunkError } = await adminClient
      .from("legal_document_chunks")
      .insert(chunkInserts);

    if (chunkError) {
      console.error("Chunk insert error:", chunkError);
      throw new Error(`Failed to insert chunks: ${chunkError.message}`);
    }

    console.log(`Successfully embedded document "${title}" with ${chunks.length} chunks`);

    return new Response(
      JSON.stringify({
        success: true,
        document_id: doc.id,
        chunks_count: chunks.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("embed-legal-source error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
