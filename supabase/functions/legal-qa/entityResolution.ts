// Phase 4 — Source Pack Gate (soft mode).
//
// Verifies the assembled `LegalSourcePack` contains the slots required by the
// router-classified question type BEFORE the drafter runs. In "soft" mode we
// never block answers — we only attach a banner to the drafter prompt and log
// telemetry. "strict" mode (which would block / force round-2) is wired here
// for forward-compat but is NOT yet enabled in any MODE_PROFILE.
//
// Telemetry shape persisted at qa_logs.metadata.research_safeguards.source_pack_gate:
//   { mode, ok, missing: string[], blocking_missing: string[],
//     banner: string | null, checks_run: string[] }
//
// PURE / synchronous: no network, easy to unit-test.

import type { LegalSourcePack, LegalSourcePackItem } from "./contracts.ts";
import type { LegalIssueRoute } from "./legalIssueRouter.ts";

export type SourcePackGateMode = "off" | "soft" | "strict";

export interface SourcePackGateResult {
  mode: SourcePackGateMode;
  /** True iff no blocking_missing slots remain. */
  ok: boolean;
  /** All checks that failed (informational, includes preferred-but-not-blocking). */
  missing: string[];
  /** Subset of `missing` that would block the drafter in `strict` mode. */
  blocking_missing: string[];
  /** Hebrew banner to prepend to the drafter prompt. Null when ok. */
  banner: string | null;
  /** Names of checks that actually ran (for telemetry / debuggability). */
  checks_run: string[];
}

const AUTHORITATIVE_CLASSES = new Set<LegalSourcePackItem["authorityClass"]>([
  "primary_legislation",
  "primary_caselaw",
  "secondary_official",
  "secondary_academic",
]);

/** Iterate every item across all 3 buckets. */
function* iterPack(pack: LegalSourcePack): Generator<LegalSourcePackItem> {
  yield* pack.coreSources;
  yield* pack.supportingSources;
  yield* pack.secondarySources;
}

function countByClass(
  pack: LegalSourcePack,
  cls: LegalSourcePackItem["authorityClass"],
): number {
  let n = 0;
  for (const it of iterPack(pack)) if (it.authorityClass === cls) n++;
  return n;
}

/** Heuristic: does the question ask whether a doctrine / ruling has changed? */
export const DOCTRINE_CHANGE_RE =
  /(שונה|שונתה|התהפכה|בוטלה|השתנתה|נדחתה|השתנו|בוטל|בוטלו|חדל|חדלה|תוקנה|הוחלפה|נסוג(?:ה)?|שינוי הלכה)/;

/** Heuristic: does the question ask about prior text / legislative history? */
const HAS_PRIOR_TEXT_RE = /(נוסח קודם|טרם התיקון|לפני התיקון|דברי הסבר|הצעת חוק|היסטוריה חקיקתית)/;

/**
 * Run the gate. The check set is keyed off `route.query_type`. For unknown /
 * unhandled query types we currently return `ok: true` with no checks (the
 * gate is opt-in per query family until each is calibrated).
 */
export function checkSourcePackGate(
  route: LegalIssueRoute | null,
  pack: LegalSourcePack | null,
  question: string,
  mode: SourcePackGateMode,
): SourcePackGateResult {
  const empty: SourcePackGateResult = {
    mode,
    ok: true,
    missing: [],
    blocking_missing: [],
    banner: null,
    checks_run: [],
  };
  if (mode === "off") return empty;
  if (!pack || !route) return empty;

  if (route.query_type === "statutory_amendment_comparison") {
    return checkAmendmentComparison(route, pack, question, mode);
  }

  // Other query types: gate not yet calibrated → ok by default.
  return empty;
}

function checkAmendmentComparison(
  route: LegalIssueRoute,
  pack: LegalSourcePack,
  question: string,
  mode: SourcePackGateMode,
): SourcePackGateResult {
  const checks_run: string[] = [];
  const missing: string[] = [];
  const blocking: string[] = [];

  // 1) Identified statute (router) OR a primary_legislation source in pack.
  checks_run.push("statute_identified_or_present");
  const hasStatuteFromRouter = !!route.target_statute?.name;
  const primaryLegCount = countByClass(pack, "primary_legislation");
  const hasStatutePresent = primaryLegCount > 0;
  if (!hasStatuteFromRouter && !hasStatutePresent) {
    missing.push("statute_identified_or_present");
    blocking.push("statute_identified_or_present");
  }

  // 2) At least one official / primary_legal / approved_secondary source for
  //    the amendment / current text. We approximate this by counting any item
  //    whose authorityClass is in the AUTHORITATIVE_CLASSES set.
  checks_run.push("authoritative_source_for_amendment");
  let authoritative = 0;
  for (const it of iterPack(pack)) {
    if (AUTHORITATIVE_CLASSES.has(it.authorityClass)) authoritative++;
  }
  if (authoritative === 0) {
    missing.push("authoritative_source_for_amendment");
    blocking.push("authoritative_source_for_amendment");
  }

  // 3) Case-law baseline — only required when the question itself asks
  //    whether a doctrine / ruling has CHANGED. Soft (preferred) when
  //    question doesn't carry the change signal.
  checks_run.push("caselaw_baseline");
  const asksDoctrineChange = DOCTRINE_CHANGE_RE.test(question);
  const caselawCount = countByClass(pack, "primary_caselaw");
  if (caselawCount === 0) {
    missing.push("caselaw_baseline");
    if (asksDoctrineChange) blocking.push("caselaw_baseline");
  }

  // 4) Prior text / explanatory material — preferred, never blocking.
  checks_run.push("prior_text_or_explanatory");
  const asksPriorText = HAS_PRIOR_TEXT_RE.test(question);
  const supportingCount =
    countByClass(pack, "secondary_official") + countByClass(pack, "secondary_academic");
  if (supportingCount === 0 && asksPriorText) {
    missing.push("prior_text_or_explanatory");
    // Never added to `blocking` — preferred only.
  }

  const ok = mode === "strict" ? blocking.length === 0 : true;
  const banner = missing.length > 0 ? buildBanner(missing) : null;

  return { mode, ok, missing, blocking_missing: blocking, banner, checks_run };
}

/** Hebrew banner prepended to the drafter prompt in soft mode. */
function buildBanner(missing: string[]): string {
  const labels: Record<string, string> = {
    statute_identified_or_present:
      "החוק היעד / נוסח חקיקתי עדכני לא זוהה במאגר המקורות",
    authoritative_source_for_amendment:
      "אין מקור סמכותי (חקיקה / פסיקה / מחקר רשמי) המתעד את התיקון או הנוסח העדכני",
    caselaw_baseline:
      "אין פסיקה קיימת במאגר המקורות לבסיס השוואה דוקטרינלי",
    prior_text_or_explanatory:
      "אין נוסח קודם / דברי הסבר / חומר היסטוריה חקיקתית במאגר",
  };
  const lines = missing.map((m) => `• ${labels[m] ?? m}`).join("\n");
  return [
    "שים לב — חסרים מקורות מסוימים במאגר עבור שאלה זו:",
    lines,
    "ענה בזהירות מוגברת: הימנע מקביעות פוזיטיביות שאינן עוגנות במקורות שהוצגו, וציין במפורש כשמקור חסר.",
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 5 — gap-driven targeted retrieval (round 2)
// Pure helpers used by index.ts to:
//   1. identify which gate slots are missing (via checkSourcePackGate);
//   2. classify each gap as "essential" or "preferred";
//   3. build Hebrew retrieval queries for the missing slots.
// No network. Easy to unit-test.
// ─────────────────────────────────────────────────────────────────────────

export type GapTier = "essential" | "preferred";

/**
 * Return the gate's missing[] / blocking_missing[] without building a banner.
 * Thin wrapper around `checkSourcePackGate(..., "soft")` so callers don't
 * accidentally rerun the gate in a different mode.
 */
export function identifyMissingSlots(
  route: LegalIssueRoute | null,
  pack: LegalSourcePack | null,
  question: string,
): { missing: string[]; blocking_missing: string[] } {
  const r = checkSourcePackGate(route, pack, question, "soft");
  return { missing: r.missing, blocking_missing: r.blocking_missing };
}

/**
 * Classify a missing slot as essential vs preferred for round-2 mode policy.
 *
 * Essential (Fast + Deep run for these):
 *   - statute_identified_or_present
 *   - authoritative_source_for_amendment
 *   - caselaw_baseline → essential ONLY when the question matches
 *     DOCTRINE_CHANGE_RE; otherwise preferred.
 *
 * Preferred (Deep only):
 *   - prior_text_or_explanatory
 *   - committee_protocol
 *   - approved_secondary_commentary
 *   - anything else
 */
export function classifyGap(slot: string, question: string): GapTier {
  switch (slot) {
    case "statute_identified_or_present":
    case "authoritative_source_for_amendment":
      return "essential";
    case "caselaw_baseline":
      return DOCTRINE_CHANGE_RE.test(question) ? "essential" : "preferred";
    default:
      return "preferred";
  }
}

/** Best-effort doctrine-name extraction for caselaw_baseline rescue queries. */
export function extractDoctrineTerm(question: string): string | null {
  // Try "הלכת X" pattern first.
  const m = question.match(/הלכת\s+([\u0590-\u05FFA-Za-z0-9״"'׳`־\-]+)/);
  if (m && m[1]) return m[1].trim();
  // Try "פסק דין X" / "פסק-דין X".
  const m2 = question.match(/פסק[־\- ]דין\s+([\u0590-\u05FFA-Za-z0-9״"'׳`־\-]+)/);
  if (m2 && m2[1]) return m2[1].trim();
  return null;
}

/**
 * Build Hebrew retrieval queries for each eligible missing slot.
 * Returns one or more queries per slot (no cap — caller applies the cap).
 * Empty input → []. Unknown slots → skipped silently.
 */
export function buildRound2Queries(
  route: LegalIssueRoute | null,
  eligibleGaps: string[],
  question: string,
): string[] {
  if (!route || eligibleGaps.length === 0) return [];
  const statuteName = route.target_statute?.name?.trim() || null;
  const out: string[] = [];

  for (const slot of eligibleGaps) {
    switch (slot) {
      case "statute_identified_or_present":
        if (statuteName) out.push(`${statuteName} נוסח מלא`);
        break;
      case "authoritative_source_for_amendment":
        if (statuteName) {
          out.push(`${statuteName} תיקון אחרון נוסח עדכני`);
          out.push(`${statuteName} ס"ח`);
        }
        break;
      case "caselaw_baseline": {
        const doctrine = extractDoctrineTerm(question);
        if (doctrine) out.push(`הלכת ${doctrine} פסיקה`);
        else if (statuteName) out.push(`${statuteName} פסיקה הלכה`);
        break;
      }
      case "prior_text_or_explanatory":
        if (statuteName) out.push(`${statuteName} דברי הסבר הצעת חוק`);
        break;
      case "committee_protocol":
        if (statuteName) out.push(`${statuteName} פרוטוקול ועדה`);
        break;
      case "approved_secondary_commentary":
        if (statuteName) out.push(`${statuteName} מאמר אקדמי פרשנות`);
        break;
      default:
        // Unknown slot — skip.
        break;
    }
  }

  // De-dup preserving order, by lowercased text.
  const seen = new Set<string>();
  const dedup: string[] = [];
  for (const q of out) {
    const k = q.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    dedup.push(q);
  }
  return dedup;
}
