/**
 * Deterministic source-sufficiency gate (authority-type aware).
 *
 * Purpose: when the surviving source pack cannot legitimately support the
 * *type* of question asked, the pipeline must not draft a normal answer built
 * on analogies from an unrelated legal domain. Instead the drafter emits a
 * limited-source answer.
 *
 * Authority-type awareness (this revision): sufficiency depends on the
 * research mode / output shape *and* on the authority type available. A
 * governing statute or regulation is enough for statutory questions
 * (definitions, practical/procedural steps, statutory institutions) even when
 * no usable judgment exists. Case-law synthesis stays strict: statutes and
 * commentary alone never license a "מה הפסיקה אומרת" synthesis.
 *
 * This stage adds no LLM call: it is a pure lexical/type computation over the
 * sources that already survived the verifier.
 *
 * Out of scope by design (handled by existing deterministic branches):
 *   - quote            → canonical-quote registry / quote refusal
 *   - case_holding     → missing-docket limitation
 *   - specific_case    → exact-docket gate
 *   - timeline         → unchanged
 */

import type { DrafterInputSource } from "./drafter.ts";
import { detectStatuteSections } from "./statuteSectionDetection.ts";
import { assessDoctrinalEligibility } from "./doctrinalSourceTyping.ts";


export type SufficiencyCategory =
  | "case_law_synthesis"
  | "doctrine"
  | "practical_list"
  | "not_applicable";

export type SufficiencyProfile =
  | "case_law_synthesis"
  | "statute_section_definition"
  | "practical_steps"
  | "statutory_institution"
  | "not_applicable";

export type SufficiencyAuthorityBasis =
  | "usable_judgment"
  | "governing_statute"
  | "governing_regulation"
  | "statute_plus_regulation"
  | "doctrinal_secondary"
  | "insufficient";

export interface SufficiencyAssessment {
  /** Whether the gate applies to this question shape at all. */
  applied: boolean;
  category: SufficiencyCategory;
  shape: string;
  sufficient: boolean;
  reason: string;
  /** Key doctrine phrases extracted from the question. */
  topic_phrases: string[];
  /** Refs of sources that are topically about the asked doctrine. */
  topical_refs: string[];
  /** Subset of topical refs that are caselaw / statute / doctrinal scholarship. */
  topical_authority_refs: string[];
  /** Titles actually found (for the "what was found" line, no legal rules). */
  found_titles: string[];
  /**
   * Advisory only: the question is answerable but the supporting text is thin
   * (short snippets). The drafter is told to caveat, not to refuse.
   */
  thin_source: boolean;

  // ── Authority-type-aware telemetry ──────────────────────────────────────
  sufficiency_profile: SufficiencyProfile;
  authority_type_sufficiency_passed: boolean;
  sufficiency_authority_basis: SufficiencyAuthorityBasis;
  statute_only_answer: boolean;
  case_law_required: boolean;
  case_law_missing_but_not_required: boolean;
  /** Refs of governing statute sources (usable text, primary/mirror tier). */
  governing_statute_refs: string[];
  /** Refs of governing regulation sources. */
  governing_regulation_refs: string[];
  /** Refs of usable judgment sources. */
  usable_judgment_refs: string[];

  // ── Practical-steps thin-authority telemetry (practical_steps only) ─────
  /** Official/primary statutes that are on-topic but metadata_only. */
  thin_governing_statute_refs: string[];
  /** Official/primary regulations that are on-topic but metadata_only. */
  thin_governing_regulation_refs: string[];
  /** Whether any domain match was achieved only via morphology normalization. */
  morphology_domain_match: boolean;
  normalized_question_tokens: string[];
  normalized_source_tokens: string[];
  /** practical_steps passed sufficiency on thin (metadata_only) authority. */
  practical_steps_thin_authority_passed: boolean;
  /** Whether exact amounts / fees / deadlines may be stated. */
  exact_amounts_allowed: boolean;

  // ── F1 / F4 telemetry ───────────────────────────────────────────────────
  /** Refs whose topical hit came only from the acquired body window. */
  body_topical_refs: string[];
  body_text_topical_match: boolean;
  /** The question names a specific statute section (drives F4 profile). */
  statute_section_requested: boolean;

  // ── substance_based_doctrinal_sufficiency_v1 ────────────────────────────
  /** Depth mode the fallback was evaluated under. */
  depth_mode: string | null;
  /** Eligible acquired doctrinal/secondary sources (see doctrinalSourceTyping). */
  doctrinal_secondary_refs: string[];
  /** Ineligible-secondary reason counts (diagnosis). */
  doctrinal_ineligible_reasons: Record<string, number>;
  /**
   * A refusal was converted into a limited doctrinal explanation supported by
   * acquired statutes / doctrinal secondaries. Never licenses case-law claims.
   */
  limited_doctrinal_answer: boolean;
  /** Which fallback combination fired (A/B/C), or null. */
  doctrinal_fallback_combination: "A" | "B" | "C" | null;
  /** Why the fallback did not fire, when it was evaluated and declined. */
  doctrinal_fallback_declined_reason: string | null;
}


const META_TOKENS = new Set([
  "הפסיקה", "פסיקה", "הדין", "המשפט", "אומרת", "אומר", "אומרים", "קובעת", "קובע",
  "מהי", "מהם", "מהן", "מהו", "כיצד", "האם", "למה", "מדוע", "הסבר", "הסבירו",
  "נא", "בבקשה", "תשובה", "שאלה", "בישראל", "הישראלי", "הישראלית",
  "רשימה", "צעדים", "מקורות", "מקור", "נושא", "הנושא", "עניין", "העניין",
  // prepositions / connectors — they break or pollute doctrine phrases
  "על", "של", "את", "עם", "לפי", "בין", "כי", "אם", "או", "גם", "מן", "אשר",
  "לגבי", "בנוגע", "בעניין", "כמו", "אך", "אבל", "יש", "אין", "היא", "הוא",
  "זה", "זו", "מה", "כל", "כדי", "אלא", "לא", "כן",
]);

const HEBREW_TOKEN_RE = /^[\u0590-\u05FF][\u0590-\u05FF"'׳״-]*$/;
const PHRASE_MIN_TOKENS = 2;
const PHRASE_MAX_TOKENS = 4;

const CASE_TYPES = new Set(["caselaw", "supreme_court_il", "case", "court_case"]);
const STATUTE_TYPES = new Set(["israeli_law", "statute", "regulation", "legislation"]);
const DOCTRINAL_TYPES = new Set(["journal_article", "article", "scholarship", "book", "commentary"]);

const PRIMARY_TIERS = new Set(["official_primary", "statute_mirror", "primary_mirror"]);
const USABLE_TEXT = new Set(["full_text", "substantive_excerpt"]);

/** Regulation-ish titles: תקנות / צו / כללים / אגרות. */
const REGULATION_TITLE_RE = /(תקנות|תקנה\s|צו\s|כללי\s|כללים|אגרות|טופס|טפסים)/;
/** Question asks about procedure / fees / forms. */
const PROCEDURE_FEE_CUE =
  /(אגר|הליך|הליכים|צעד|צעדים|כיצד|איך|להגיש|הגשה|טופס|סדרי\s?דין|נוהל|תהליך|מסמכים|כתב\s+תביעה)/;

function normalize(text: string): string {
  return String(text || "")
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/["׳״''`,.;:?!()[\]{}<>«»—–\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract 2-4 token Hebrew doctrine phrases from the question, dropping
 * meta/question words so that "מה הפסיקה אומרת על הלכת יורש אחר יורש" yields
 * "הלכת יורש אחר יורש" and not "הפסיקה אומרת".
 */
export function extractTopicPhrases(question: string): string[] {
  const tokens = normalize(question).split(" ");
  const phrases: string[] = [];
  let run: string[] = [];
  const flush = () => {
    // Sliding windows of 2..4 tokens over the content run.
    for (let size = Math.min(PHRASE_MAX_TOKENS, run.length); size >= PHRASE_MIN_TOKENS; size--) {
      for (let i = 0; i + size <= run.length; i++) {
        phrases.push(run.slice(i, i + size).join(" "));
      }
    }
    run = [];
  };
  for (const tok of tokens) {
    const isContent =
      tok.length >= 2 && HEBREW_TOKEN_RE.test(tok) && !META_TOKENS.has(tok);
    if (isContent) run.push(tok);
    else flush();
  }
  flush();
  // Deduplicate, keep the longest/most specific first.
  const seen = new Set<string>();
  return phrases
    .filter((p) => (seen.has(p) ? false : (seen.add(p), true)))
    .sort((a, b) => b.split(" ").length - a.split(" ").length || b.length - a.length)
    .slice(0, 16);
}

/** Content tokens (length ≥ 4) from the question — used for loose statute matching. */
function contentTokens(question: string): string[] {
  return normalize(question)
    .split(" ")
    .filter((t) => t.length >= 4 && HEBREW_TOKEN_RE.test(t) && !META_TOKENS.has(t));
}

function phraseMatches(phrase: string, haystack: string): boolean {
  if (!phrase) return false;
  if (haystack.includes(phrase)) return true;
  // For 3+ token phrases only: all tokens present (order-free) — tolerates
  // inflection and parenthetical noise. Two-token phrases require an exact
  // substring hit, otherwise the gate becomes trivially satisfiable.
  const toks = phrase.split(" ").filter((t) => t.length >= 2);
  if (toks.length < 3) return false;
  return toks.every((t) => haystack.includes(t));
}

// ── F1: bounded body-text topical window ──────────────────────────────────
// A judgment or statute body that was actually acquired is truncated hard
// before it reaches the drafter, so the doctrine phrase frequently survives
// only inside the acquired text and never in title/snippet. Topical matching
// may therefore read a *capped* window of the acquired body — but only for
// sources whose body was genuinely acquired (never metadata-only, never
// commentary).
const TOPICAL_BODY_WINDOW_CHARS = 20_000;

function hasAcquiredBody(s: DrafterInputSource): boolean {
  const body = String(s.topical_text ?? "");
  if (body.length < 200) return false;
  const usability = String(s.text_usability || "unknown");
  if (usability === "metadata_only" || usability === "listing_page") return false;
  return isUsableJudgment(s) || isGoverningStatuteLike(s);
}

function topicalHaystack(s: DrafterInputSource): string {
  const base = normalize(`${s.title} ${s.snippet ?? ""}`);
  if (!hasAcquiredBody(s)) return base;
  return `${base} ${normalize(String(s.topical_text).slice(0, TOPICAL_BODY_WINDOW_CHARS))}`;
}

function isTopical(s: DrafterInputSource, phrases: string[]): boolean {
  return phrases.some((p) => phraseMatches(p, topicalHaystack(s)));
}

/** True when the topical hit exists only inside the acquired body window. */
function isBodyOnlyTopical(s: DrafterInputSource, phrases: string[]): boolean {
  if (!hasAcquiredBody(s)) return false;
  const base = normalize(`${s.title} ${s.snippet ?? ""}`);
  if (phrases.some((p) => phraseMatches(p, base))) return false;
  return isTopical(s, phrases);
}

/**
 * Looser domain match used *only* for governing statutes/regulations: a
 * governing statute whose title or text shares a substantive content token
 * with the question is treated as domain-matching. Statutes carry their own
 * authority; requiring a full doctrine phrase in a statute title is what
 * caused the over-refusals (e.g. "חוק השכירות והשאילה" for a deposit
 * question).
 */
function isDomainMatch(s: DrafterInputSource, phrases: string[], tokens: string[]): boolean {
  if (isTopical(s, phrases)) return true;
  const hay = topicalHaystack(s);
  return tokens.some((t) => hay.includes(t));
}

// ── F3: conservative Hebrew inflection variants (domain matching ONLY) ────
// Never used for docket matching, quote matching, or anchor resolution.
//
// The previous implementation stripped prefixes and suffixes aggressively and
// replaced the token with the residue, which destroyed real legal terms
// ("מידתיות" → "ידת") and produced silent sufficiency false negatives. The
// rule now: always keep the original token, add only conservative variants,
// and reject residues that are too short or obviously destructive.
const HEB_CLITIC_PREFIXES = ["ו", "ב", "ל", "כ", "ה", "מ", "ש"];
const HEB_SUFFIXES = ["יות", "ות", "ים", "יה", "ה", "ת"];
/** Minimum length of any derived (non-original) variant. */
const MIN_VARIANT_LEN = 4;
/** Minimum residue length before a prefix AND a suffix may both be stripped. */
const MIN_DOUBLE_STRIP_LEN = 5;

function stripOnePrefix(tok: string): string | null {
  const p = HEB_CLITIC_PREFIXES.find((pref) => tok.startsWith(pref));
  if (!p) return null;
  const rest = tok.slice(p.length);
  return rest.length >= MIN_VARIANT_LEN ? rest : null;
}

function stripOneSuffix(tok: string): string | null {
  for (const suf of HEB_SUFFIXES) {
    if (tok.endsWith(suf) && tok.length - suf.length >= MIN_VARIANT_LEN) {
      return tok.slice(0, tok.length - suf.length);
    }
  }
  return null;
}

/**
 * Conservative variant set for one token: the original plus at most a
 * prefix-stripped form, a suffix-stripped form, and (only for long tokens) the
 * doubly-stripped form. Destructive residues are dropped.
 */
export function hebrewVariants(tokenRaw: string): string[] {
  const tok = String(tokenRaw || "").replace(/["'׳״]/g, "");
  if (!HEBREW_TOKEN_RE.test(tok) || tok.length < 3) return [];
  const out = new Set<string>([tok]);
  const noPrefix = stripOnePrefix(tok);
  if (noPrefix) out.add(noPrefix);
  const noSuffix = stripOneSuffix(tok);
  if (noSuffix) out.add(noSuffix);
  if (noPrefix && noSuffix) {
    const both = stripOneSuffix(noPrefix);
    if (both && both.length >= MIN_DOUBLE_STRIP_LEN) out.add(both);
  }
  return [...out];
}

/**
 * Backwards-compatible single-stem accessor. Returns the most conservative
 * non-destructive stem (suffix-stripped when available, otherwise the token
 * itself) and never a residue shorter than MIN_VARIANT_LEN.
 */
export function stemHebrew(tokenRaw: string): string | null {
  const variants = hebrewVariants(tokenRaw);
  if (variants.length === 0) return null;
  const tok = variants[0];
  const suffixStripped = stripOneSuffix(tok);
  return suffixStripped ?? (tok.length >= 3 ? tok : null);
}

export function stemSet(text: string): string[] {
  const out = new Set<string>();
  for (const tok of normalize(text).split(" ")) {
    if (tok.length < 3 || META_TOKENS.has(tok)) continue;
    for (const v of hebrewVariants(tok)) out.add(v);
  }
  return [...out];
}

function stemsIntersect(qStems: string[], sStems: string[]): boolean {
  const set = new Set(sStems);
  for (const q of qStems) {
    if (set.has(q)) return true;
    if (q.length >= 5 && sStems.some((s) => s.length >= 5 && (s.includes(q) || q.includes(s)))) {
      return true;
    }
  }
  return false;
}


function isGoverningStatuteLike(s: DrafterInputSource, opts?: { allowThinText?: boolean }): boolean {
  const t = String(s.source_type || "").toLowerCase();
  const citable = String(s.citable_as || "");
  const typeOk = citable === "statute" || STATUTE_TYPES.has(t);
  if (!typeOk) return false;
  if (citable === "not_citable") return false;
  const tier = String(s.authority_tier || "unknown");
  if (tier !== "unknown" && !PRIMARY_TIERS.has(tier)) return false;
  const usability = String(s.text_usability || "unknown");
  if (usability === "listing_page") return false;
  if (s.authority_tier === "index_or_listing" || s.authority_tier === "non_authority") return false;
  if (usability !== "unknown" && !USABLE_TEXT.has(usability)) {
    // Thin (metadata_only) official statutes/regulations are accepted only
    // where the caller explicitly opts in (practical_steps).
    return opts?.allowThinText === true && usability === "metadata_only";
  }
  return true;
}

function isThinText(s: DrafterInputSource): boolean {
  return String(s.text_usability || "unknown") === "metadata_only";
}

function isRegulation(s: DrafterInputSource): boolean {
  const t = String(s.source_type || "").toLowerCase();
  return t === "regulation" || REGULATION_TITLE_RE.test(String(s.title || ""));
}

function isUsableJudgment(s: DrafterInputSource): boolean {
  const t = String(s.source_type || "").toLowerCase();
  const citable = String(s.citable_as || "");
  const looksJudgment = citable === "judgment" || CASE_TYPES.has(t) || s.is_judgment_document === true;
  if (!looksJudgment) return false;
  if (citable === "not_citable") return false;
  const tier = String(s.authority_tier || "unknown");
  if (tier === "index_or_listing" || tier === "non_authority") return false;
  const usability = String(s.text_usability || "unknown");
  if (usability === "metadata_only" || usability === "listing_page") return false;
  return true;
}

export function classifySufficiencyCategory(
  shape: string | undefined,
  question: string,
): SufficiencyCategory {
  if (shape === "analysis" || shape === "comparison") {
    return /פסיק|הלכ|בתי המשפט|בית המשפט|פסקי דין|פסק דין/.test(question)
      ? "case_law_synthesis"
      : "doctrine";
  }
  if (shape === "list") return "practical_list";
  return "not_applicable";
}

function resolveProfile(
  researchMode: string | null | undefined,
  category: SufficiencyCategory,
  statuteSectionRequested: boolean,
): SufficiencyProfile {
  switch (researchMode) {
    case "case_law_synthesis":
      return "case_law_synthesis";
    case "statute_section_definition":
      return "statute_section_definition";
    case "practical_steps":
      return "practical_steps";
    case "doctrine_explanation":
      if (category === "case_law_synthesis") return "case_law_synthesis";
      // F4 — mode-consistent statute expectations: a question that names a
      // specific statute section gets the statute-section sufficiency
      // contract regardless of whether the planner labelled it
      // `doctrine_explanation` or `statute_section_definition`. This changes
      // only *sufficiency expectations*; the direct section-text requirement
      // for definitions/quotes lives in the anchor guard and is untouched.
      return statuteSectionRequested ? "statute_section_definition" : "statutory_institution";
    default:
      break;
  }
  if (category === "case_law_synthesis") return "case_law_synthesis";
  if (category === "practical_list") return "practical_steps";
  if (statuteSectionRequested) return "statute_section_definition";
  if (category === "doctrine") return "statutory_institution";
  return "not_applicable";
}


export function assessSourceSufficiency(args: {
  question: string;
  shape: string | undefined;
  sources: DrafterInputSource[];
  /** Statute-section / docket anchors that were required but not satisfied. */
  hasMissingAnchor?: boolean;
  /** candidate_ids that satisfied a required anchor (statute/docket). */
  requiredAnchorCandidateIds?: Set<string>;
  /** Research mode from stages/researchMode.ts (drives the sufficiency profile). */
  researchMode?: string | null;
  /** five_mode_source_depth_policy_v1 depth mode (drives the doctrinal fallback). */
  depthMode?: string | null;
}): SufficiencyAssessment {
  const { question, shape, sources } = args;
  const category = classifySufficiencyCategory(shape, question);
  const phrases = extractTopicPhrases(question);
  const tokens = contentTokens(question);
  const anchorIds = args.requiredAnchorCandidateIds ?? new Set<string>();
  const statuteSectionRequested = detectStatuteSections(question).length > 0;
  const profile = resolveProfile(args.researchMode, category, statuteSectionRequested);

  const topical = sources.filter((s) => isTopical(s, phrases));
  const bodyOnlyTopical = sources.filter((s) => isBodyOnlyTopical(s, phrases));

  const topicalAuthority = topical.filter((s) => {
    const t = String(s.source_type || "").toLowerCase();
    const typeOk = CASE_TYPES.has(t) || STATUTE_TYPES.has(t) || DOCTRINAL_TYPES.has(t);
    if (!typeOk) return false;
    // Authority-tier adequacy: topicality alone is not enough. Listing /
    // pagination / non-citable pages never count as authority.
    if (s.citable_as === "not_citable") return false;
    if (s.authority_tier === "index_or_listing" || s.authority_tier === "non_authority") {
      return false;
    }
    if (s.text_usability === "listing_page") return false;
    return true;
  });

  // Morphology-tolerant domain matching (domain buckets only).
  const qStems = stemSet(question);
  let morphologyDomainMatch = false;
  const sourceStemsSeen = new Set<string>();
  const domainMatch = (s: DrafterInputSource): boolean => {
    if (isDomainMatch(s, phrases, tokens)) return true;
    const sStems = stemSet(topicalHaystack(s));
    for (const st of sStems.slice(0, 40)) sourceStemsSeen.add(st);

    if (stemsIntersect(qStems, sStems)) {
      morphologyDomainMatch = true;
      return true;
    }
    return false;
  };

  // Authority-type buckets (domain-matched, not doctrine-phrase-matched).
  const isPracticalSteps = profile === "practical_steps";
  const domainStatutesAll = sources.filter(
    (s) => isGoverningStatuteLike(s, { allowThinText: isPracticalSteps }) && domainMatch(s),
  );
  const domainStatutes = domainStatutesAll.filter((s) => !isThinText(s));
  const thinDomainStatutes = domainStatutesAll.filter(isThinText);
  const governingRegulations = domainStatutes.filter(isRegulation);
  const governingStatutes = domainStatutes.filter((s) => !isRegulation(s));
  const thinGoverningRegulations = thinDomainStatutes.filter(isRegulation);
  const thinGoverningStatutes = thinDomainStatutes.filter((s) => !isRegulation(s));
  const usableJudgments = sources.filter((s) => isUsableJudgment(s) && domainMatch(s));

  const satisfiedAnchor = sources.some((s) => anchorIds.has(s.candidate_id));

  const base = {
    shape: shape ?? "unknown",
    category,
    topic_phrases: phrases,
    topical_refs: topical.map((s) => s.ref),
    topical_authority_refs: topicalAuthority.map((s) => s.ref),
    found_titles: sources.slice(0, 5).map((s) => s.title),
    sufficiency_profile: profile,
    governing_statute_refs: governingStatutes.map((s) => s.ref),
    governing_regulation_refs: governingRegulations.map((s) => s.ref),
    usable_judgment_refs: usableJudgments.map((s) => s.ref),
    thin_governing_statute_refs: thinGoverningStatutes.map((s) => s.ref),
    thin_governing_regulation_refs: thinGoverningRegulations.map((s) => s.ref),
    normalized_question_tokens: qStems,
    normalized_source_tokens: [...sourceStemsSeen].slice(0, 60),
    body_topical_refs: bodyOnlyTopical.map((s) => s.ref),
    body_text_topical_match: bodyOnlyTopical.length > 0,
    statute_section_requested: statuteSectionRequested,
  };


  const caseLawRequired = profile === "case_law_synthesis";

  const basisFor = (): SufficiencyAuthorityBasis => {
    if (usableJudgments.length > 0) return "usable_judgment";
    if (governingStatutes.length > 0 && governingRegulations.length > 0) {
      return "statute_plus_regulation";
    }
    if (governingStatutes.length > 0) return "governing_statute";
    if (governingRegulations.length > 0) return "governing_regulation";
    if (thinGoverningStatutes.length > 0) return "governing_statute";
    if (thinGoverningRegulations.length > 0) return "governing_regulation";
    return "insufficient";
  };

  // ── substance_based_doctrinal_sufficiency_v1 — doctrinal fallback inputs ──
  const doctrinalEligibility = sources.map((s) => ({ s, e: assessDoctrinalEligibility(s) }));
  const eligibleSecondaries = doctrinalEligibility
    .filter(({ s, e }) => e.eligible && domainMatch(s))
    .map(({ s }) => s);
  const doctrinalIneligibleReasons: Record<string, number> = {};
  for (const { e } of doctrinalEligibility) {
    if (e.eligible) continue;
    doctrinalIneligibleReasons[e.reason] = (doctrinalIneligibleReasons[e.reason] ?? 0) + 1;
  }
  const depthMode = args.depthMode ?? null;
  const broadMode = depthMode === "broad_research" || depthMode === "academic_research" ||
    args.researchMode === "broad_doctrine" || args.researchMode === "academic_research";

  /**
   * The fallback exists to stop *over-refusal*, not to force citations: it
   * fires only when acquired, validated material can actually carry a limited
   * doctrinal explanation. With no eligible secondary it never fires, and the
   * refusal stands.
   */
  const doctrinalFallback = (): { combination: "A" | "B" | "C"; reason: string } | null => {
    if (!broadMode) return null;
    const statutes = governingStatutes.length + governingRegulations.length;
    const secondaries = eligibleSecondaries.length;
    const judgments = usableJudgments.length;
    if (judgments >= 1 && (statutes >= 1 || secondaries >= 1)) {
      return { combination: "C", reason: "judgment_plus_supporting_material" };
    }
    if (statutes >= 1 && secondaries >= 1) {
      return { combination: "A", reason: "statute_plus_doctrinal_secondary" };
    }
    if (secondaries >= 2) {
      return { combination: "B", reason: "two_doctrinal_secondaries" };
    }
    return null;
  };

  const finish = (
    applied: boolean,
    sufficient: boolean,
    reason: string,
    thin_source: boolean,
    opts?: {
      basis?: SufficiencyAuthorityBasis;
      thinAuthorityPassed?: boolean;
      exactAmountsAllowed?: boolean;
    },
  ): SufficiencyAssessment => {
    // Doctrinal fallback: convert a would-be refusal in broad/academic modes
    // into a limited doctrinal answer when acquired material supports one.
    let limitedDoctrinal = false;
    let fallbackCombination: "A" | "B" | "C" | null = null;
    let fallbackDeclined: string | null = null;
    if (applied && !sufficient) {
      const fb = doctrinalFallback();
      if (fb) {
        limitedDoctrinal = true;
        fallbackCombination = fb.combination;
        sufficient = true;
        reason = `limited_doctrinal_fallback_${fb.combination}:${fb.reason}(was:${reason})`;
      } else {
        fallbackDeclined = broadMode
          ? "no_eligible_acquired_doctrinal_support"
          : "depth_mode_not_broad";
      }
    }
    const basis = opts?.basis ??
      (limitedDoctrinal
        ? (usableJudgments.length > 0
          ? "usable_judgment"
          : governingStatutes.length + governingRegulations.length > 0
          ? basisFor()
          : "doctrinal_secondary")
        : sufficient
        ? basisFor()
        : "insufficient");
    const statuteOnly = sufficient && !limitedDoctrinal && basis !== "usable_judgment" &&
      basis !== "insufficient";
    const thinAuthorityPassed = opts?.thinAuthorityPassed === true;
    const exactAmountsAllowed = opts?.exactAmountsAllowed ??
      (sufficient && !thinAuthorityPassed);
    return {
      ...base,
      applied,
      sufficient,
      reason,
      thin_source: thin_source || thinAuthorityPassed,
      authority_type_sufficiency_passed: sufficient,
      sufficiency_authority_basis: basis,
      statute_only_answer: statuteOnly,
      case_law_required: caseLawRequired,
      case_law_missing_but_not_required:
        !caseLawRequired && usableJudgments.length === 0 && statuteOnly,
      morphology_domain_match: morphologyDomainMatch,
      practical_steps_thin_authority_passed: thinAuthorityPassed,
      exact_amounts_allowed: limitedDoctrinal ? false : exactAmountsAllowed,
      depth_mode: depthMode,
      doctrinal_secondary_refs: eligibleSecondaries.map((s2) => s2.ref),
      doctrinal_ineligible_reasons: doctrinalIneligibleReasons,
      limited_doctrinal_answer: limitedDoctrinal,
      doctrinal_fallback_combination: fallbackCombination,
      doctrinal_fallback_declined_reason: fallbackDeclined,
    };
  };

  // Thin-source advisory (never a refusal): the pack is on-topic but the
  // supporting text is short.
  const leadTextLen = Math.max(
    0,
    ...topical.map((s) => (s.snippet ?? "").length),
    ...domainStatutes.map((s) => (s.snippet ?? "").length),
    0,
  );
  const thin_source = (topical.length > 0 || domainStatutes.length > 0) && leadTextLen < 300;

  if (category === "not_applicable" && profile === "not_applicable") {
    return finish(false, true, "shape_not_gated", false);
  }

  // A satisfied required anchor (exact docket / statute section) is always
  // sufficient grounding — the anchor pipeline already proved directness.
  if (satisfiedAnchor) {
    return finish(true, true, "required_anchor_satisfied", thin_source);
  }

  // ── 1. Case-law synthesis: strict, judgments only ───────────────────────
  if (profile === "case_law_synthesis") {
    // Handoff fix: an acquired judgment body is truncated for the drafter, so
    // the doctrine phrase may not appear in the visible snippet even though
    // the verifier already graded the judgment `direct` for this question.
    // A domain-matched usable judgment with a *direct* verifier verdict is
    // therefore accepted as topical grounding. No loosening otherwise:
    // partial/tangential judgments still require a phrase-level topical hit.
    const directJudgments = usableJudgments.filter((s) => s.best_support === "direct");
    const ok = usableJudgments.length >= 1 &&
      (topical.length >= 1 || directJudgments.length >= 1);
    return finish(
      true,
      ok,
      ok
        ? "case_law_synthesis_supported"
        : usableJudgments.length === 0
        ? "no_usable_judgment_authority"
        : "no_topical_source",
      thin_source,
      ok ? { basis: "usable_judgment" } : { basis: "insufficient" },
    );
  }


  // ── 3. Statute-section definition: governing statute suffices ───────────
  if (profile === "statute_section_definition") {
    const ok = domainStatutes.length >= 1;
    return finish(
      true,
      ok,
      ok ? "governing_statute_section_available" : "no_governing_statute_text",
      thin_source,
    );
  }

  // ── 4. Practical steps: statute/regulation pack suffices ────────────────
  if (profile === "practical_steps") {
    const wantsProcedure = PROCEDURE_FEE_CUE.test(question);
    const hasProcedural = governingRegulations.length >= 1;
    const hasDomainAuthority = domainStatutes.length >= 1 || usableJudgments.length >= 1;
    const ok = hasDomainAuthority && (!wantsProcedure || hasProcedural || domainStatutes.length >= 2);
    if (ok) {
      return finish(true, true, "statutory_procedural_pack_present", thin_source);
    }
    // Thin fallback: official/primary on-topic legislation or regulations that
    // survived integrity but carry only metadata text. They license a bounded
    // practical answer — never exact amounts, deadlines or section text.
    const thinAuthorityCount = thinGoverningStatutes.length + thinGoverningRegulations.length;
    if (thinAuthorityCount >= 1) {
      return finish(true, true, "thin_governing_statute_pack_present", true, {
        thinAuthorityPassed: true,
        exactAmountsAllowed: false,
      });
    }
    return finish(
      true,
      false,
      hasDomainAuthority ? "no_procedural_or_fee_source" : "generic_procedure_only",
      thin_source,
    );
  }

  // ── 5. Statutory institution / doctrine anchored in statute ─────────────
  const ok = domainStatutes.length >= 1 || usableJudgments.length >= 1 ||
    topicalAuthority.length >= 1;
  return finish(
    true,
    ok,
    ok ? "doctrinal_anchor_present" : "no_statutory_caselaw_or_doctrinal_anchor",
    thin_source,
    ok && domainStatutes.length === 0 && usableJudgments.length === 0
      ? { basis: "insufficient" }
      : undefined,
  );
}
