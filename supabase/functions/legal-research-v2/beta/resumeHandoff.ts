/**
 * legal-research-v2 — chunk hand-off with an observed acknowledgment.
 *
 * Observation only: never retries (no ownership fencing exists) and never
 * writes run state. A failed hand-off is logged as bounded structured metadata
 * (run UUID + status) and left to the existing watchdog. Network errors are
 * logged and rethrown, preserving prior behaviour.
 */

export interface ResumeHandoffAck {
  ok: boolean;
  status: number | null;
  error: "http" | null;
}

type Log = (line: string) => void;

export async function invokeResumeHandoff(
  run_id: string,
  supabaseUrl: string,
  serviceKey: string,
  deps: { fetchImpl?: typeof fetch; log?: Log } = {},
): Promise<ResumeHandoffAck> {
  const f = deps.fetchImpl ?? fetch;
  const log = deps.log ?? ((l: string) => console.error(l));
  let res: Response;
  try {
    res = await f(`${supabaseUrl}/functions/v1/legal-research-v2`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        "x-smoke-mode": "1",
      },
      body: JSON.stringify({ resume_run_id: run_id }),
    });
  } catch (e) {
    log(JSON.stringify({ event: "v2_resume_handoff_failed", run_id, error: "network" }));
    throw e;
  }
  try { await res.body?.cancel(); } catch { /* ignore */ }
  if (!res.ok) {
    log(JSON.stringify({ event: "v2_resume_handoff_failed", run_id, status: res.status }));
  }
  return { ok: res.ok, status: res.status, error: res.ok ? null : "http" };
}
