/**
 * legal-research-v2 — `fetch` tool.
 *
 * Retrieve actual readable legal text and append it to the evidence store.
 * Reuses the proven low-level HTTP/extraction primitives (official fetch
 * profiles + court egress relay, bounded PDF page extraction, DOCX, HTML) and
 * nothing above them: no acquisition stage, no fallback hierarchy, no rescue.
 * If a fetch fails, the research agent decides what to do next.
 *
 * Context discipline: the full body is stored server-side; the tool response
 * carries only a summary plus bounded excerpts. An already-read source is
 * answered from the store, and `fetch({source_id, query})` re-reads a specific
 * part of it without re-injecting the document.
 */

import type { EvidenceSource, PdfExtractionMeta, SearchResult } from "../types.ts";
import {
  type BibliographicMetadata,
  bibliographicFromSearch,
  isDiscoveryEndpointUrl,
  mergeBibliographic,
  parseHtmlBibliographic,
  parsePdfInfoMetadata,
  pdfUrlFromHtmlMeta,
  sanitizeBibliographic,
} from "../shared/bibliographic.ts";
import {
  classifyFetchException,
  classifyHttpStatus,
  classifyUnusableBody,
  type FetchFailureClass,
  isRecoverableFailure,
} from "../shared/fetchDiagnostics.ts";
import { normalizeMalformedUrl } from "../shared/urlNormalize.ts";
import type { EvidenceStore } from "../evidence/evidenceStore.ts";
import { excerptWindows } from "../evidence/evidenceStore.ts";
import {
  extractDocumentText,
  extractPdfPagesBounded,
  htmlToText,
  looksLikeBlockPage,
  officialFetch,
  type SupabaseClient,
} from "../shared/primitives.ts";
import { decodeResponseText, isUnreadableEncoding } from "../shared/textDecoding.ts";
import { checkUrlSafety } from "../shared/urlSafety.ts";
import { loadLocalDocument, localAttemptKey } from "./localCorpusBody.ts";
import { AcquisitionLedger, type AuthorityState, authorityKeyOf } from "./acquisitionLedger.ts";
import { corroborateAuthority } from "./authorityCorroboration.ts";
import { locateSection, normalizeSectionToken, sectionMissingInstruction } from "../evidence/sectionLocator.ts";
import { normalizeUrlKey } from "../evidence/evidenceStore.ts";
import type { ServedQuote } from "../evidence/quotable.ts";

export const FETCH_LIMITS = {
  TIMEOUT_MS: 25_000,
  MAX_BYTES: 24 * 1024 * 1024,
  MAX_TEXT_CHARS: 200_000,
  PDF_MAX_PAGES: 24,
  PDF_DEADLINE_MS: 12_000,
  PDF_ENOUGH_CHARS: 80_000,
  MIN_DOCUMENT_CHARS: 400,
  /** Bounded later-page continuation of an already-acquired PDF. */
  PDF_CONTINUATION_PAGES: 20,
  PDF_CONTINUATION_CHARS: 90_000,
  /** Context ceilings — the agent never receives a whole body. */
  HEAD_CHARS: 1_400,
  WINDOW_CHARS: 1_200,
  MAX_WINDOWS: 3,
  MAX_RESPONSE_CHARS: 6_500,
};

/** Deterministic "this is not a document" signatures. One small set, no taxonomy. */
const LISTING_SIGNATURES = [
  "תוצאות חיפוש",
  "לא נמצאו תוצאות",
  "search results",
  "no results found",
  "מנוע חיפוש",
  "רשימת פסקי דין",
  "התחבר כדי לצפות",
  "נדרשת הרשמה",
  "subscribe to continue",
  "enable javascript",
  "דפדפן אינו נתמך",
];

export interface DocumentCheck {
  is_actual_document: boolean;
  reason?: string;
}

export function checkIsActualDocument(text: string): DocumentCheck {
  const t = (text ?? "").trim();
  if (t.length < FETCH_LIMITS.MIN_DOCUMENT_CHARS) {
    return { is_actual_document: false, reason: "too_short_for_a_document" };
  }
  // Decode corruption: a body dominated by U+FFFD is not readable, however
  // long it is and however many ASCII docket digits survived inside it.
  if (isUnreadableEncoding(t)) {
    return { is_actual_document: false, reason: "unreadable_encoding" };
  }
  if (looksLikeBlockPage(t)) {
    return { is_actual_document: false, reason: "block_page" };
  }
  const head = t.slice(0, 3_000).toLowerCase();
  const hit = LISTING_SIGNATURES.find((s) => head.includes(s.toLowerCase()));
  if (hit && t.length < 8_000) {
    return { is_actual_document: false, reason: `listing_or_portal_shell:${hit}` };
  }
  // A portal shell is mostly navigation: very little running prose.
  const sentences = (t.match(/[.!?׃:]\s/g) ?? []).length;
  if (t.length < 2_000 && sentences < 3) {
    return { is_actual_document: false, reason: "portal_shell_no_prose" };
  }
  return { is_actual_document: true };
}

export interface DecodeTelemetry {
  charset_declared: string | null;
  charset_used: string;
  replacement_ratio_utf8: number;
  replacement_ratio: number;
  fallback_applied: boolean;
}

export interface ExtractResult {
  text: string;
  error?: string;
  decode?: DecodeTelemetry;
  /** Raw markup, kept only so bibliographic meta tags can be parsed. */
  html?: string;
  pdf?: PdfExtractionMeta;
  /** Bibliographic metadata found in the document itself. */
  bibliographic?: BibliographicMetadata;
  /** Repository landing page → the article PDF it declares. */
  pdf_link?: string;
}

export async function extractByContentType(
  url: string,
  contentType: string,
  bytes: Uint8Array,
): Promise<ExtractResult> {
  const ct = contentType.toLowerCase();
  const isPdf = ct.includes("pdf") || /\.pdf(\?|$)/i.test(url) ||
    (bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50);
  if (isPdf) {
    try {
      const res = await extractPdfPagesBounded(bytes, {
        maxPages: FETCH_LIMITS.PDF_MAX_PAGES,
        maxChars: FETCH_LIMITS.MAX_TEXT_CHARS,
        deadlineMs: FETCH_LIMITS.PDF_DEADLINE_MS,
        enoughChars: FETCH_LIMITS.PDF_ENOUGH_CHARS,
      });
      return {
        text: res.text,
        pdf: {
          total_pages: res.total_pages,
          pages_attempted: res.pages_attempted,
          pages_extracted: res.pages_extracted,
          first_page: res.first_page_extracted,
          last_page: res.last_page_extracted,
          chars_extracted: res.chars_extracted,
          stop_reason: res.stopped_reason,
          continued_through_page: res.last_page_extracted ?? undefined,
        },
        bibliographic: parsePdfInfoMetadata(res.info),
      };
    } catch (e) {
      return { text: "", error: `pdf_extract_failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  if (ct.includes("wordprocessingml") || /\.docx(\?|$)/i.test(url)) {
    try {
      return { text: await extractDocumentText(bytes, "docx") };
    } catch (e) {
      return { text: "", error: `docx_extract_failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  // Charset-aware decode BEFORE any HTML stripping, so a windows-1255 page is
  // never stripped as mojibake.
  const decoded = decodeResponseText(bytes, contentType);
  const raw = decoded.text;
  const decode = {
    charset_declared: decoded.charset_declared,
    charset_used: decoded.charset_used,
    replacement_ratio_utf8: decoded.replacement_ratio_utf8,
    replacement_ratio: decoded.replacement_ratio,
    fallback_applied: decoded.fallback_applied,
  };
  if (ct.includes("html") || /<html[\s>]/i.test(raw.slice(0, 2_000))) {
    return {
      text: htmlToText(raw),
      decode,
      html: raw.slice(0, 400_000),
      bibliographic: parseHtmlBibliographic(raw),
      pdf_link: pdfUrlFromHtmlMeta(raw, url),
    };
  }
  return { text: raw.trim(), decode };
}

/** Return reading windows around the agent's search terms (verbatim slices). */
export function readingWindows(text: string, find: string[]): string[] {
  return excerptWindows(text, find, {
    window: FETCH_LIMITS.WINDOW_CHARS,
    max: FETCH_LIMITS.MAX_WINDOWS,
  });
}

/** Register windows as literal quotable text and shape them for the response. */
export function serveExactText(
  store: EvidenceStore,
  source_id: string,
  windows: string[] | undefined,
  issue?: string,
): {
  windows?: string[];
  exact_source_text?: Array<{ quote_id: string; text: string }>;
  /** How many of the served quotes were new to this run (0 = nothing new). */
  new_quote_count: number;
  served_quote_count: number;
} {
  if (!windows?.length) return { new_quote_count: 0, served_quote_count: 0 };
  const { quotes: served, new_count }: { quotes: ServedQuote[]; new_count: number } = store
    .serveQuotesWithNovelty(source_id, windows, issue);
  if (!served.length) return { windows, new_quote_count: 0, served_quote_count: 0 };
  return {
    windows: served.map((q) => q.text),
    exact_source_text: served.map((q) => ({ quote_id: q.quote_id, text: q.text })),
    new_quote_count: new_count,
    served_quote_count: served.length,
  };
}

const QUOTE_RULE =
  " צטט מילה במילה מתוך exact_source_text בלבד — כל quoted_span חייב להיות העתקה מדויקת של רצף תווים מתוך הקטעים שהוחזרו, ללא ניסוח מחדש, קיצור פנימי או תרגום.";

export interface FetchInput {
  result_id?: string;
  url?: string;
  /** Targeted re-read of a document already in the evidence store. */
  source_id?: string;
  query?: string;
  locator?: string;
  want?: string;
  expected_identity?: { docket?: string; statute?: string; section?: string };
  /** Optional in-document search terms; returns verbatim windows around them. */
  find?: string[];
  /** Explicit justification for re-fetching an already-read URL. */
  refetch_reason?: string;
}

export interface FetchOutput {
  ok: boolean;
  source_id?: string;
  title?: string;
  summary?: string;
  text_length?: number;
  is_actual_document?: boolean;
  not_document_reason?: string;
  identity_found?: { dockets: string[]; statutes: string[]; sections: string[] };
  identity_hint?: string;
  text_head?: string;
  windows?: string[];
  /**
   * The literal, quotable form of the returned windows. `quoted_span` in the
   * research memo must be copied from here, character for character.
   */
  exact_source_text?: Array<{ quote_id: string; text: string }>;
  /** True when the body was already in the evidence store (no new HTTP call). */
  deduped?: boolean;
  already_read?: boolean;
  instruction?: string;
  acquisition_note?: string;
  /** Compact per-authority acquisition state (attempted hosts, usable body). */
  authority_state?: AuthorityState;
  /** True when a usable body for this authority already exists elsewhere. */
  authority_reuse?: boolean;
  /** Internal telemetry: the body corroborated the requested authority. */
  authority_identity_corroborated?: boolean;
  /** Internal telemetry: a binding authority_key → source was created. */
  authority_binding_created?: boolean;
  /** Internal telemetry: readable body, but identity unconfirmed → no binding. */
  authority_binding_withheld?: boolean;
  /** Deterministic reason string for the binding decision. */
  authority_binding_basis?: string;
  /** Which authority this fetch was aimed at, and where that came from. */
  expected_authority_key?: string;
  expected_identity_source?: "candidate" | "model" | "merged" | "none";
  /** Set when model-supplied identity contradicted the candidate's own. */
  expected_identity_conflict?: string;
  /** What the candidate was, as classified at discovery time. */
  candidate_kind?: "document" | "local_document" | "discovery_entry";
  /** How the body was obtained: an HTTP fetch, or the stored local corpus. */
  acquisition_transport?: "http" | "local_corpus";
  /** For a local corpus acquisition: how the row was matched to the authority. */
  local_match_basis?: "case_number_exact" | "citation_docket" | "title_ilike";
  /** Charset decision and decode-quality signal for a text/HTML body. */
  decode?: DecodeTelemetry;
  /** True when this exact URL already failed for this authority. */
  dead_path?: boolean;
  /** Targeted section retrieval outcome. */
  section_requested?: string;
  section_found?: boolean;
  section_coverage?: { first: string | null; last: string | null; count: number };
  /**
   * Advisory only: equivalent queries on this source have not been yielding.
   * The agent keeps full discretion over what to do next.
   */
  search_path_exhausted?: boolean;
  same_issue_no_yield?: number;
  no_new_evidence?: boolean;
  /**
   * Span-hunting discipline (v2_span_hunting_efficiency_v1): repeated targeted
   * reads of this source stopped producing any new quotable text.
   */
  span_hunting_exhausted?: boolean;
  /** This read was answered from state; no in-document search was performed. */
  span_hunting_suppressed?: boolean;
  /** Internal telemetry for the read that just ran. */
  span_hunting_newly_exhausted?: boolean;
  new_quote_count?: number;
  /** A malformed URL was deterministically repaired before fetching. */
  url_repaired?: boolean;
  /** A repository landing page was resolved to its article PDF. */
  repository_pdf_followed?: boolean;
  /** Specific terminal cause of an acquisition failure (never "http_failed"). */
  failure_class?: FetchFailureClass;
  /** True when a bounded alternative-copy attempt could plausibly help. */
  alternative_copy_worth_trying?: boolean;
  /**
   * same_work_live_recovery_v1 — this body came from another PUBLIC copy of
   * the SAME work, accepted by the deterministic equivalence check. It carries
   * no extra trust: every ordinary gate still applied.
   */
  same_work_recovered?: boolean;
  same_work_recovery_basis?: string;
  same_work_recovered_host?: string;
  /** Precise reason a bounded same-work recovery round did not help. */
  same_work_recovery_failed_reason?: string;
  /** Provenance of the structured bibliographic metadata, if any. */
  bibliographic_basis?: string[];
  /** Bounded later-page continuation of an already-acquired PDF. */
  pdf_continued?: boolean;
  pdf_pages_added?: string;
  pdf_chars_added?: number;
  served_quote_count?: number;
  error?: string;
}

function alreadyReadPayload(
  store: EvidenceStore,
  cached: EvidenceSource,
  input: FetchInput,
): FetchOutput {
  const terms = [
    ...(input.find ?? []),
    ...(input.query ? [input.query] : []),
    ...(input.locator ? [input.locator] : []),
  ];
  const raw = terms.length ? readingWindows(cached.extracted_text, terms) : undefined;
  const served = serveExactText(store, cached.source_id, raw, input.query ?? input.locator);
  const windows = served.windows;
  return {
    ok: cached.fetch_status === "ok",
    already_read: true,
    deduped: true,
    source_id: cached.source_id,
    title: cached.title,
    summary: cached.summary,
    text_length: cached.text_length,
    is_actual_document: cached.is_actual_document,
    not_document_reason: cached.not_document_reason,
    identity_found: cached.identity_fields,
    windows: windows?.length ? windows : undefined,
    exact_source_text: served.exact_source_text,
    text_head: windows?.length ? undefined : cached.extracted_text.slice(0, FETCH_LIMITS.HEAD_CHARS),
    instruction: cached.fetch_status === "ok" && cached.is_actual_document
      ? `מקור זה כבר נקרא בריצה זו. אל תביא אותו שוב אלא אם נדרשת הבאה שונה מהותית. לקריאה ממוקדת בתוכו: fetch({source_id, query}).${
        windows?.length ? QUOTE_RULE : ""
      }`
      : `נתיב זה כבר נוסה בריצה זו ולא הניב מסמך קריא (${cached.not_document_reason ?? cached.fetch_error ?? "unusable"}). אל תחזור עליו — פנה למקור רשמי אחר או לנוסח משולב אמין.`,
    error: cached.fetch_status === "ok" ? undefined : cached.fetch_error,
  };
}

/** Clamp every string field so a single tool response can never blow up context. */
export function clampFetchOutput(out: FetchOutput): FetchOutput {
  const clamped: FetchOutput = { ...out };
  if (clamped.text_head) clamped.text_head = clamped.text_head.slice(0, FETCH_LIMITS.HEAD_CHARS);
  if (clamped.summary) clamped.summary = clamped.summary.slice(0, 900);
  if (clamped.windows) {
    clamped.windows = clamped.windows
      .slice(0, FETCH_LIMITS.MAX_WINDOWS)
      .map((w) => w.slice(0, FETCH_LIMITS.WINDOW_CHARS));
  }
  if (clamped.exact_source_text) {
    clamped.exact_source_text = clamped.exact_source_text
      .slice(0, FETCH_LIMITS.MAX_WINDOWS)
      .map((q) => ({ quote_id: q.quote_id, text: q.text.slice(0, FETCH_LIMITS.WINDOW_CHARS) }));
  }
  // Last-resort ceiling on the serialized payload.
  let json = JSON.stringify(clamped);
  while (json.length > FETCH_LIMITS.MAX_RESPONSE_CHARS && clamped.windows?.length) {
    clamped.windows = clamped.windows.slice(0, clamped.windows.length - 1);
    if (clamped.exact_source_text?.length) {
      clamped.exact_source_text = clamped.exact_source_text.slice(0, clamped.windows.length);
    }
    json = JSON.stringify(clamped);
  }
  if (json.length > FETCH_LIMITS.MAX_RESPONSE_CHARS && clamped.text_head) {
    clamped.text_head = clamped.text_head.slice(0, 800);
  }
  return clamped;
}

/**
 * Merge the identity the candidate was discovered FOR with any identity the
 * model restated. Deterministic candidate metadata wins on conflict: the model
 * may add detail (a section), never silently retarget a known candidate.
 */
export function resolveExpectedIdentity(
  candidate: Pick<SearchResult, "expected_identity" | "authority_key"> | null | undefined,
  fromModel: FetchInput["expected_identity"],
): {
  identity?: { docket?: string; statute?: string; section?: string };
  source: "candidate" | "model" | "merged" | "none";
  conflict?: string;
} {
  const c = candidate?.expected_identity;
  const m = fromModel;
  const clean = (v?: string) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const cd = clean(c?.docket), md = clean(m?.docket);
  const cs = clean(c?.statute), ms = clean(m?.statute);
  if (!cd && !cs) {
    return m && (md || ms || clean(m.section))
      ? { identity: { docket: md, statute: ms, section: clean(m.section) }, source: "model" }
      : { source: "none" };
  }
  const num = (v?: string) => v?.match(/\d{1,6}\s*\/\s*\d{2,4}/)?.[0]?.replace(/\s+/g, "") ?? v;
  const conflict = (cd && md && num(cd) !== num(md))
    ? `model_expected_identity_ignored: candidate=${cd} model=${md}`
    : (cs && ms && !cs.includes(ms) && !ms.includes(cs))
    ? `model_expected_identity_ignored: candidate=${cs} model=${ms}`
    : undefined;
  return {
    identity: {
      docket: cd,
      statute: cs,
      // A section is extra precision, accepted only when it does not contradict.
      section: clean(c?.section) ?? (conflict ? undefined : clean(m?.section)),
    },
    source: m && (md || ms) ? "merged" : "candidate",
    conflict,
  };
}

export async function runFetch(
  store: EvidenceStore,
  discovered: Map<string, SearchResult>,
  input: FetchInput,
  ledger?: AcquisitionLedger,
  opts?: { admin?: SupabaseClient | null },
): Promise<FetchOutput> {
  // ── Targeted re-read of an already-stored body (no HTTP, no budget) ──────
  if (input.source_id && !input.url && !input.result_id) {
    const src = store.get(input.source_id);
    if (!src) return { ok: false, error: `unknown_source_id:${input.source_id}` };

    // ── Targeted section retrieval ────────────────────────────────────────
    // A long consolidated statute is not limited to its first text window:
    // the requested provision is located inside the stored body, and if the
    // body cannot serve it that is said plainly so the agent pivots.
    const sectionRequest = input.expected_identity?.section ?? input.locator ??
      (input.want === "relevant_section" ? input.query : undefined);
    const sectionToken = sectionRequest ? normalizeSectionToken(sectionRequest) : null;

    // ── Bounded later-page continuation (academic_evidence_yield_v1) ──────
    // A long law-review article often spends its first pages on title, table
    // of contents and introduction, so the argument the agent needs sits past
    // the initial page bound. This reads a BOUNDED further page range of a
    // PDF already acquired in this run — append-only, hard ceilings intact,
    // never the whole journal issue.
    if (input.want === "pdf_page_range" || input.want === "later_pages") {
      const cont = await continuePdfRead(store, src, input);
      if (cont) return clampFetchOutput(cont);
    }

    // ── Span-hunting suppression (v2_span_hunting_efficiency_v1) ──────────
    // Repeated paraphrased reads of a body that keep returning text already
    // served cost a whole agent turn each and add nothing. Once this source
    // is span-hunting exhausted, such a read is answered from state without
    // running another in-document search. Structurally different reads — a
    // section/locator never attempted here, or an explicit refetch_reason —
    // still execute normally, so no source is ever permanently locked.
    const structurallyNew = (!!sectionToken && ledger?.isNewLocator(src.source_id, sectionToken) === true &&
      !ledger?.knownMissingLocator(src.source_id, sectionToken)) ||
      !!input.refetch_reason?.trim();
    if (ledger?.spanHuntingExhausted(src.source_id) && !structurallyNew) {
      const prior = store.servedQuotes(src.source_id).slice(-FETCH_LIMITS.MAX_WINDOWS);
      const state = ledger.readState(src.source_id);
      return clampFetchOutput({
        ok: false,
        already_read: true,
        no_new_evidence: true,
        span_hunting_exhausted: true,
        span_hunting_suppressed: true,
        source_id: src.source_id,
        same_issue_no_yield: state?.no_yield,
        exact_source_text: prior.length
          ? prior.map((q) => ({ quote_id: q.quote_id, text: q.text }))
          : undefined,
        instruction:
          `מספר קריאות ממוקדות ב-${src.source_id} לא הפיקו טקסט ציטוט חדש. אל תמשיך לחפש במקור זה בניסוחים שונים. עשה אחת מאלה: (1) השתמש בקטעים המדויקים שכבר הוגשו לך; (2) פנה למקור או לנתיב השגה קונקרטי אחר; (3) הגש את תזכיר המחקר. קריאה בעלת מטרה שונה מהותית (סעיף מסוים שטרם התבקש כאן) עדיין אפשרית.`,
      });
    }
    if (sectionToken) {
      ledger?.noteLocatorAttempt(src.source_id, sectionToken);
      if (ledger?.knownMissingLocator(src.source_id, sectionToken)) {
        const known = locateSection(src.extracted_text, sectionToken, {
          truncated: src.text_length >= FETCH_LIMITS.MAX_TEXT_CHARS,
        });
        const prior = store.servedQuotes(src.source_id).slice(-2);
        return clampFetchOutput({
          ok: false,
          already_read: true,
          no_new_evidence: true,
          search_path_exhausted: true,
          same_issue_no_yield: ledger?.readState(src.source_id)?.no_yield,
          source_id: src.source_id,
          section_requested: sectionToken,
          section_found: false,
          section_coverage: known.coverage,
          exact_source_text: prior.length
            ? prior.map((q) => ({ quote_id: q.quote_id, text: q.text }))
            : undefined,
          instruction: sectionMissingInstruction(known, src.source_id),
        });
      }
      const found = locateSection(src.extracted_text, sectionToken, {
        window: FETCH_LIMITS.WINDOW_CHARS + 600,
        truncated: src.text_length >= FETCH_LIMITS.MAX_TEXT_CHARS,
      });
      const read = ledger?.noteRead(src.source_id, {
        yielded: found.found,
        locator: found.found ? null : sectionToken,
      });
      // Not the requested section, but do not withhold what the body does say:
      // return bounded term windows as clearly-labelled context.
      const fallback = found.found ? null : store.excerpt(src.source_id, {
        query: input.query,
        find: input.find,
        maxChars: FETCH_LIMITS.WINDOW_CHARS,
      });
      const fallbackWindows = fallback && fallback.from !== "head" ? fallback.windows : undefined;
      const servedSection = serveExactText(
        store,
        src.source_id,
        found.found ? found.windows : fallbackWindows,
        found.found ? `סעיף ${sectionToken}` : input.query,
      );
      const sectionYield = ledger?.noteQuoteYield(src.source_id, servedSection.new_quote_count);
      return clampFetchOutput({
        ok: found.found && src.fetch_status === "ok",
        already_read: true,
        new_quote_count: servedSection.new_quote_count,
        served_quote_count: servedSection.served_quote_count,
        span_hunting_exhausted: sectionYield?.span_hunting_exhausted || undefined,
        span_hunting_newly_exhausted: sectionYield?.newly_exhausted || undefined,
        source_id: src.source_id,
        title: src.title,
        text_length: src.text_length,
        is_actual_document: src.is_actual_document,
        identity_found: src.identity_fields,
        section_requested: sectionToken,
        section_found: found.found,
        section_coverage: found.coverage,
        windows: servedSection.windows,
        exact_source_text: servedSection.exact_source_text,
        no_new_evidence: found.found || fallbackWindows ? undefined : true,
        search_path_exhausted: found.found ? undefined : read?.exhausted || undefined,
        same_issue_no_yield: found.found ? undefined : read?.no_yield,
        instruction: found.found
          ? `סעיף ${sectionToken} אותר בתוך ${src.source_id}.${QUOTE_RULE}`
          : `${sectionMissingInstruction(found, src.source_id)}${
            fallbackWindows ? " (הוחזרו חלונות טקסט לפי מונחי החיפוש בלבד — אינם הסעיף המבוקש.)" : ""
          }`,
      });
    }

    const ex = store.excerpt(input.source_id, {
      query: input.query,
      locator: input.locator,
      find: input.find,
      maxChars: FETCH_LIMITS.WINDOW_CHARS,
    })!;
    // "head" means no query term matched: this read produced no new evidence.
    const yielded = ex.from !== "head";
    const read = ledger?.noteRead(src.source_id, {
      yielded,
      locator: yielded ? null : (input.query ?? input.locator ?? null),
    });
    const servedRead = serveExactText(store, src.source_id, ex.windows, input.query ?? input.locator);
    if (input.locator) ledger?.noteLocatorAttempt(src.source_id, input.locator);
    const quoteYield = ledger?.noteQuoteYield(src.source_id, servedRead.new_quote_count);
    const spanAdvisory = quoteYield?.span_hunting_exhausted
      ? ` מספר קריאות ממוקדות במקור זה לא הפיקו טקסט ציטוט חדש; קריאות נוספות בניסוח אחר יוחזרו ללא חיפוש נוסף. השתמש בקטעים שכבר הוגשו, פנה למקור אחר, או הגש את התזכיר.`
      : "";
    const advisory = !yielded && read?.exhausted
      ? ` שים לב: ${read.no_yield} קריאות ממוקדות רצופות על מקור זה לא הניבו ראיה חדשה. ההמלצה היא לפנות למקור אחר או לנתיב השגה אחר, אך ההחלטה שלך.`
      : "";
    return clampFetchOutput({
      ok: src.fetch_status === "ok",
      already_read: true,
      source_id: src.source_id,
      title: src.title,
      summary: src.summary,
      text_length: src.text_length,
      is_actual_document: src.is_actual_document,
      identity_found: src.identity_fields,
      windows: servedRead.windows,
      exact_source_text: servedRead.exact_source_text,
      new_quote_count: servedRead.new_quote_count,
      served_quote_count: servedRead.served_quote_count,
      span_hunting_exhausted: quoteYield?.span_hunting_exhausted || undefined,
      span_hunting_newly_exhausted: quoteYield?.newly_exhausted || undefined,
      no_new_evidence: yielded && servedRead.new_quote_count > 0 ? undefined : true,
      search_path_exhausted: !yielded && read?.exhausted ? true : undefined,
      same_issue_no_yield: yielded ? undefined : read?.no_yield,
      instruction: yielded
        ? `קריאה ממוקדת בתוך ${src.source_id} (${ex.from}).${
          servedRead.new_quote_count > 0 ? "" : " הטקסט שהוחזר כבר הוגש לך קודם — אין כאן ראיה חדשה."
        }${spanAdvisory}${QUOTE_RULE}`
        : `לא נמצאה התאמה לשאילתה בתוך ${src.source_id}; הוחזרה פתיחת המסמך בלבד (טקסט מילולי).${advisory}${spanAdvisory}${QUOTE_RULE}`,
    });
  }

  const discovery = input.result_id ? discovered.get(input.result_id) ?? null : null;

  // ── Local corpus body (no HTTP) ──────────────────────────────────────────
  // Only reachable through a durable lookup candidate: the model cannot name
  // a local_document_id, and identity comes from the candidate, not the call.
  if (discovery?.local_document_id && !input.url) {
    return await acquireLocalBody(store, discovery, input, ledger, opts?.admin);
  }

  // Deterministic URL hygiene before anything else: backslash path separators
  // and duplicated slashes leak in from PDFs and document text (observed on
  // `https://fs.knesset.gov.il/\7\law\…`) and kill the fetch before it starts.
  const rawUrl = input.url || discovery?.url;
  const url = normalizeMalformedUrl(rawUrl);
  const url_repaired = !!rawUrl && url !== String(rawUrl).trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return { ok: false, error: "no_usable_url" };
  }

  // Outbound safety gate — applies to every URL, whoever supplied it
  // (model, lookup candidate, broad web search). Nothing downstream is
  // relaxed by it: relay allowlists and official profiles still run.
  const safety = checkUrlSafety(url);
  if (!safety.safe) {
    return {
      ok: false,
      error: "unsafe_url_blocked",
      instruction: `כתובת זו נחסמה מטעמי אבטחה (${safety.reason}). בחר מקור ציבורי אחר.`,
    };
  }

  // A discovery / metadata API endpoint is not a document. Crossref, OpenAlex
  // and similar services may point at scholarship; their query responses are
  // never scholarship themselves and must never become an evidence citation.
  if (isDiscoveryEndpointUrl(url)) {
    return {
      ok: false,
      failure_class: "discovery_endpoint_not_a_document",
      error: "discovery_endpoint_not_a_document",
      instruction:
        "כתובת זו היא ממשק חיפוש/מטא-דאטה ואינה גוף מסמך. השתמש בה לאיתור בלבד, והבא את המאמר או המסמך עצמו.",
    };
  }

  // Identity the deterministic layer already knows for this candidate travels
  // with it; the model does not have to restate it. It remains an acquisition
  // TARGET only — the body still has to corroborate it below.
  const resolvedIdentity = resolveExpectedIdentity(discovery, input.expected_identity);
  const expectedIdentity = resolvedIdentity.identity;
  const authorityKey = authorityKeyOf(expectedIdentity ?? {});

  // Per-run fetch dedupe: an already-read URL is served from the evidence
  // store and does not consume fetch budget, unless a refetch reason is given.
  if (!input.refetch_reason?.trim()) {
    const cached = store.findByUrl(url);
    if (cached) return clampFetchOutput(alreadyReadPayload(store, cached, input));
  }

  // ── Same-authority acquisition efficiency ────────────────────────────────
  // Identity verification is unchanged: this only avoids repeating network
  // work for an authority whose body was ALREADY acquired with a matching
  // identity, and avoids re-walking a path that already failed.
  if (ledger && authorityKey && !input.refetch_reason?.trim()) {
    const acquiredId = ledger.get(authorityKey)?.acquired_source_id;
    const acquired = acquiredId ? store.get(acquiredId) : null;
    if (acquired && normalizeUrlKey(acquired.url ?? "") !== normalizeUrlKey(url)) {
      return clampFetchOutput({
        ...alreadyReadPayload(store, acquired, input),
        authority_reuse: true,
        authority_state: ledger.state(authorityKey) ?? undefined,
        instruction:
          `גוף האסמכתה ${authorityKey} כבר הובא ואומת זהותית (${acquired.source_id}). עבוד מתוכו: fetch({source_id:"${acquired.source_id}", query}). אל תחפש עותקים נוספים אלא אם חסר בו רכיב ספציפי — ואז ציין refetch_reason.`,
      });
    }
    // ── Parent-statute reuse (exact_authority_resilience_v1) ───────────────
    // `statute:X#12` and `statute:X` are the same body. When the consolidated
    // statute was already acquired and identity-corroborated in this run, the
    // requested section is located INSIDE it instead of spending another
    // network attempt on a section-specific URL. Verification is unchanged:
    // the parent body already passed corroboration, and a section that is not
    // in the body is reported as missing, never assumed.
    const hashAt = authorityKey.indexOf("#");
    const parentKey = hashAt > 0 ? authorityKey.slice(0, hashAt) : null;
    const parentId = parentKey ? ledger.get(parentKey)?.acquired_source_id : undefined;
    const parentBody = parentId ? store.get(parentId) : null;
    if (parentBody && parentBody.is_actual_document) {
      const token = normalizeSectionToken(
        expectedIdentity?.section ?? authorityKey.slice(hashAt + 1),
      );
      const located = token
        ? locateSection(parentBody.extracted_text, token, {
          window: FETCH_LIMITS.WINDOW_CHARS + 600,
          truncated: parentBody.text_length >= FETCH_LIMITS.MAX_TEXT_CHARS,
        })
        : null;
      if (located?.found) {
        const servedParent = serveExactText(
          store,
          parentBody.source_id,
          located.windows,
          `סעיף ${token}`,
        );
        return clampFetchOutput({
          ok: true,
          authority_reuse: true,
          already_read: true,
          source_id: parentBody.source_id,
          title: parentBody.title,
          text_length: parentBody.text_length,
          is_actual_document: true,
          identity_found: parentBody.identity_fields,
          section_requested: token ?? undefined,
          section_found: true,
          section_coverage: located.coverage,
          windows: servedParent.windows,
          exact_source_text: servedParent.exact_source_text,
          new_quote_count: servedParent.new_quote_count,
          served_quote_count: servedParent.served_quote_count,
          authority_state: ledger.state(authorityKey) ?? undefined,
          instruction:
            `נוסח החוק המלא (${parentBody.source_id}) כבר הובא ואומת בריצה זו, וסעיף ${token} אותר בתוכו. אין צורך בהבאה נוספת.${QUOTE_RULE}`,
        });
      }
    }

    const prior = ledger.attemptOn(authorityKey, url);
    if (prior && prior.outcome !== "acquired" && prior.outcome !== "readable_unconfirmed_identity") {
      return clampFetchOutput({
        ok: false,
        dead_path: true,
        error: `dead_acquisition_path:${prior.reason}`.slice(0, 160),
        authority_state: ledger.state(authorityKey) ?? undefined,
        instruction:
          "כתובת זו כבר נוסתה בריצה זו ונכשלה. אל תחזור עליה. נסה מקור שונה מהותית או המשך עם מה שכבר נקרא.",
      });
    }
  }

  const title = discovery?.title || url;
  const origin = discovery?.origin ?? "direct_url";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_LIMITS.TIMEOUT_MS);
  let entry: EvidenceSource;
  let decodeMeta: DecodeTelemetry | undefined;
  let repositoryPdfFollowed = false;
  let failureClass: FetchFailureClass | undefined;
  const noteFailure = (reason: string) => {
    if (ledger && authorityKey) {
      ledger.note(authorityKey, { url, outcome: "failed", reason, at: new Date().toISOString() });
    }
  };
  try {
    const res = await officialFetch(url, { signal: controller.signal });
    // A redirect must not land anywhere the original URL could not go.
    const finalUrl = typeof res.url === "string" && res.url ? res.url : url;
    if (finalUrl !== url && !checkUrlSafety(finalUrl).safe) {
      noteFailure("unsafe_redirect_blocked");
      return clampFetchOutput({ ok: false, error: "unsafe_url_blocked" });
    }
    if (!res.ok) {
      const cls = classifyHttpStatus(res.status);
      entry = await store.append({
        url,
        title,
        origin,
        fetch_status: "error",
        fetch_error: `${cls}:http_${res.status}`,
        extracted_text: "",
        is_actual_document: false,
        not_document_reason: `${cls}:http_${res.status}`,
      });
      noteFailure(`${cls}:http_${res.status}`);
      return clampFetchOutput({
        ok: false,
        source_id: entry.source_id,
        failure_class: cls,
        alternative_copy_worth_trying: isRecoverableFailure(cls),
        error: `http_${res.status}`,
        instruction: isRecoverableFailure(cls)
          ? "השרת סירב לבקשה או שהמסמך אינו זמין בכתובת זו. חפש עותק ציבורי אחר של אותו מקור (מאגר מוסדי, אתר כתב העת, דף הסגל של המחבר, DOI) — לא מקור אחר."
          : undefined,
        acquisition_note: authorityKey ? ledger?.advice(authorityKey) : undefined,
      });
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > FETCH_LIMITS.MAX_BYTES) {
      entry = await store.append({
        url,
        title,
        origin,
        fetch_status: "error",
        fetch_error: "document_too_large",
        extracted_text: "",
        is_actual_document: false,
        not_document_reason: "document_too_large",
      });
      noteFailure("document_too_large");
      return clampFetchOutput({ ok: false, source_id: entry.source_id, error: "document_too_large" });
    }
    const contentType = res.headers.get("content-type") ?? "";
    let extracted = await extractByContentType(url, contentType, buf);
    let bodyContentType = contentType;

    // ── Repository landing page → the article itself ────────────────────
    // Digital Commons / bepress / university repositories publish the article
    // PDF in `citation_pdf_url` alongside full citation metadata. Following it
    // once turns an abstract page into a readable body, and merges landing
    // metadata with PDF body under ONE evidence identity.
    let repository_pdf_followed = false;
    if (extracted.pdf_link && extracted.pdf_link !== url) {
      const pdfUrl = normalizeMalformedUrl(extracted.pdf_link);
      if (checkUrlSafety(pdfUrl).safe) {
        try {
          const pdfRes = await officialFetch(pdfUrl, { signal: controller.signal });
          if (pdfRes.ok) {
            const pdfBuf = new Uint8Array(await pdfRes.arrayBuffer());
            if (pdfBuf.length <= FETCH_LIMITS.MAX_BYTES) {
              const pdfCt = pdfRes.headers.get("content-type") ?? "application/pdf";
              const body = await extractByContentType(pdfUrl, pdfCt, pdfBuf);
              if (!body.error && body.text.trim().length > extracted.text.trim().length) {
                repository_pdf_followed = true;
                bodyContentType = pdfCt;
                extracted = {
                  ...body,
                  // Landing-page metadata is the stronger basis and wins.
                  bibliographic: mergeBibliographic(extracted.bibliographic, body.bibliographic),
                };
              }
            }
          }
        } catch { /* the landing page body remains usable */ }
      }
    }

    const { text, error, decode, pdf } = extracted;
    decodeMeta = decode;
    const clipped = text.slice(0, FETCH_LIMITS.MAX_TEXT_CHARS);
    const docCheck = checkIsActualDocument(clipped);
    // Metadata fail-safe: weak embedded PDF fields can never outrank
    // repository / publisher / search metadata, and a value that contradicts
    // the source kind is dropped rather than rendered.
    const mergedMeta = mergeBibliographic(
      extracted.bibliographic,
      bibliographicFromSearch(discovery ?? undefined),
    );
    entry = await store.append({
      url,
      title,
      origin,
      fetch_status: error ? "error" : "ok",
      fetch_error: error,
      extracted_text: clipped,
      is_actual_document: !error && docCheck.is_actual_document,
      not_document_reason: error ?? docCheck.reason,
      content_type: bodyContentType,
      pdf_extraction: pdf,
      acquisition_status: error ? "unsupported_response" : "acquired",
      bibliographic: sanitizeBibliographic(mergedMeta, { url, title }),
    });
    repositoryPdfFollowed = repository_pdf_followed;
    if (error) {
      const cls = classifyUnusableBody({
        text: clipped,
        reason: error,
        content_type: bodyContentType,
        is_pdf: /pdf/i.test(bodyContentType),
      });
      noteFailure(`${cls}:${error}`);
      return clampFetchOutput({
        ok: false,
        source_id: entry.source_id,
        failure_class: cls,
        alternative_copy_worth_trying: isRecoverableFailure(cls),
        error,
        acquisition_note: authorityKey ? ledger?.advice(authorityKey) : undefined,
      });
    }
    if (!docCheck.is_actual_document) {
      failureClass = classifyUnusableBody({
        text: clipped,
        reason: docCheck.reason,
        content_type: bodyContentType,
        is_pdf: /pdf/i.test(bodyContentType),
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    entry = await store.append({
      url,
      title,
      origin,
      fetch_status: "error",
      fetch_error: msg.slice(0, 200),
      extracted_text: "",
      is_actual_document: false,
      not_document_reason: "fetch_exception",
    });
    const cls = classifyFetchException(msg);
    noteFailure(`${cls}:${msg.slice(0, 100)}`);
    return clampFetchOutput({
      ok: false,
      source_id: entry.source_id,
      failure_class: cls,
      alternative_copy_worth_trying: isRecoverableFailure(cls),
      error: msg.slice(0, 200),
      acquisition_note: authorityKey ? ledger?.advice(authorityKey) : undefined,
    });
  } finally {
    clearTimeout(timer);
  }

  return {
    ...finalizeAcquiredBody({
      store,
      ledger,
      entry,
      attemptKey: url,
      expectedIdentity,
      authorityKey,
      resolvedIdentity,
      discovery,
      input,
      transport: "http",
      decode: decodeMeta,
    }),
    url_repaired: url_repaired || undefined,
    repository_pdf_followed: repositoryPdfFollowed || undefined,
    bibliographic_basis: entry.bibliographic?.metadata_basis,
    failure_class: failureClass,
    alternative_copy_worth_trying: failureClass ? isRecoverableFailure(failureClass) : undefined,
  };
}

/**
 * Identity corroboration, authority binding and the bounded agent-facing
 * response. Shared verbatim by every transport: a locally stored body is
 * held to exactly the same standard as one fetched over HTTP.
 */
function finalizeAcquiredBody(args: {
  store: EvidenceStore;
  ledger?: AcquisitionLedger;
  entry: EvidenceSource;
  /** Ledger attempt key (an URL for HTTP, `local:…` for the corpus). */
  attemptKey: string;
  expectedIdentity?: { docket?: string; statute?: string; section?: string };
  authorityKey: string | null;
  resolvedIdentity: ReturnType<typeof resolveExpectedIdentity>;
  discovery: SearchResult | null;
  input: FetchInput;
  transport: "http" | "local_corpus";
  decode?: DecodeTelemetry;
  /** Exact docket of the stored corpus row, when this body came from one. */
  structuredDocket?: string | null;
}): FetchOutput {
  const { store, ledger, entry, attemptKey, expectedIdentity, authorityKey, resolvedIdentity } = args;
  const { discovery, input, transport, decode } = args;

  const expectedDocket = expectedIdentity?.docket?.trim();
  let identity_hint: string | undefined;

  // Positive corroboration: the acquired BODY must present itself as the
  // requested authority before it may occupy that authority key. A requested
  // label, a merely readable body, or a local database row is never proof.
  const corroboration = corroborateAuthority({
    expected: expectedIdentity,
    title: entry.title,
    text: entry.extracted_text,
    identity_fields: entry.identity_fields,
    is_actual_document: entry.is_actual_document,
    structured_docket: args.structuredDocket,
  });

  if (expectedDocket) {
    identity_hint = corroboration.corroborated
      ? `התיק ${expectedDocket} מופיע בגוף המסמך שהובא.`
      : `אזהרה: התיק ${expectedDocket} לא נמצא בגוף המסמך שהובא — ככל הנראה זה אינו המסמך המבוקש.`;
  } else if (expectedIdentity?.statute?.trim() && !corroboration.corroborated && entry.is_actual_document) {
    identity_hint =
      `אזהרה: גוף המסמך שהובא אינו מזדהה כ"${expectedIdentity.statute.trim()}" (${corroboration.basis}). ניתן להשתמש בו ככל שהוא רלוונטי, אך הוא אינו נחשב לגוף האסמכתה המבוקשת — אפשר וכדאי להביא מועמד אחר עבורה.`;
  }

  let authority_binding_created = false;
  let authority_binding_withheld = false;
  if (ledger && authorityKey) {
    const bind = corroboration.corroborated;
    const outcome: "acquired" | "failed" | "not_the_document" | "readable_unconfirmed_identity" = bind
      ? "acquired"
      : !entry.is_actual_document
      ? "failed"
      : corroboration.basis === "docket_absent_from_body"
      ? "not_the_document"
      : "readable_unconfirmed_identity";
    authority_binding_created = bind;
    authority_binding_withheld = !bind && entry.is_actual_document;
    ledger.note(
      authorityKey,
      {
        url: attemptKey,
        outcome,
        reason: bind
          ? `body_identity_corroborated:${corroboration.basis}`
          : (entry.not_document_reason ?? corroboration.basis),
        at: new Date().toISOString(),
        identity_corroborated: bind,
      },
      bind ? entry.source_id : undefined,
    );
  }

  const freshWindows = entry.is_actual_document
    ? (input.find?.length
      ? readingWindows(entry.extracted_text, input.find)
      : [entry.extracted_text.slice(0, FETCH_LIMITS.HEAD_CHARS)])
    : undefined;
  const freshServed = serveExactText(store, entry.source_id, freshWindows, input.query ?? input.find?.[0]);

  return clampFetchOutput({
    ok: true,
    source_id: entry.source_id,
    title: entry.title,
    summary: entry.summary,
    text_length: entry.text_length,
    is_actual_document: entry.is_actual_document,
    not_document_reason: entry.not_document_reason,
    identity_found: entry.identity_fields,
    identity_hint,
    authority_identity_corroborated: authorityKey ? corroboration.corroborated : undefined,
    authority_binding_created: authorityKey ? authority_binding_created : undefined,
    authority_binding_withheld: authorityKey ? authority_binding_withheld : undefined,
    authority_binding_basis: authorityKey ? corroboration.basis : undefined,
    expected_authority_key: authorityKey ?? undefined,
    expected_identity_source: resolvedIdentity.source,
    expected_identity_conflict: resolvedIdentity.conflict,
    candidate_kind: discovery?.candidate_kind,
    acquisition_transport: transport,
    local_match_basis: transport === "local_corpus" ? discovery?.local_match_basis : undefined,
    text_head: freshServed.windows?.length
      ? undefined
      : entry.extracted_text.slice(0, FETCH_LIMITS.HEAD_CHARS),
    windows: freshServed.windows,
    exact_source_text: freshServed.exact_source_text,
    decode,
    instruction: entry.not_document_reason === "unreadable_encoding"
      ? "הטקסט שהתקבל אינו קריא (קידוד תווים פגום), ולכן אינו נחשב מסמך ואינו יכול לשמש כראיה או לאשש זהות אסמכתה. נדרש נתיב השגה אחר (קובץ/מקור אחר) עבור אסמכתה זו."
      : transport === "local_corpus"
      ? `הגוף המלא (מהמאגר המקומי) שמור בצד השרת. לקריאת קטע נוסף מתוכו: fetch({source_id, query}).${
        freshServed.windows?.length ? QUOTE_RULE : ""
      }`
      : `הגוף המלא שמור בצד השרת. לקריאת קטע נוסף מתוכו: fetch({source_id, query}) — אל תביא את אותו URL שוב.${
        freshServed.windows?.length ? QUOTE_RULE : ""
      }`,
    acquisition_note: authorityKey ? ledger?.advice(authorityKey) : undefined,
  });
}

/**
 * Acquire a body the corpus already stores, with no network call at all.
 *
 * The candidate — and therefore the identity this acquisition is aimed at —
 * comes from the durable lookup result, never from the model. Locality buys
 * nothing: the body passes the same document check and the same authority
 * corroboration, and a title-matched row that turns out to be a different
 * case is rejected exactly like a wrong page from the web.
 */
async function acquireLocalBody(
  store: EvidenceStore,
  discovery: SearchResult,
  input: FetchInput,
  ledger?: AcquisitionLedger,
  admin?: SupabaseClient | null,
): Promise<FetchOutput> {
  const documentId = discovery.local_document_id!;
  const attemptKey = localAttemptKey(documentId);

  // Identity is the candidate's own; the model may refine, never retarget.
  const resolvedIdentity = resolveExpectedIdentity(discovery, input.expected_identity);
  const expectedIdentity = resolvedIdentity.identity;
  const authorityKey = authorityKeyOf(expectedIdentity ?? {});

  if (ledger && authorityKey && !input.refetch_reason?.trim()) {
    const prior = ledger.attemptOn(authorityKey, attemptKey);
    if (prior && prior.outcome !== "acquired" && prior.outcome !== "readable_unconfirmed_identity") {
      return clampFetchOutput({
        ok: false,
        dead_path: true,
        acquisition_transport: "local_corpus",
        error: `dead_acquisition_path:${prior.reason}`.slice(0, 160),
        authority_state: ledger.state(authorityKey) ?? undefined,
        instruction: "רשומה מקומית זו כבר נוסתה בריצה זו ולא הניבה גוף שמיש. נסה מועמד אחר.",
      });
    }
  }

  const noteFailure = (reason: string) => {
    if (ledger && authorityKey) {
      ledger.note(authorityKey, {
        url: attemptKey,
        outcome: "failed",
        reason,
        at: new Date().toISOString(),
      });
    }
  };

  const row = await loadLocalDocument(admin, documentId);
  if (!row) {
    noteFailure("local_document_unavailable");
    return clampFetchOutput({
      ok: false,
      acquisition_transport: "local_corpus",
      error: "local_document_unavailable",
      authority_state: authorityKey ? ledger?.state(authorityKey) ?? undefined : undefined,
      instruction: "הגוף השמור לא נטען. בחר מועמד אחר או נתיב השגה אחר.",
    });
  }

  // A body already read in this run (via its public URL) is served from the
  // store instead of being stored twice.
  const realUrl = typeof row.source_url === "string" && /^https?:\/\//i.test(row.source_url)
    ? row.source_url
    : undefined;
  const cached = realUrl && !input.refetch_reason?.trim() ? store.findByUrl(realUrl) : null;
  if (cached && cached.fetch_status === "ok" && cached.is_actual_document) {
    return clampFetchOutput(alreadyReadPayload(store, cached, input));
  }

  const text = (row.content ?? "").slice(0, FETCH_LIMITS.MAX_TEXT_CHARS);
  const docCheck = checkIsActualDocument(text);
  if (!text.trim() || !docCheck.is_actual_document) {
    const reason = !text.trim() ? "local_body_empty" : `local_body_${docCheck.reason}`;
    noteFailure(reason);
    return clampFetchOutput({
      ok: false,
      acquisition_transport: "local_corpus",
      local_match_basis: discovery.local_match_basis,
      error: reason,
      authority_state: authorityKey ? ledger?.state(authorityKey) ?? undefined : undefined,
      instruction:
        "הרשומה המקומית אינה מכילה גוף מסמך שמיש. ההחלטה מה לעשות הלאה שלך — אין ניסיון אוטומטי במועמד אחר.",
    });
  }

  const entry = await store.append({
    // Keep the public URL only when it is not already occupied by a failed
    // attempt, so a stored body never inherits a dead URL's evidence entry.
    url: cached ? undefined : realUrl,
    title: row.title || discovery.title,
    origin: "local_corpus",
    fetch_status: "ok",
    extracted_text: text,
    is_actual_document: true,
  });

  return finalizeAcquiredBody({
    store,
    ledger,
    entry,
    attemptKey,
    expectedIdentity,
    authorityKey,
    resolvedIdentity,
    discovery,
    input,
    transport: "local_corpus",
    structuredDocket: row.case_number,
  });
}

/**
 * Bounded later-page continuation of an already-acquired academic PDF
 * (academic_evidence_yield_v1).
 *
 * The first bounded pass may stop before the analytical core of a long
 * article. Rather than re-reading the whole document (or lifting the global
 * page ceiling), this re-fetches the same URL once and extracts the NEXT
 * bounded page window, appending it to the existing body. Append-only, so no
 * previously verified span can move; returns null when continuation does not
 * apply, letting the normal re-read path run.
 */
async function continuePdfRead(
  store: EvidenceStore,
  src: EvidenceSource,
  input: FetchInput,
): Promise<FetchOutput | null> {
  const meta = src.pdf_extraction;
  const url = src.url;
  if (!url || !meta?.total_pages) return null;
  const readThrough = meta.continued_through_page ?? meta.last_page ?? 0;
  if (readThrough <= 0 || readThrough >= meta.total_pages) {
    return {
      ok: false,
      source_id: src.source_id,
      error: "pdf_fully_read",
      instruction: `כל העמודים הזמינים של ${src.source_id} כבר נקראו. השתמש בטקסט שברשותך או פנה למקור אחר.`,
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_LIMITS.TIMEOUT_MS);
  try {
    const res = await officialFetch(url, { signal: controller.signal });
    if (!res.ok) return { ok: false, source_id: src.source_id, error: `http_${res.status}` };
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > FETCH_LIMITS.MAX_BYTES) {
      return { ok: false, source_id: src.source_id, error: "document_too_large" };
    }
    const cont = await extractPdfPagesBounded(buf, {
      startPage: readThrough + 1,
      maxPages: FETCH_LIMITS.PDF_CONTINUATION_PAGES,
      maxChars: FETCH_LIMITS.PDF_CONTINUATION_CHARS,
      deadlineMs: FETCH_LIMITS.PDF_DEADLINE_MS,
      enoughChars: FETCH_LIMITS.PDF_CONTINUATION_CHARS,
    });
    if (!cont.text.trim()) {
      return { ok: false, source_id: src.source_id, error: "pdf_continuation_empty" };
    }
    const lastRead = cont.last_page_extracted ?? (readThrough + cont.pages_attempted);
    const added = await store.extendBody(src.source_id, cont.text, {
      total_pages: cont.total_pages,
      last_page: lastRead,
      continued_through_page: lastRead,
      stop_reason: cont.stopped_reason,
    });
    const excerpt = store.excerpt(src.source_id, {
      query: input.query,
      locator: input.locator,
      find: input.find,
      maxChars: FETCH_LIMITS.WINDOW_CHARS,
    });
    const quotes = excerpt
      ? store.serveQuotesWithNovelty(src.source_id, excerpt.windows, input.query)
      : { quotes: [], new_count: 0 };
    return {
      ok: true,
      source_id: src.source_id,
      pdf_continued: true,
      pdf_pages_added: `${readThrough + 1}-${lastRead}`,
      pdf_chars_added: added?.added ?? 0,
      exact_source_text: quotes.quotes.map((q) => ({ quote_id: q.quote_id, text: q.text })),
      new_quote_count: quotes.new_count,
    };
  } catch (e) {
    return {
      ok: false,
      source_id: src.source_id,
      error: `pdf_continuation_failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
