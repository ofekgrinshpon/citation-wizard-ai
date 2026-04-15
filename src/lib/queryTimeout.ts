/**
 * Wraps a promise with a hard timeout. If the promise doesn't resolve
 * within `ms` milliseconds, it rejects with a timeout error.
 * The original promise is NOT cancelled — this only stops waiting.
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
