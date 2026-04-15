/**
 * Wraps a promise with a hard timeout. If the promise doesn't resolve
 * within `ms` milliseconds, it rejects with a timeout error.
 * The original promise is NOT cancelled — this only stops waiting.
 * 
 * For Supabase query builders, pass them wrapped: withTimeout(query.then(r => r), ms)
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = "query",
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`[Timeout] ${label} exceeded ${ms}ms`));
    }, ms);

    promise
      .then((val) => { clearTimeout(timer); resolve(val); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}

/**
 * Helper to convert a Supabase query builder (PromiseLike) into a real Promise
 * and wrap it with a timeout.
 */
export function supabaseWithTimeout<T>(
  query: PromiseLike<T>,
  ms: number,
  label = "query",
): Promise<T> {
  return withTimeout(Promise.resolve(query), ms, label);
}
