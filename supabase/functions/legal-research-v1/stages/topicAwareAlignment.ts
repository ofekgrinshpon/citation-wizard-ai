/**
 * topic_aware_source_role_and_claim_alignment_v1
 *
 * Precision-of-use module. It does NOT retrieve, acquire, verify, or admit any
 * source, and it never adds a source that is not already in the drafter pack.
 * It only makes three deterministic decisions sharper:
 *
 *   1. source-type ↔ source-role sanity (a judgment is never "scholarship");
 *   2. topic / legal-area fit for judgment citations;
 *   3. block-level claim→source selection, ranking and compound-footnote
 *      hygiene, applied to an already validated + CSM-filtered draft.
 *
 * Everything here can only remove or reorder refs, or promote a ref that the
 * same draft already uses on a compatible block. Source integrity, judgment
 * identity, metadata-only rules, found-only rules, CSM and the footnote
 * invariants are untouched.
 */

import type { DrafterInputSource } from "./drafter.ts";
import type { StructuredBlock, StructuredDraft } from "./structuredValidation.ts";
import { deriveClaimCategory } from "./claimSupportCategory.ts";
import { academicTopicalFit } from "./academicAuthorityAlignment.ts";

export const TOPIC_AWARE_ALIGNMENT_VERSION = "v1.0";

// ── source classes ──────────────────────────────────────────────────────────

export type SourceClass = "judgment" | "statute" | "academic" | "institutional" | "other";

const JUDGMENT_TYPE_RE = /(judgment|caselaw|case_law|verdict|psak|pesika|court|ruling)/i;
const STATUTE_TYPE_RE = /(statute|israeli_law|legislation|takanot|regulation|law_book|basic_law)/i;
const ACADEMIC_TYPE_RE =
  /(journal_article|academic|faculty_pdf|working_paper|scholarship|article|thesis|book)/i;
const REPORT_TYPE_RE = /(government_report|policy_report|state_report|knesset|report)/i;

export function classifySource(s: DrafterInputSource): SourceClass {
  const citable = String(s.citable_as ?? "").toLowerCase();
  const type = String(s.source_type ?? "");
  const tier = String(s.authority_tier ?? "").toLowerCase();
  if (citable === "judgment" || s.is_judgment_document === true || JUDGMENT_TYPE_RE.test(type)) {
    return "judgment";
  }
  if (
    citable === "statute" || citable === "regulation" || tier === "statute_mirror" ||
    STATUTE_TYPE_RE.test(type)
  ) return "statute";
  if (citable === "scholarship" || ACADEMIC_TYPE_RE.test(type)) return "academic";
  if (citable === "commentary" || REPORT_TYPE_RE.test(type)) return "institutional";
  return "other";
}

const ALLOWED_ROLES: Record<SourceClass, string[]> = {
  judgment: [
    "binding_case_law",
    "persuasive_case_law",
    "judgment_anchor",
    "implementation_or_example_source",
    "doctrinal_application_source",
    "primary_legal_anchor",
    "primary_mirror",
  ],
  statute: [
    "statutory_anchor",
    "primary_statute",
    "primary_legal_anchor",
    "regulation",
  ],
  academic: [
    "scholarship",
    "doctrinal_background_source",
    "theoretical_normative_source",
    "critique_or_counterposition_source",
    "comparative_source",
  ],
  institutional: [
    "policy_or_institutional_source",
    "factual_report",
    "implementation_context_source",
  ],
  other: [],
};

const DEFAULT_ROLE: Record<SourceClass, string> = {
  judgment: "binding_case_law",
  statute: "primary_statute",
  academic: "scholarship",
  institutional: "policy_or_institutional_source",
  other: "",
};

export interface SourceRoleSanityRow {
  source_id: string;
  title: string;
  source_type: string;
  citable_as: string;
  original_role: string;
  final_role: string;
  changed: boolean;
  reason: string;
}

export interface SourceRoleSanityReport {
  version: string;
  checked: number;
  changed: number;
  rows: SourceRoleSanityRow[];
}

/**
 * Corrects incompatible roles in place (labels only) into a *safe* role for the
 * source class. A secondary source is never promoted into a primary role.
 */
export function applySourceRoleSanity(
  sources: DrafterInputSource[],
): SourceRoleSanityReport {
  const rows: SourceRoleSanityRow[] = [];
  let changed = 0;
  for (const s of sources) {
    const cls = classifySource(s);
    const original = String(s.role ?? "unknown");
    let final = original;
    let reason = "compatible";
    if (cls !== "other") {
      const allowed = ALLOWED_ROLES[cls];
      if (!allowed.includes(original)) {
        final = DEFAULT_ROLE[cls];
        reason = `role_incompatible_with_${cls}`;
        s.role = final;
        changed++;
      }
    } else {
      reason = "class_unknown_role_kept";
    }
    rows.push({
      source_id: s.ref,
      title: String(s.title ?? ""),
      source_type: String(s.source_type ?? ""),
      citable_as: String(s.citable_as ?? "unknown"),
      original_role: original,
      final_role: final,
      changed: final !== original,
      reason,
    });
  }
  return { version: TOPIC_AWARE_ALIGNMENT_VERSION, checked: sources.length, changed, rows };
}

// ── doctrine lexicon (legal-area fit) ───────────────────────────────────────

const DOCTRINE_LEXICON: Record<string, RegExp> = {
  proportionality: /(מידתי|מידתיות|פסקת\s+ההגבלה|איזון\s+חוקתי|תכלית\s+ראויה|פגיעה\s+בזכות|האמצעי\s+שפגיעתו)/,
  reasonableness: /(סביר|סבירות|מתחם\s+הסבירות|אי[- ]סבירות)/,
  reliance_expectation:
    /(הסתמכות|הבטחה\s+מנהלית|ציפייה\s+לגיטימית|שינוי\s+מדיניות|חזרה\s+מהבטחה|התחייבות\s+שלטונית)/,
  judicial_review: /(ביקורת\s+שיפוטית|התערבות\s+בית\s+המשפט|עילת\s+ההתערבות|שפיטות|זכות\s+עמידה)/,
  human_dignity: /(כבוד\s+האדם|חירות|זכויות\s+יסוד|חוק[- ]יסוד)/,
  prison_conditions: /(תנאי\s+מאסר|אסיר|כליאה|בית\s+סוהר|שב["״]?ס|מעצר)/,
  equality: /(שוויון|אפליה|הפליה)/,
  free_speech: /(חופש\s+הביטוי|צנזור|ביטוי\s+פוליטי)/,
  separation_of_powers: /(הפרדת\s+רשויות|רשות\s+מבצעת|רשות\s+מחוקקת|סמכות\s+הכנסת)/,
  appointments: /(מינוי|מינויים|כשירות\s+למינוי|ועדת\s+איתור)/,
  contract: /(חוזה|הפרת\s+חוזה|פיצוי\s+מוסכם|תרופות|תום\s+לב\s+במשא)/,
  family_property: /(איזון\s+משאבים|גירושין|בית\s+הדין\s+הרבני|חלוקת\s+רכוש|כתובה)/,
  procedure: /(סדר\s+דין|התיישנות|צו\s+מניעה|השתק\s+פלוגתא|מעשה\s+בית\s+דין)/,
  administrative_authority: /(חוסר\s+סמכות|אולטרה\s+וירס|שיקול\s+דעת\s+מנהלי|שיקולים\s+זרים)/,
  planning: /(תב["״]?ע|תכנון\s+ובנייה|ועדה\s+מקומית|היתר\s+בנייה)/,
  comparative: /(משפט\s+משווה|קנדה|גרמניה|אמנה\s+האירופית|oakes|ecthr|comparative)/i,
};

function doctrinesOf(text: string): string[] {
  const t = String(text ?? "");
  const out: string[] = [];
  for (const [k, re] of Object.entries(DOCTRINE_LEXICON)) if (re.test(t)) out.push(k);
  return out;
}

export interface JudgmentLegalAreaFit {
  source_id: string;
  title: string;
  claim_id: string;
  claim_topic_terms: string[];
  judgment_topic_terms: string[];
  direct_doctrine_match: boolean;
  adjacent_area_only: boolean;
  allowed_use: "support" | "example_only" | "none";
  blocked: boolean;
  reason: string;
}

function judgmentText(s: DrafterInputSource): string {
  return `${s.title ?? ""} ${s.snippet ?? ""} ${(s.supported_points ?? []).join(" ")} ${
    (s.topical_text ?? "").slice(0, 4000)
  }`;
}

/** Lightweight, deterministic doctrine/legal-area fit for a judgment ref. */
export function judgmentLegalAreaFit(
  question: string,
  blockText: string,
  s: DrafterInputSource,
  claimId: string,
  strict: boolean,
): JudgmentLegalAreaFit {
  const claimDoctrines = doctrinesOf(`${question} ${blockText}`);
  const judgeDoctrines = doctrinesOf(judgmentText(s));
  const shared = claimDoctrines.filter((d) => judgeDoctrines.includes(d));
  const lexical = academicTopicalFit(question, blockText, s, 3);
  const direct = shared.length > 0 || (claimDoctrines.length === 0 && lexical.score >= 4);
  const adjacent = !direct && (judgeDoctrines.length > 0 || lexical.score > 0);

  let allowed_use: JudgmentLegalAreaFit["allowed_use"] = "support";
  let blocked = false;
  let reason = "direct_doctrine_match";
  if (!direct) {
    if (adjacent && strict) {
      allowed_use = "example_only";
      blocked = true;
      reason = "adjacent_legal_area_only";
    } else if (adjacent) {
      allowed_use = lexical.score >= 2 ? "support" : "example_only";
      blocked = allowed_use === "example_only";
      reason = blocked ? "adjacent_legal_area_only" : "lexical_topical_support";
    } else {
      allowed_use = "none";
      blocked = true;
      reason = "no_topical_or_doctrinal_overlap";
    }
  }
  return {
    source_id: s.ref,
    title: String(s.title ?? ""),
    claim_id: claimId,
    claim_topic_terms: claimDoctrines.length ? claimDoctrines : lexical.shared,
    judgment_topic_terms: judgeDoctrines.length ? judgeDoctrines : [],
    direct_doctrine_match: direct,
    adjacent_area_only: adjacent && !direct,
    allowed_use,
    blocked,
    reason,
  };
}

// ── claim types + acceptable classes ────────────────────────────────────────

export type ClaimType =
  | "statutory_framework"
  | "case_holding"
  | "doctrinal_rule"
  | "theoretical_background"
  | "comparative_context"
  | "critique"
  | "implementation_example"
  | "other";

const ACCEPTABLE_CLASSES: Record<ClaimType, SourceClass[]> = {
  statutory_framework: ["statute"],
  case_holding: ["judgment"],
  doctrinal_rule: ["judgment", "statute", "academic"],
  // A statute may anchor theoretical background (e.g. פסקת ההגבלה) — primary
  // authority is never a downgrade; it is only barred from critique claims.
  theoretical_background: ["academic", "institutional", "statute"],

  comparative_context: ["academic", "judgment"],
  critique: ["academic"],
  implementation_example: ["judgment", "institutional", "academic"],
  other: ["judgment", "statute", "academic", "institutional", "other"],
};

const STATUTORY_CUE = /(סעיף|חוק[- ]יסוד|תקנה\s+\d|לפי\s+חוק|נוסח\s+החוק|הוראת\s+החוק)/;
const HOLDING_CUE = /(נפסק|נקבע\s+כי|בית\s+המשפט\s+קבע|הלכת|פסק\s+הדין\s+קבע)/;
const COMPARATIVE_CUE = DOCTRINE_LEXICON.comparative;
const CRITIQUE_CUE = /(ביקורת|בעייתי|כשל|מנוגד|הסתייגות|יש\s+לתהות)/;
const EXAMPLE_CUE = /(לדוגמה|כך\s+למשל|יישום|הלכה\s+למעשה|בפועל)/;

export function deriveClaimType(b: StructuredBlock, academicMode: boolean): ClaimType {
  if (b.kind === "heading") return "other";
  const text = b.text ?? "";
  const { category } = deriveClaimCategory({
    declared: b.claim_category,
    propositionType: b.proposition_type,
    text,
    academicMode,
  });
  if (STATUTORY_CUE.test(text)) return "statutory_framework";
  if (HOLDING_CUE.test(text)) return "case_holding";
  if (COMPARATIVE_CUE.test(text)) return "comparative_context";
  if (CRITIQUE_CUE.test(text) || category === "critique_or_counterposition") return "critique";
  if (EXAMPLE_CUE.test(text)) return "implementation_example";
  switch (category) {
    case "theoretical_explanation":
    case "academic_framing":
    case "methodological_framing":
    case "literature_synthesis":
      return "theoretical_background";
    case "doctrinal_background":
      return academicMode ? "theoretical_background" : "doctrinal_rule";
    default:
      break;
  }
  if (b.proposition_type === "black_letter_rule") return "doctrinal_rule";
  if (b.proposition_type === "application") return "implementation_example";
  return "other";
}

// ── block plan / ranking / compound guard ───────────────────────────────────

export interface BlockSourcePlanRow {
  block_id: string;
  block_topic: string;
  claim_type: ClaimType;
  acceptable_roles: string[];
  selected_sources: string[];
  rejected_sources: string[];
  rejection_reasons: string[];
  unsupported_or_cautious: boolean;
}

export interface BlockSourceRankingRow {
  block_id: string;
  source_id: string;
  old_rank: number;
  new_rank: number;
  role_match: boolean;
  topic_match: boolean;
  legal_area_match: boolean;
  final_selected: boolean;
}

export interface CompoundFootnoteGuardRow {
  footnote_id: string;
  sources: string[];
  shared_claim: string;
  all_sources_support_claim: boolean;
  removed_sources: string[];
  split_required: boolean;
  final_sources: string[];
}

export interface UnusedStrongerSourceRow {
  block_id: string;
  source_id: string;
  title: string;
  score: number;
  used_score: number;
  promoted: boolean;
}

export interface TopicAwareAlignmentReport {
  version: string;
  applied: boolean;
  academic_mode: boolean;
  source_role_sanity_check: SourceRoleSanityRow[];
  judgment_legal_area_fit: JudgmentLegalAreaFit[];
  block_source_plan: BlockSourcePlanRow[];
  block_source_ranking: BlockSourceRankingRow[];
  compound_footnote_guard: CompoundFootnoteGuardRow[];
  unused_stronger_sources: UnusedStrongerSourceRow[];
  refs_removed: number;
  refs_reordered: number;
  refs_promoted: number;
  blocks_left_uncited: number;
}

export function emptyTopicAwareAlignmentReport(): TopicAwareAlignmentReport {
  return {
    version: TOPIC_AWARE_ALIGNMENT_VERSION,
    applied: false,
    academic_mode: false,
    source_role_sanity_check: [],
    judgment_legal_area_fit: [],
    block_source_plan: [],
    block_source_ranking: [],
    compound_footnote_guard: [],
    unused_stronger_sources: [],
    refs_removed: 0,
    refs_reordered: 0,
    refs_promoted: 0,
    blocks_left_uncited: 0,
  };
}

const MAX_REFS_PER_BLOCK = 3;

function blockTopic(text: string): string {
  const d = doctrinesOf(text);
  return d.length ? d.join("+") : (text ?? "").slice(0, 60);
}

interface Scored {
  s: DrafterInputSource;
  cls: SourceClass;
  roleMatch: boolean;
  topicMatch: boolean;
  areaMatch: boolean;
  score: number;
}

/**
 * Main entry: prune + rank + de-compound the source_refs of an already
 * validated, gated and CSM-filtered draft. Never adds a source that the draft
 * does not already use somewhere on a compatible block.
 */
export function applyTopicAwareBlockAlignment(
  draft: StructuredDraft | null,
  sources: DrafterInputSource[],
  question: string,
  opts: { academicMode: boolean },
): { draft: StructuredDraft | null; report: TopicAwareAlignmentReport } {
  const report = emptyTopicAwareAlignmentReport();
  report.academic_mode = opts.academicMode;
  if (!draft) return { draft, report };

  const byRef = new Map(sources.map((s) => [s.ref, s]));
  const usedAnywhere = new Set<string>();
  for (const b of draft.blocks) {
    if (b.kind === "heading") continue;
    for (const r of b.source_refs ?? []) usedAnywhere.add(r);
  }

  const blocks: StructuredBlock[] = [];
  let idx = 0;
  for (const b of draft.blocks) {
    if (b.kind === "heading") {
      blocks.push(b);
      continue;
    }
    idx++;
    const blockId = `b${idx}`;
    const text = b.text ?? "";
    const claimType = deriveClaimType(b, opts.academicMode);
    const acceptable = ACCEPTABLE_CLASSES[claimType];
    const refs = [...(b.source_refs ?? [])];
    const rejected: string[] = [];
    const reasons: string[] = [];
    const scored: Scored[] = [];

    for (const ref of refs) {
      const s = byRef.get(ref);
      if (!s) {
        rejected.push(ref);
        reasons.push(`${ref}:unknown_ref`);
        continue;
      }
      const cls = classifySource(s);
      const roleMatch = acceptable.includes(cls);
      if (!roleMatch) {
        rejected.push(ref);
        reasons.push(`${ref}:class_${cls}_not_acceptable_for_${claimType}`);
        continue;
      }
      const lexical = academicTopicalFit(question, text, s, 2);
      let areaMatch = true;
      if (cls === "judgment") {
        const fit = judgmentLegalAreaFit(
          question,
          text,
          s,
          String(b.claim_id ?? b.facet_id ?? blockId),
          opts.academicMode,
        );
        report.judgment_legal_area_fit.push(fit);
        areaMatch = fit.direct_doctrine_match;
        if (fit.blocked) {
          rejected.push(ref);
          reasons.push(`${ref}:${fit.reason}`);
          continue;
        }
      }
      const score = (areaMatch ? 4 : 0) + (roleMatch ? 2 : 0) +
        Math.min(lexical.score, 4) + (s.body_acquired === true ? 1 : 0) +
        (s.best_support === "direct" ? 1 : 0);
      scored.push({ s, cls, roleMatch, topicMatch: lexical.fit, areaMatch, score });
    }

    const oldOrder = scored.map((x) => x.s.ref);
    scored.sort((a, b2) => b2.score - a.score);

    // Compound-footnote guard: when the leader has a direct legal-area/topic
    // match, weak adjacent companions are removed rather than bundled.
    let selected = scored;
    if (scored.length > 1) {
      const lead = scored[0];
      const strongLead = lead.areaMatch && lead.topicMatch;
      const keep = scored.filter((x, i) =>
        i === 0 || (x.areaMatch && x.topicMatch && x.score >= lead.score - 2)
      );
      const removed = scored.filter((x) => !keep.includes(x));
      selected = keep.slice(0, MAX_REFS_PER_BLOCK);
      if (removed.length > 0) {
        report.compound_footnote_guard.push({
          footnote_id: blockId,
          sources: scored.map((x) => x.s.ref),
          shared_claim: blockTopic(text),
          all_sources_support_claim: false,
          removed_sources: removed.map((x) => x.s.ref),
          split_required: !strongLead,
          final_sources: selected.map((x) => x.s.ref),
        });
        for (const x of removed) {
          rejected.push(x.s.ref);
          reasons.push(`${x.s.ref}:compound_weak_companion`);
        }
      }
    } else {
      selected = scored.slice(0, MAX_REFS_PER_BLOCK);
    }

    // Conservative promotion: if the block lost all support, a source already
    // used elsewhere in this same draft may take its place — but only with a
    // direct class + legal-area match. Nothing new enters the answer.
    let promoted = false;
    if (selected.length === 0) {
      const candidates: Scored[] = [];
      for (const ref of usedAnywhere) {
        if (refs.includes(ref)) continue;
        const s = byRef.get(ref);
        if (!s) continue;
        const cls = classifySource(s);
        if (!acceptable.includes(cls)) continue;
        const lexical = academicTopicalFit(question, text, s, 2);
        if (!lexical.fit) continue;
        if (cls === "judgment") {
          const fit = judgmentLegalAreaFit(question, text, s, blockId, opts.academicMode);
          if (!fit.direct_doctrine_match) continue;
        }
        candidates.push({
          s,
          cls,
          roleMatch: true,
          topicMatch: true,
          areaMatch: true,
          score: 6 + Math.min(lexical.score, 4),
        });
      }
      candidates.sort((a, b2) => b2.score - a.score);
      if (candidates.length > 0 && refs.length > 0) {
        selected = [candidates[0]];
        promoted = true;
        report.refs_promoted++;
        report.unused_stronger_sources.push({
          block_id: blockId,
          source_id: candidates[0].s.ref,
          title: String(candidates[0].s.title ?? ""),
          score: candidates[0].score,
          used_score: 0,
          promoted: true,
        });
      }
    } else {
      // Report-only: a stronger, unused, on-point pack source for this block.
      const best = selected[0];
      for (const s of sources) {
        if (selected.some((x) => x.s.ref === s.ref) || refs.includes(s.ref)) continue;
        const cls = classifySource(s);
        if (!acceptable.includes(cls)) continue;
        const lexical = academicTopicalFit(question, text, s, 3);
        if (!lexical.fit) continue;
        const score = 6 + Math.min(lexical.score, 4) + (s.body_acquired === true ? 1 : 0);
        if (score > best.score && report.unused_stronger_sources.length < 20) {
          report.unused_stronger_sources.push({
            block_id: blockId,
            source_id: s.ref,
            title: String(s.title ?? ""),
            score,
            used_score: best.score,
            promoted: false,
          });
        }
      }
    }

    const finalRefs = selected.map((x) => x.s.ref);
    for (let i = 0; i < scored.length; i++) {
      const x = scored[i];
      report.block_source_ranking.push({
        block_id: blockId,
        source_id: x.s.ref,
        old_rank: oldOrder.indexOf(x.s.ref),
        new_rank: finalRefs.indexOf(x.s.ref),
        role_match: x.roleMatch,
        topic_match: x.topicMatch,
        legal_area_match: x.areaMatch,
        final_selected: finalRefs.includes(x.s.ref),
      });
    }
    report.block_source_plan.push({
      block_id: blockId,
      block_topic: blockTopic(text),
      claim_type: claimType,
      acceptable_roles: acceptable.flatMap((c) => ALLOWED_ROLES[c]).slice(0, 12),
      selected_sources: finalRefs,
      rejected_sources: rejected,
      rejection_reasons: reasons.slice(0, 8),
      unsupported_or_cautious: finalRefs.length === 0 && refs.length > 0,
    });

    report.refs_removed += Math.max(0, refs.length - finalRefs.length) - (promoted ? 1 : 0) + 0;
    if (finalRefs.join("|") !== refs.join("|") && finalRefs.length === refs.length) {
      report.refs_reordered++;
    }
    if (finalRefs.length === 0 && refs.length > 0) report.blocks_left_uncited++;

    blocks.push({ ...b, source_refs: finalRefs });
  }

  report.applied = true;
  if (report.refs_removed < 0) report.refs_removed = 0;
  return { draft: { ...draft, blocks }, report };
}

// ── limitation-note alignment ───────────────────────────────────────────────

export interface LimitationNoteAlignment {
  answer_id: string;
  primary_sources_present: boolean;
  judgment_sources_present: boolean;
  direct_doctrine_judgment_present: boolean;
  limitation_note: string;
  accurate: boolean;
  revised: boolean;
}

export const NO_DIRECT_CASELAW_NOTE_HE =
  "הערה על היקף המקורות: לא אותר פסק דין העוסק ישירות בדוקטרינה הנדונה; פסקי הדין שאותרו נוגעים לתחום סמוך בלבד, והביסוס הדוקטרינרי כאן נשען על חקיקה וספרות משפטית.";

export function assessLimitationNoteAlignment(
  answerId: string,
  sources: DrafterInputSource[],
  report: TopicAwareAlignmentReport,
  currentNote: string,
): LimitationNoteAlignment {
  const classes = sources.map(classifySource);
  const judgment_sources_present = classes.includes("judgment");
  const primary_sources_present = judgment_sources_present || classes.includes("statute");
  const direct = report.judgment_legal_area_fit.some((f) =>
    f.direct_doctrine_match && !f.blocked
  );
  const needsNote = judgment_sources_present && !direct;
  const alreadyStated = currentNote.includes("לא אותר פסק דין");
  const note = needsNote && !alreadyStated
    ? [currentNote, NO_DIRECT_CASELAW_NOTE_HE].filter(Boolean).join("\n\n")
    : currentNote;
  return {
    answer_id: answerId,
    primary_sources_present,
    judgment_sources_present,
    direct_doctrine_judgment_present: direct,
    limitation_note: note,
    accurate: !needsNote || note !== currentNote || alreadyStated,
    revised: note !== currentNote,
  };
}
