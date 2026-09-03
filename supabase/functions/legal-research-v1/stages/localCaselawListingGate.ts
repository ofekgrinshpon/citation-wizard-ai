// local_caselaw_content_aware_listing_gate_v1
//
// Local-corpus caselaw rows are ingested with a gov.il *collector* URL
// (…/dynamiccollectors/…?skip=N). That URL is an ingestion identity artefact,
// not a content signal: an audit of 534 suppressed candidates found 524 full
// judgment bodies, 10 official abridged summaries and ZERO listing pages.
//
// This gate makes listing suppression content-aware for `origin = local_db`
// caselaw ONLY. Everything else (web / perplexity / external) is untouched.
//
// Hard constraints: no LLM, no network, no PDF/OCR, no extra retrieval, no
// pool growth. The only I/O is one batched, bounded RPC against the local
// corpus that returns case_number, body length and a 3k head excerpt.

import type { Candidate } from "../lib/types.ts";

export type LocalCaselawClass =
  | "substantive_judgment_body"
  | "partial_judgment_summary"
  | "metadata_only"
  | "listing_or_index_body";

export interface LocalCaselawGateRow {
  candidate_id: string;
  doc_id: string | null;
  source_url: string | null;
  origin: string;
  source_type: string;
  case_number_present: boolean;
  available_text_chars: number;
  positive_judgment_signals: string[];
  negative_listing_signals: string[];
  classification: LocalCaselawClass;
  bypass_url_listing_suppression: boolean;
  final_decision: "bypass_suppression" | "keep_suppressible";
  reason: string;
  elapsed_ms: number;
}

export interface LocalCaselawGateDiagnostics {
  status: "not_started" | "completed";
  candidates_checked: number;
  bypassed: number;
  still_suppressible: number;
  classification_counts: Record<string, number>;
  rows: LocalCaselawGateRow[];
  p50_ms: number;
  p95_ms: number;
  elapsed_ms: number;
  rpc_error?: string;
}

export function emptyLocalCaselawGateDiagnostics(): LocalCaselawGateDiagnostics {
  return {
    status: "not_started",
    candidates_checked: 0,
    bypassed: 0,
    still_suppressible: 0,
    classification_counts: {},
    rows: [],
    p50_ms: 0,
    p95_ms: 0,
    elapsed_ms: 0,
  };
}

/** Metadata key written on candidates that pass the content gate. */
export const GATE_META_KEY = "local_caselaw_content_gate";

const CASELAW_TYPES = new Set([
  "caselaw",
  "case_law",
  "supreme_court_il",
  "court_case",
  "judgment",
]);

/** gov.il collector / listing-shaped stored URLs. */
const COLLECTOR_URL_RE =
  /(dynamiccollectors|\/collectors?\/|[?&]skip=\d+|[?&]page=\d+|\/search(\/|\?|$)|\/archive(\/|\?|$)|\/index(\/|\?|$))/i;

const OPENER_RE = /(ל\s?פני\s+(כבוד|הרכב)|בפני\s+(כבוד|הרכב)|בבית\s+המשפט)/;
const DECISION_HEADER_RE = /(פסק\s*דין|גזר\s*דין|הכרעת\s*דין|החלטה)/;
const PARTY_RE = /(המערער|המשיב|העותר|המבקש|הנאשם|התובע|הנתבע|מאשימה)/;
const VS_RE = /\sנגד\s|\sנ'\s|\sנ׳\s/;
const DOCKET_RE =
  /(בג"?ץ|בג״ץ|ע"?א|רע"?א|ע"?פ|רע"?פ|בש"?א|עה"?ס|עע"?ם|ד"?נ|תמ"?ש|ת"?א)\s*\d{1,6}\/\d{2,4}(?!\d)/;

const LISTING_VOCAB = [
  /תוצאות\s*חיפוש/g,
  /לצפייה/g,
  /עמוד\s*הבא/g,
  /עמוד\s*קודם/g,
  /הצג\s*עוד/g,
  /סנן/g,
  /תוצאות\s*נוספות/g,
];

const SUMMARY_RE = /(תקציר\s*(פסק\s*דין|החלטה)?|הודעה\s*לתקשורת|דובר(ות)?\s*בתי\s*המשפט)/;

const SUBSTANTIVE_MIN_CHARS = 2000;
const PARTIAL_MIN_CHARS = 900;

export interface BodySignals {
  case_number: string | null;
  body_chars: number;
  head_text: string;
}

export function isLocalCaselawCandidate(c: Candidate): boolean {
  return c.origin === "local_db" && !!c.document_id &&
    CASELAW_TYPES.has(String(c.source_type ?? "").toLowerCase());
}

export function hasCollectorShapedUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return COLLECTOR_URL_RE.test(url);
}

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) || []).length;
}

/** Pure, deterministic classification from already-available text. */
export function classifyLocalCaselawBody(
  args: { title: string; text: string; case_number: string | null; body_chars: number },
): {
  classification: LocalCaselawClass;
  positive: string[];
  negative: string[];
  reason: string;
} {
  const text = args.text || "";
  const hay = `${args.title || ""}\n${text}`;
  const positive: string[] = [];
  const negative: string[] = [];

  if (args.case_number && args.case_number.trim()) positive.push("case_number_column");
  if (DOCKET_RE.test(hay)) positive.push("docket_pattern");
  if (OPENER_RE.test(text)) positive.push("formal_judgment_opener");
  if (DECISION_HEADER_RE.test(text)) positive.push("decision_header");
  if (PARTY_RE.test(text)) positive.push("party_role_terms");
  if (VS_RE.test(hay)) positive.push("party_block_vs");

  let listingHits = 0;
  for (const re of LISTING_VOCAB) listingHits += countMatches(text, new RegExp(re.source, "g"));
  if (listingHits > 0) negative.push(`listing_vocabulary_x${listingHits}`);
  if (args.body_chars < PARTIAL_MIN_CHARS) negative.push("very_short_text");

  const judgmentMarkers = positive.length;

  // Audit-derived negative rule: listing vocabulary dominates and judgment
  // markers are scarce ⇒ this really is a listing/index body.
  if (listingHits >= 5 && judgmentMarkers < 4) {
    negative.push("listing_vocabulary_dominant");
    return {
      classification: "listing_or_index_body",
      positive,
      negative,
      reason: "listing_vocabulary_dominant_with_few_judgment_markers",
    };
  }

  const hasIdentity = positive.includes("case_number_column") ||
    positive.includes("docket_pattern") ||
    positive.includes("formal_judgment_opener");

  if (args.body_chars < 400 || judgmentMarkers === 0) {
    return {
      classification: "metadata_only",
      positive,
      negative,
      reason: args.body_chars < 400 ? "body_below_metadata_floor" : "no_judgment_signals",
    };
  }

  if (args.body_chars >= SUBSTANTIVE_MIN_CHARS && hasIdentity && judgmentMarkers >= 2) {
    return {
      classification: "substantive_judgment_body",
      positive,
      negative,
      reason: "substantive_body_with_judgment_identity",
    };
  }

  if (args.body_chars >= PARTIAL_MIN_CHARS && hasIdentity) {
    return {
      classification: "partial_judgment_summary",
      positive,
      negative,
      reason: SUMMARY_RE.test(text)
        ? "official_abridged_summary"
        : "short_body_with_judgment_identity",
    };
  }

  return {
    classification: "metadata_only",
    positive,
    negative,
    reason: "insufficient_body_for_judgment_support",
  };
}

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

const MAX_LOOKUPS = 80;

/**
 * Enrich local_db caselaw candidates with a content-gate verdict, so the
 * discovery-precision stage can decide with content instead of the URL.
 * One batched RPC, bounded to MAX_LOOKUPS documents. Never throws.
 */
export async function enrichLocalCaselawListingGate(
  admin: RpcClient | null,
  candidates: Candidate[],
): Promise<LocalCaselawGateDiagnostics> {
  const diag = emptyLocalCaselawGateDiagnostics();
  const t0 = Date.now();

  const targets = candidates.filter(
    (c) => isLocalCaselawCandidate(c) && hasCollectorShapedUrl(c.source_url),
  );
  if (!targets.length || !admin) {
    diag.status = "completed";
    diag.elapsed_ms = Date.now() - t0;
    return diag;
  }

  const docIds = Array.from(new Set(targets.map((c) => String(c.document_id)))).slice(
    0,
    MAX_LOOKUPS,
  );
  const signals = new Map<string, BodySignals>();
  try {
    const { data, error } = await admin.rpc("local_caselaw_body_signals", { _doc_ids: docIds });
    if (error) diag.rpc_error = error.message || String(error);
    for (const r of (data as Array<Record<string, unknown>> | null) ?? []) {
      signals.set(String(r.document_id), {
        case_number: (r.case_number as string) ?? null,
        body_chars: Number(r.body_chars ?? 0),
        head_text: String(r.head_text ?? ""),
      });
    }
  } catch (e) {
    diag.rpc_error = String(e);
  }

  const durations: number[] = [];
  for (const c of targets) {
    const rowT0 = Date.now();
    const docId = String(c.document_id);
    const sig = signals.get(docId);
    const localText = `${c.snippet ?? ""}\n${
      String((c.metadata as Record<string, unknown> | undefined)?.extended_text ?? "")
    }`;
    const text = sig?.head_text && sig.head_text.length > localText.length
      ? sig.head_text
      : localText;
    const bodyChars = Math.max(sig?.body_chars ?? 0, localText.trim().length);
    const verdict = classifyLocalCaselawBody({
      title: c.title ?? "",
      text,
      case_number: sig?.case_number ?? null,
      body_chars: bodyChars,
    });

    const bypass = verdict.classification === "substantive_judgment_body" ||
      verdict.classification === "partial_judgment_summary";
    const ms = Date.now() - rowT0;
    durations.push(ms);

    const row: LocalCaselawGateRow = {
      candidate_id: c.candidate_id,
      doc_id: docId,
      source_url: c.source_url ?? null,
      origin: c.origin,
      source_type: String(c.source_type ?? ""),
      case_number_present: !!(sig?.case_number && sig.case_number.trim()),
      available_text_chars: bodyChars,
      positive_judgment_signals: verdict.positive,
      negative_listing_signals: verdict.negative,
      classification: verdict.classification,
      bypass_url_listing_suppression: bypass,
      final_decision: bypass ? "bypass_suppression" : "keep_suppressible",
      reason: verdict.reason,
      elapsed_ms: ms,
    };
    diag.rows.push(row);
    diag.classification_counts[verdict.classification] =
      (diag.classification_counts[verdict.classification] ?? 0) + 1;
    if (bypass) diag.bypassed++;
    else diag.still_suppressible++;

    c.metadata = {
      ...(c.metadata ?? {}),
      [GATE_META_KEY]: {
        classification: verdict.classification,
        bypass,
        reason: verdict.reason,
        body_chars: bodyChars,
        // Partial official summaries may framing/background only — never a holding.
        limited_claim_scope: verdict.classification === "partial_judgment_summary",
      },
    };
  }

  durations.sort((a, b) => a - b);
  const pick = (q: number) => durations.length ? durations[Math.min(durations.length - 1, Math.floor(q * durations.length))] : 0;
  diag.candidates_checked = targets.length;
  diag.p50_ms = pick(0.5);
  diag.p95_ms = pick(0.95);
  diag.status = "completed";
  diag.elapsed_ms = Date.now() - t0;
  return diag;
}
