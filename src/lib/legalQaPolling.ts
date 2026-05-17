/**
 * Polls the `legal-qa-status` Edge Function until a Deep async run reaches a
 * terminal state. Used as a defensive fallback for the non-streaming Deep
 * path: when `legal-qa` returns HTTP 202 with a `run_id`, the UI polls here
 * instead of waiting on a long-lived HTTP connection that the gateway would
 * cut at 150s.
 *
 * No backend coupling beyond the documented status payload shape.
 */
import { supabase } from "@/integrations/supabase/client";

export type CheckpointKey =
  | "queued"
  | "running"
  | "legal_issue_router"
  | "decomposition"
  | "open_web_discovery"
  | "retrieval"
  | "claim_map"
  | "claim_verification"
  | "drafting"
  | "anchor_pass"
  | "completed"
  | "failed"
  | string;

export const CHECKPOINT_LABELS_HE: Record<string, string> = {
  queued: "בתור",
  running: "מעבד",
  legal_issue_router: "מסווג שאלה",
  decomposition: "מפרק לשאלות-משנה",
  open_web_discovery: "סריקת מקורות",
  retrieval: "אחזור מקורות",
  claim_map: "מפת טענות",
  claim_verification: "אימות טענות",
  drafting: "ניסוח תשובה",
  anchor_pass: "עיגון ציטוטים",
};

export interface StatusSnapshot {
  status: "queued" | "running" | "completed" | "failed";
  checkpoint?: string | null;
  progress?: { completed_stages?: number; total_stages?: number } | null;
  // Terminal-only:
  answer?: string;
  footnotes?: unknown;
  metadata?: Record<string, unknown>;
  reason?: string;
}

export interface PollOptions {
  /** Polling interval in ms before the backoff threshold. Default 2000. */
  intervalMs?: number;
  /** Backoff threshold in ms; after this, interval doubles. Default 60000. */
  backoffAfterMs?: number;
  /** Hard cap in ms before we stop polling. Default 600000 (10 min). */
  maxWallMs?: number;
  /** Called on every successful poll (including non-terminal). */
  onUpdate?: (snap: StatusSnapshot) => void;
  /** AbortSignal to cancel polling. Does NOT cancel the background job. */
  signal?: AbortSignal;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    });
  });

/**
 * Resolves with the terminal snapshot (status="completed" | "failed").
 * Throws on abort or hard timeout.
 */
export async function pollLegalQaStatus(
  runId: string,
  opts: PollOptions = {},
): Promise<StatusSnapshot> {
  const intervalMs = opts.intervalMs ?? 2000;
  const backoffAfterMs = opts.backoffAfterMs ?? 60_000;
  const maxWallMs = opts.maxWallMs ?? 600_000;
  const started = Date.now();

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  while (true) {
    if (opts.signal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
    const elapsed = Date.now() - started;
    if (elapsed > maxWallMs) {
      throw new Error("polling_timeout");
    }

    const { data: { session } } = await supabase.auth.getSession();
    const url = `${supabaseUrl}/functions/v1/legal-qa-status?runId=${encodeURIComponent(runId)}`;
    let snap: StatusSnapshot | null = null;
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${session?.access_token ?? ""}`,
          "apikey": supabaseKey,
        },
        signal: opts.signal,
      });
      if (res.ok) {
        snap = (await res.json()) as StatusSnapshot;
      } else if (res.status === 404) {
        // Treat as still queued — the row may not be visible to RLS for a
        // brief moment after insert.
        snap = { status: "queued", checkpoint: "queued" };
      } else {
        throw new Error(`status_http_${res.status}`);
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      // Transient network errors: log and keep polling until maxWallMs.
      console.warn("[legal-qa-status] poll error, retrying:", (e as Error).message);
    }

    if (snap) {
      opts.onUpdate?.(snap);
      if (snap.status === "completed" || snap.status === "failed") {
        return snap;
      }
    }

    const wait = elapsed > backoffAfterMs ? intervalMs * 2 : intervalMs;
    await sleep(wait, opts.signal);
  }
}
