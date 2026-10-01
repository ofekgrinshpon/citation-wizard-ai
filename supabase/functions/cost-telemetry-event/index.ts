/**
 * Metadata-only zero-work cost events reported by the signed-in client
 * (verified-store hits, local deterministic formatter, footnote→bibliography
 * import). Strict allowlist; provider is always "none" and USD always 0 —
 * this route can never record or forge a paid provider attempt.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { writeWithRetry } from "../_shared/costTelemetry.ts";
import { buildClientEvents } from "./validate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return json({ error: "missing_authorization" }, 401);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) return json({ error: "unauthorized" }, 401);
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > 8192) return json({ error: "too_large" }, 413);
  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const rows = buildClientEvents(body);
  if (!rows) return json({ error: "invalid_events" }, 400);
  const r = await writeWithRetry(rows);
  return json({ ok: r.ok }, r.ok ? 202 : 503);
});
