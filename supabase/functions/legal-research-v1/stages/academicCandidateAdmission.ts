// academic_candidate_admission_and_slotting_v1
//
// Hardens the ORIGINAL admission and role-slotting decisions for academic runs.
// There is no rescue lane here: nothing in this module looks at candidates that
// were already dropped. It is consulted *at* the perplexity admission gate,
// before a drop is recorded.
//
// Two decisions:
//   1. `evaluateScholarshipAdmission` — a candidate the domain classifier could
//      not place (`class_unknown`) is admitted as scholarship only when several
//      independent academic signals AND topical fit are present, and no
//      listing / SEO / aggregator signal fires.
//   2. `resolveAcademicRoleSlot` — a candidate that does not satisfy the slot
//      the planner asked for is re-slotted into a *secondary* academic role
//      when it safely fits one, instead of being dropped. Never into a primary
//      (statute / case-law) role.
//
// Pure functions. No network, no LLM, no candidate-count increase: this module
// can only change the disposition of a candidate the retrieval already
// returned. Non-academic runs never call it.

export type AcademicRoleSlot = "scholarship" | "government_report" | "factual_report";

export type AcademicSourceRole =
  | "theoretical_normative_source"
  | "comparative_source"
  | "policy_or_institutional_source"
  | "critique_or_counterposition_source"
  | "doctrinal_background_source";

export interface ScholarshipAdmissionInput {
  candidate_id?: string;
  title: string;
  url: string;
  snippet?: string | null;
  original_class: string;
  /** Significant tokens from the user question / desired academic roles. */
  topic_terms: string[];
}

export interface ScholarshipAdmissionDecision {
  candidate_id: string | null;
  title: string;
  url: string;
  domain: string;
  original_class: string;
  admission_decision: "admitted_as_scholarship" | "rejected";
  admission_signals: string[];
  rejection_reasons: string[];
  topical_fit: boolean;
  assigned_source_type: string | null;
}

export interface RoleSlottingInput {
  candidate_id?: string;
  title: string;
  url: string;
  snippet?: string | null;
  original_slot: string;
  source_class: string;
  topical_fit: boolean;
  admission_signals?: string[];
}

export interface RoleSlottingDecision {
  candidate_id: string | null;
  title: string;
  original_slot: string;
  final_slot: AcademicRoleSlot | null;
  changed: boolean;
  reason: string;
  rejected_reason: string | null;
  assigned_academic_roles: AcademicSourceRole[];
}

// ── host / path signals ────────────────────────────────────────────────────

const ACADEMIC_PUBLISHER_HOST_RE =
  /(^|\.)(academic\.oup\.com|oup\.com|link\.springer\.com|springer\.com|cambridge\.org|tandfonline\.com|sciencedirect\.com|onlinelibrary\.wiley\.com|wiley\.com|brill\.com|degruyter\.com|jstor\.org|heinonline\.org|hein\.org|ssrn\.com|papers\.ssrn\.com|mitpressjournals\.org|journals\.sagepub\.com|nomos-elibrary\.de)$/i;

const UNIVERSITY_HOST_RE = /(\.ac\.il|\.edu|\.ac\.uk|\.uni-[a-z]+\.de|\.edu\.au)$/i;

/**
 * Recognized research institutes that publish peer-reviewed-adjacent legal
 * scholarship and policy studies. Narrow allow-list on purpose: a think tank
 * with an editorial research program, never a blog, portal or firm site.
 */
const RESEARCH_INSTITUTE_HOST_RE =
  /(^|\.)(idi\.org\.il|taubcenter\.org\.il|inss\.org\.il|molad\.org|fes\.org\.il|iataskforce\.org|vanleer\.org\.il|macro\.org\.il|kohelet\.org\.il|adalah\.org|acri\.org\.il|bankisrael\.org\.il)$/i;

const REPOSITORY_PATH_RE =
  /\/(repository|repositories|eprints|dspace|handle|bitstream|research|publications?|papers?|working[-_]?papers?|wp-content\/uploads|pubs?|lawreview|law[-_]review|journals?|articles?|faculty|staff|sites\/default\/files)(\/|$)/i;

const DOI_RE = /(doi\.org\/10\.|\/10\.\d{4,9}\/|[?&]doi=)/i;


const AGGREGATOR_HOST_RE =
  /(^|\.)(scholar\.google\.[a-z.]+|semanticscholar\.org|researchgate\.net|academia\.edu|core\.ac\.uk|base-search\.net|citeseerx\.ist\.psu\.edu)$/i;

const SEARCH_OR_LISTING_RE =
  /(^|\/)(search|results|browse|index|archive|catalog|category|categories|tag|tags|issue|issues|toc|sitemap)(\/|$)|[?&](q|query|search|keywords|freetext)=|(^|\/)page\/\d+(\/|$)/i;

const COMMERCIAL_SEO_RE =
  /(^|\.)(lawyer|lawyers|advocate|law-?firm|din-online|kolzchut|kol-zchut|lawguide|law-?info|zap|b144|dun|mysupermarket)/i;
const COMMERCIAL_TITLE_RE =
  /(עורך[\s-]?דין|משרד עורכי דין|ייעוץ משפטי חינם|צור קשר|שיחת ייעוץ|הצעת מחיר|free consultation|contact us|book a call)/i;

// ── content-shape signals ──────────────────────────────────────────────────

const SCHOLARLY_TITLE_RE =
  /(מאמר|כתב[\s-]?עת|עיוני משפט|משפטים|הפרקליט|משפט וממשל|עלי משפט|מחקר|נייר עמדה|דו"?ח|רבעון|ביקורת|תיאורי|תאורטי|עיון|journal|law review|review of|studies|quarterly|working paper|essay|article|chapter|symposium|comment on|towards?|rethinking|critique|theory|jurisprudence)/i;

const ABSTRACT_LIKE_RE =
  /(תקציר|abstract|this article|this paper|the article argues|במאמר זה|מאמר זה|רשימה זו|נטען כי|abstract:|keywords)/i;

const AUTHOR_YEAR_RE =
  /((^|\s)[A-Z][a-z]+,\s?[A-Z]\.|מאת\s|\(\s?(19|20)\d{2}\s?\)|(19|20)\d{2}\)?\s*[,·—-]|vol\.?\s?\d+|כרך\s?[א-תיו]+|עמ'\s?\d+)/;

// ── academic role inference (secondary roles only) ─────────────────────────

const COMPARATIVE_RE =
  /(משפט משווה|גרמני|קנדי|אמריקאי|אירופ|comparative|german|canadian|european|ECHR|Oakes|Bundesverfassungsgericht|Verhältnismäßigkeit)/i;
const CRITIQUE_RE =
  /(ביקורת|ביקורתי|הרהורים|נגד|מוסכמות|כשל|בעייתי|critique|critical|against|myth|rethinking|revisited|limits of)/i;
const POLICY_RE =
  /(דו"?ח|דוח|מדיניות|ועדת|מבקר המדינה|נייר עמדה|מכון|policy|report|commission|institute|OECD)/i;
const THEORY_RE =
  /(תיאור|תאורי|תורת|פילוסופי|מושג|עקרון|נורמטיב|theory|theoretical|normative|conceptual|philosoph|foundations)/i;

// ── helpers ────────────────────────────────────────────────────────────────

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return "";
  }
}

const HE_PREFIX_CHARS = /^[והבלכמש]/;
const HE_SUFFIX_RE = /(ים|ות|יות|ית|יים)$/;

/** Base normalization: casing/punctuation only (plus Hebrew plural suffix). */
export function normalizeTopicToken(raw: string): string {
  let t = raw.toLowerCase().replace(/["'׳״.,;:()\[\]־–—]/g, "").trim();
  if (/[\u0590-\u05FF]/.test(t)) t = t.replace(HE_SUFFIX_RE, "");
  return t;
}

/**
 * All forms a Hebrew token may legitimately take across a question and a
 * source title ("המידתיות" vs "מידתיות"). Matching compares variant sets, so
 * prefix stripping is never lossy in one direction only — the greedy stripper
 * this replaced reduced "המידתיות" to "ידת" and killed every topical check.
 */
export function tokenVariants(raw: string): string[] {
  const base = normalizeTopicToken(raw);
  if (!base) return [];
  const out = new Set<string>([base]);
  if (/[\u0590-\u05FF]/.test(base) && base.length >= 5 && HE_PREFIX_CHARS.test(base)) {
    const stripped = base.slice(1).replace(HE_SUFFIX_RE, "");
    if (stripped.length >= 3) out.add(stripped);
  }
  return [...out];
}

const HE_STOP = new Set([
  "אשר", "כאשר", "עבור", "מהי", "מהם", "אינו", "אינה", "יותר", "כלומר", "לגבי",
  "בין", "לאחר", "לפני", "בתוך", "משפט", "משפטי", "מקור", "מקורות",
]);

/** Extract significant tokens from the question / role hints. */
export function extractTopicTerms(text: string, limit = 24): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of String(text ?? "").split(/[\s,.;:!?()"'\[\]־–—\/]+/)) {
    const t = normalizeTopicToken(raw);
    if (!t) continue;
    const hebrew = /[\u0590-\u05FF]/.test(t);
    if (hebrew ? t.length < 4 : t.length < 5) continue;
    if (HE_STOP.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

/** True when the candidate text shares at least one significant topic token. */
export function hasTopicalFit(
  text: string,
  topicTerms: string[],
): boolean {
  if (!topicTerms.length) return false;
  const hay = String(text ?? "").toLowerCase();
  const tokens = new Set<string>();
  for (const raw of hay.split(/[\s,.;:!?()"'\[\]־–—\/]+/)) {
    for (const v of tokenVariants(raw)) tokens.add(v);
  }
  for (const term of topicTerms) {
    for (const v of tokenVariants(term)) {
      if (tokens.has(v)) return true;
      if (v.length >= 6 && hay.includes(v)) return true;
    }
  }
  return false;
}

/**
 * Original-gate scholarship admission review for a candidate the domain
 * classifier left as `unknown`. Unknown does not mean admitted — it means
 * reviewed by scholarship signals.
 */
export function evaluateScholarshipAdmission(
  input: ScholarshipAdmissionInput,
): ScholarshipAdmissionDecision {
  const domain = hostOf(input.url);
  const path = pathOf(input.url);
  const title = String(input.title ?? "");
  const snippet = String(input.snippet ?? "");
  const hay = `${title} ${snippet}`;

  const signals: string[] = [];
  const rejections: string[] = [];

  // provenance
  const publisher = ACADEMIC_PUBLISHER_HOST_RE.test(domain);
  const university = UNIVERSITY_HOST_RE.test(domain);
  const institute = RESEARCH_INSTITUTE_HOST_RE.test(domain);
  const repositoryPath = REPOSITORY_PATH_RE.test(path);
  const doi = DOI_RE.test(input.url);
  const pdfDoc = /\.(pdf|docx?)(\?|#|$)/i.test(input.url);
  if (publisher) signals.push("academic_publisher_host");
  if (university) signals.push("university_or_faculty_host");
  if (institute) signals.push("recognized_research_institute_host");
  if (repositoryPath) signals.push("repository_or_publications_path");
  if (doi) signals.push("doi_or_stable_identifier");
  if (pdfDoc && (university || repositoryPath || publisher || institute)) {
    signals.push("document_body_path");
  }
  const provenance = publisher || university || institute || repositoryPath || doi;

  // content shape
  const scholarlyTitle = SCHOLARLY_TITLE_RE.test(title);
  const abstractLike = ABSTRACT_LIKE_RE.test(hay);
  const authorYear = AUTHOR_YEAR_RE.test(hay);
  // An analytic Hebrew/English title ("X: subtitle", 6+ words) is a weak signal
  // on its own — it counts only together with credible academic provenance.
  const analyticTitle = /[:–—]/.test(title) && title.trim().split(/\s+/).length >= 6;
  if (scholarlyTitle) signals.push("scholarly_title_shape");
  if (abstractLike) signals.push("abstract_like_snippet");
  if (authorYear) signals.push("author_or_publication_metadata");
  if (analyticTitle && provenance) signals.push("analytic_title_with_provenance");

  // exclusions
  if (!domain) rejections.push("no_resolvable_domain");
  if (AGGREGATOR_HOST_RE.test(domain)) rejections.push("citation_aggregator_or_search_index");
  if (SEARCH_OR_LISTING_RE.test(path)) rejections.push("listing_or_search_page");
  if (COMMERCIAL_SEO_RE.test(domain) || COMMERCIAL_TITLE_RE.test(hay)) {
    rejections.push("commercial_seo_page");
  }
  if (!provenance) rejections.push("no_credible_academic_provenance");
  if (!scholarlyTitle && !abstractLike && !(analyticTitle && provenance)) {
    rejections.push("no_scholarly_title_or_abstract");
  }


  const topical_fit = hasTopicalFit(hay, input.topic_terms);
  if (!topical_fit) rejections.push("off_topic_for_question_and_roles");
  if (signals.length < 2) rejections.push("insufficient_academic_signals");

  const admitted = rejections.length === 0;
  return {
    candidate_id: input.candidate_id ?? null,
    title,
    url: input.url,
    domain,
    original_class: input.original_class,
    admission_decision: admitted ? "admitted_as_scholarship" : "rejected",
    admission_signals: signals,
    rejection_reasons: rejections,
    topical_fit,
    // Bibliographic-only material stays `reference_only` downstream; the
    // substantive-body requirement is enforced by the existing doctrinal gates.
    assigned_source_type: admitted ? (publisher ? "journal_article" : "academic") : null,
  };
}

/** Infer the secondary academic roles a source can safely carry. */
export function inferAcademicRoles(title: string, snippet?: string | null): AcademicSourceRole[] {
  const hay = `${title ?? ""} ${snippet ?? ""}`;
  const roles: AcademicSourceRole[] = [];
  if (COMPARATIVE_RE.test(hay)) roles.push("comparative_source");
  if (CRITIQUE_RE.test(hay)) roles.push("critique_or_counterposition_source");
  if (POLICY_RE.test(hay)) roles.push("policy_or_institutional_source");
  if (THEORY_RE.test(hay)) roles.push("theoretical_normative_source");
  if (roles.length === 0) roles.push("doctrinal_background_source");
  return roles;
}

const PRIMARY_SLOTS = new Set([
  "primary_statute",
  "regulation",
  "binding_case_law",
  "persuasive_case_law",
]);

/**
 * Correct the role slot *before* rejection. A candidate that cannot satisfy the
 * slot the planner asked for is moved to a safe secondary academic slot when it
 * fits one; otherwise it is rejected with an explicit reason.
 *
 * Hard rule: a secondary source is never moved INTO a primary slot here.
 */
export function resolveAcademicRoleSlot(input: RoleSlottingInput): RoleSlottingDecision {
  const base = {
    candidate_id: input.candidate_id ?? null,
    title: input.title,
    original_slot: input.original_slot,
  };
  const cls = input.source_class;

  if (!input.topical_fit) {
    return {
      ...base,
      final_slot: null,
      changed: false,
      reason: "no_reslot_attempted",
      rejected_reason: "off_topic_no_role_assignment",
      assigned_academic_roles: [],
    };
  }

  let final_slot: AcademicRoleSlot | null = null;
  let reason = "";
  if (cls === "academic" || cls === "publisher") {
    final_slot = "scholarship";
    reason = "scholarship_class_fits_secondary_slot";
  } else if (cls === "government_report") {
    final_slot = "government_report";
    reason = "institutional_source_fits_policy_slot";
  }

  if (!final_slot) {
    return {
      ...base,
      final_slot: null,
      changed: false,
      reason: "no_safe_academic_slot",
      rejected_reason: `class_${cls}_has_no_secondary_academic_slot`,
      assigned_academic_roles: [],
    };
  }

  // Never launder a secondary source into a primary role.
  if (PRIMARY_SLOTS.has(final_slot)) {
    return {
      ...base,
      final_slot: null,
      changed: false,
      reason: "primary_slot_assignment_forbidden",
      rejected_reason: "secondary_source_may_not_take_primary_slot",
      assigned_academic_roles: [],
    };
  }

  return {
    ...base,
    final_slot,
    changed: final_slot !== input.original_slot,
    reason,
    rejected_reason: null,
    assigned_academic_roles: inferAcademicRoles(input.title, input.snippet),
  };
}

// ── pack admission summary (role-aware, not count-aware) ───────────────────

export interface AcademicPackAdmissionSummary {
  reviewed_candidates: number;
  admitted_count: number;
  rejected_count: number;
  admitted_by_role: Record<string, number>;
  rejected_by_reason: Record<string, number>;
  final_pack_roles: string[];
  role_diversity_score: number;
}

export function summarizeAcademicPackAdmission(
  admissions: ScholarshipAdmissionDecision[],
  slotting: RoleSlottingDecision[],
): AcademicPackAdmissionSummary {
  const admitted_by_role: Record<string, number> = {};
  const rejected_by_reason: Record<string, number> = {};
  const roles = new Set<string>();
  let admitted = 0;
  let rejected = 0;

  for (const a of admissions) {
    if (a.admission_decision === "admitted_as_scholarship") {
      admitted++;
      admitted_by_role["scholarship"] = (admitted_by_role["scholarship"] ?? 0) + 1;
      for (const r of inferAcademicRoles(a.title)) roles.add(r);
      continue;
    }
    rejected++;
    for (const r of a.rejection_reasons) {
      rejected_by_reason[r] = (rejected_by_reason[r] ?? 0) + 1;
    }
  }
  for (const s of slotting) {
    if (s.final_slot) {
      admitted++;
      admitted_by_role[s.final_slot] = (admitted_by_role[s.final_slot] ?? 0) + 1;
      for (const r of s.assigned_academic_roles) roles.add(r);
    } else if (s.rejected_reason) {
      rejected_by_reason[s.rejected_reason] = (rejected_by_reason[s.rejected_reason] ?? 0) + 1;
    }
  }
  // 5 secondary academic roles are tracked; diversity is coverage of them.
  const role_diversity_score = Number((roles.size / 5).toFixed(2));
  return {
    reviewed_candidates: admissions.length,
    admitted_count: admitted,
    rejected_count: rejected,
    admitted_by_role,
    rejected_by_reason,
    final_pack_roles: [...roles].sort(),
    role_diversity_score,
  };
}
