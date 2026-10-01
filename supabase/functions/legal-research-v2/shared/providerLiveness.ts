/**
 * Bounded provider-pending liveness.
 *
 * While a run waits on a paid provider call, keep its run/job/operation
 * heartbeat fresh so the resume watchdog (STALE_MS = 180 s) does not treat an
 * actively-streaming worker as dead. Keepalive is bounded:
 *   - KEEPALIVE_MS   30 s  — beat cadence while the call is pending
 *   - INACTIVITY_MS 150 s  — abort if no headers/bytes arrive for this long
 *   - ABSOLUTE_MS   300 s  — abort any single provider attempt after this long
 * After abort the beats stop, so a genuinely stuck worker goes stale and the
 * existing watchdog may resume it. The beat is scoped per run via
 * AsyncLocalStorage (never a module global), so only the current run renews
 * its own liveness. Never alters the request itself.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export const PROVIDER_LIVENESS = {
  KEEPALIVE_MS: 30_000,
  INACTIVITY_MS: 150_000,
  ABSOLUTE_MS: 300_000,
};

type Beat = () => Promise<unknown> | unknown;
const als = new AsyncLocalStorage<{ beat: Beat }>();

export function withProviderLiveness<T>(beat: Beat, fn: () => Promise<T>): Promise<T> {
  return als.run({ beat }, fn);
}

export interface ProviderGuard {
  signal: AbortSignal;
  /** Call on headers / every received chunk. */
  touch(): void;
  /** Always call in finally. Idempotent. */
  done(): void;
}

export function guardProviderCall(outer?: AbortSignal, limits = PROVIDER_LIVENESS): ProviderGuard {
  const beat = als.getStore()?.beat;
  const ctrl = new AbortController();
  let finished = false;
  const onOuter = () => ctrl.abort(outer?.reason);
  if (outer) {
    if (outer.aborted) ctrl.abort(outer.reason);
    else outer.addEventListener("abort", onOuter, { once: true });
  }
  const abort = (why: string) => {
    if (finished) return;
    const e = new Error(why);
    e.name = "AbortError";
    ctrl.abort(e);
    stop();
  };
  let inact = setTimeout(() => abort("provider_inactivity_timeout"), limits.INACTIVITY_MS);
  const absolute = setTimeout(() => abort("provider_absolute_timeout"), limits.ABSOLUTE_MS);
  const keep = beat
    ? setInterval(() => {
      if (finished || ctrl.signal.aborted) return;
      try { Promise.resolve(beat()).catch(() => {}); } catch { /* never throw */ }
    }, limits.KEEPALIVE_MS)
    : null;
  function stop() {
    finished = true;
    clearTimeout(inact);
    clearTimeout(absolute);
    if (keep) clearInterval(keep);
    outer?.removeEventListener("abort", onOuter);
  }
  return {
    signal: ctrl.signal,
    touch() {
      if (finished) return;
      clearTimeout(inact);
      inact = setTimeout(() => abort("provider_inactivity_timeout"), limits.INACTIVITY_MS);
    },
    done: stop,
  };
}
