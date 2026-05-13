// Phase 6.5 — Role-aware drafter prompt helpers.
//
// Renders the source catalog with role/quality/confidence labels and emits
// the per-role usage instructions block for the contract drafter prompt.
//
// Kept OUT of cardClaimContract.ts on purpose: the contract module owns
// stable IDs, marker parsing, and footnote building. Prompt rendering is
// drafter-side concern and lives here so contract semantics stay isolated.

import type {
  CitationQuality,
  LegalResearchPlan,
  SourceRole,
} from "./contracts.ts";

export interface RoleAwareCardInput {
  /** "S3" — the contract ID. */
  contractId: string;
  /** Numeric pack id (used in legacy [src-N] tag for back-compat). */
  numericId: number;
  citation: string;
  sourceType: string;
  url?: string;
  provenance: "local" | "perplexity" | "perplexity_completion" | "document";
  role?: SourceRole;
  roleConfidence?: "high" | "medium" | "low";
  citationQuality?: CitationQuality;
}

const PROVENANCE_TAG: Record<string, string> = {
  local: " [מאומת – מקור אמת לתוכן]",
  perplexity: " [חיצוני – למטא-דאטה בלבד]",
  perplexity_completion: " [מאומת חיצונית – ציטוט בלבד]",
  document: " [מסמך משתמש]",
};

/**
 * Render a single source-catalog line. When role/quality fields are present
 * (planner active), include them inline so the drafter sees them per card.
 */
export function renderRoleAwareCard(card: RoleAwareCardInput): string {
  const provTag = PROVENANCE_TAG[card.provenance] ?? "";
  const sidTag = ` {${card.contractId}}`;
  const head = `[${card.numericId}]${sidTag}${provTag}`;

  const roleBits: string[] = [];
  if (card.role) {
    roleBits.push(`role=${card.role}`);
    if (card.roleConfidence) roleBits.push(`conf=${card.roleConfidence}`);
  }
  if (card.citationQuality) {
    roleBits.push(`quality=${card.citationQuality}`);
  }
  const labels = roleBits.length > 0 ? `\n   ${roleBits.join(" | ")}` : "";

  const tail = `${card.citation}${card.url ? ` (${card.url})` : ""} — ${card.sourceType}`;
  return `${head} ${tail}${labels}`;
}

export function renderRoleAwareCatalog(cards: RoleAwareCardInput[]): string {
  return cards.map(renderRoleAwareCard).join("\n");
}

/**
 * Hebrew block injected into the drafter prompt that explains how to USE
 * the role/quality labels above. Domain-agnostic — no contract-law specifics.
 */
export function buildRoleUsageBlock(plan: LegalResearchPlan | null): string {
  if (!plan) return "";
  const requiredText = plan.requiredRoles
    .map((r) => `${r.role} (${r.priority}, ≥${r.minCount})`)
    .join(", ");
  return `═══ שימוש לפי תפקיד מקור (Phase 6.5) ═══
כל כרטיס מקור למטה מתויג ב-role / conf / quality. השתמש בהם לבחירת המקור הנכון לכל סוג טענה:

- טענה דוקטרינרית ("ההלכה היא...", "בית המשפט קבע ש-...") → העדף role=doctrinal_anchor.
  אסור לבסס טענה דוקטרינרית מרכזית על role=application_example או role=case_example לבד.
- טענה סטטוטורית ("החוק קובע...", "סעיף X מחייב...") → השתמש ב-role=statutory_anchor.
- דוגמה / יישום ("בפרשת X יושם הכלל על...") → השתמש ב-role=case_example או role=application_example.
- טענה תיאורטית ("גישת X גורסת ש-...") → השתמש ב-role=academic_commentary, role=theoretical_anchor או role=policy_analysis.
- עמדה מנוגדת ("מנגד נטען ש-...") → השתמש ב-role=counter_position.
- מקור עם quality=weak — מותר לאזכר כסיוע, לא כסמכות מרכזית. נסח כ"ראו למשל" / "ניתן ללמוד מ-".
- מקור עם quality=placeholder — אל תשתמש בו כמקור מרכזי. אם משתמש, ניסוח זהיר בלבד.
- מקור עם conf=low — נסח כסיוע, לא כסמכות מכוננת.

תכנית המחקר דורשת: ${requiredText || "(אין דרישות תפקיד)"}.
אם אין מקור התואם תפקיד נדרש — נסח את הטענה כאי-ודאות ("ייתכן", "טרם הוכרע") במקום להמציא או לעוות תפקיד.`;
}
