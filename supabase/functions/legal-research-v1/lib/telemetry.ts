// qa_logs writer for legal-research-v1.
// One row per run; metadata carries the full planning trace.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export type AdminClient = ReturnType<typeof createClient>;

export function makeAdminClient(): AdminClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

export interface TelemetryRow {
  user_id: string;
  project_id: string | null;
  question: string;
  metadata: Record<string, unknown>;
  // stub answer fields — kept for shape compatibility with qa_logs
  answer: string;
  footnotes: unknown[];
  // Optional override; defaults to "legal_research_v1" (drafter pipeline).
  // The sources-only mode passes "legal_source_search".
  task_mode?: string;
  /** When set, the terminal write UPDATEs this pre-created trace row instead
   *  of inserting a second row. */
  row_id?: string | null;
}

/**
 * Create an in-progress trace row *before* expensive retrieval work starts, so
 * an isolate kill still leaves a durable record of the run.
 *
 * The row is explicitly marked in-progress: no answer text, no footnotes, no
 * used sources, no final branch. Never surfaced as a QA result.
 */
export async function beginTraceRow(
  admin: AdminClient,
  row: {
    user_id: string;
    project_id: string | null;
    question: string;
    run_id: string;
    task_mode?: string;
    trace_stage?: string;
    detail?: Record<string, unknown>;
  },
): Promise<string | null> {
  try {
    const { data, error } = await admin.from("qa_logs").insert({
      user_id: row.user_id,
      project_id: row.project_id,
      question: row.question,
      answer: "",
      task_mode: row.task_mode ?? "legal_research_v1",
      footnotes: [],
      local_footnotes_count: 0,
      perplexity_footnotes_count: 0,
      total_footnotes: 0,
      metadata: {
        pipeline: "legal-research-v1",
        run_id: row.run_id,
        trace_stage: row.trace_stage ?? "retrieval_entering",
        trace_status: "in_progress",
        trace_started_at: new Date().toISOString(),
        ...(row.detail ?? {}),
      },
    }).select("id").single();
    if (error || !data) {
      console.error("[legal-research-v1] trace row insert failed:", error);
      return null;
    }
    return String((data as { id: string }).id);
  } catch (e) {
    console.error("[legal-research-v1] trace row insert threw:", e);
    return null;
  }
}

export async function writeTelemetry(
  admin: AdminClient,
  row: TelemetryRow,
): Promise<void> {
  const payload = {
    user_id: row.user_id,
    project_id: row.project_id,
    question: row.question,
    answer: row.answer,
    task_mode: row.task_mode ?? "legal_research_v1",
    footnotes: row.footnotes,
    local_footnotes_count: 0,
    perplexity_footnotes_count: 0,
    total_footnotes: 0,
    metadata: {
      ...row.metadata,
      trace_status: "terminal",
    },
  };
  try {
    if (row.row_id) {
      const { error } = await admin.from("qa_logs").update(payload).eq("id", row.row_id);
      if (!error) return;
      console.error("[legal-research-v1] qa_logs trace update failed, inserting:", error);
    }
    const { error } = await admin.from("qa_logs").insert(payload);
    if (error) console.error("[legal-research-v1] qa_logs insert failed:", error);
  } catch (e) {
    console.error("[legal-research-v1] qa_logs write threw:", e);
  }
}

