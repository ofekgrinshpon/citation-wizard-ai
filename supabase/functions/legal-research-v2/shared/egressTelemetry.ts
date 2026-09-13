/**
 * legal-research-v2 — per-run egress state reset + compact egress telemetry.
 *
 * The official-fetch ledger, the court relay ledger and the judgment-URL
 * eligibility ledger are module globals. An Edge isolate is reused across
 * runs, so a cap or a `stopped_reason` reached in run A would otherwise
 * silently suppress acquisition in run B.
 *
 * This module resets them to their INTENDED per-run budget. It never removes
 * a cap, never raises one, never disables backoff and never widens the relay
 * host allowlist.
 */

import {
  officialFetchTelemetry,
  OFFICIAL_FETCH_LIMITS,
  resetOfficialFetchLedger,
} from "../vendor/officialFetch.ts";
import {
  COURT_EGRESS_LIMITS,
  courtEgressTelemetry,
  resetCourtEgressLedger,
  resetCourtRelayDiagnostics,
} from "../vendor/courtEgress.ts";
import {
  judgmentUrlTelemetry,
  type JudgmentUrlSource,
  registerJudgmentUrl,
  resetJudgmentUrlLedger,
} from "../vendor/judgmentUrlEligibility.ts";

export interface EgressTelemetry {
  official_calls: number;
  official_max_per_run: number;
  official_stopped_reason: string | null;
  official_block_pages: number;
  official_reset_or_rate_limited: number;
  relay_configured: boolean;
  relay_calls: number;
  relay_max_per_run: number;
  relay_stopped_reason: string | null;
  relay_successes: number;
  relay_failures: number;
  relay_skipped: number;
  relay_slots_saved: number;
  relay_slots_spent: number;
  suppressed_urls: number;
  registered_urls: number;
}

/** Call once at the start of every independent research run. */
export function resetEgressStateForRun(): void {
  resetOfficialFetchLedger();
  resetCourtEgressLedger();
  resetCourtRelayDiagnostics();
  resetJudgmentUrlLedger();
}

/**
 * Register provenance for a candidate URL so the relay gate is not blind.
 * Registration cannot make a guessed / bare-host URL relay-eligible — the
 * existing classification decides that.
 */
export function registerCandidateProvenance(
  url: string | undefined,
  source: JudgmentUrlSource,
): void {
  if (!url || !/^https?:\/\//i.test(url)) return;
  try {
    registerJudgmentUrl(url, source);
  } catch {
    /* telemetry only — never block acquisition */
  }
}

export function egressTelemetry(): EgressTelemetry {
  const official = officialFetchTelemetry();
  const relay = courtEgressTelemetry();
  const urls = judgmentUrlTelemetry();
  const attempts = relay.attempts ?? [];
  const skipped = attempts.filter((a) => a.skipped_reason).length;
  const successes = attempts.filter((a) =>
    !a.skipped_reason && !a.error && typeof a.status === "number" && a.status >= 200 && a.status < 400
  ).length;
  return {
    official_calls: official.official_calls,
    official_max_per_run: OFFICIAL_FETCH_LIMITS.MAX_PER_RUN,
    official_stopped_reason: official.stopped_reason,
    official_block_pages: official.block_pages_detected,
    official_reset_or_rate_limited: official.rate_limited_events,
    relay_configured: relay.configured,
    relay_calls: relay.calls,
    relay_max_per_run: COURT_EGRESS_LIMITS.MAX_PER_RUN,
    relay_stopped_reason: relay.stopped_reason,
    relay_successes: successes,
    relay_failures: attempts.length - skipped - successes,
    relay_skipped: skipped,
    relay_slots_saved: urls.relay_slots_saved,
    relay_slots_spent: urls.relay_slots_spent,
    suppressed_urls: urls.suppressed,
    registered_urls: urls.total_candidates,
  };
}
