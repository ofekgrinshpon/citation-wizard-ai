/**
 * legal-research-v2 — beta user job lifecycle.
 *
 * Routing/配置 layer only: it reuses the EXISTING production job table,
 * credit RPCs and refund semantics of the beta experience, and delegates all
 * research to the unchanged V2 pipeline. No research behaviour lives here.
 */

import type { SupabaseClient } from "../shared/primitives.ts";
import type { Footnote } from "../types.ts";

export const RESEARCH_CREDIT_COST = 5;

export interface BetaJob {
  id: string;
  user_id: string;
  credit_request_id: string | null;
}

export interface BetaResultShape {
  answer: string;
  footnotes: Array<{
    number: number;
    title: string;
    url?: string | null;
    sources: Array<{ title: string; url?: string | null }>;
  }>;
  used_sources: Array<{ number: number; title: string; url?: string | null }>;
  pipeline_version: "v2";
  run_id: string;
  debug: Record<string, unknown>;
}

/** Map the deterministic V2 render onto the shape the beta UI already reads. */
export function toBetaResult(out: Record<string, unknown>): BetaResultShape {
  const footnotes = (out.footnotes ?? []) as Footnote[];
  return {
    answer: String(out.answer_markdown ?? ""),
    footnotes: footnotes.map((f) => ({
      number: f.index,
      title: f.citation,
      url: f.url ?? null,
      sources: [{ title: f.citation, url: f.url ?? null }],
    })),
    used_sources: footnotes.map((f) => ({
      number: f.index,
      title: f.citation,
      url: f.url ?? null,
    })),
    pipeline_version: "v2",
    run_id: String(out.run_id ?? ""),
    debug: {
      pipeline_version: "v2",
      run_id: out.run_id ?? null,
      invariant_errors: out.invariant_errors ?? [],
      unresolved_questions: out.unresolved_questions ?? [],
      telemetry: out.telemetry ?? null,
      agent_error: out.agent_error ?? null,
      drafter_error: out.drafter_error ?? null,
    },
  };
}

/**
 * A run only counts as delivered when it produced an actual cited answer.
 * Refusals and empty answers are refunded, exactly as in the current beta.
 */
export function isDelivered(result: BetaResultShape): boolean {
  return result.answer.trim().length > 0 && result.footnotes.length > 0;
}

export async function refundJob(
  admin: SupabaseClient,
  job: BetaJob,
  reason: string,
): Promise<boolean> {
  if (!job.credit_request_id) return false;
  try {
    await admin.rpc("refund_credits_for_user", {
      _user_id: job.user_id,
      _request_id: job.credit_request_id,
      _reason: `auto-refund: ${reason}`,
    });
    return true;
  } catch {
    return false;
  }
}

export async function finishJobSuccess(
  admin: SupabaseClient,
  job: BetaJob,
  result: BetaResultShape,
): Promise<{ refunded: boolean }> {
  const delivered = isDelivered(result);
  const refunded = delivered ? false : await refundJob(admin, job, "no_answer_delivered");
  await admin.from("legal_research_jobs").update({
    status: "done",
    result: { ...result, credits_refunded: refunded },
    current_stage: null,
    progress_label_he: null,
    completed_at: new Date().toISOString(),
  }).eq("id", job.id);
  return { refunded };
}

export async function finishJobError(
  admin: SupabaseClient,
  job: BetaJob,
  message: string,
): Promise<void> {
  const refunded = await refundJob(admin, job, "pipeline_error");
  await admin.from("legal_research_jobs").update({
    status: "error",
    error: message.slice(0, 500),
    result: { credits_refunded: refunded, pipeline_version: "v2" },
    current_stage: null,
    progress_label_he: null,
    completed_at: new Date().toISOString(),
  }).eq("id", job.id);
}
