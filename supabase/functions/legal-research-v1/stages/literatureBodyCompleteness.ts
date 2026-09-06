/**
 * literature_body_completeness_v1
 *
 * `fix_topicality_and_role_labelling_v1` stopped good scholarship from being
 * mislabelled, but several strong articles still die at
 * `body_evidence_too_weak_to_override_slot`: the body that was actually
 * fetched is a listing page, an abstract, a navigation shell or a truncated
 * PDF extraction, so nothing downstream can classify or verify it safely.
 *
 * This stage makes ONE bounded attempt to obtain a fuller body for literature
 * candidates that were ALREADY found and ALREADY fetched in this run.
 *
 * Hard scope guarantees:
 *   - No discovery, no search queries, no new candidates, no model call.
 *   - Only the candidate's own URL, and at most one link found inside that
 *     same already-fetched page (canonical / print view / same-host PDF).
 *   - Paywalled, access-controlled, court and primary-law sources are refused.
 *   - A replacement body must be materially better, article-identity
 *     confirmed, substantive and on-topic; otherwise the old body is kept.
 *   - Fail closed: every failure leaves the candidate exactly as it was.
 */

import {
  assessSubstantiveBody,
  extractFullTextLinks,
  isAccessControlledUrl,
  PAYWALLED_HOST_RE,
  COURT_HOST_RE,
} from "./secondaryWebAcquisition.ts";
import { formsIntersect, termForms } from "./hebrewTopicTerms.ts";

export const LITERATURE_BODY_COMPLETENESS_VERSION = "literature_body_completeness_v1";

export const BODY_COMPLETENESS_LIMITS = {
  /** Below this a body cannot be classified reliably. */
  MIN_CLASSIFIABLE_CHARS: 800,
  /** A body at/above this is treated as complete on length alone. */
  COMPLETE_CHARS: 3_000,
  MAX_REEXTRACTION_CANDIDATES: 4,
  MAX_VARIANTS_PER_CANDIDATE: 2,
  MAX_FOLLOWS_PER_CANDIDATE: 1,
  TOTAL_MS: 25_000,
  PER_CANDIDATE_MS: 12_000,
  /** Replacement must beat the old body by this much. */
  MIN_IMPROVEMENT_RATIO: 1.25,
  MIN_IMPROVEMENT_CHARS: 400,
  MAX_TEXT: 16_000,
} as const;

export type Completeness = "complete" | "partial" | "metadata_only" | "listing_like" | "failed";

// ── deterministic body shape signals ───────────────────────────────────────

const LISTING_RE =
  /(תוצאות\s+חיפוש|לא\s+נמצאו\s+תוצאות|רשימת\s+מאמרים|כל\s+הגיליונות|תוכן\s+העניינים|גיליונות\s+קודמים|search\s+results|browse\s+(?:by|issues)|table\s+of\s+contents|archive\s+of\s+issues)/i;
const NAV_RE =
  /(דף\s+הבית|תפריט|כל\s+הזכויות\s+שמורות|צור\s+קשר|מפת\s+האתר|הרשמה\s+לניוזלטר|תנאי\s+שימוש|מדיניות\s+פרטיות|skip\s+to\s+content|main\s+menu|all\s+rights\s+reserved|privacy\s+policy|terms\s+of\s+use|newsletter)/i;
const ABSTRACT_RE = /(תקציר|abstract)/i;
const EXTRACTION_FAILURE_RE =
  /(\uFFFD{3,}|%PDF|obj\s*<<|endstream|cannot\s+be\s+displayed|error\s+loading\s+(?:pdf|document)|failed\s+to\s+extract|javascript\s+is\s+required|enable\s+javascript)/i;
const AUTHOR_RE = /(מאת|פרופ['׳]|ד["״]ר|עו["״]ד|\bby\s+[A-Z][a-z]+\s+[A-Z])/;
const JOURNAL_RE =
  /(משפטים\s+על\s+אתר|פורום\s+עיוני\s+משפט|עיוני\s+משפט|מחקרי\s+משפט|הפרקליט|משפט\s+וממשל|מאזני\s+משפט|דין\s+ודברים|מעשי\s+משפט|משפט\s+ועסקים|עלי\s+משפט|כרך\s+|כתב[\s-]?עת|law\s+review|law\s+journal|working\s+paper|נייר\s+מדיניות)/i;
const LEGAL_SUBSTANCE_RE =
  /(דוקטרינה|הלכה|פסיקה|חקיקה|ביקורת\s+שיפוטית|עקרון|נורמה|רשות\s+מנהלית|שיקול\s+דעת|מידתיות|סבירות|הסתמכות|לגיטימי|טענה|נימוק|גישה|תיאורי|נורמטיבי|פרשנות|ניתוח|לטענת|לדעת|לעומת\s+זאת|יש\s+לטעון|מנגד)/g;
const ARGUMENT_RE = /(לטענת|לדעת|לעומת\s+זאת|מנגד|יש\s+לטעון|בניגוד\s+ל|לפיכך|מכאן\s+ש|ניתן\s+לסכם)/;
const PARA_SPLIT = /\n{1,}/;

export interface BodyCompletenessInput {
  run_id?: string | null;
  source_id: string;
  title: string;
  url?: string | null;
  source_type?: string | null;
  role_before?: string | null;
  body?: string | null;
}

export interface BodyCompletenessAssessment {
  run_id: string | null;
  source_id: string;
  title: string;
  url: string | null;
  host: string;
  source_type: string | null;
  role_before: string | null;
  body_chars: number;
  paragraph_count: number;
  has_title: boolean;
  has_author: boolean;
  has_journal_signal: boolean;
  has_abstract_only: boolean;
  listing_like: boolean;
  navigation_noise_ratio: number;
  legal_substance_terms_count: number;
  extraction_failure_signals: string[];
  completeness: Completeness;
  reason: string;
}

export function hostOf(url?: string | null): string {
  try {
    return new URL(String(url ?? "")).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Deterministic completeness classification of an already-acquired body. */
export function assessBodyCompleteness(
  input: BodyCompletenessInput,
): BodyCompletenessAssessment {
  const body = String(input.body ?? "");
  const head = body.slice(0, 6_000);
  const paragraphs = body.split(PARA_SPLIT).map((p) => p.trim()).filter((p) => p.length >= 120);
  const lines = body.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const navLines = lines.filter((l) => l.length < 60 && NAV_RE.test(l)).length;
  const navRatio = lines.length ? Number((navLines / lines.length).toFixed(2)) : 0;
  const substanceHits = (body.match(LEGAL_SUBSTANCE_RE) ?? []).length;
  const failures: string[] = [];
  if (EXTRACTION_FAILURE_RE.test(head)) failures.push("extraction_failure_marker");
  if (/\uFFFD/.test(body) && (body.match(/\uFFFD/g) ?? []).length > body.length / 200) {
    failures.push("replacement_char_noise");
  }
  const listing = LISTING_RE.test(head) && paragraphs.length <= 2;
  const abstractOnly = ABSTRACT_RE.test(head) && body.length < 2_000 && paragraphs.length <= 2;

  const base = {
    run_id: input.run_id ?? null,
    source_id: input.source_id,
    title: String(input.title ?? ""),
    url: input.url ?? null,
    host: hostOf(input.url),
    source_type: input.source_type ?? null,
    role_before: input.role_before ?? null,
    body_chars: body.length,
    paragraph_count: paragraphs.length,
    has_title: String(input.title ?? "").trim().length > 0,
    has_author: AUTHOR_RE.test(head),
    has_journal_signal: JOURNAL_RE.test(`${input.title ?? ""}\n${head}`),
    has_abstract_only: abstractOnly,
    listing_like: listing,
    navigation_noise_ratio: navRatio,
    legal_substance_terms_count: substanceHits,
    extraction_failure_signals: failures,
  };

  const verdict = (completeness: Completeness, reason: string): BodyCompletenessAssessment => ({
    ...base,
    completeness,
    reason,
  });

  if (body.length === 0) return verdict("failed", "no_body_stored");
  if (failures.length > 0) return verdict("failed", failures[0]);
  if (listing) return verdict("listing_like", "listing_or_index_page");
  if (body.length < 300) return verdict("metadata_only", "title_or_metadata_only");
  if (abstractOnly) return verdict("metadata_only", "abstract_only");
  if (body.length < BODY_COMPLETENESS_LIMITS.MIN_CLASSIFIABLE_CHARS) {
    return verdict("partial", "below_min_classifiable_chars");
  }
  if (navRatio > 0.5) return verdict("partial", "navigation_noise_dominates");
  if (paragraphs.length < 2) return verdict("partial", "very_low_paragraph_count");
  if (substanceHits < 3 && body.length < BODY_COMPLETENESS_LIMITS.COMPLETE_CHARS) {
    return verdict("partial", "no_legal_substance_vocabulary");
  }
  if (
    body.length < BODY_COMPLETENESS_LIMITS.COMPLETE_CHARS && !ARGUMENT_RE.test(body)
  ) {
    return verdict("partial", "metadata_present_without_argumentation");
  }
  return verdict("complete", "substantive_body");
}

// ── selection ──────────────────────────────────────────────────────────────

const NON_REEXTRACTABLE_TYPES = new Set([
  "case",
  "caselaw",
  "judgment",
  "israeli_law",
  "statute",
  "regulation",
  "legislation",
  "legislation_primary",
  "legislation_secondary",
  "news",
]);

const SCHOLARSHIP_ROLE_RE =
  /(scholarship|journal|article|book|institutional|academic|commentary|report)/i;

/** Distinct literature roles a candidate can add to the review. */
export type LiteratureRole =
  | "history"
  | "critique"
  | "doctrine"
  | "theory"
  | "comparative"
  | "institutional"
  | "counter_position"
  | "unclassified";

export function literatureRoleOf(title: string, body: string): LiteratureRole {
  const hay = `${title}\n${body.slice(0, 4_000)}`;
  if (/(היסטורי|התפתחות|מקורות\s+ההלכה|רקע\s+היסטורי)/.test(hay)) return "history";
  if (/(ביקורת|נגד\s+עילת|כשל|התנגדות|critique)/.test(hay)) return "critique";
  if (/(תיאורי|תיאוריה|פילוסופי|נורמטיבי\s+כללי|theory|jurisprud)/i.test(hay)) return "theory";
  if (/(משפט\s+משווה|בארה"ב|באנגליה|בגרמניה|comparative)/i.test(hay)) return "comparative";
  if (/(המכון\s+הישראלי\s+לדמוקרטיה|מרכז\s+המחקר\s+והמידע|נייר\s+מדיניות|policy\s+paper)/i.test(hay)) {
    return "institutional";
  }
  if (/(מנגד|עמדה\s+נגדית|תשובה\s+ל|בתגובה\s+ל)/.test(hay)) return "counter_position";
  if (/(דוקטרינ|מבחן\s+ה|יסודות\s+העילה|תנאי\s+ה)/.test(hay)) return "doctrine";
  return "unclassified";
}

export interface ReextractionCandidateView extends BodyCompletenessInput {
  /** From `isStrongDirectLiteratureCandidate` for this run. */
  strong_direct: boolean;
  strong_adjacent?: boolean;
  /** Reason recorded by body-derived role relabelling, when known. */
  blocker?: string | null;
  /** Post-body topicality, when already computed. */
  topicality?: "direct" | "adjacent" | "off_topic" | null;
  /** Hard integrity rejection recorded earlier in the run. */
  hard_integrity_failure?: boolean;
}

export interface ReextractionCandidateRow {
  run_id: string | null;
  source_id: string;
  title: string;
  original_url: string | null;
  blocker: string | null;
  current_body_chars: number;
  current_completeness: Completeness;
  priority_rank: number;
  literature_role: LiteratureRole;
  selected_for_reextraction: boolean;
  selection_reason: string | null;
  skipped_reason: string | null;
}

function refusedReason(v: ReextractionCandidateView): string | null {
  const url = String(v.url ?? "");
  if (!url || !/^https?:\/\//i.test(url)) return "no_fetchable_url";
  if (isAccessControlledUrl(url) || PAYWALLED_HOST_RE.test(url)) return "access_controlled_or_paywalled";
  if (COURT_HOST_RE.test(url)) return "court_host_out_of_scope";
  if (NON_REEXTRACTABLE_TYPES.has(String(v.source_type ?? "").toLowerCase())) {
    return "primary_law_or_news_not_reextracted";
  }
  if (v.hard_integrity_failure) return "hard_integrity_failure";
  if (v.topicality === "off_topic") return "off_topic_after_body";
  if (!v.strong_direct && !v.strong_adjacent) return "not_a_strong_scholarship_candidate";
  const role = String(v.role_before ?? "");
  if (role && !SCHOLARSHIP_ROLE_RE.test(role) && !v.strong_direct) {
    return "non_scholarship_role_without_direct_signal";
  }
  return null;
}

/** Rank and select the bounded re-extraction set. */
export function selectReextractionCandidates(
  views: ReextractionCandidateView[],
  assessments: Map<string, BodyCompletenessAssessment>,
  run_id?: string | null,
): ReextractionCandidateRow[] {
  const scored: Array<{ row: ReextractionCandidateRow; score: number }> = [];
  for (const v of views) {
    const a = assessments.get(v.source_id);
    const completeness = a?.completeness ?? "failed";
    const role = literatureRoleOf(String(v.title ?? ""), String(v.body ?? ""));
    const row: ReextractionCandidateRow = {
      run_id: run_id ?? null,
      source_id: v.source_id,
      title: String(v.title ?? ""),
      original_url: v.url ?? null,
      blocker: v.blocker ?? null,
      current_body_chars: String(v.body ?? "").length,
      current_completeness: completeness,
      priority_rank: 0,
      literature_role: role,
      selected_for_reextraction: false,
      selection_reason: null,
      skipped_reason: null,
    };

    if (completeness === "complete") {
      row.skipped_reason = "body_already_complete";
      scored.push({ row, score: -1 });
      continue;
    }
    const refused = refusedReason(v);
    if (refused) {
      row.skipped_reason = refused;
      scored.push({ row, score: -1 });
      continue;
    }
    if (!(a?.has_title) && !(a?.has_journal_signal) && !(a?.has_author)) {
      row.skipped_reason = "no_article_identity_signal";
      scored.push({ row, score: -1 });
      continue;
    }

    let score = 0;
    if (v.strong_direct) score += 40;
    if (a?.has_journal_signal) score += 20;
    if (String(v.blocker ?? "") === "body_evidence_too_weak_to_override_slot") score += 15;
    if (role !== "unclassified") score += 10;
    if (completeness === "partial") score += 5;
    scored.push({ row, score });
  }

  const eligible = scored.filter((s) => s.score >= 0).sort((a, b) => b.score - a.score);
  eligible.forEach((s, i) => {
    s.row.priority_rank = i + 1;
    if (i < BODY_COMPLETENESS_LIMITS.MAX_REEXTRACTION_CANDIDATES) {
      s.row.selected_for_reextraction = true;
      s.row.selection_reason =
        `${s.row.current_completeness}_body_with_article_identity_rank_${i + 1}`;
    } else {
      s.row.skipped_reason = "over_per_run_reextraction_cap";
    }
  });
  return scored.map((s) => s.row);
}

// ── bounded re-extraction ──────────────────────────────────────────────────

export type ReextractionMethod =
  | "html_main"
  | "pdf_text"
  | "print_view"
  | "canonical_url"
  | "same_page_pdf"
  | "alternate_parser";

export interface ReextractionAttemptRow {
  run_id: string | null;
  source_id: string;
  title: string;
  attempt_number: number;
  method: ReextractionMethod;
  attempted_url: string;
  status: string;
  bytes: number;
  chars_extracted: number;
  old_body_chars: number;
  new_body_chars: number;
  improvement_ratio: number;
  accepted: boolean;
  rejection_reason: string | null;
  latency_ms: number;
}

export interface ReextractionResultRow {
  run_id: string | null;
  source_id: string;
  title: string;
  old_body_chars: number;
  new_body_chars: number;
  old_completeness: Completeness;
  new_completeness: Completeness;
  article_identity_confirmed: boolean;
  topicality_after_reextraction: "direct" | "adjacent" | "off_topic" | "unknown";
  role_before: string | null;
  role_after: string | null;
  body_replaced: boolean;
  final_reason: string;
}

/** Title/author/journal identity check between the old record and a new body. */
export function confirmsArticleIdentity(title: string, newBody: string): boolean {
  const head = newBody.slice(0, 8_000);
  const titleTerms = String(title ?? "")
    .split(/[\s,:;.()"'׳״\-–—]+/)
    .filter((w) => w.length >= 4)
    .slice(0, 12);
  if (titleTerms.length === 0) return JOURNAL_RE.test(head) || AUTHOR_RE.test(head);
  const bodyForms = new Set(
    head.split(/[\s,:;.()"'׳״\-–—\n]+/).filter((w) => w.length >= 4).flatMap((w) => termForms(w)),
  );
  const hits = titleTerms.filter((t) => formsIntersect(termForms(t), bodyForms)).length;
  const ratio = hits / titleTerms.length;
  return ratio >= 0.4 || (hits >= 3 && (JOURNAL_RE.test(head) || AUTHOR_RE.test(head)));
}

/** Canonical / print / same-page PDF link inside an already-fetched page. */
export function findSamePageFullText(
  html: string,
  pageUrl: string,
): { url: string; method: ReextractionMethod } | null {
  const scan = html.slice(0, 200_000);
  const canonical =
    scan.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] ??
      scan.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? null;
  const print = scan.match(/href=["']([^"']*(?:print|nodeprint|\?print=1)[^"']*)["']/i)?.[1] ?? null;

  const abs = (raw: string | null): string | null => {
    if (!raw) return null;
    try {
      const u = new URL(raw, pageUrl).toString();
      if (isAccessControlledUrl(u) || PAYWALLED_HOST_RE.test(u) || COURT_HOST_RE.test(u)) return null;
      return u;
    } catch {
      return null;
    }
  };

  const links = extractFullTextLinks(html, pageUrl);
  const pdf = links.find((l) => /\.pdf(\?|#|$)/i.test(l.url) && l.same_host) ??
    links.find((l) => /\.pdf(\?|#|$)/i.test(l.url));
  if (pdf) return { url: pdf.url, method: "same_page_pdf" };

  const p = abs(print);
  if (p && p !== pageUrl) return { url: p, method: "print_view" };

  const c = abs(canonical);
  if (c && c !== pageUrl) return { url: c, method: "canonical_url" };

  const other = links[0];
  if (other) return { url: other.url, method: "alternate_parser" };
  return null;
}

export interface FetchedBody {
  text: string;
  html: string | null;
  final_url: string;
  status: number;
  bytes: number;
  extraction_method: "pdf" | "docx" | "html" | "text";
}

export interface CompletenessStageInput {
  run_id?: string | null;
  enabled: boolean;
  views: ReextractionCandidateView[];
  /** Applies the improved body to the live candidate. Returns the stored length. */
  applyBody: (source_id: string, text: string, final_url: string) => number;
  fetchBody: (url: string) => Promise<FetchedBody>;
  topicality?: (source_id: string, body: string) => "direct" | "adjacent" | "off_topic";
  markDurable?: (name: string, detail: Record<string, unknown>) => void | Promise<void>;
  now?: () => number;
}

export interface CompletenessStageReport {
  version: string;
  ran: boolean;
  not_run_reason: string | null;
  assessments: BodyCompletenessAssessment[];
  candidates: ReextractionCandidateRow[];
  attempts: ReextractionAttemptRow[];
  results: ReextractionResultRow[];
  improved_source_ids: string[];
  added_latency_ms: number;
}

export async function runLiteratureBodyCompleteness(
  input: CompletenessStageInput,
): Promise<CompletenessStageReport> {
  const now = input.now ?? (() => Date.now());
  const started = now();
  const report: CompletenessStageReport = {
    version: LITERATURE_BODY_COMPLETENESS_VERSION,
    ran: false,
    not_run_reason: null,
    assessments: [],
    candidates: [],
    attempts: [],
    results: [],
    improved_source_ids: [],
    added_latency_ms: 0,
  };
  if (!input.enabled) {
    report.not_run_reason = "stage_disabled_for_this_run";
    return report;
  }
  report.ran = true;

  const assessments = new Map<string, BodyCompletenessAssessment>();
  for (const v of input.views) {
    const a = assessBodyCompleteness({ ...v, run_id: input.run_id ?? null });
    assessments.set(v.source_id, a);
    report.assessments.push(a);
  }
  report.candidates = selectReextractionCandidates(input.views, assessments, input.run_id ?? null);
  await input.markDurable?.("literature_body_completeness_assessment", {
    assessed: report.assessments.length,
    incomplete: report.assessments.filter((a) => a.completeness !== "complete").length,
    selected: report.candidates.filter((c) => c.selected_for_reextraction).length,
  });

  const byId = new Map(input.views.map((v) => [v.source_id, v]));
  for (const row of report.candidates.filter((c) => c.selected_for_reextraction)) {
    if (now() - started > BODY_COMPLETENESS_LIMITS.TOTAL_MS) {
      row.selected_for_reextraction = false;
      row.skipped_reason = "run_reextraction_time_budget_spent";
      continue;
    }
    const view = byId.get(row.source_id);
    if (!view) continue;
    const old = String(view.body ?? "");
    const oldAssessment = assessments.get(row.source_id)!;
    const candidateStart = now();
    let attemptNo = 0;
    let follows = 0;
    let best: { text: string; url: string } | null = null;
    let lastReason = "no_attempt_made";
    let nextUrl: string | null = String(view.url ?? "");
    let nextMethod: ReextractionMethod = "html_main";

    while (
      nextUrl &&
      attemptNo < BODY_COMPLETENESS_LIMITS.MAX_VARIANTS_PER_CANDIDATE &&
      now() - candidateStart < BODY_COMPLETENESS_LIMITS.PER_CANDIDATE_MS &&
      now() - started < BODY_COMPLETENESS_LIMITS.TOTAL_MS
    ) {
      attemptNo += 1;
      const attemptUrl = nextUrl;
      const method = nextMethod;
      nextUrl = null;
      const t0 = now();
      const attempt: ReextractionAttemptRow = {
        run_id: input.run_id ?? null,
        source_id: row.source_id,
        title: row.title,
        attempt_number: attemptNo,
        method,
        attempted_url: attemptUrl,
        status: "pending",
        bytes: 0,
        chars_extracted: 0,
        old_body_chars: old.length,
        new_body_chars: 0,
        improvement_ratio: 0,
        accepted: false,
        rejection_reason: null,
        latency_ms: 0,
      };
      try {
        // Hard wall-clock cap: never let a single hanging fetch stall the run.
        const remaining = Math.max(
          1_000,
          Math.min(
            BODY_COMPLETENESS_LIMITS.PER_CANDIDATE_MS - (now() - candidateStart),
            BODY_COMPLETENESS_LIMITS.TOTAL_MS - (now() - started),
          ),
        );
        const fetched = await Promise.race([
          input.fetchBody(attemptUrl),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("reextraction_fetch_timeout")), remaining)
          ),
        ]);

        attempt.status = `http_${fetched.status}`;
        attempt.bytes = fetched.bytes;
        attempt.chars_extracted = fetched.text.length;
        attempt.method = fetched.extraction_method === "pdf" ? "pdf_text" : method;
        if (fetched.text.length > (best?.text.length ?? 0)) {
          best = { text: fetched.text, url: fetched.final_url };
        }
        if (
          fetched.html && follows < BODY_COMPLETENESS_LIMITS.MAX_FOLLOWS_PER_CANDIDATE &&
          fetched.text.length < BODY_COMPLETENESS_LIMITS.COMPLETE_CHARS
        ) {
          const link = findSamePageFullText(fetched.html, fetched.final_url);
          if (link) {
            follows += 1;
            nextUrl = link.url;
            nextMethod = link.method;
          }
        }
        lastReason = "fetched";
      } catch (e) {
        attempt.status = "error";
        attempt.rejection_reason = String((e as Error)?.message ?? e).slice(0, 160);
        lastReason = attempt.rejection_reason;
      }
      attempt.latency_ms = now() - t0;
      report.attempts.push(attempt);
    }

    // ── acceptance ────────────────────────────────────────────────────────
    let replaced = false;
    let finalReason = lastReason;
    let newAssessment = oldAssessment;
    let topicalityAfter: ReextractionResultRow["topicality_after_reextraction"] = "unknown";
    let identity = false;

    if (best) {
      const text = best.text.slice(0, BODY_COMPLETENESS_LIMITS.MAX_TEXT);
      const ratio = old.length ? Number((text.length / old.length).toFixed(2)) : text.length ? 99 : 0;
      const longEnough = text.length >= old.length + BODY_COMPLETENESS_LIMITS.MIN_IMPROVEMENT_CHARS &&
        (old.length === 0 || ratio >= BODY_COMPLETENESS_LIMITS.MIN_IMPROVEMENT_RATIO);
      const substantive = assessSubstantiveBody(text, "journal_article");
      newAssessment = assessBodyCompleteness({
        ...view,
        run_id: input.run_id ?? null,
        body: text,
      });
      identity = confirmsArticleIdentity(row.title, text);
      topicalityAfter = input.topicality ? input.topicality(row.source_id, text) : "unknown";

      const reject = !longEnough
        ? "not_materially_longer_than_stored_body"
        : !substantive.substantive
        ? `not_substantive:${substantive.reason}`
        : newAssessment.completeness === "listing_like"
        ? "replacement_is_listing_page"
        : newAssessment.completeness === "failed"
        ? `replacement_${newAssessment.reason}`
        : !identity
        ? "article_identity_not_confirmed"
        : topicalityAfter === "off_topic"
        ? "off_topic_after_reextraction"
        : null;

      const last = report.attempts[report.attempts.length - 1];
      if (last) {
        last.new_body_chars = text.length;
        last.improvement_ratio = ratio;
        last.accepted = reject === null;
        last.rejection_reason = reject;
      }
      if (reject === null) {
        input.applyBody(row.source_id, text, best.url);
        replaced = true;
        report.improved_source_ids.push(row.source_id);
        finalReason = "body_replaced_with_fuller_extraction";
      } else {
        finalReason = reject;
        newAssessment = oldAssessment;
      }
    }

    report.results.push({
      run_id: input.run_id ?? null,
      source_id: row.source_id,
      title: row.title,
      old_body_chars: old.length,
      new_body_chars: replaced ? newAssessment.body_chars : old.length,
      old_completeness: oldAssessment.completeness,
      new_completeness: newAssessment.completeness,
      article_identity_confirmed: identity,
      topicality_after_reextraction: topicalityAfter,
      role_before: view.role_before ?? null,
      role_after: null,
      body_replaced: replaced,
      final_reason: finalReason,
    });
  }

  report.added_latency_ms = now() - started;
  await input.markDurable?.("literature_body_reextraction", {
    attempts: report.attempts.length,
    improved: report.improved_source_ids.length,
    added_latency_ms: report.added_latency_ms,
  });
  return report;
}

/**
 * Precise, non-opaque reason when a candidate still cannot override its slot
 * after the bounded re-extraction attempt.
 */
export function explainRemainingWeakBody(
  assessment: BodyCompletenessAssessment,
  attempts: ReextractionAttemptRow[],
  result: ReextractionResultRow | null,
): string {
  if (result?.body_replaced) return "body_improved";
  if (assessment.completeness === "listing_like") return "source_is_listing_only";
  if (assessment.has_abstract_only) return "extraction_returned_abstract_only";
  if (assessment.extraction_failure_signals.length > 0) return "pdf_or_html_extraction_failed";
  if (attempts.length === 0) return "no_eligible_reextraction_attempt";
  if (attempts.every((a) => a.status === "error")) {
    const err = attempts[attempts.length - 1].rejection_reason ?? "fetch_error";
    return /http_4|http_5|error/.test(err) ? `article_unavailable:${err}` : err;
  }
  if (result?.final_reason === "article_identity_not_confirmed") return "identity_not_confirmed";
  if (result?.final_reason === "off_topic_after_reextraction") return "off_topic_after_body";
  if (!attempts.some((a) => a.method === "same_page_pdf" || a.method === "pdf_text")) {
    return "same_page_pdf_not_found_body_remains_under_threshold";
  }
  return "body_remains_under_threshold";
}
