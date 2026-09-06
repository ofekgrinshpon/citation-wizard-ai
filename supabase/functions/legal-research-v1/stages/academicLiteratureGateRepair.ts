/**
 * academic_literature_gate_repair_and_thin_pack_recovery_v1
 *
 * Literature-only runs kept finding strong direct Israeli scholarship and then
 * losing it before the drafter: `class_unknown` admission rejections,
 * `discovery_only` candidates that were never fetched, and pack selection that
 * collapsed to a single adjacent source.
 *
 * This module is diagnosis + deterministic gate helpers. It adds NO retrieval,
 * NO model call, NO fixed source count and NO padding. Every function is pure
 * except the caller-supplied telemetry sink.
 *
 *   1. `isStrongDirectLiteratureCandidate` — combined-signal test used by the
 *      admission gate and the body-priority gate (never by pack padding).
 *   2. `buildLiteratureGateTrace` — one row per topically direct candidate
 *      saying exactly where it stopped.
 *   3. `classifyBodyTopicality` — direct / adjacent / off_topic on the acquired
 *      body, before verifier usability and pack selection.
 *   4. `decideThinPackRecovery` — bounded safety net: at most 3 already-found
 *      strong direct candidates, one retry each, no new search.
 *   5. `checkNamedSynthesis` — post-draft honesty check (report only).
 */

import { scoreLiteratureTopicality, subjectStems } from "./academicLiteratureRichness.ts";

export const LITERATURE_GATE_REPAIR_VERSION =
  "academic_literature_gate_repair_and_thin_pack_recovery_v1";

// ── recognized Israeli legal scholarship identity ──────────────────────────

/** Israeli law reviews, legal-policy institutes and faculty publications. */
export const ISRAELI_LEGAL_SCHOLARSHIP_RE =
  /(משפטים\s+על\s+אתר|פורום\s+עיוני\s+משפט|עיוני\s+משפט|מחקרי\s+משפט|הפרקליט|משפט\s+וממשל|מאזני\s+משפט|דין\s+ודברים|מעשי\s+משפט|משפט\s+ועסקים|עלי\s+משפט|(?:^|[^א-ת])חוקים(?=\s|[,–—])|(?:^|[^א-ת])משפטים(?=\s*[,־–—]|\s+כרך)|השילוח|המכון\s+הישראלי\s+לדמוקרטיה|מחקר\s+מדיניות|נייר\s+מדיניות|נייר\s+עמדה|כתב[\s-]?עת|law\s+review|law\s+journal|israel\s+democracy\s+institute)/i;

const SCHOLARSHIP_HOST_RE =
  /(\.ac\.il|\.edu|\.ac\.uk|idi\.org\.il|nevo\.co\.il|hamishpat\.com|iuli\.co\.il|ssrn\.com|jstor\.org|heinonline\.org|cambridge\.org|oup\.com|springer\.com|tandfonline\.com|hashiloach\.org\.il|vanleer\.org\.il|kohelet\.org\.il|molad\.org|acri\.org\.il)/i;

/** Mirrors / aggregators: not automatically valid, not automatically invalid. */
const MIRROR_HOST_RE =
  /(researchgate\.net|academia\.edu|semanticscholar\.org|core\.ac\.uk|scholar\.google|base-search\.net|citeseerx|docplayer|scribd|yumpu)/i;

const MARKETING_RE =
  /(עורך[\s-]?דין|משרד עורכי דין|ייעוץ משפטי|צור קשר|הצעת מחיר|free consultation|contact us)/i;

const LISTING_RE =
  /(^|\/)(search|results|browse|catalog|category|tag|tags|sitemap)(\/|$)|[?&](q|query|search)=/i;

const AUTHOR_RE =
  /(מאת\s+[א-ת]{2,}|[א-ת]{2,}\s+[א-ת]{2,}\s*[,|·]\s*["״]|(^|\s)[A-Z][a-z]+,\s?[A-Z]\.)/;

const SCHOLARLY_SHAPE_RE =
  /(מאמר|רשימה|עיון|ביקורת|תיאורי|תאורטי|תיאורטי|נורמטיב|דוקטרינ|abstract|article|essay|working paper|symposium|critique|theory)/i;

export function hostname(url?: string | null): string {
  try {
    return new URL(String(url ?? "")).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export interface LiteratureCandidateView {
  candidate_id: string;
  title: string;
  url?: string | null;
  snippet?: string | null;
  source_type?: string | null;
  role?: string | null;
  origin?: string | null;
  /** True when a substantive body was already acquired. */
  has_body?: boolean;
  body_chars?: number;
}

export interface StrongDirectAssessment {
  candidate_id: string;
  title: string;
  host: string;
  topicality_score: number;
  direct: boolean;
  detected_journal_or_institution: string | null;
  detected_author: boolean;
  mirror_status: "not_a_mirror" | "mirror_with_article_identity" | "mirror_unvalidated";
  scholarship_signals: string[];
  disqualifiers: string[];
  strong_direct: boolean;
}

/**
 * A candidate that is *both* recognisable legal scholarship and directly on the
 * question's subject. Used to protect such candidates at admission and to give
 * them body-acquisition priority — never to add anything to a pack by itself.
 */
export function isStrongDirectLiteratureCandidate(
  question: string,
  c: LiteratureCandidateView,
): StrongDirectAssessment {
  const host = hostname(c.url);
  const hay = `${c.title ?? ""} ${c.snippet ?? ""}`;
  const t = scoreLiteratureTopicality(question, {
    title: c.title,
    snippet: c.snippet,
    url: c.url ?? null,
  });
  const journalMatch = hay.match(ISRAELI_LEGAL_SCHOLARSHIP_RE)?.[0]?.trim() ?? null;
  const scholarlyHost = SCHOLARSHIP_HOST_RE.test(host);
  const mirror = MIRROR_HOST_RE.test(host);
  const author = AUTHOR_RE.test(hay);
  const pdf = /\.(pdf|docx?)(\?|#|$)/i.test(String(c.url ?? ""));
  const shape = SCHOLARLY_SHAPE_RE.test(hay);
  const typeScholarly =
    /(article|journal|academic|scholarship|book|chapter|commentary|report)/i.test(
      `${c.source_type ?? ""} ${c.role ?? ""}`,
    );

  const signals: string[] = [];
  if (journalMatch) signals.push(`journal_or_institution:${journalMatch}`);
  if (scholarlyHost) signals.push("scholarly_host");
  if (author) signals.push("author_metadata");
  if (pdf) signals.push("document_body_url");
  if (shape) signals.push("scholarly_content_shape");
  if (typeScholarly) signals.push("scholarly_declared_type");
  if (t.direct) signals.push("direct_topical_title");

  const disqualifiers: string[] = [];
  if (!host) disqualifiers.push("no_resolvable_host");
  if (MARKETING_RE.test(hay)) disqualifiers.push("marketing_or_firm_page");
  if (LISTING_RE.test(String(c.url ?? ""))) disqualifiers.push("listing_or_search_page");
  if (t.shared_count === 0) disqualifiers.push("off_topic");

  const articleIdentity = Boolean(journalMatch) || (author && shape) ||
    (scholarlyHost && (shape || typeScholarly));
  const mirror_status: StrongDirectAssessment["mirror_status"] = !mirror
    ? "not_a_mirror"
    : articleIdentity
    ? "mirror_with_article_identity"
    : "mirror_unvalidated";

  const strong_direct = disqualifiers.length === 0 &&
    t.direct &&
    articleIdentity &&
    mirror_status !== "mirror_unvalidated";

  return {
    candidate_id: c.candidate_id,
    title: String(c.title ?? ""),
    host,
    topicality_score: t.score,
    direct: t.direct,
    detected_journal_or_institution: journalMatch,
    detected_author: author,
    mirror_status,
    scholarship_signals: signals,
    disqualifiers,
    strong_direct,
  };
}

// ── 2. gate trace ──────────────────────────────────────────────────────────

export interface LiteratureGateTraceRow {
  run_id: string | null;
  source_id: string;
  title: string;
  url: string | null;
  host: string;
  detected_author: boolean;
  detected_journal_or_institution: string | null;
  detected_publication_type: string;
  topicality_score: number;
  role_candidate: string;
  initial_class: string;
  found_stage: string;
  admitted: boolean;
  admission_reason_or_rejection: string;
  body_attempted: boolean;
  body_acquired: boolean;
  extracted_chars: number;
  post_body_topicality: number | null;
  verifier_usable: boolean;
  selected_for_pack: boolean;
  final_loss_stage: string;
  final_loss_reason: string | null;
}

export interface GateTraceInput {
  run_id?: string | null;
  question: string;
  candidates: LiteratureCandidateView[];
  /** candidate_id → admission verdict text (admitted reason or rejection). */
  admission: Map<string, { admitted: boolean; reason: string; initial_class?: string }>;
  /** candidate_id → body acquisition outcome. */
  body: Map<
    string,
    { attempted: boolean; acquired: boolean; chars: number; failure_reason?: string | null }
  >;
  verifier_usable_ids: Set<string>;
  pack_ids: Set<string>;
  post_body_topicality?: Map<string, number>;
}

export function buildLiteratureGateTrace(input: GateTraceInput): LiteratureGateTraceRow[] {
  const rows: LiteratureGateTraceRow[] = [];
  for (const c of input.candidates) {
    const a = isStrongDirectLiteratureCandidate(input.question, c);
    // Only candidates that *look* topically direct are traced — this is a
    // diagnostic for lost scholarship, not a dump of the whole pool.
    if (!a.direct && a.topicality_score < 0.1) continue;
    const adm = input.admission.get(c.candidate_id);
    const b = input.body.get(c.candidate_id);
    const usable = input.verifier_usable_ids.has(c.candidate_id);
    const inPack = input.pack_ids.has(c.candidate_id);
    const admitted = adm?.admitted ?? true;
    let final_loss_stage = "none";
    let final_loss_reason: string | null = null;
    if (!inPack) {
      if (!admitted) {
        final_loss_stage = "admission";
        final_loss_reason = adm?.reason ?? "rejected_at_admission";
      } else if (!b?.attempted) {
        final_loss_stage = "body_not_attempted";
        final_loss_reason = "discovery_only_no_body_attempt";
      } else if (!b?.acquired) {
        final_loss_stage = "body_acquisition_failed";
        final_loss_reason = b?.failure_reason ?? "fetch_failed";
      } else if (!usable) {
        final_loss_stage = "verifier_usability";
        final_loss_reason = "body_acquired_but_not_verifier_usable";
      } else {
        final_loss_stage = "pack_omission";
        final_loss_reason = "usable_but_not_selected_for_pack";
      }
    }
    rows.push({
      run_id: input.run_id ?? null,
      source_id: c.candidate_id,
      title: a.title,
      url: c.url ?? null,
      host: a.host,
      detected_author: a.detected_author,
      detected_journal_or_institution: a.detected_journal_or_institution,
      detected_publication_type: String(c.source_type ?? "unknown"),
      topicality_score: a.topicality_score,
      role_candidate: String(c.role ?? "unknown"),
      initial_class: adm?.initial_class ?? String(c.source_type ?? "unknown"),
      found_stage: String(c.origin ?? "unknown"),
      admitted,
      admission_reason_or_rejection: adm?.reason ?? "admitted_without_academic_review",
      body_attempted: b?.attempted ?? false,
      body_acquired: b?.acquired ?? false,
      extracted_chars: b?.chars ?? (c.body_chars ?? 0),
      post_body_topicality: input.post_body_topicality?.get(c.candidate_id) ?? null,
      verifier_usable: usable,
      selected_for_pack: inPack,
      final_loss_stage,
      final_loss_reason,
    });
  }
  return rows;
}

// ── 3. topicality after body ───────────────────────────────────────────────

export type BodyTopicality = "direct" | "adjacent" | "off_topic";

export interface BodyTopicalityRow {
  run_id: string | null;
  source_id: string;
  title: string;
  pre_body_topicality: number;
  post_body_topicality: number;
  key_matching_terms: string[];
  negative_topic_signals: string[];
  role_after_body: BodyTopicality;
  eligible_for_pack: boolean;
  ineligible_reason: string | null;
}

/**
 * Re-score topical fit once the real body text exists. A body that never
 * discusses the question's subject is off-topic no matter how good the title
 * looked.
 */
export function classifyBodyTopicality(
  question: string,
  source: {
    candidate_id: string;
    title: string;
    snippet?: string | null;
    url?: string | null;
    body?: string | null;
  },
  run_id?: string | null,
): BodyTopicalityRow {
  const pre = scoreLiteratureTopicality(question, {
    title: source.title,
    snippet: source.snippet,
    url: source.url ?? null,
  });
  const body = String(source.body ?? "").slice(0, 20_000);
  const q = subjectStems(question);
  const bodyStems = subjectStems(`${source.title ?? ""} ${body}`);
  const matched: string[] = [];
  for (const s of q) if (bodyStems.has(s)) matched.push(s);
  const denom = Math.max(6, Math.min(q.size, 24));
  const post = body
    ? Number(Math.min(1, matched.length / denom).toFixed(2))
    : pre.score;

  const negatives: string[] = [];
  if (body && body.length < 800) negatives.push("body_too_short_to_assess");
  if (body && matched.length === 0) negatives.push("no_subject_vocabulary_in_body");

  const role_after_body: BodyTopicality = matched.length >= 4 || (!body && pre.direct)
    ? "direct"
    : matched.length >= 1 || pre.shared_count > 0
    ? "adjacent"
    : "off_topic";

  return {
    run_id: run_id ?? null,
    source_id: source.candidate_id,
    title: source.title,
    pre_body_topicality: pre.score,
    post_body_topicality: post,
    key_matching_terms: matched.slice(0, 10),
    negative_topic_signals: negatives,
    role_after_body,
    eligible_for_pack: role_after_body !== "off_topic",
    ineligible_reason: role_after_body === "off_topic"
      ? "body_off_topic_for_question"
      : null,
  };
}

// ── 4. bounded thin-pack recovery ──────────────────────────────────────────

export interface ThinPackRecoveryDecision {
  triggered: boolean;
  trigger_reason: string;
  candidate_ids: string[];
  bounds: { max_candidates: number; max_web_attempts: number; total_ms: number };
}

export interface ThinPackRecoveryInput {
  literature_mode: boolean;
  /** Sources currently usable as literature for the drafter. */
  usable_literature_count: number;
  /** Strong direct candidates found by retrieval, whatever their state. */
  strong_direct: StrongDirectAssessment[];
  /** candidate_id → whether a body was acquired. */
  body_acquired: Set<string>;
  /** candidate_ids with a definitive bad-source / integrity rejection. */
  definitively_rejected: Set<string>;
  budget_allows: boolean;
}

export const THIN_PACK_RECOVERY_BOUNDS = {
  MAX_CANDIDATES: 3,
  MAX_WEB_ATTEMPTS: 3,
  TOTAL_MS: 12_000,
} as const;

export function decideThinPackRecovery(
  input: ThinPackRecoveryInput,
): ThinPackRecoveryDecision {
  const bounds = {
    max_candidates: THIN_PACK_RECOVERY_BOUNDS.MAX_CANDIDATES,
    max_web_attempts: THIN_PACK_RECOVERY_BOUNDS.MAX_WEB_ATTEMPTS,
    total_ms: THIN_PACK_RECOVERY_BOUNDS.TOTAL_MS,
  };
  const no = (reason: string): ThinPackRecoveryDecision => ({
    triggered: false,
    trigger_reason: reason,
    candidate_ids: [],
    bounds,
  });
  if (!input.literature_mode) return no("not_a_literature_review_request");
  if (!input.budget_allows) return no("retrieval_budget_exhausted");
  if (input.usable_literature_count > 2) return no("pack_not_thin");

  const candidates = input.strong_direct
    .filter((s) => s.strong_direct)
    .filter((s) => !input.body_acquired.has(s.candidate_id))
    .filter((s) => !input.definitively_rejected.has(s.candidate_id))
    .sort((a, b) => b.topicality_score - a.topicality_score)
    .slice(0, bounds.max_candidates);

  if (candidates.length === 0) {
    return no("no_recoverable_strong_direct_candidates_real_scarcity");
  }
  return {
    triggered: true,
    trigger_reason:
      `thin_literature_pack:${input.usable_literature_count}_with_${candidates.length}_strong_direct_unfetched`,
    candidate_ids: candidates.map((c) => c.candidate_id),
    bounds,
  };
}

// ── 5. named-synthesis honesty check (report only) ─────────────────────────

const GENERIC_LITERATURE_RE =
  /(הספרות\s+(?:המשפטית\s+)?(?:טוענת|גורסת|מצביעה|מדגישה|עומדת)|מקובל\s+בספרות|בספרות\s+נטען|חוקרים\s+רבים|מלומדים\s+רבים|יש\s+הטוענים)/g;

export interface NamedSynthesisCheck {
  run_id: string | null;
  named_sources_used: string[];
  generic_literature_phrases_count: number;
  unsupported_generic_literature_claims: number;
  one_source_reused_across_unrelated_claims: boolean;
  limitation_required: boolean;
  limitation_present: boolean;
}

const LIMITATION_RE =
  /(מצומצם|מוגבל|לא\s+נמצאה\s+ספרות|בסיס\s+המקורות|היקף\s+המקורות|אין\s+בכך\s+כדי\s+לשקף)/;

export function checkNamedSynthesis(
  answerMarkdown: string,
  opts: {
    run_id?: string | null;
    named_sources?: string[];
    footnote_count: number;
    limitation_required: boolean;
  },
): NamedSynthesisCheck {
  const text = String(answerMarkdown ?? "");
  const generics = text.match(GENERIC_LITERATURE_RE) ?? [];
  // A generic claim is "unsupported" when the sentence carrying it has no
  // footnote marker.
  let unsupported = 0;
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    if (!GENERIC_LITERATURE_RE.test(sentence)) {
      GENERIC_LITERATURE_RE.lastIndex = 0;
      continue;
    }
    GENERIC_LITERATURE_RE.lastIndex = 0;
    if (!/[¹²³⁴⁵⁶⁷⁸⁹⁰]|\[\^?\d+\]/.test(sentence)) unsupported++;
  }
  const named = (opts.named_sources ?? []).filter((n) =>
    n && text.includes(n.split(/[,–—:]/)[0].trim())
  );
  return {
    run_id: opts.run_id ?? null,
    named_sources_used: named.slice(0, 12),
    generic_literature_phrases_count: generics.length,
    unsupported_generic_literature_claims: unsupported,
    one_source_reused_across_unrelated_claims: opts.footnote_count >= 4 &&
      (opts.named_sources ?? []).length <= 1,
    limitation_required: opts.limitation_required,
    limitation_present: LIMITATION_RE.test(text),
  };
}
