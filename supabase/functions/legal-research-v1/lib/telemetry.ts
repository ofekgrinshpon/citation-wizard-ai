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
}

export async function writeTelemetry(
  admin: AdminClient,
  row: TelemetryRow,
): Promise<void> {
  try {
    const { error } = await admin.from("qa_logs").insert({
      user_id: row.user_id,
      project_id: row.project_id,
      question: row.question,
      answer: row.answer,
      task_mode: row.task_mode ?? "legal_research_v1",
      footnotes: row.footnotes,
      local_footnotes_count: 0,
      perplexity_footnotes_count: 0,
      total_footnotes: 0,
      metadata: row.metadata,
    });
    if (error) console.error("[legal-research-v1] qa_logs insert failed:", error);
  } catch (e) {
    console.error("[legal-research-v1] qa_logs insert threw:", e);
  }
}
