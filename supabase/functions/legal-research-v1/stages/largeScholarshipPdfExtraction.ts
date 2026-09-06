/**
 * large_scholarship_pdf_extraction_v1
 *
 * `literature_body_completeness_v1` proved safe and bounded but produced no
 * richness gain: every re-extraction attempt on the strong Israeli scholarship
 * PDFs (נדב דגן, מיכל טמיר) died at
 * `secondary_binary_too_large_for_inline_extraction`. The articles were found,
 * classified as scholarship and fetched — and then discarded unread because the
 * inline extractor refuses binaries above 900 KB.
 *
 * This stage reads exactly those PDFs, and nothing else, through bounded
 * page-by-page extraction (`lib/largePdfChunkedExtract.ts`).
 *
 * Hard scope guarantees:
 *   - No discovery, no search, no new candidates, no model call.
 *   - Only sources already found in THIS run, already scholarship-shaped, and
 *     already blocked by an inline extraction size cap.
 *   - Paywalled / access-controlled / court / primary-law / news sources are
 *     refused outright. No paywall bypass, no court-host acquisition.
 *   - A new body is accepted only when article identity is confirmed and the
 *     body quality is usable; otherwise the candidate is left untouched.
 *   - Every downstream gate (role labelling, topicality, verifier, pack, CSM)
 *     runs unweakened afterwards.
 */

import {
  COURT_HOST_RE,
  isAccessControlledUrl,
  PAYWALLED_HOST_RE,
} from "./secondaryWebAcquisition.ts";
import { formsIntersect, termForms } from "./hebrewTopicTerms.ts";
import type { ChunkedPdfResult } from "../lib/largePdfChunkedExtract.ts";

export const LARGE_SCHOLARSHIP_PDF_VERSION = "large_scholarship_pdf_extraction_v1";

export const LARGE_PDF_LIMITS = {
  /** Large scholarship PDFs read per run. */
  MAX_PDFS_PER_RUN: 2,
  /** Pages read on the first pass. */
  FIRST_PASS_PAGES: 20,
  /** Extra pages allowed only when the first pass was too thin. */
  EXTENDED_PASS_PAGES: 40,
  /** Stored body ceiling. */
  MAX_BODY_CHARS: 25_000,
  /** Enough text to classify, verify and cite. */
  MIN_USEFUL_CHARS: 4_000,
  /** Target at which the first pass may stop early. */
  ENOUGH_CHARS: 8_000,
  /** Hard wall-clock cap per PDF (download + extraction). */
  PER_PDF_MS: 20_000,
  /** Hard total added latency for the stage. */
  TOTAL_MS: 40_000,
  /** Download ceiling: beyond this we do not even stream the binary. */
  MAX_DOWNLOAD_BYTES: 12 * 1024 * 1024,
  /** Only bodies at least this weak are worth replacing. */
  REPLACE_IF_OLD_BELOW: 25_000,
} as const;

/** Failure reasons this stage exists to cure. */
export const INLINE_SIZE_CAP_REASONS = [
  "secondary_binary_too_large_for_inline_extraction",
  "binary_too_large_for_inline_extraction",
  "secondary_body_too_large",
  "statute_binary_too_large_for_inline_extraction",
  "secondary_extraction_budget_spent",
  "pdf_extraction_skipped_too_large",
  "pdf_extraction_skipped_too_large_exact_case",
];

export function isInlineSizeCapFailure(reason?: string | null): boolean {
  const r = String(reason ?? "");
  if (!r) return false;
  return INLINE_SIZE_CAP_REASONS.some((x) => r.includes(x));
}

const SCHOLARSHIP_TYPES = new Set([
  "legal_article",
  "journal_article",
  "article",
  "book",
  "book_chapter",
  "book_or_chapter",
  "chapter",
  "scholarship",
  "academic",
  "commentary",
  "doctrinal_commentary",
  "report",
  "institutional_report",
  "government_report",
]);

const PRIMARY_TYPES = new Set([
  "case",
  "caselaw",
  "judgment",
  "israeli_law",
  "statute",
  "regulation",
  "legislation",
  "legislation_primary",
  "legislation_secondary",
]);

const NEWS_TYPES = new Set(["news", "press", "media", "blog_post"]);

const SCHOLARSHIP_ROLE_RE = /(scholarship|journal|article|book|academic|institutional|commentary)/i;

const JOURNAL_RE =
  /(משפטים\s+על\s+אתר|פורום\s+עיוני\s+משפט|עיוני\s+משפט|מחקרי\s+משפט|הפרקליט|משפט\s+וממשל|מאזני\s+משפט|דין\s+ודברים|מעשי\s+משפט|משפט\s+ועסקים|עלי\s+משפט|כתב[\s-]?עת|כרך|הפקולטה\s+למשפטים|אוניברסיט|המכללה\s+למינהל|המכון\s+הישראלי\s+לדמוקרטיה|law\s+review|law\s+journal|faculty\s+of\s+law|working\s+paper)/i;
const AUTHOR_RE = /(מאת|פרופ['׳]|ד["״]ר|עו["״]ד|\bby\s+[A-Z][a-z]+\s+[A-Z])/;
const ARGUMENT_RE =
  /(לטענת|לדעת|לעומת\s+זאת|מנגד|יש\s+לטעון|בניגוד\s+ל|לפיכך|מכאן\s+ש|ניתן\s+לסכם|אבקש\s+לטעון|טענתי|לשיטת)/g;
const ABSTRACT_RE = /(תקציר|abstract)/i;
const BIBLIO_RE = /(ביבליוגרפיה|רשימת\s+מקורות|תוכן\s+העניינים|references|bibliography|table\s+of\s+contents)/i;
const FOOTNOTE_RE = /(ראו\s|לעיל\s+ה"ש|שם,\s|ה"ש\s|ibid|supra)/g;
const MOJIBAKE_RE = /(\uFFFD|%PDF|\bobj\s*<<|endstream|stream\s*\r?\n\s*x\u009C)/;

export function hostOf(url?: string | null): string {
  try {
    return new URL(String(url ?? "")).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function looksLikePdfTarget(url: string, contentType?: string | null): boolean {
  return /pdf/i.test(String(contentType ?? "")) || /\.pdf(\?|#|$)/i.test(url) ||
    /(\/pdf\/|format=pdf|type=pdf|download.*pdf)/i.test(url);
}

// ── 1. Eligibility ─────────────────────────────────────────────────────────

export interface LargePdfCandidateView {
  run_id?: string | null;
  source_id: string;
  title: string;
  author?: string | null;
  url?: string | null;
  host?: string | null;
  source_type?: string | null;
  role?: string | null;
  content_type?: string | null;
  topicality_before?: "direct" | "adjacent" | "off_topic" | null;
  previous_failure_reason?: string | null;
  binary_size_bytes?: number | null;
  body_chars?: number;
  strong_scholarship?: boolean;
  hard_integrity_failure?: boolean;
}

export interface LargePdfEligibilityRow {
  run_id: string | null;
  source_id: string;
  title: string;
  author: string | null;
  url: string | null;
  host: string;
  source_type_before: string | null;
  topicality_before: string | null;
  previous_failure_reason: string | null;
  binary_size_bytes: number;
  eligible: boolean;
  ineligible_reason: string | null;
}

/**
 * Deterministic eligibility. Every clause is a refusal the track requires:
 * only already-found, already-scholarship, already-size-capped, freely
 * accessible, on-topic, integrity-clean article PDFs get here.
 */
export function assessLargePdfEligibility(
  v: LargePdfCandidateView,
): LargePdfEligibilityRow {
  const url = String(v.url ?? "");
  const type = String(v.source_type ?? "").toLowerCase();
  const role = String(v.role ?? "");
  const row: LargePdfEligibilityRow = {
    run_id: v.run_id ?? null,
    source_id: v.source_id,
    title: String(v.title ?? ""),
    author: v.author ?? null,
    url: v.url ?? null,
    host: v.host ?? hostOf(url),
    source_type_before: v.source_type ?? null,
    topicality_before: v.topicality_before ?? null,
    previous_failure_reason: v.previous_failure_reason ?? null,
    binary_size_bytes: Math.max(0, Number(v.binary_size_bytes ?? 0) | 0),
    eligible: false,
    ineligible_reason: null,
  };

  const refuse = (reason: string) => {
    row.ineligible_reason = reason;
    return row;
  };

  if (!url || !/^https?:\/\//i.test(url)) return refuse("no_fetchable_url");
  if (isAccessControlledUrl(url) || PAYWALLED_HOST_RE.test(url)) {
    return refuse("access_controlled_or_paywalled");
  }
  if (COURT_HOST_RE.test(url)) return refuse("court_host_out_of_scope");
  if (PRIMARY_TYPES.has(type)) return refuse("primary_law_not_extracted");
  if (NEWS_TYPES.has(type)) return refuse("news_or_blog_not_extracted");
  if (v.hard_integrity_failure) return refuse("hard_integrity_failure");
  if (v.topicality_before === "off_topic") return refuse("off_topic_before_extraction");

  const scholarshipShaped = SCHOLARSHIP_TYPES.has(type) || SCHOLARSHIP_ROLE_RE.test(role) ||
    v.strong_scholarship === true;
  if (!scholarshipShaped) return refuse("not_scholarship_shaped");

  if (!looksLikePdfTarget(url, v.content_type)) return refuse("not_a_pdf_target");

  const hasTitle = row.title.trim().length >= 8;
  const hasAuthorOrJournal = Boolean(v.author && String(v.author).trim().length >= 3) ||
    JOURNAL_RE.test(`${row.title}\n${row.host}`) || AUTHOR_RE.test(row.title);
  if (!hasTitle || !hasAuthorOrJournal) return refuse("no_article_identity_signal");

  if (!isInlineSizeCapFailure(v.previous_failure_reason)) {
    return refuse("not_blocked_by_inline_size_cap");
  }
  if ((v.body_chars ?? 0) >= LARGE_PDF_LIMITS.REPLACE_IF_OLD_BELOW) {
    return refuse("body_already_sufficient");
  }

  row.eligible = true;
  return row;
}

/** Rank eligible candidates and apply the per-run cap. */
export function selectLargePdfCandidates(
  rows: LargePdfEligibilityRow[],
  views: Map<string, LargePdfCandidateView>,
  max = LARGE_PDF_LIMITS.MAX_PDFS_PER_RUN,
): LargePdfEligibilityRow[] {
  const eligible = rows.filter((r) => r.eligible);
  const score = (r: LargePdfEligibilityRow) => {
    const v = views.get(r.source_id);
    let s = 0;
    if (v?.strong_scholarship) s += 40;
    if (v?.topicality_before === "direct") s += 25;
    if (v?.topicality_before === "adjacent") s += 10;
    if (JOURNAL_RE.test(`${r.title}\n${r.host}`)) s += 15;
    s += Math.max(0, 10 - Math.floor((v?.body_chars ?? 0) / 1_000));
    return s;
  };
  const ranked = [...eligible].sort((a, b) => score(b) - score(a));
  for (const r of ranked.slice(max)) {
    r.eligible = false;
    r.ineligible_reason = "over_per_run_large_pdf_cap";
  }
  return ranked.slice(0, max);
}

// ── 3. Article identity confirmation ───────────────────────────────────────

export interface LargePdfIdentityRow {
  run_id: string | null;
  source_id: string;
  expected_title: string;
  expected_author: string | null;
  title_match: boolean;
  author_match: boolean;
  journal_or_institution_match: boolean;
  legal_argumentation_signals: number;
  mojibake_or_binary_noise: boolean;
  identity_confirmed: boolean;
  rejection_reason: string | null;
}

function titleOverlap(title: string, head: string): number {
  const terms = String(title ?? "")
    .split(/[\s,:;.()"'׳״\-–—]+/)
    .filter((w) => w.length >= 4)
    .slice(0, 14);
  if (terms.length === 0) return 0;
  const bodyForms = new Set(
    head.split(/[\s,:;.()"'׳״\-–—\n]+/).filter((w) => w.length >= 4).flatMap((w) => termForms(w)),
  );
  const hits = terms.filter((t) => formsIntersect(termForms(t), bodyForms)).length;
  return hits / terms.length;
}

function authorPresent(author: string | null | undefined, head: string): boolean {
  const a = String(author ?? "").trim();
  if (a.length < 3) return false;
  const parts = a.split(/\s+/).filter((p) => p.length >= 2);
  if (parts.length === 0) return false;
  const hits = parts.filter((p) => head.includes(p)).length;
  return hits >= Math.min(2, parts.length);
}

/** Deterministic: does the extracted text belong to the expected article? */
export function confirmLargePdfIdentity(input: {
  run_id?: string | null;
  source_id: string;
  expected_title: string;
  expected_author?: string | null;
  text: string;
}): LargePdfIdentityRow {
  const text = String(input.text ?? "");
  const head = text.slice(0, 12_000);
  const noise = MOJIBAKE_RE.test(head) ||
    (head.match(/\uFFFD/g) ?? []).length > head.length / 200;
  const overlap = titleOverlap(input.expected_title, head);
  const titleMatch = overlap >= 0.4;
  const authorMatch = authorPresent(input.expected_author, head);
  const journalMatch = JOURNAL_RE.test(head);
  const argumentation = (text.match(ARGUMENT_RE) ?? []).length;

  let rejection: string | null = null;
  if (noise) rejection = "mojibake_or_binary_noise";
  else if (!titleMatch && !(authorMatch && journalMatch)) rejection = "title_and_author_not_found";
  else if (argumentation < 2 && text.length < LARGE_PDF_LIMITS.MIN_USEFUL_CHARS) {
    rejection = "no_legal_argumentation_signals";
  }

  return {
    run_id: input.run_id ?? null,
    source_id: input.source_id,
    expected_title: String(input.expected_title ?? ""),
    expected_author: input.expected_author ?? null,
    title_match: titleMatch,
    author_match: authorMatch,
    journal_or_institution_match: journalMatch,
    legal_argumentation_signals: argumentation,
    mojibake_or_binary_noise: noise,
    identity_confirmed: rejection === null,
    rejection_reason: rejection,
  };
}

// ── 4. Body quality ────────────────────────────────────────────────────────

export type LargePdfBodyQuality =
  | "complete_enough_for_use"
  | "partial_but_usable"
  | "abstract_only"
  | "metadata_only"
  | "extraction_failed"
  | "wrong_document"
  | "too_noisy";

export interface LargePdfBodyQualityRow {
  run_id: string | null;
  source_id: string;
  title: string;
  chars_extracted: number;
  paragraph_count: number;
  topic_terms_found: number;
  argumentation_markers_found: number;
  footnote_density: number;
  bibliography_only_signal: boolean;
  abstract_only_signal: boolean;
  body_quality: LargePdfBodyQuality;
  usable: boolean;
}

/** Deterministic quality classification of the chunk-extracted body. */
export function classifyLargePdfBody(input: {
  run_id?: string | null;
  source_id: string;
  title: string;
  text: string;
  topicTerms?: string[];
  identity_confirmed?: boolean;
}): LargePdfBodyQualityRow {
  const text = String(input.text ?? "");
  const paragraphs = text.split(/\n{1,}/).map((p) => p.trim()).filter((p) => p.length >= 120);
  const argumentation = (text.match(ARGUMENT_RE) ?? []).length;
  const footnotes = (text.match(FOOTNOTE_RE) ?? []).length;
  const density = text.length ? Number((footnotes / (text.length / 1_000)).toFixed(2)) : 0;
  const bodyForms = new Set(
    text.slice(0, 24_000).split(/[\s,:;.()"'׳״\-–—\n]+/).filter((w) => w.length >= 3)
      .flatMap((w) => termForms(w)),
  );
  const topicHits = (input.topicTerms ?? []).filter((t) =>
    formsIntersect(termForms(t), bodyForms)
  ).length;
  const bibliographyOnly = BIBLIO_RE.test(text.slice(0, 1_500)) && paragraphs.length <= 2;
  const abstractOnly = ABSTRACT_RE.test(text.slice(0, 800)) && text.length < 2_500 &&
    paragraphs.length <= 2;
  const noisy = MOJIBAKE_RE.test(text.slice(0, 6_000));

  const row: LargePdfBodyQualityRow = {
    run_id: input.run_id ?? null,
    source_id: input.source_id,
    title: String(input.title ?? ""),
    chars_extracted: text.length,
    paragraph_count: paragraphs.length,
    topic_terms_found: topicHits,
    argumentation_markers_found: argumentation,
    footnote_density: density,
    bibliography_only_signal: bibliographyOnly,
    abstract_only_signal: abstractOnly,
    body_quality: "extraction_failed",
    usable: false,
  };

  if (input.identity_confirmed === false) {
    row.body_quality = "wrong_document";
    return row;
  }
  if (text.length === 0) return row;
  if (noisy) {
    row.body_quality = "too_noisy";
    return row;
  }
  if (text.length < 800) {
    row.body_quality = "metadata_only";
    return row;
  }
  if (abstractOnly) {
    row.body_quality = "abstract_only";
    return row;
  }
  if (bibliographyOnly) {
    row.body_quality = "metadata_only";
    return row;
  }

  const substantive = paragraphs.length >= 3 && argumentation >= 2;
  if (text.length >= LARGE_PDF_LIMITS.MIN_USEFUL_CHARS && substantive) {
    row.body_quality = "complete_enough_for_use";
    row.usable = true;
    return row;
  }
  if (text.length >= 1_500 && paragraphs.length >= 2 && (argumentation >= 1 || topicHits >= 2)) {
    row.body_quality = "partial_but_usable";
    row.usable = true;
    return row;
  }
  row.body_quality = "metadata_only";
  return row;
}

// ── 2 + 5 + 6. Bounded orchestration ───────────────────────────────────────

export interface LargePdfAttemptRow {
  run_id: string | null;
  source_id: string;
  title: string;
  url: string;
  method: "large_scholarship_pdf_chunked";
  binary_size_bytes: number;
  pages_attempted: number;
  pages_extracted: number;
  chars_extracted: number;
  first_page_extracted: number | null;
  last_page_extracted: number | null;
  stopped_reason: string;
  status: "success" | "failed";
  failure_reason: string | null;
  latency_ms: number;
}

export interface LargePdfCacheWriteRow {
  source_id: string;
  title: string;
  url_hash: string;
  old_body_chars: number;
  new_body_chars: number;
  cache_written: boolean;
  cache_key: string;
  reason: string;
}

export interface LargePdfDownstreamRow {
  run_id: string | null;
  source_id: string;
  title: string;
  extraction_succeeded: boolean;
  body_chars_before: number;
  body_chars_after: number;
  role_before: string | null;
  role_after: string | null;
  topicality_before: string | null;
  topicality_after: string | null;
  verifier_usable: boolean | null;
  in_pack: boolean | null;
  emitted_by_model: boolean | null;
  cited: boolean | null;
  final_loss_stage: string | null;
  final_loss_reason: string | null;
}

export interface LargePdfStageReport {
  version: string;
  enabled: boolean;
  eligibility: LargePdfEligibilityRow[];
  attempts: LargePdfAttemptRow[];
  identity: LargePdfIdentityRow[];
  quality: LargePdfBodyQualityRow[];
  cache_writes: LargePdfCacheWriteRow[];
  downstream: LargePdfDownstreamRow[];
  improved_source_ids: string[];
  added_latency_ms: number;
  stop_reason: string;
}

export interface LargePdfStageInput {
  run_id?: string | null;
  enabled: boolean;
  views: LargePdfCandidateView[];
  topicTerms?: string[];
  /** Streamed, size-capped download. Must not follow into blocked hosts. */
  downloadPdf: (url: string, maxBytes: number) => Promise<{
    bytes: Uint8Array;
    content_type: string;
    final_url: string;
    status: number;
  }>;
  /** Bounded page-range extraction (injected for deterministic tests). */
  extractPages: (
    bytes: Uint8Array,
    opts: { maxPages: number; maxChars: number; deadlineMs: number; enoughChars?: number },
  ) => Promise<ChunkedPdfResult>;
  /** Cached body from a previous run, keyed by URL. */
  cacheLookup?: (url: string) => Promise<string | null>;
  cacheWrite?: (url: string, text: string, meta: Record<string, unknown>) => Promise<boolean>;
  /** Stores the accepted body on the candidate. Returns stored length. */
  applyBody: (source_id: string, text: string, meta: Record<string, unknown>) => number;
  topicality?: (source_id: string, body: string) => "direct" | "adjacent" | "off_topic";
  markDurable?: (name: string, detail: Record<string, unknown>) => Promise<void> | void;
  now?: () => number;
}

function urlHash(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (Math.imul(31, h) + url.charCodeAt(i)) | 0;
  return `u${(h >>> 0).toString(36)}`;
}

export async function runLargeScholarshipPdfExtraction(
  input: LargePdfStageInput,
): Promise<LargePdfStageReport> {
  const now = input.now ?? (() => Date.now());
  const started = now();
  const report: LargePdfStageReport = {
    version: LARGE_SCHOLARSHIP_PDF_VERSION,
    enabled: input.enabled,
    eligibility: [],
    attempts: [],
    identity: [],
    quality: [],
    cache_writes: [],
    downstream: [],
    improved_source_ids: [],
    added_latency_ms: 0,
    stop_reason: "completed",
  };
  if (!input.enabled) {
    report.stop_reason = "stage_disabled";
    return report;
  }

  const viewById = new Map(input.views.map((v) => [v.source_id, v]));
  report.eligibility = input.views.map((v) =>
    assessLargePdfEligibility({ ...v, run_id: input.run_id ?? v.run_id ?? null })
  );
  const selected = selectLargePdfCandidates(report.eligibility, viewById);
  if (selected.length === 0) {
    report.stop_reason = "no_eligible_large_pdf";
    report.added_latency_ms = now() - started;
    return report;
  }

  for (const row of selected) {
    if (now() - started >= LARGE_PDF_LIMITS.TOTAL_MS) {
      report.stop_reason = "stage_budget_exhausted";
      break;
    }
    const v = viewById.get(row.source_id)!;
    const url = String(row.url);
    const oldBody = String(v.body_chars ?? 0) ? Number(v.body_chars ?? 0) : 0;
    const t0 = now();
    const attempt: LargePdfAttemptRow = {
      run_id: input.run_id ?? null,
      source_id: row.source_id,
      title: row.title,
      url,
      method: "large_scholarship_pdf_chunked",
      binary_size_bytes: row.binary_size_bytes,
      pages_attempted: 0,
      pages_extracted: 0,
      chars_extracted: 0,
      first_page_extracted: null,
      last_page_extracted: null,
      stopped_reason: "not_started",
      status: "failed",
      failure_reason: null,
      latency_ms: 0,
    };

    let text = "";
    try {
      const cached = input.cacheLookup ? await input.cacheLookup(url) : null;
      if (cached && cached.length >= LARGE_PDF_LIMITS.MIN_USEFUL_CHARS) {
        text = cached.slice(0, LARGE_PDF_LIMITS.MAX_BODY_CHARS);
        attempt.chars_extracted = text.length;
        attempt.stopped_reason = "cache_hit";
      } else {
        const budgetMs = Math.max(
          2_000,
          Math.min(
            LARGE_PDF_LIMITS.PER_PDF_MS,
            LARGE_PDF_LIMITS.TOTAL_MS - (now() - started),
          ),
        );
        const dl = await Promise.race([
          input.downloadPdf(url, LARGE_PDF_LIMITS.MAX_DOWNLOAD_BYTES),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error("large_pdf_download_timeout")), budgetMs)
          ),
        ]);
        attempt.binary_size_bytes = dl.bytes.byteLength || row.binary_size_bytes;
        if (dl.status >= 400) throw new Error(`http_${dl.status}`);
        if (dl.bytes.byteLength === 0) throw new Error("empty_download");

        const remaining = Math.max(
          2_000,
          Math.min(
            LARGE_PDF_LIMITS.PER_PDF_MS - (now() - t0),
            LARGE_PDF_LIMITS.TOTAL_MS - (now() - started),
          ),
        );
        let res = await Promise.race([
          input.extractPages(dl.bytes, {
            maxPages: LARGE_PDF_LIMITS.FIRST_PASS_PAGES,
            maxChars: LARGE_PDF_LIMITS.MAX_BODY_CHARS,
            deadlineMs: remaining,
            enoughChars: LARGE_PDF_LIMITS.ENOUGH_CHARS,
          }),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error("large_pdf_extract_timeout")), remaining + 1_000)
          ),
        ]);

        // Second, wider pass only when the first pass was too thin and budget allows.
        const leftAfterFirst = Math.min(
          LARGE_PDF_LIMITS.PER_PDF_MS - (now() - t0),
          LARGE_PDF_LIMITS.TOTAL_MS - (now() - started),
        );
        if (
          res.chars_extracted < LARGE_PDF_LIMITS.MIN_USEFUL_CHARS &&
          res.total_pages > LARGE_PDF_LIMITS.FIRST_PASS_PAGES && leftAfterFirst > 4_000
        ) {
          const wider = await Promise.race([
            input.extractPages(dl.bytes, {
              maxPages: LARGE_PDF_LIMITS.EXTENDED_PASS_PAGES,
              maxChars: LARGE_PDF_LIMITS.MAX_BODY_CHARS,
              deadlineMs: leftAfterFirst,
              enoughChars: LARGE_PDF_LIMITS.ENOUGH_CHARS,
            }),
            new Promise<never>((_, rej) =>
              setTimeout(() => rej(new Error("large_pdf_extract_timeout")), leftAfterFirst + 1_000)
            ),
          ]).catch(() => res);
          if (wider.chars_extracted > res.chars_extracted) res = wider;
        }

        attempt.pages_attempted = res.pages_attempted;
        attempt.pages_extracted = res.pages_extracted;
        attempt.first_page_extracted = res.first_page_extracted;
        attempt.last_page_extracted = res.last_page_extracted;
        attempt.stopped_reason = res.stopped_reason;
        attempt.chars_extracted = res.chars_extracted;
        text = res.text.slice(0, LARGE_PDF_LIMITS.MAX_BODY_CHARS);
      }
    } catch (e) {
      attempt.failure_reason = String((e as Error)?.message ?? e).slice(0, 160);
      attempt.stopped_reason = "error";
      attempt.latency_ms = now() - t0;
      report.attempts.push(attempt);
      report.downstream.push({
        run_id: input.run_id ?? null,
        source_id: row.source_id,
        title: row.title,
        extraction_succeeded: false,
        body_chars_before: oldBody,
        body_chars_after: oldBody,
        role_before: v.role ?? null,
        role_after: v.role ?? null,
        topicality_before: v.topicality_before ?? null,
        topicality_after: v.topicality_before ?? null,
        verifier_usable: null,
        in_pack: null,
        emitted_by_model: null,
        cited: null,
        final_loss_stage: "large_pdf_extraction",
        final_loss_reason: attempt.failure_reason,
      });
      continue;
    }

    // ── identity + quality ────────────────────────────────────────────────
    const identity = confirmLargePdfIdentity({
      run_id: input.run_id ?? null,
      source_id: row.source_id,
      expected_title: row.title,
      expected_author: row.author,
      text,
    });
    report.identity.push(identity);

    const quality = classifyLargePdfBody({
      run_id: input.run_id ?? null,
      source_id: row.source_id,
      title: row.title,
      text,
      topicTerms: input.topicTerms,
      identity_confirmed: identity.identity_confirmed,
    });
    report.quality.push(quality);

    const topicalityAfter = identity.identity_confirmed && quality.usable && input.topicality
      ? input.topicality(row.source_id, text)
      : null;

    const reject = !identity.identity_confirmed
      ? `identity_${identity.rejection_reason}`
      : !quality.usable
      ? `body_${quality.body_quality}`
      : text.length <= oldBody
      ? "not_better_than_existing_body"
      : topicalityAfter === "off_topic"
      ? "off_topic_after_extraction"
      : null;

    attempt.status = reject === null ? "success" : "failed";
    attempt.failure_reason = reject;
    attempt.latency_ms = now() - t0;
    report.attempts.push(attempt);

    let newChars = oldBody;
    if (reject === null) {
      newChars = input.applyBody(row.source_id, text, {
        extraction_method: "large_scholarship_pdf_chunked",
        pages: [attempt.first_page_extracted, attempt.last_page_extracted],
        binary_size_bytes: attempt.binary_size_bytes,
        source_url: url,
      });
      report.improved_source_ids.push(row.source_id);

      let written = false;
      if (input.cacheWrite && attempt.stopped_reason !== "cache_hit") {
        try {
          written = await input.cacheWrite(url, text, {
            extraction_method: "large_scholarship_pdf_chunked",
            first_page: attempt.first_page_extracted,
            last_page: attempt.last_page_extracted,
          });
        } catch { /* cache is best-effort */ }
      }
      report.cache_writes.push({
        source_id: row.source_id,
        title: row.title,
        url_hash: urlHash(url),
        old_body_chars: oldBody,
        new_body_chars: text.length,
        cache_written: written,
        cache_key: `secondary_source_bodies:${urlHash(url)}`,
        reason: written
          ? "chunked_body_cached"
          : attempt.stopped_reason === "cache_hit"
          ? "served_from_cache"
          : "cache_write_unavailable",
      });
    }

    report.downstream.push({
      run_id: input.run_id ?? null,
      source_id: row.source_id,
      title: row.title,
      extraction_succeeded: reject === null,
      body_chars_before: oldBody,
      body_chars_after: newChars,
      role_before: v.role ?? null,
      role_after: null,
      topicality_before: v.topicality_before ?? null,
      topicality_after: topicalityAfter,
      verifier_usable: null,
      in_pack: null,
      emitted_by_model: null,
      cited: null,
      final_loss_stage: reject === null ? null : "large_pdf_acceptance",
      final_loss_reason: reject,
    });
  }

  report.added_latency_ms = now() - started;
  await input.markDurable?.("large_scholarship_pdf_extraction", {
    version: LARGE_SCHOLARSHIP_PDF_VERSION,
    eligible: report.eligibility.filter((r) => r.eligible).length,
    attempts: report.attempts.length,
    improved: report.improved_source_ids.length,
    added_latency_ms: report.added_latency_ms,
  });
  return report;
}
