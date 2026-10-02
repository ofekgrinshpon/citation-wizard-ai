/** One in-call 504 retry, before terminal evidence is cached. No new timeout. */
export const FETCH_RETRY_DELAY_MS = 500;
export const FETCH_RETRY_MIN_REMAINING_MS = 1_000;

function waitForRetry(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new Error("fetch_aborted"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, FETCH_RETRY_DELAY_MS);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

export async function fetchWithBoundedRetry(
  url: string,
  opts: {
    signal: AbortSignal;
    deadlineAt: number;
    fetchOnce: (url: string, opts: { signal: AbortSignal }) => Promise<Response>;
    isSafeUrl: (url: string) => boolean;
    /** Atomic budget check + debit, immediately before each HTTP attempt. */
    reserveAttempt?: () => boolean;
    /** Disabled for pre-existing entries and callers without budget wiring. */
    allowRetry: boolean;
  },
): Promise<Response> {
  const canStart = () => !opts.signal.aborted && Date.now() < opts.deadlineAt;
  const dispatch = () => opts.fetchOnce(url, { signal: opts.signal });
  if (!canStart()) throw new Error("fetch_deadline_exhausted");
  if (opts.reserveAttempt && !opts.reserveAttempt()) throw new Error("fetch_budget_exhausted");
  const first = await dispatch();
  const finalUrl = first.url || url;
  // Leave access denials, rate limits, exceptions and court-specific retry
  // machinery alone. Even a 504 carrying Retry-After is left to its origin's
  // requested pacing rather than being retried early or extending our budget.
  if (
    first.status !== 504 || !opts.allowRetry || !opts.reserveAttempt ||
    !opts.isSafeUrl(finalUrl) || first.headers.has("retry-after") ||
    !canStart() ||
    opts.deadlineAt - Date.now() <= FETCH_RETRY_DELAY_MS + FETCH_RETRY_MIN_REMAINING_MS
  ) return first;

  await waitForRetry(opts.signal);
  if (!canStart() || opts.deadlineAt - Date.now() < FETCH_RETRY_MIN_REMAINING_MS) return first;
  if (!opts.reserveAttempt()) return first;
  // Do not read an error body or await an unbounded stream cancellation.
  void first.body?.cancel().catch(() => {});
  return await dispatch();
}
