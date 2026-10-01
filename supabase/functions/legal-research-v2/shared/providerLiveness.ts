/**
 * Heartbeat-only provider-pending liveness.
 *
 * While a run waits on a paid model call, renew its run/job/operation
 * heartbeat every KEEPALIVE_MS so the resume watchdog (STALE_MS = 180 s) does
 * not treat an actively-waiting worker as dead.
 *
 * This NEVER cancels a provider call and adds no request timeout. Renewal is
 * bounded per withProviderLiveness invocation: it stops RENEWAL_WINDOW_MS after
 * the invocation started (never reset by a new attempt). After that the
 * existing platform worker timeout and resume watchdog govern a truly hung
 * call. Scoped per run via AsyncLocalStorage — only this run renews its own
 * liveness. A bounded keepalive is not a distributed lease and does not rule
 * out every stale-worker overlap.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export const PROVIDER_LIVENESS = {
  KEEPALIVE_MS: 30_000,
  RENEWAL_WINDOW_MS: 300_000,
};

type Beat = () => Promise<unknown> | unknown;
interface Scope { beat: Beat; deadline: number; keepaliveMs: number }
const als = new AsyncLocalStorage<Scope>();

export function withProviderLiveness<T>(
  beat: Beat,
  fn: () => Promise<T>,
  limits: { KEEPALIVE_MS: number; RENEWAL_WINDOW_MS: number } = PROVIDER_LIVENESS,
): Promise<T> {
  return als.run({ beat, deadline: Date.now() + limits.RENEWAL_WINDOW_MS, keepaliveMs: limits.KEEPALIVE_MS }, fn);
}

export interface ProviderGuard {
  /** Always call in finally. Idempotent. */
  done(): void;
}

/** Heartbeat-only guard for one paid attempt. Never aborts anything. */
export function guardProviderCall(callerSignal?: AbortSignal): ProviderGuard {
  const scope = als.getStore();
  let timer: ReturnType<typeof setInterval> | null = null;
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    if (timer) clearInterval(timer);
    timer = null;
    callerSignal?.removeEventListener("abort", done);
  };
  if (!scope || callerSignal?.aborted || Date.now() >= scope.deadline) {
    finished = true;
    return { done: () => {} };
  }
  callerSignal?.addEventListener("abort", done, { once: true });
  timer = setInterval(() => {
    if (finished) return;
    if (Date.now() >= scope.deadline) { done(); return; }
    try { Promise.resolve(scope.beat()).catch(() => {}); } catch { /* never throw */ }
  }, scope.keepaliveMs);
  return { done };
}
