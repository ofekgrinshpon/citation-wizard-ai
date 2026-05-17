// Pass E — polling endpoint for Deep async runs.
// Client polls this with { runId } (POST) or ?runId=... (GET) and gets the
// current status, checkpoint, stage_runs, and — once completed — the final
// answer + footnotes. RLS on qa_logs ensures users only see their own rows.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function deriveStatus(metadata: Record<string, unknown> | null, hasAnswer: boolean): string {
  const cp = (metadata?.checkpoint as string | undefined) ?? null;
  if (hasAnswer) return "completed";
  if (cp === "failed" || cp === "error" || cp === "drafting_failed") return "failed";
  if (cp === "queued") return "queued";
  if (cp) return "running";
  return "running";
}

Deno.serve(async (req) => {
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

    let runId: string | null = null;
    if (req.method === "GET") {
      runId = new URL(req.url).searchParams.get("runId");
    } else {
      try {
        const body = await req.json();
        if (typeof body?.runId === "string") runId = body.runId;
      } catch { /* empty body */ }
    }
    if (!runId || !/^[0-9a-f-]{36}$/i.test(runId)) {
      return new Response(JSON.stringify({ error: "Invalid or missing runId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use the caller's JWT so RLS enforces "users read own qa_logs".
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: row, error } = await supabase
      .from("qa_logs")
      .select("id, question, answer, footnotes, total_footnotes, local_footnotes_count, perplexity_footnotes_count, metadata, created_at")
      .eq("id", runId)
      .maybeSingle();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!row) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const metadata = (row.metadata as Record<string, unknown> | null) ?? null;
    const hasAnswer = typeof row.answer === "string" && row.answer.length > 0;
    const status = deriveStatus(metadata, hasAnswer);

    const stageRuns = Array.isArray(metadata?.stage_runs) ? (metadata!.stage_runs as Array<Record<string, unknown>>) : [];
    const lastStage = stageRuns.length ? stageRuns[stageRuns.length - 1] : null;

    return new Response(
      JSON.stringify({
        run_id: row.id,
        status,
        checkpoint: metadata?.checkpoint ?? null,
        checkpoint_at: metadata?.checkpoint_at ?? null,
        progress: {
          stages_completed: stageRuns.length,
          last_stage: lastStage?.stage ?? null,
          last_stage_status: lastStage?.status ?? null,
        },
        // Only return heavy payloads when terminal.
        ...(status === "completed" ? {
          question: row.question,
          answer: row.answer,
          footnotes: row.footnotes,
          total_footnotes: row.total_footnotes,
          local_footnotes_count: row.local_footnotes_count,
          perplexity_footnotes_count: row.perplexity_footnotes_count,
        } : {}),
        ...(status === "failed" ? {
          drafter_failure: metadata?.drafter_failure ?? null,
          error_message: metadata?.error_message ?? null,
        } : {}),
        // Lightweight metadata always useful for the UI / admins.
        metadata_summary: {
          depth: metadata?.depth ?? null,
          pass_d_compact: metadata?.pass_d_compact ?? null,
          models_used: metadata?.models_used ?? null,
          stage_runs: stageRuns,
        },
        created_at: row.created_at,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("legal-qa-status error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
