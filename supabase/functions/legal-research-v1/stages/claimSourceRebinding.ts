/**
 * claim_source_rebinding_v1 — substance-based (block ↔ source) binding.
 *
 * Problem this fixes: `claimSourceMatch` Rule A dropped a source whenever the
 * drafter's block `claim_id` string differed from the retrieval-time
 * `claim_id` the verifier judged the source against. Those two id-spaces
 * legitimately diverge (reworded claims, merged claims, facets, blocks that
 * compose across claims), so fully acquired, verifier-`direct` sources were
 * lost at the last gate — 4–12 refs per run in the candidate-funnel
 * diagnostics.
 *
 * This module answers the substantive question instead: *does this source
 * actually support the proposition in this block?* — deterministically, with
 * no LLM call, using evidence already present in telemetry.
 *
 * Binding hierarchy (strongest first):
 *   exact       — block claim_id ∈ source.verified_claim_ids
 *   facet       — parent/child facet relation between block and source ids
 *   topical     — legally meaningful terms shared by block text and the
 *                 verifier's supported_points for this source
 *   area_direct — conservative fallback: same legal area + direct/partial
 *                 verdict + acquired body. Allowed ONLY for broad
 *                 doctrinal/background blocks; never for court holdings,
 *                 statutory text, specific applications or narrow factual
 *                 propositions.
 *   unbound     — drop (this is the only case Rule A may still reject)
 *
 * The module never upgrades authority: a topically rebound secondary source is
 * still a secondary source and must still clear Rules B–E in claimSourceMatch.
 */

import type { DrafterInputSource } from "./drafter.ts";
import type { ClaimSupportCategory, SourceSupportProfile } from "./claimSupportCategory.ts";

export type BindingKind = "exact" | "facet" | "topical" | "area_direct" | "unbound";

export const BINDING_RANK: Record<BindingKind, number> = {
  exact: 4,
  facet: 3,
  topical: 2,
  area_direct: 1,
  unbound: 0,
};

export interface RebindingDecision {
  ref: string;
  block_index: number;
  binding: BindingKind;
  reason: string;
  /** number of legally meaningful shared terms (topical binding only) */
  score?: number;
  matched_terms?: string[];
}

export interface RebindingSummary {
  applied: boolean;
  bound_exact: number;
  bound_facet: number;
  bound_topical: number;
  bound_area_direct: number;
  unbound: number;
  /** refs kept that would have been dropped by the old string-identity Rule A */
  rebound_ref_count: number;
  claim_mismatch_drops_before: number;
  claim_mismatch_drops_after: number;
  /** refs removed by the per-block cap (footnote-inflation control) */
  capped_ref_count: number;
  decisions: RebindingDecision[];
}

export function emptyRebindingSummary(): RebindingSummary {
  return {
    applied: false,
    bound_exact: 0,
    bound_facet: 0,
    bound_topical: 0,
    bound_area_direct: 0,
    unbound: 0,
    rebound_ref_count: 0,
    claim_mismatch_drops_before: 0,
    claim_mismatch_drops_after: 0,
    capped_ref_count: 0,
    decisions: [],
  };
}

// ─── Hebrew-tolerant term extraction ────────────────────────────────────────

/** Hebrew clitic prefixes that attach to nouns (ו ה ב ל כ מ ש). */
const PREFIX_RE = /^(?:ו?ש?[הבלכמ]|ו|ה|ש)/;

/** Generic legal vocabulary — shared occurrences of these prove nothing. */
const GENERIC_TERMS = new Set([
  "משפט", "משפטי", "משפטית", "חוק", "חוקי", "דין", "הדין", "בית", "משפטה",
  "פסק", "פסיקה", "פסקדין", "הלכה", "סעיף", "תקנה", "כלל", "כללי", "עקרון",
  "עקרונות", "זכות", "זכויות", "חובה", "חובות", "טענה", "טענות", "קביעה",
  "מקור", "מקורות", "מדינה", "ישראל", "ישראלי", "עניין", "נושא", "מקרה",
  "רשות", "רשויות", "ערעור", "עתירה", "בקשה", "החלטה", "נימוק", "מסגרת",
  "תנאי", "תנאים", "מבחן", "מבחנים", "היקף", "תחולה", "פרשנות", "ניתוח",
  "שאלה", "תשובה", "כאשר", "לפיכך", "בהתאם", "בנוגע", "לעניין", "במסגרת",
  "אולם", "בנוסף", "כלומר", "יותר", "פחות", "בלבד", "לאחר", "לפני", "מתוך",
]);

/** Identifier-like tokens (dockets, statute years, sections) are high-signal. */
const IDENTIFIER_RE = /\b\d{1,5}\/\d{2,4}\b|\b(?:תש[א-ת]?["׳']?[א-ת]{1,2})\b|\b\d{4}\b/g;

function stripPunct(s: string): string {
  return s
    .replace(/[\u0591-\u05C7]/g, "") // niqqud / cantillation
    .replace(/["'`״׳()[\]{}.,;:!?–—\-\u2000-\u206F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Hebrew suffixes that mark plural / feminine / construct-state variation of
 * the same lemma (חוקים ↔ חוק, סמכויות ↔ סמכות). Stripped only when a
 * reasonable stem remains, so short words are never mangled.
 */
const SUFFIX_RE = /(?:יות|ויות|ותיה|ותיו|ותינו|יהם|יהן|ים|ות|יה|יו|נו|כם|כן|הם|הן)$/;

function normalizeToken(t: string): string {
  let x = t;
  if (x.length > 4) {
    const stripped = x.replace(PREFIX_RE, "");
    if (stripped.length >= 3) x = stripped;
  }
  // final-letter normalization (ך ם ן ף ץ → כ מ נ פ צ)
  x = x
    .replace(/ך/g, "כ").replace(/ם/g, "מ").replace(/ן/g, "נ")
    .replace(/ף/g, "פ").replace(/ץ/g, "צ");
  // plural / construct / possessive suffix normalization
  if (x.length > 4) {
    const stripped = x.replace(SUFFIX_RE, "");
    if (stripped.length >= 3) x = stripped;
  }
  return x;
}

/** Loose stem used only as a secondary matching key (never for filtering). */
export function looseStem(t: string): string {
  if (t.startsWith("#")) return t;
  return t.length > 5 ? t.slice(0, 5) : t;
}

/** Legally meaningful terms: content words + identifiers, generics removed. */
const GENERIC_NORM = new Set(
  [...GENERIC_TERMS].flatMap((g) => [normalizeToken(g), looseStem(normalizeToken(g))]),
);

export function meaningfulTerms(text: string): Set<string> {
  const out = new Set<string>();
  if (!text) return out;
  for (const m of text.matchAll(IDENTIFIER_RE)) out.add(`#${m[0]}`);
  for (const raw of stripPunct(text).split(" ")) {
    if (raw.length < 4) continue;
    if (/^\d+$/.test(raw)) continue;
    const t = normalizeToken(raw);
    if (t.length < 3) continue;
    if (GENERIC_TERMS.has(t) || GENERIC_NORM.has(t) || GENERIC_NORM.has(looseStem(t))) continue;
    out.add(t);
  }
  return out;
}

/**
 * Shared meaningful terms between two texts, tolerant to Hebrew morphology:
 * exact normalized match first, then a loose stem match.
 */
export function sharedMeaningfulTerms(a: Set<string>, b: Set<string>): string[] {
  const shared: string[] = [];
  const bStems = new Map<string, string>();
  for (const t of b) bStems.set(looseStem(t), t);
  for (const t of a) {
    if (b.has(t)) shared.push(t);
    else {
      const hit = bStems.get(looseStem(t));
      if (hit) shared.push(t);
    }
  }
  return shared;
}

/** Identifier terms carry enough signal alone. */
function isIdentifier(t: string): boolean {
  return t.startsWith("#");
}


// ─── Binding evaluation ─────────────────────────────────────────────────────

/** facet ids look like `<claim_id>::f<N>`. */
function parentOfFacet(id: string): string | null {
  const i = id.indexOf("::");
  return i > 0 ? id.slice(0, i) : null;
}

export interface RebindBlockInput {
  block_index: number;
  claim_id: string | null;
  facet_id: string | null;
  /** effective proposition type (already defaulted by the caller) */
  proposition_type: string;
  claim_category: ClaimSupportCategory;
  legal_area: string | null;
  text: string;
  /** academic_utilization_stabilization_v1 — academic_writing runs only */
  academic_mode?: boolean;
}


export interface RebindSourceInput {
  ref: string;
  verified_claim_ids: string[];
  facet_ids: string[];
  supported_points: string[];
  legal_area: string | null;
  verifier_verdict: string;
  body_acquired: boolean;
  /** academic_utilization_stabilization_v1 */
  title?: string;
  snippet?: string;
  /** academicTopicalFit verdict against question + block text */
  topical_fit_passed?: boolean;
  /** doctrinal/scholarly item (never a judgment or statute) */
  is_secondary_academic?: boolean;
}


/** Categories/propositions broad enough for the area_direct fallback. */
function areaFallbackAllowed(b: RebindBlockInput): boolean {
  const broadCategory = b.claim_category === "doctrinal_synthesis" ||
    b.claim_category === "scholarly_commentary" ||
    b.claim_category === "contextual_background" ||
    // academic_citation_authority_alignment_v1 — academic framing/background
    // blocks are broad in the same sense.
    b.claim_category === "doctrinal_background" ||
    b.claim_category === "academic_framing" ||
    b.claim_category === "theoretical_explanation" ||
    b.claim_category === "literature_synthesis" ||
    b.claim_category === "critique_or_counterposition" ||
    b.claim_category === "methodological_framing";
  const broadProposition = b.proposition_type === "background" ||
    b.proposition_type === "practical_guidance";
  return broadCategory && broadProposition;
}

export function evaluateBinding(
  block: RebindBlockInput,
  source: RebindSourceInput,
): RebindingDecision {
  const base = { ref: source.ref, block_index: block.block_index };
  const blockClaim = block.claim_id ??
    (block.facet_id ? parentOfFacet(block.facet_id) : null);

  // No verifier binding recorded at all → nothing to contradict; treat as exact
  // (identical to pre-existing Rule A behaviour).
  if (source.verified_claim_ids.length === 0 || !blockClaim) {
    return { ...base, binding: "exact", reason: "no_verifier_claim_binding" };
  }

  if (source.verified_claim_ids.includes(blockClaim)) {
    return { ...base, binding: "exact", reason: "claim_id_match" };
  }

  // facet relation, in either direction
  if (block.facet_id && source.facet_ids.includes(block.facet_id)) {
    return { ...base, binding: "facet", reason: "facet_id_match" };
  }
  const sourceParents = source.facet_ids
    .map(parentOfFacet)
    .filter((x): x is string => !!x);
  if (
    sourceParents.includes(blockClaim) ||
    (block.facet_id && source.verified_claim_ids.includes(parentOfFacet(block.facet_id) ?? ""))
  ) {
    return { ...base, binding: "facet", reason: "facet_parent_relation" };
  }

  // topical: legally meaningful term overlap with the verifier's own
  // supported_points for this source.
  const blockTerms = meaningfulTerms(block.text);
  const points = source.supported_points.join(" ");
  if (points.trim()) {
    const pointTerms = meaningfulTerms(points);
    const shared = sharedMeaningfulTerms(blockTerms, pointTerms);
    const hasIdentifier = shared.some(isIdentifier);
    if (hasIdentifier || shared.length >= 2) {
      return {
        ...base,
        binding: "topical",
        reason: hasIdentifier ? "shared_identifier_term" : "shared_meaningful_terms",
        score: shared.length,
        matched_terms: shared.slice(0, 8),
      };
    }
  }

  // academic_utilization_stabilization_v1 — title/subject binding. Stubs and
  // freshly acquired secondaries often carry no supported_points at all, so
  // fall back to the source's own bibliographic subject matter. Restricted to
  // broad academic blocks: never a holding, statute or specific application.
  if (areaFallbackAllowed(block)) {
    const subject = `${source.title ?? ""} ${source.snippet ?? ""}`;
    if (subject.trim()) {
      const subjectTerms = meaningfulTerms(subject);
      const shared = sharedMeaningfulTerms(blockTerms, subjectTerms);
      if (shared.some(isIdentifier) || shared.length >= 2) {
        return {
          ...base,
          binding: "topical",
          reason: "shared_title_subject_terms",
          score: shared.length,
          matched_terms: shared.slice(0, 8),
        };
      }
    }
  }

  // academic_utilization_stabilization_v1 — an on-topic acquired secondary that
  // the verifier judged `direct` may carry a broad academic block even when the
  // claim-id spaces diverged entirely.
  if (
    block.academic_mode && areaFallbackAllowed(block) &&
    source.is_secondary_academic && source.topical_fit_passed &&
    source.verifier_verdict === "direct" && source.body_acquired
  ) {
    return { ...base, binding: "topical", reason: "academic_direct_subject_fit" };
  }

  // conservative area fallback
  if (
    areaFallbackAllowed(block) &&
    block.legal_area && source.legal_area && block.legal_area === source.legal_area &&
    (source.verifier_verdict === "direct" || source.verifier_verdict === "partial") &&
    source.body_acquired
  ) {
    return { ...base, binding: "area_direct", reason: "same_area_direct_acquired_body" };
  }


  return { ...base, binding: "unbound", reason: "no_substantive_binding" };
}

// ─── Per-block selection (strength + authority + cap) ───────────────────────

function authorityRank(p: SourceSupportProfile | undefined): number {
  if (!p) return 0;
  if (p.judgment_authority) return 4;
  if (p.statutory_authority) return 4;
  if (p.doctrinal_authority) return 2;
  if (p.background_only) return 1;
  return 0;
}

function verdictRank(v: string | undefined): number {
  return v === "direct" ? 2 : v === "partial" ? 1 : 0;
}

export const DEFAULT_REF_CAP = 3;
export const SYNTHESIS_REF_CAP = 5;

/**
 * Order the kept refs by binding strength → authority → verdict, and cap the
 * count so a block cannot inflate its footnotes with mechanically rebound
 * refs. Genuine multi-source synthesis blocks get a wider cap.
 */
export function selectBlockRefs(
  kept: string[],
  ctx: {
    bindings: Map<string, BindingKind>;
    profiles: Map<string, SourceSupportProfile>;
    sources: Map<string, DrafterInputSource>;
    claim_category: ClaimSupportCategory;
  },
): { refs: string[]; dropped: string[] } {
  if (kept.length <= 1) return { refs: kept, dropped: [] };
  const ordered = [...kept].sort((a, b) => {
    const ba = BINDING_RANK[ctx.bindings.get(a) ?? "exact"];
    const bb = BINDING_RANK[ctx.bindings.get(b) ?? "exact"];
    if (ba !== bb) return bb - ba;
    const aa = authorityRank(ctx.profiles.get(a));
    const ab = authorityRank(ctx.profiles.get(b));
    if (aa !== ab) return ab - aa;
    const va = verdictRank(ctx.sources.get(a)?.verifier_verdict);
    const vb = verdictRank(ctx.sources.get(b)?.verifier_verdict);
    if (va !== vb) return vb - va;
    return kept.indexOf(a) - kept.indexOf(b);
  });

  const strongOnly = ordered.every((r) => {
    const k = ctx.bindings.get(r) ?? "exact";
    return k === "exact" || k === "facet";
  });
  const cap = ctx.claim_category === "doctrinal_synthesis" && strongOnly
    ? SYNTHESIS_REF_CAP
    : DEFAULT_REF_CAP;

  return { refs: ordered.slice(0, cap), dropped: ordered.slice(cap) };
}
