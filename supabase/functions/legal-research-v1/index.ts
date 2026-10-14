// Retain the V1 URL for old clients, but never start or resume research here.
// Historical stage/lib modules remain available to imports and regression tests.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function handle(req: Request): Response {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // This public, static notice says nothing about prior jobs or their charges.
  // Do not inspect auth, read the body, access resources, or redirect to V2.
  return new Response(JSON.stringify({
    error: "RESEARCH_VERSION_RETIRED",
    code: "RESEARCH_VERSION_RETIRED",
    message: "גרסת המחקר הישנה הוצאה משימוש. יש לרענן את העמוד כדי להשתמש בגרסה העדכנית. הבקשה הזו לא התחילה מחקר ולא צרכה יחידות שימוש.",
    refresh_required: true,
    execution_started: false,
    units_consumed: 0,
  }), {
    status: 410,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(handle);
