/**
 * academic_drafter_source_ref_coverage_v2
 *
 * Drafter-side (prompt) module only. It derives a lightweight role→block map
 * from metadata the pack already carries and renders:
 *   1. a citation-use section for the short / generic academic genres, and
 *   2. the role map itself, so the model knows which source fits which block.
 *
 * It also measures emission after the model call (report-only).
 *
 * Out of scope by construction: retrieval, discovery, acquisition, CSM rules,
 * authority alignment, identity validation, footnote rendering, sufficiency
 * and any citation-count policy. Nothing here drops or adds a source_ref.
 */

import type { DrafterInputSource } from "./drafter.ts";
import type { StructuredDraft } from "./structuredValidation.ts";
import {
  type ClaimSupportCategory,
  deriveClaimCategory,
  isAcademicClaimCategory,
  profileSource,
} from "./claimSupportCategory.ts";
import {
  type AcademicSourceRole,
  academicTopicalFit,
  CATEGORY_TO_ROLE,
  classifyAcademicSourceRoles,
} from "./academicAuthorityAlignment.ts";
import type { AcademicGenre } from "./academicPresentationHygiene.ts";

export const ACADEMIC_SOURCE_ROLE_MAP_VERSION = "v2.0";

/** Academic block categories that are substantive enough to want a ref. */
export const SUBSTANTIVE_ACADEMIC_CATEGORIES: ClaimSupportCategory[] = [
  "doctrinal_background",
  "academic_framing",
  "theoretical_explanation",
  "literature_synthesis",
  "critique_or_counterposition",
  "methodological_framing",
];

/** Categories where a bibliography-only pointer may legitimately be cited. */
const POINTER_OK_CATEGORIES = new Set<string>([
  "literature_synthesis",
  "academic_framing",
  "methodological_framing",
  "critique_or_counterposition",
]);

export type AllowedUse =
  | "substantive"
  | "literature_pointer"
  | "primary_only"
  | "not_for_binding_law";

export interface SourceRoleMapEntry {
  ref: string;
  title: string;
  source_role: string;
  academic_roles: AcademicSourceRole[];
  block_categories: ClaimSupportCategory[];
  supported_points: string[];
  acquisition: "full_body" | "reference_only";
  allowed_use: AllowedUse[];
}

export interface SourceRoleMap {
  version: string;
  entries: SourceRoleMapEntry[];
  by_category: Record<string, string[]>;
}

function isPrimary(s: DrafterInputSource): boolean {
  const c = String(s.citable_as ?? "");
  return c === "judgment" || c === "statute" || c === "regulation";
}

/**
 * Derives the map from existing metadata only. No network, no scoring model.
 */
export function buildAcademicSourceRoleMap(
  question: string,
  sources: DrafterInputSource[],
): SourceRoleMap {
  const eligible = new Set(
    sources.filter((s) => profileSource(s).doctrinal_authority).map((s) => s.ref),
  );
  const roles = classifyAcademicSourceRoles(sources, eligible);
  const roleOf = (ref: string): AcademicSourceRole[] =>
    (Object.keys(roles.by_role) as AcademicSourceRole[]).filter((r) =>
      (roles.by_role[r] ?? []).includes(ref)
    );

  const entries: SourceRoleMapEntry[] = [];
  const by_category: Record<string, string[]> = {};

  for (const s of sources) {
    const profile = profileSource(s);
    const acquisition: SourceRoleMapEntry["acquisition"] =
      s.body_acquired === true || profile.judgment_authority || profile.statutory_authority
        ? "full_body"
        : "reference_only";
    const academic_roles = roleOf(s.ref);
    const onTopic = academicTopicalFit(question, "", s).fit;

    const cats: ClaimSupportCategory[] = [];
    if (isPrimary(s) && acquisition === "full_body") {
      cats.push("doctrinal_background");
    }
    if (profile.doctrinal_authority || acquisition === "reference_only") {
      for (const c of SUBSTANTIVE_ACADEMIC_CATEGORIES) {
        const wanted = CATEGORY_TO_ROLE[c];
        const roleFits = academic_roles.includes(wanted) ||
          (wanted === "doctrinal_background_source" && profile.doctrinal_authority);
        if (!roleFits) continue;
        if (acquisition === "reference_only" && !POINTER_OK_CATEGORIES.has(c)) continue;
        if (!onTopic && acquisition === "reference_only") continue;
        if (!cats.includes(c)) cats.push(c);
      }
    }

    const allowed_use: AllowedUse[] = [];
    if (acquisition === "reference_only") allowed_use.push("literature_pointer");
    else allowed_use.push("substantive");
    if (isPrimary(s) && acquisition === "full_body") allowed_use.push("primary_only");
    if (!isPrimary(s)) allowed_use.push("not_for_binding_law");

    for (const c of cats) (by_category[c] ??= []).push(s.ref);

    entries.push({
      ref: s.ref,
      title: String(s.title ?? ""),
      source_role: String(s.role ?? "unknown"),
      academic_roles,
      block_categories: cats,
      supported_points: (s.supported_points ?? []).slice(0, 3),
      acquisition,
      allowed_use,
    });
  }

  return { version: ACADEMIC_SOURCE_ROLE_MAP_VERSION, entries, by_category };
}

const CATEGORY_HE: Record<string, string> = {
  doctrinal_background: "רקע דוקטרינרי",
  academic_framing: "מסגור אקדמי",
  theoretical_explanation: "הסבר תיאורטי/נורמטיבי",
  literature_synthesis: "סקירת ספרות",
  critique_or_counterposition: "ביקורת/עמדה נגדית",
  methodological_framing: "מסגור מתודולוגי",
};

const USE_HE: Record<AllowedUse, string> = {
  substantive: "ביסוס מהותי",
  literature_pointer: "הפניה לקריאה בלבד",
  primary_only: "מקור ראשוני — מותר גם לקביעות על הדין המחייב",
  not_for_binding_law: "אסור כביסוס להלכה, לנוסח חוק, לתוצאת תיק או לציטוט מחייב",
};

/** Renders the role map for the drafter prompt. */
export function renderSourceRoleMapBlock(map: SourceRoleMap): string {
  const usable = map.entries.filter((e) => e.block_categories.length > 0);
  if (usable.length === 0) return "";
  const lines: string[] = [];
  lines.push("מיפוי מקור→סוג פסקה (source_role_map) — לשימוש פנימי בבחירת source_refs:");
  for (const e of usable) {
    const cats = e.block_categories.map((c) => CATEGORY_HE[c] ?? c).join(", ");
    lines.push(
      `- ${e.ref} — "${e.title}" | מתאים ל: ${cats} | ` +
        `${e.acquisition === "full_body" ? "נקרא גוף המקור" : "אותר ביבליוגרפית בלבד"} | ` +
        `שימוש מותר: ${e.allowed_use.map((u) => USE_HE[u]).join("; ")}`,
    );
    if (e.supported_points.length) {
      lines.push(`  נקודות תמיכה: ${e.supported_points.join(" | ")}`);
    }
  }
  lines.push(
    "לכל פסקה מהותית שיש לה מקור מתאים במיפוי — צרף לפחות source_ref אחד. " +
      "אם אין מקור מתאים לפסקה — אל תצרף מקור מתחום אחר ואל תמציא הפניה; נסח אותה בזהירות. " +
      "מקור שאותר ביבליוגרפית בלבד ייכלל רק בפסקאות ספרות/מסגור/מתודולוגיה ובלשון הפניה לקריאה.",
  );
  return lines.join("\n");
}

/** Short genres get a light citation-use section (no density push). */
export function buildLightCitationUseBlock(genre: AcademicGenre): string {
  return [
    "**שימוש באסמכתאות (פלט קצר)**",
    "- פסקה מהותית — דוקטרינרית, תיאורטית, סקירת ספרות, ביקורתית או מתודולוגית — תישא source_refs כאשר קיים במאגר מקור מתאים לתפקידה.",
    "- משפטי קישור, מפת דרכים או הצהרות מבנה אינם נושאים אסמכתה.",
    "- אין להוסיף אסמכתאות כדי להגדיל מספר; אין יעד כמותי.",
    "- מקור אחד יכול לתמוך בכמה פסקאות סמוכות אם הוא באמת מתאים לכולן.",
    "- פסקה שאין לה תמיכה במאגר תנוסח בלשון זהירה, בלי לייחס קביעה למקור.",
    `- זהו פלט קצר (${genre}); אין להפוך אותו לסקירת ספרות ארוכה — האורך נשמר, השימוש במקורות הממופים משתפר.`,
  ].join("\n");
}

/** Genres that receive the light block instead of the long-chapter guidance. */
export const LIGHT_CITATION_GENRES: AcademicGenre[] = [
  "topic_presentation",
  "generic_academic",
  "research_question",
  "chapter_outline",
];

// ── Telemetry ───────────────────────────────────────────────────────────────

export interface AcademicDrafterSourceRefEmission {
  genre: string;
  substantive_blocks: number;
  blocks_with_mapped_source: number;
  blocks_with_emitted_ref: number;
  blocks_missing_ref_despite_mapping: number;
  missing_ref_reasons: string[];
  source_role_map_summary: Record<string, string[]>;
  model_emitted_ref_count: number;
}

export interface PreCsmSourceRefFiltering {
  structured_validation_unknown_refs: number;
  metadata_only_holding_gate_drops: number;
  claim_source_match_drops: number;
}

/**
 * Report-only measurement on the *pre-CSM* draft: what the model actually
 * emitted against what the map made available.
 */
export function measureSourceRefEmission(
  draft: StructuredDraft | null,
  map: SourceRoleMap,
  genre: string,
): AcademicDrafterSourceRefEmission {
  const out: AcademicDrafterSourceRefEmission = {
    genre,
    substantive_blocks: 0,
    blocks_with_mapped_source: 0,
    blocks_with_emitted_ref: 0,
    blocks_missing_ref_despite_mapping: 0,
    missing_ref_reasons: [],
    source_role_map_summary: map.by_category,
    model_emitted_ref_count: 0,
  };
  if (!draft) return out;

  for (const b of draft.blocks) {
    if (b.kind === "heading") continue;
    const refs = b.source_refs ?? [];
    out.model_emitted_ref_count += refs.length;
    const { category } = deriveClaimCategory({
      declared: b.claim_category,
      propositionType: b.proposition_type,
      text: b.text,
      academicMode: true,
    });
    if (!isAcademicClaimCategory(category)) continue;
    out.substantive_blocks += 1;
    const mapped = map.by_category[category] ?? [];
    if (mapped.length > 0) out.blocks_with_mapped_source += 1;
    if (refs.length > 0) {
      out.blocks_with_emitted_ref += 1;
    } else if (mapped.length > 0) {
      out.blocks_missing_ref_despite_mapping += 1;
      if (out.missing_ref_reasons.length < 8) {
        out.missing_ref_reasons.push(
          `no_ref_emitted_by_drafter:${category}:${mapped.slice(0, 3).join(",")}`,
        );
      }
    }
  }
  return out;
}
