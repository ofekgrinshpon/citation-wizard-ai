// academic_candidate_admission_and_slotting_v1 — part 3.
//
// Precise final states for nominated PRIMARY anchors (judgments, statutes).
// Read-only derivation over the official-discovery attempts and the
// official-fetch ledger. It changes nothing about what may be cited: a
// metadata-only or unverified anchor is reported as unusable, and secondary
// sources never substitute for it.
//
// The states are deliberately distinguishable, because "no primary anchor"
// used to collapse three very different failures into one:
//   - never found;
//   - HTTP 200 body received but extraction produced nothing;
//   - HTTP 200 body received and then mislabelled as a connection reset
//     (body-read failure recorded on the same URL after a 200);
//   - identity mismatch;
//   - true network / origin failure;
//   - budget or time cap.

import type { OfficialFetchAttempt } from "../lib/officialFetch.ts";

export const PRIMARY_ANCHOR_STATUSES = [
  "not_found",
  "found_metadata_only",
  "body_received_extraction_failed",
  "body_received_logged_as_connection_reset",
  "identity_mismatch",
  "budget_or_time_cap",
  "network_or_origin_failure",
  "acquired_identity_verified",
] as const;
export type PrimaryAnchorStatus = typeof PRIMARY_ANCHOR_STATUSES[number];

export interface PrimaryAnchorAcquisitionRow {
  nominated_target: string;
  found: boolean;
  url: string | null;
  status: string;
  bytes_received: number;
  extraction_started: boolean;
  extraction_succeeded: boolean;
  chars_extracted: number;
  identity_passed: boolean | null;
  final_status: PrimaryAnchorStatus;
  failure_reason: string | null;
  usable_primary_anchor: boolean;
}

/** Minimal shape of an official-discovery attempt (kept structural on purpose). */
export interface AnchorAttemptLike {
  label: string;
  category: string;
  urls_attempted?: string[];
  acquisition_path?: string;
  result: string;
  body_chars?: number;
  reason?: string | null;
  identity?: { validated: boolean; reason?: string } | null;
}

const MIN_PRIMARY_BODY_CHARS = 400;

function ledgerFor(url: string | null, ledger: OfficialFetchAttempt[]) {
  if (!url) return [] as OfficialFetchAttempt[];
  return ledger.filter((a) => a.url === url);
}

/**
 * Derive the precise final state of one nominated primary anchor.
 * `attempt` is the official-discovery attempt; `ledger` the fetch attempts.
 */
export function derivePrimaryAnchorStatus(
  attempt: AnchorAttemptLike,
  ledger: OfficialFetchAttempt[] = [],
): PrimaryAnchorAcquisitionRow {
  const url = attempt.urls_attempted?.length
    ? attempt.urls_attempted[attempt.urls_attempted.length - 1]
    : null;
  const fetches = ledgerFor(url, ledger);
  const ok200 = fetches.find((f) => typeof f.status === "number" && f.status >= 200 && f.status < 300);
  const resetAfter200 = !!ok200 && fetches.some((f) => f.connection_reset && f.status === null);
  const bytes_received = ok200?.content_length ?? 0;
  const chars_extracted = Number(attempt.body_chars ?? 0);
  const extraction_started = !!ok200 || chars_extracted > 0;
  const extraction_succeeded = chars_extracted >= MIN_PRIMARY_BODY_CHARS;
  const identity_passed = attempt.identity ? attempt.identity.validated : null;

  let final_status: PrimaryAnchorStatus;
  let failure_reason: string | null = attempt.reason ?? null;

  switch (attempt.result) {
    case "cache_hit":
    case "body_acquired":
      final_status = identity_passed === false
        ? "identity_mismatch"
        : extraction_succeeded
        ? "acquired_identity_verified"
        : "body_received_extraction_failed";
      break;
    case "identity_mismatch":
      final_status = "identity_mismatch";
      failure_reason ??= attempt.identity?.reason ?? "identity_validation_failed";
      break;
    case "below_threshold":
      final_status = chars_extracted > 0 ? "body_received_extraction_failed" : "found_metadata_only";
      break;
    case "timeout":
      final_status = "budget_or_time_cap";
      break;
    case "blocked_by_origin":
    case "fetch_failed":
      final_status = resetAfter200
        ? "body_received_logged_as_connection_reset"
        : ok200 && !extraction_succeeded
        ? "body_received_extraction_failed"
        : "network_or_origin_failure";
      break;
    case "statute_not_found":
    case "section_not_found":
    case "unsupported_statute_source":
    case "not_attempted":
    default:
      final_status = url ? "found_metadata_only" : "not_found";
      break;
  }

  // A 200 that ended as a "reset" is always reported as such, whatever the
  // discovery stage concluded — that is the bug this table exists to expose.
  if (resetAfter200 && final_status === "network_or_origin_failure") {
    final_status = "body_received_logged_as_connection_reset";
  }

  return {
    nominated_target: attempt.label,
    found: !!url,
    url,
    status: attempt.result,
    bytes_received,
    extraction_started,
    extraction_succeeded,
    chars_extracted,
    identity_passed,
    final_status,
    failure_reason,
    usable_primary_anchor: final_status === "acquired_identity_verified",
  };
}

const PRIMARY_CATEGORIES = /^(judgment|caselaw|case_law|statute|legislation|regulation|primary)/i;

export interface PrimaryAnchorAcquisitionReport {
  rows: PrimaryAnchorAcquisitionRow[];
  usable_primary_anchor_count: number;
  status_counts: Record<string, number>;
  /** True when every nominated primary anchor failed for a *reportable* reason. */
  all_primary_anchors_failed: boolean;
}

export function buildPrimaryAnchorAcquisitionReport(
  attempts: AnchorAttemptLike[],
  ledger: OfficialFetchAttempt[] = [],
): PrimaryAnchorAcquisitionReport {
  const rows = attempts
    .filter((a) => PRIMARY_CATEGORIES.test(String(a.category ?? "")))
    .map((a) => derivePrimaryAnchorStatus(a, ledger));
  const status_counts: Record<string, number> = {};
  for (const r of rows) status_counts[r.final_status] = (status_counts[r.final_status] ?? 0) + 1;
  const usable = rows.filter((r) => r.usable_primary_anchor).length;
  return {
    rows,
    usable_primary_anchor_count: usable,
    status_counts,
    all_primary_anchors_failed: rows.length > 0 && usable === 0,
  };
}
