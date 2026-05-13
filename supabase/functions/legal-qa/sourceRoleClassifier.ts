// Phase 6.5 — Source Role Classifier.
//
// Assigns a SourceRole + roleConfidence to each retrieved card based on
// (a) the card's metadata + excerpt and (b) the LegalResearchPlan that
// declares what kind of answer is being built. Citation quality is NOT
// the classifier's job — that comes from the deterministic
// `citationQualityScorer.ts`.
//
// Implementation: Gemini Flash, batched. Resilient: any failure returns
// per-card defaults of `background_context` / `low` so the pipeline never
// stops on classifier errors.

import { callPlannerJSON, type PlannerToolDef, type StageRun } from "./aiProvider.ts";
import type { LegalResearchPlan, SourceRole } from "./contracts.ts";

const BATCH_SIZE = 8;
const MAX_BATCHES = 3;            // hard cap → at most ~24 cards classified per request

export interface ClassifierInputCard {
  /** Stable contract id, e.g. "S3". */
  contractId: string;
  /** numeric pack id (telemetry only). */
  numericId: number;
  title: string;
  sourceType: string;
  court?: string;
  caseNumber?: string;
  year?: string;
  excerpt?: string;
}

export interface ClassifierOutputItem {
  contractId: string;
  role: SourceRole;
  roleConfidence: "high" | "medium" | "low";
  rationale: string;
}

export interface ClassifierResult {
  items: ClassifierOutputItem[];
  runs: StageRun[];
  /** Number of cards that hit the default fallback path. */
  fallbackCount: number;
}

const CLASSIFIER_TOOL: PlannerToolDef = {
  name: "submit_source_role_classification",
  description:
    "Assign a source role and confidence to each retrieved card based on the research plan.",
  parameters: {
    type: "object",
    properties: {
      classifications: {
        type: "array",
        items: {
          type: "object",
          properties: {
            contract_id: { type: "string" },
            role: {
              type: "string",
              enum: [
                "doctrinal_anchor",
                "statutory_anchor",
                "legislative_history",
                "academic_commentary",
                "theoretical_anchor",
                "policy_analysis",
                "case_example",
                "application_example",
                "counter_position",
                "institutional_context",
                "background_context",
                "weak_or_uncertain",
              ],
            },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            rationale: { type: "string" },
          },
          required: ["contract_id", "role", "confidence", "rationale"],
          additionalProperties: false,
        },
      },
    },
    required: ["classifications"],
    additionalProperties: false,
  },
};

const CLASSIFIER_SYSTEM_PROMPT = `אתה מסווג מקורות משפטיים לפי תפקיד (source role). קבל רשימת כרטיסי מקור ותכנית מחקר; החזר תפקיד עבור כל כרטיס.

תפקידי-מקור:
- doctrinal_anchor — פסק דין מכונן שמבסס/פירש את הדוקטרינה הנדונה. הסכמה עם תכנית המחקר חיונית: אם התכנית עוסקת בפרשנות חוזים, רק פסק דין על פרשנות חוזים יכול להיות doctrinal_anchor — לא פסק דין מערכאה גבוהה בנושא אחר.
- statutory_anchor — החוק / הסעיף עצמו שהשאלה מתייחסת אליו. רק כרטיס מסוג חקיקה שתוכן הסעיף הרלוונטי בו.
- legislative_history — הצעות חוק, פרוטוקולי ועדה, מחקרי כנסת.
- academic_commentary — מאמר אקדמי שמבקר/מסביר את הדוקטרינה.
- theoretical_anchor — עמדה אקדמית קנונית שהיא הטענה התיאורטית עצמה.
- policy_analysis — ניתוח מדיניות, IDI, מכוני מחקר.
- case_example — פסק דין שממחיש את הדוקטרינה (כל ערכאה).
- application_example — פסק דין מערכאה כלשהי שמיישם דוקטרינה על עובדות. **בית משפט לענייני משפחה / שלום שעוסק ביישום מקרי לרוב נופל כאן, לא ב-doctrinal_anchor.**
- counter_position — דעת מיעוט / עמדה מנוגדת.
- institutional_context — רקע מוסדי על המוסד / ההליך הרלוונטי.
- background_context — הקשר כללי שאינו תומך טענה ספציפית.
- weak_or_uncertain — לא מצליח להציב בוודאות.

חשוב:
- אל תיתן doctrinal_anchor רק כי המקור מערכאה גבוהה. נדרש שהמקור עוסק בדוקטרינה הספציפית של תכנית המחקר.
- אל תוריד מקור מערכאה נמוכה אוטומטית. ערכאה נמוכה יכולה להיות application_example לגיטימי.
- ביטחון high רק כשהמקור משרת בבירור את התפקיד; medium ברירת מחדל; low אם יש ספק אמיתי.

החזר JSON בלבד דרך הכלי submit_source_role_classification.`;

/**
 * Classify a list of cards in batches. Always non-throwing; on failure each
 * card receives `background_context` / `low` defaults.
 */
export async function classifySourceRoles(
  cards: ClassifierInputCard[],
  plan: LegalResearchPlan,
): Promise<ClassifierResult> {
  const items: ClassifierOutputItem[] = [];
  const runs: StageRun[] = [];
  let fallbackCount = 0;

  if (cards.length === 0) {
    return { items, runs, fallbackCount };
  }

  // Cap to MAX_BATCHES * BATCH_SIZE total; remainder gets default classification.
  const classifiable = cards.slice(0, MAX_BATCHES * BATCH_SIZE);
  const remainder = cards.slice(MAX_BATCHES * BATCH_SIZE);

  const batches: ClassifierInputCard[][] = [];
  for (let i = 0; i < classifiable.length; i += BATCH_SIZE) {
    batches.push(classifiable.slice(i, i + BATCH_SIZE));
  }

  // Run batches in parallel — each ~3-6s on Gemini Flash.
  const results = await Promise.all(
    batches.map((batch) => classifyBatch(batch, plan)),
  );

  const seen = new Set<string>();
  for (const r of results) {
    runs.push(r.run);
    for (const item of r.items) {
      if (seen.has(item.contractId)) continue;
      seen.add(item.contractId);
      items.push(item);
    }
    fallbackCount += r.fallbackCount;
  }

  // Any classifiable card that didn't get a classification → default.
  for (const c of classifiable) {
    if (!seen.has(c.contractId)) {
      items.push(defaultClassification(c));
      seen.add(c.contractId);
      fallbackCount++;
    }
  }
  for (const c of remainder) {
    items.push(defaultClassification(c));
    fallbackCount++;
  }

  return { items, runs, fallbackCount };
}

async function classifyBatch(
  batch: ClassifierInputCard[],
  plan: LegalResearchPlan,
): Promise<{ items: ClassifierOutputItem[]; run: StageRun; fallbackCount: number }> {
  const userPrompt = buildBatchPrompt(batch, plan);
  const { data, run } = await callPlannerJSON<{
    classifications: Array<{
      contract_id: string;
      role: SourceRole;
      confidence: "high" | "medium" | "low";
      rationale: string;
    }>;
  }>(
    CLASSIFIER_SYSTEM_PROMPT,
    userPrompt,
    CLASSIFIER_TOOL,
    {
      stage: "source_role_classifier",
      timeoutMs: 14000,
      reasoningEffort: "minimal",
      forceProvider: "gemini",
    },
  );

  if (!data || !Array.isArray(data.classifications)) {
    return {
      items: batch.map((c) => defaultClassification(c)),
      run,
      fallbackCount: batch.length,
    };
  }

  const validIds = new Set(batch.map((b) => b.contractId));
  const out: ClassifierOutputItem[] = [];
  const seen = new Set<string>();
  let fallbackCount = 0;
  for (const item of data.classifications) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.contract_id !== "string" || !validIds.has(item.contract_id)) continue;
    if (seen.has(item.contract_id)) continue;
    seen.add(item.contract_id);
    out.push({
      contractId: item.contract_id,
      role: normalizeRole(item.role),
      roleConfidence: normalizeConfidence(item.confidence),
      rationale: typeof item.rationale === "string" ? item.rationale.slice(0, 160) : "",
    });
  }
  // Backfill any card the model skipped.
  for (const c of batch) {
    if (!seen.has(c.contractId)) {
      out.push(defaultClassification(c));
      fallbackCount++;
    }
  }
  return { items: out, run, fallbackCount };
}

function defaultClassification(c: ClassifierInputCard): ClassifierOutputItem {
  return {
    contractId: c.contractId,
    role: "background_context",
    roleConfidence: "low",
    rationale: "classifier_fallback",
  };
}

function normalizeRole(r: unknown): SourceRole {
  const valid: SourceRole[] = [
    "doctrinal_anchor",
    "statutory_anchor",
    "legislative_history",
    "academic_commentary",
    "theoretical_anchor",
    "policy_analysis",
    "case_example",
    "application_example",
    "counter_position",
    "institutional_context",
    "background_context",
    "weak_or_uncertain",
  ];
  return valid.includes(r as SourceRole) ? (r as SourceRole) : "background_context";
}

function normalizeConfidence(c: unknown): "high" | "medium" | "low" {
  return c === "high" || c === "medium" || c === "low" ? c : "low";
}

function buildBatchPrompt(batch: ClassifierInputCard[], plan: LegalResearchPlan): string {
  const planLines: string[] = [];
  planLines.push(`אסטרטגיית תשובה: ${plan.answerStrategy}`);
  if (plan.statuteNames?.length) {
    planLines.push(`חוקים מרכזיים: ${plan.statuteNames.slice(0, 4).join(", ")}`);
  }
  if (plan.doctrinalAnchorNames?.length) {
    planLines.push(`עוגנים דוקטרינריים מזוהים: ${plan.doctrinalAnchorNames.slice(0, 4).join(", ")}`);
  }
  planLines.push(
    `תפקידים נדרשים: ${plan.requiredRoles.map((r) => `${r.role}(${r.priority})`).join(", ")}`,
  );

  const cardLines = batch.map((c) => {
    const meta: string[] = [`type=${c.sourceType}`];
    if (c.court) meta.push(`court=${c.court}`);
    if (c.year) meta.push(`year=${c.year}`);
    if (c.caseNumber) meta.push(`case=${c.caseNumber}`);
    const excerpt = (c.excerpt || "").replace(/\s+/g, " ").slice(0, 320);
    return `[${c.contractId}] ${meta.join(" ")}\nכותרת: ${c.title}\nתקציר: ${excerpt}`;
  });

  return `תכנית המחקר:\n${planLines.join("\n")}\n\nכרטיסי מקור לסיווג:\n\n${cardLines.join("\n\n")}`;
}
