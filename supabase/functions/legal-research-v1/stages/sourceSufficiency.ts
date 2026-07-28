/**
 * Deterministic source-sufficiency gate.
 *
 * Purpose: when the surviving source pack cannot legitimately support the
 * *type* of question asked (case-law synthesis, doctrine explanation,
 * practical legal list), the pipeline must not draft a normal answer built on
 * analogies from an unrelated legal domain. Instead the drafter emits a
 * limited-source answer.
 *
 * This stage adds no LLM call: it is a pure lexical/type computation over the
 * sources that already survived the verifier.
 *
 * Out of scope by design (handled by existing deterministic branches):
 *   - quote            → canonical-quote registry / quote refusal
 *   - definition       → statute-section required-source guard
 *   - case_holding     → missing-docket limitation
 *   - timeline         → unchanged
 */

import type { DrafterInputSource } from "./drafter.ts";

export type SufficiencyCategory =
  | "case_law_synthesis"
  | "doctrine"
  | "practical_list"
  | "not_applicable";

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


function isTopical(s: DrafterInputSource, phrases: string[]): boolean {
  const hay = normalize(`${s.title} ${s.snippet ?? ""}`);
  return phrases.some((p) => phraseMatches(p, hay));
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

export function assessSourceSufficiency(args: {
  question: string;
  shape: string | undefined;
  sources: DrafterInputSource[];
  /** Statute-section / docket anchors that were required but not satisfied. */
  hasMissingAnchor?: boolean;
  /** candidate_ids that satisfied a required anchor (statute/docket). */
  requiredAnchorCandidateIds?: Set<string>;
}): SufficiencyAssessment {
  const { question, shape, sources } = args;
  const category = classifySufficiencyCategory(shape, question);
  const phrases = extractTopicPhrases(question);
  const anchorIds = args.requiredAnchorCandidateIds ?? new Set<string>();

  const topical = sources.filter((s) => isTopical(s, phrases));
  const topicalAuthority = topical.filter((s) => {
    const t = String(s.source_type || "").toLowerCase();
    return CASE_TYPES.has(t) || STATUTE_TYPES.has(t) || DOCTRINAL_TYPES.has(t);
  });
  const satisfiedAnchor = sources.some((s) => anchorIds.has(s.candidate_id));

  const base = {
    shape: shape ?? "unknown",
    category,
    topic_phrases: phrases,
    topical_refs: topical.map((s) => s.ref),
    topical_authority_refs: topicalAuthority.map((s) => s.ref),
    found_titles: sources.slice(0, 5).map((s) => s.title),
  };

  // Thin-source advisory (never a refusal): the pack is on-topic but the
  // supporting text is short.
  const leadTextLen = Math.max(
    0,
    ...topical.map((s) => (s.snippet ?? "").length),
    ...(topical.length === 0 ? [0] : []),
  );
  const thin_source = topical.length > 0 && leadTextLen < 300;

  if (category === "not_applicable") {
    return {
      ...base,
      applied: false,
      sufficient: true,
      reason: "shape_not_gated",
      thin_source: false,
    };
  }

  // A satisfied required anchor (exact docket / statute section) is always
  // sufficient grounding — the anchor pipeline already proved directness.
  if (satisfiedAnchor) {
    return { ...base, applied: true, sufficient: true, reason: "required_anchor_satisfied", thin_source };
  }

  if (category === "case_law_synthesis") {
    const ok = topical.length >= 2 && topicalAuthority.length >= 1;
    return {
      ...base,
      applied: true,
      sufficient: ok,
      reason: ok
        ? "case_law_synthesis_supported"
        : topical.length === 0
        ? "no_topical_source"
        : topicalAuthority.length === 0
        ? "no_topical_authority"
        : "single_topical_source",
      thin_source,
    };
  }

  if (category === "doctrine") {
    const ok = topicalAuthority.length >= 1;
    return {
      ...base,
      applied: true,
      sufficient: ok,
      reason: ok ? "doctrinal_anchor_present" : "no_statutory_caselaw_or_doctrinal_anchor",
      thin_source,
    };
  }

  // practical_list — at least one domain-specific source, not only generic
  // procedure boilerplate.
  const ok = topical.length >= 1;
  return {
    ...base,
    applied: true,
    sufficient: ok,
    reason: ok ? "domain_specific_source_present" : "generic_procedure_only",
    thin_source,
  };
}
