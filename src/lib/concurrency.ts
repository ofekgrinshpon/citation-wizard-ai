/**
 * Run async tasks with a bounded number of workers, plus an optional retry
 * for transient failures (rate limits / timeouts). Results are reported as
 * each task settles so the UI can update progressively.
 */
export interface RunPoolOptions<T> {
  concurrency?: number;
  /** Retry attempts per task (0 = no retry). */
  retries?: number;
  /** Base backoff in ms; doubled per attempt. */
  backoffMs?: number;
  /** Return true when the error is worth retrying. */
  shouldRetry?: (error: unknown) => boolean;
  /** Called as soon as a task settles. */
  onSettled?: (index: number, result: { ok: true; value: T } | { ok: false; error: unknown }) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function isTransientError(error: unknown): boolean {
  const e = error as { code?: string; status?: number; message?: string } | null;
  const code = e?.code || e?.message || "";
  return (
    /HTTP_429|HTTP_5\d\d|RATE|TIMEOUT|NETWORK|EMPTY_RESPONSE|FunctionsFetchError/i.test(code)
  );
}

export async function runPool<TIn, TOut>(
  items: TIn[],
  task: (item: TIn, index: number) => Promise<TOut>,
  options: RunPoolOptions<TOut> = {}
): Promise<Array<{ ok: true; value: TOut } | { ok: false; error: unknown }>> {
  const concurrency = Math.max(1, options.concurrency ?? 2);
  const retries = options.retries ?? 1;
  const backoffMs = options.backoffMs ?? 1200;
  const shouldRetry = options.shouldRetry ?? isTransientError;

  const results: Array<{ ok: true; value: TOut } | { ok: false; error: unknown }> = new Array(
    items.length
  );
  let cursor = 0;

  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      let attempt = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          const value = await task(items[index], index);
          results[index] = { ok: true, value };
          break;
        } catch (error) {
          if (attempt < retries && shouldRetry(error)) {
            await sleep(backoffMs * Math.pow(2, attempt));
            attempt++;
            continue;
          }
          results[index] = { ok: false, error };
          break;
        }
      }
      options.onSettled?.(index, results[index]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
