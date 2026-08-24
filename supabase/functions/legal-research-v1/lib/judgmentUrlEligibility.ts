/**
 * judgment_url_guess_suppression_v1
 *
 * Deterministically derived Supreme Court document URLs embed a *guessed*
 * archive object code (`Z01` / `_z01` / `.z01`) and a transposed path triple.
 * The origin answers those guesses with an HTML Exception page, which the
 * relay correctly refuses — but the attempt has already burned an official
 * fetch slot and, worse, one of the three per-run relay slots.
 *
 * This module makes that impossible: guessed URLs are classified, kept for
 * telemetry, and never sent to the alternative court egress. Relay slots are
 * reserved for URLs whose provenance is a real search-first official result,
 * the verified cache, or a trusted official parser.
 *
 * Pure + a small per-run ledger. No network, no model calls.
 */

export const JUDGMENT_URL_GUESS_SUPPRESSION_VERSION = "judgment_url_guess_suppression_v1";

export type JudgmentUrlSource =
  | "search_first"
  | "verified_cache"
  | "trusted_official_parser"
  | "retrieved"
  | "derivation"
  | "unknown";

/** Provenances allowed to spend a relay slot. */
const RELAY_ELIGIBLE_SOURCES: ReadonlySet<JudgmentUrlSource> = new Set([
  "search_first",
  "verified_cache",
  "trusted_official_parser",
  "retrieved",
]);

/** Guessed archive object-code patterns produced by deterministic derivation. */
const GUESS_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "z01_object_code", re: /(^|[^a-z0-9])_?z01([^a-z0-9]|$)/i },
  { id: "dotted_z01_file", re: /\.z01(\.htm|\.txt)?($|[?&#])/i },
  // NOTE: only the z01 archive object code is a guess. Real search-first URLs
  // carry genuine object codes (a15/c11/p34/SB1_…) and must NOT be suppressed.
];

export interface JudgmentUrlClassification {
  url: string;
  url_source: JudgmentUrlSource;
  guessed_pattern: boolean;
  guessed_pattern_id: string | null;
  relay_eligible: boolean;
  suppression_reason: string | null;
}

/** A bare host / landing page is never a judgment document. */
export function isBareHostUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.pathname === "" || u.pathname === "/") && !u.search;
  } catch {
    return false;
  }
}

export function guessedPatternId(url: string): string | null {
  const u = String(url ?? "");
  for (const p of GUESS_PATTERNS) if (p.re.test(u)) return p.id;
  return null;
}

export function isGuessedCourtUrl(url: string): boolean {
  return guessedPatternId(url) !== null;
}

export function classifyJudgmentUrl(
  url: string,
  url_source: JudgmentUrlSource = "unknown",
): JudgmentUrlClassification {
  const gid = guessedPatternId(url);
  const known = knownBadUrls.has(normalizeKey(url));
  let suppression_reason: string | null = null;
  if (gid) suppression_reason = `guessed_url_pattern:${gid}`;
  else if (isBareHostUrl(url)) suppression_reason = "not_a_document_url";
  else if (known) suppression_reason = "previously_exception_page_or_wrong_file_code";
  else if (!RELAY_ELIGIBLE_SOURCES.has(url_source)) suppression_reason = `url_source_not_trusted:${url_source}`;
  return {
    url,
    url_source,
    guessed_pattern: gid !== null,
    guessed_pattern_id: gid,
    relay_eligible: suppression_reason === null,
    suppression_reason,
  };
}

// ── per-run ledger ────────────────────────────────────────────────────────

interface UrlRecord extends JudgmentUrlClassification {
  relay_slot_spent: boolean;
  fetch_result: string | null;
  body_chars: number | null;
  identity_validated: boolean | null;
  cache: "hit" | "write" | "write_failed" | null;
  injected_candidate: boolean | null;
  final_cited: boolean | null;
}

let records = new Map<string, UrlRecord>();
let eligible = new Map<string, JudgmentUrlSource>();
let knownBadUrls = new Set<string>();
let suppressedCount = 0;
let relaySlotsSaved = 0;

function normalizeKey(url: string): string {
  return String(url ?? "").trim();
}

export function resetJudgmentUrlLedger(): void {
  records = new Map();
  eligible = new Map();
  knownBadUrls = new Set();
  suppressedCount = 0;
  relaySlotsSaved = 0;
}

/** Register provenance for a URL before it is fetched. */
export function registerJudgmentUrl(
  url: string,
  url_source: JudgmentUrlSource,
): JudgmentUrlClassification {
  const c = classifyJudgmentUrl(url, url_source);
  const key = normalizeKey(url);
  const prev = records.get(key);
  const rec: UrlRecord = {
    ...c,
    // A URL seen from a trusted source keeps that provenance.
    ...(prev && prev.relay_eligible ? { url_source: prev.url_source, relay_eligible: true, suppression_reason: null } : {}),
    relay_slot_spent: prev?.relay_slot_spent ?? false,
    fetch_result: prev?.fetch_result ?? null,
    body_chars: prev?.body_chars ?? null,
    identity_validated: prev?.identity_validated ?? null,
    cache: prev?.cache ?? null,
    injected_candidate: prev?.injected_candidate ?? null,
    final_cited: prev?.final_cited ?? null,
  };
  records.set(key, rec);
  if (rec.relay_eligible) eligible.set(key, rec.url_source);
  else if (!prev) suppressedCount++;
  return rec;
}

export function noteJudgmentUrlOutcome(url: string, patch: Partial<UrlRecord>): void {
  const key = normalizeKey(url);
  const rec = records.get(key);
  if (!rec) {
    records.set(key, { ...classifyJudgmentUrl(url), relay_slot_spent: false, fetch_result: null, body_chars: null, identity_validated: null, cache: null, injected_candidate: null, final_cited: null, ...patch });
    return;
  }
  Object.assign(rec, patch);
}

/** Mark a URL the origin answered with an Exception / wrong-file-code page. */
export function markExceptionPageUrl(url: string): void {
  knownBadUrls.add(normalizeKey(url));
  noteJudgmentUrlOutcome(url, { fetch_result: "exception_page" });
}

/**
 * Relay gate. A URL may spend a relay slot only when it is not a guessed
 * derivation, was not previously an Exception page, and its provenance is a
 * real official search result, the verified cache, or a trusted parser.
 *
 * URLs with no registered provenance are allowed only when they carry no
 * guessed pattern and the caller did not label them as a derivation — the
 * pre-existing non-nomination lanes (statutes, specific-case resolution) do
 * not register provenance and must keep working.
 */
export function relayGate(
  url: string,
  callerOrigin?: string,
): { allowed: boolean; reason: string | null; url_source: JudgmentUrlSource } {
  const key = normalizeKey(url);
  const rec = records.get(key);
  const gid = guessedPatternId(url);
  if (isBareHostUrl(url)) {
    relaySlotsSaved++;
    return { allowed: false, reason: "not_a_document_url", url_source: rec?.url_source ?? "unknown" };
  }
  if (gid) {
    relaySlotsSaved++;
    noteJudgmentUrlOutcome(url, { fetch_result: "relay_suppressed" });
    return { allowed: false, reason: `guessed_url_pattern:${gid}`, url_source: rec?.url_source ?? "derivation" };
  }
  if (knownBadUrls.has(key)) {
    relaySlotsSaved++;
    return { allowed: false, reason: "previously_exception_page", url_source: rec?.url_source ?? "unknown" };
  }
  if (rec && !rec.relay_eligible) {
    relaySlotsSaved++;
    return { allowed: false, reason: rec.suppression_reason, url_source: rec.url_source };
  }
  if (!rec && callerOrigin === "derivation") {
    relaySlotsSaved++;
    return { allowed: false, reason: "url_source_not_trusted:derivation", url_source: "derivation" };
  }
  return { allowed: true, reason: null, url_source: rec?.url_source ?? "unknown" };
}

export function noteRelaySlotSpent(url: string): void {
  noteJudgmentUrlOutcome(url, { relay_slot_spent: true });
}

export function judgmentUrlTelemetry() {
  return {
    version: JUDGMENT_URL_GUESS_SUPPRESSION_VERSION,
    candidates: [...records.values()].slice(0, 60),
    total_candidates: records.size,
    guessed_detected: [...records.values()].filter((r) => r.guessed_pattern).length,
    suppressed: suppressedCount,
    relay_slots_saved: relaySlotsSaved,
    relay_slots_spent: [...records.values()].filter((r) => r.relay_slot_spent).length,
  };
}
