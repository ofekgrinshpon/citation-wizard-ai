/**
 * legal-research-v2 — beta user job lifecycle.
 *
 * Routing/配置 layer only: it reuses the EXISTING production job table,
 * credit pricing and trusted-failure refunds, and delegates all
 * research to the unchanged V2 pipeline. No research behaviour lives here.
 */

import type { SupabaseClient } from "../shared/primitives.ts";
import type { Footnote } from "../types.ts";
import { attestUsageFailure, hasAmbiguousFailure } from "../../_shared/legacyUsageRefund.ts";
import { releaseOperationLock } from "../../_shared/operationLock.ts";

export const RESEARCH_CREDIT_COST = 5;

/**
 * Academic Writing body chapter. Matches the existing client-side
 * CREDIT_COSTS.academicChapter constant — no new pricing is invented here.
 */
export const ACADEMIC_CHAPTER_CREDIT_COST = 8;

/**
 * Source search runs the same discovery/reading agent but terminates in the
 * Source Renderer: no drafter, no answer citation synthesis, no post-draft
 * repair, and a lighter tool budget. Priced below full legal research.
 */
export const SOURCE_SEARCH_CREDIT_COST = 3;

/**
 * Product availability flag for Academic Writing (public beta = OFF).
 * Availability only — not an authorization mechanism. Internal/dev deployments
 * set ACADEMIC_WRITING_ENABLED="true".
 */
export function academicWritingEnabled(
  env?: { get(key: string): string | undefined },
): boolean {
  const runtimeEnv = env ??
    (globalThis as { Deno?: { env: { get(key: string): string | undefined } } }).Deno?.env;
  return runtimeEnv?.get("ACADEMIC_WRITING_ENABLED") === "true";
}

export interface BetaJob {
  id: string;
  user_id: string;
  credit_request_id: string | null;
  /** Account-level concurrent-operation lock id (client_request_id). */
  operation_id?: string | null;
}

/** Terminal release of the account-level operation lock. Idempotent. */
async function releaseJobLock(
  admin: SupabaseClient,
  job: BetaJob,
  reason: string,
): Promise<void> {
  if (!job.operation_id) return;
  await releaseOperationLock(
    admin as unknown as { rpc(fn: string, params?: Record<string, unknown>): unknown },
    job.user_id,
    job.operation_id,
    reason,
  );
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
  /** Present only for Academic Writing chapter runs. */
  academic?: Record<string, unknown> | null;
  /** "sources" for source-search runs; absent/"answer" otherwise. */
  output_mode?: "answer" | "sources";
  /** Present only for source-search runs. */
  source_pack?: Record<string, unknown> | null;
  /** Answer quality only; job status remains the execution lifecycle. */
  research_complete?: boolean | null;
  completeness_status?: "complete" | "partial" | "unknown" | "insufficient";
  debug: Record<string, unknown>;
}

/** Map the deterministic V2 render onto the shape the beta UI already reads. */
export function toBetaResult(out: Record<string, unknown>): BetaResultShape {
  const footnotes = (out.footnotes ?? []) as Footnote[];
  // User-facing footnotes stay OCCURRENCE-based: one row per marker, never
  // deduplicated by source. `used_sources` is the distinct-source analytics
  // view and keeps the first occurrence number of each authority.
  const seenSource = new Set<string>();
  const used_sources: BetaResultShape["used_sources"] = [];
  for (const f of footnotes) {
    for (const s of f.sources ?? [{ ...f }]) {
      if (!s.source_id || seenSource.has(s.source_id)) continue;
      seenSource.add(s.source_id);
      used_sources.push({
        number: s.first_occurrence ?? f.index,
        title: s.full_citation ?? s.citation,
        url: s.url ?? null,
      });
    }
  }
  return {
    answer: String(out.answer_markdown ?? ""),
    footnotes: footnotes.map((f) => {
      const entries = f.sources?.length
        ? f.sources
        : [{
          source_id: f.source_id,
          citation: f.citation,
          repeat_kind: f.repeat_kind,
          url: f.url,
        }];
      return {
        number: f.index,
        title: f.citation,
        url: entries.length === 1 && entries[0].repeat_kind === "full"
          ? (entries[0].url ?? null)
          : null,
        // One row per citation point; a compound point lists its sources here.
        sources: entries.map((s) => ({
          title: s.citation,
          url: s.repeat_kind && s.repeat_kind !== "full" ? null : (s.url ?? null),
        })),
      };
    }),
    used_sources,
    research_complete: typeof out.research_complete === "boolean" ? out.research_complete : null,
    completeness_status: ["complete", "partial", "unknown", "insufficient"].includes(String(out.completeness_status))
      ? out.completeness_status as BetaResultShape["completeness_status"] : "unknown",
    pipeline_version: "v2",
    run_id: String(out.run_id ?? ""),
    academic: (out.academic as Record<string, unknown> | undefined) ?? null,
    output_mode: out.output_mode === "sources" ? "sources" : "answer",
    source_pack: (out.source_pack as Record<string, unknown> | undefined) ?? null,
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
 * Definitive refusals and empty answers can be refunded after persistence.
 * Ambiguous provider outcomes require reconciliation instead.
 */
export function isDelivered(result: BetaResultShape): boolean {
  // Source search delivers a source pack, not an answer: it counts as
  // delivered when at least one verified/read source reached the user.
  if (result.output_mode === "sources") {
    const pack = result.source_pack as { recommended?: unknown[] } | null;
    return Array.isArray(pack?.recommended) && pack!.recommended!.length > 0;
  }
  return result.answer.trim().length > 0 && result.footnotes.length > 0;
}

export async function refundJob(
  admin: SupabaseClient,
  job: BetaJob,
  reason: string,
): Promise<boolean> {
  if (!job.credit_request_id) return false;
  return attestUsageFailure(admin, job.user_id, job.credit_request_id, `auto-refund: ${reason}`);
}

/**
 * A blocked / failed model gateway call is an infrastructure failure, not a
 * legal answer: it must fail the job (and refund) rather than deliver silence.
 */
export function gatewayFailure(out: Record<string, unknown>): string | null {
  const agent = typeof out.agent_error === "string" ? out.agent_error : "";
  const drafter = typeof out.drafter_error === "string" ? out.drafter_error : "";
  const hit = [agent, drafter].find((e) => /model_error_\d{3}|_error_\d{3}/.test(e));
  return hit ? hit.slice(0, 300) : null;
}

/** Model error codes can be synthetic (notably 502 for interrupted SSE).
 * Those codes cannot certify an observed terminal provider rejection. */
export function definitiveGatewayFailure(out: Record<string, unknown>): boolean {
  const hit = gatewayFailure(out);
  return hit !== null && !hasAmbiguousFailure({
    agent_error: out.agent_error,
    drafter_error: out.drafter_error,
  });
}

/**
 * A job that already reached a terminal state (done / error / timed_out, e.g.
 * written by the stale-job reaper) must never be rewritten by a late worker,
 * and must never trigger a second refund.
 */
export async function isTerminal(admin: SupabaseClient, jobId: string): Promise<boolean> {
  try {
    const { data, error } = await admin
      .from("legal_research_jobs")
      .select("status")
      .eq("id", jobId)
      .maybeSingle();
    if (error || !data) return true; // Unknown state is not permission to finalize.
    const status = (data as { status?: string } | null)?.status ?? "";
    return status === "done" || status === "error" || status === "timed_out";
  } catch {
    return true;
  }
}

export async function finishJobSuccess(
  admin: SupabaseClient,
  job: BetaJob,
  result: BetaResultShape,
): Promise<{ refunded: boolean; skipped?: boolean }> {
  const delivered = isDelivered(result);
  const uncertain = hasAmbiguousFailure(result.debug);
  const persistedResult = {
    ...result,
    delivery_failed: !delivered && !uncertain,
    execution_outcome_unknown: uncertain,
    credits_refunded: false,
  };
  // The conditional write is the terminal winner. A read-before-write check
  // cannot prevent a late failure from refunding a concurrent successful job.
  const { data, error } = await admin.from("legal_research_jobs").update({
    status: "done",
    result: persistedResult,
    current_stage: null,
    progress_label_he: null,
    completed_at: new Date().toISOString(),
  }).eq("id", job.id).eq("user_id", job.user_id)
    .in("status", ["running", "queued"]).select("id").maybeSingle();
  if (error || !data) return { refunded: false, skipped: true };
  const refunded = !delivered && !uncertain
    ? await refundJob(admin, job, "no_answer_delivered") : false;
  if (refunded) {
    await admin.from("legal_research_jobs").update({
      result: { ...persistedResult, credits_refunded: true },
    }).eq("id", job.id).eq("user_id", job.user_id).eq("status", "done");
  }
  await releaseJobLock(admin, job, refunded ? "refunded" : "done");
  return { refunded };
}

export async function finishJobError(
  admin: SupabaseClient,
  job: BetaJob,
  message: string,
  definitiveFailure = false,
): Promise<{ refunded: boolean; skipped?: boolean }> {
  const result = {
    credits_refunded: false,
    pipeline_version: "v2",
    delivery_failed: definitiveFailure,
    execution_outcome_unknown: !definitiveFailure,
  };
  const { data, error } = await admin.from("legal_research_jobs").update({
    status: "error",
    error: message.slice(0, 500),
    result,
    current_stage: null,
    progress_label_he: null,
    completed_at: new Date().toISOString(),
  }).eq("id", job.id).eq("user_id", job.user_id)
    .in("status", ["running", "queued"]).select("id").maybeSingle();
  if (error || !data) return { refunded: false, skipped: true };
  const refunded = definitiveFailure ? await refundJob(admin, job, "pipeline_error") : false;
  if (refunded) {
    await admin.from("legal_research_jobs").update({
      result: { ...result, credits_refunded: true },
    }).eq("id", job.id).eq("user_id", job.user_id).eq("status", "error");
  }
  await releaseJobLock(admin, job, "error");
  return { refunded };
}
