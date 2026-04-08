import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    const APIFY_API_TOKEN = Deno.env.get("APIFY_API_TOKEN");
    if (!APIFY_API_TOKEN) {
      return new Response(JSON.stringify({ error: "APIFY_API_TOKEN not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const actorId = body.actorId || "";
    const datasetId = body.datasetId || "";

    if (!actorId && !datasetId) {
      return new Response(
        JSON.stringify({ error: "Provide either actorId or datasetId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build Apify API URL
    let apiUrl: string;
    if (datasetId) {
      apiUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_TOKEN}&format=json`;
    } else {
      // Apify API requires tilde (~) between username and actor name, not slash
      const normalizedActorId = actorId.replace("/", "~");
      apiUrl = `https://api.apify.com/v2/acts/${normalizedActorId}/runs/last/dataset/items?token=${APIFY_API_TOKEN}&format=json`;
    }

    console.log(`Fetching from Apify: ${apiUrl.replace(APIFY_API_TOKEN, "***")}`);

    const apifyRes = await fetch(apiUrl);
    if (!apifyRes.ok) {
      const errText = await apifyRes.text();
      console.error("Apify API error:", apifyRes.status, errText);
      return new Response(
        JSON.stringify({ error: `Apify API error: ${apifyRes.status}`, details: errText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const items = await apifyRes.json();
    console.log(`Fetched ${Array.isArray(items) ? items.length : 0} items from Apify`);

    return new Response(JSON.stringify({ items, count: Array.isArray(items) ? items.length : 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("fetch-apify-dataset error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
