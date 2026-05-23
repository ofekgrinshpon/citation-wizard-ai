// Research Core v1 — Semantic Doctrine Classifier.
//
// Additive stage between planner and source_requirements.
// Identifies legal doctrines + required source roles using a small LLM
// call constrained to a controlled taxonomy. Does NOT replace the planner
// and does NOT mutate retrieval/verifier/drafter behavior.
//
// If the call fails (timeout / parse error / no LOVABLE_API_KEY), the
// caller continues without classifier output.

import type { PlanV1, StageRun } from "./types.ts";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "openai/gpt-5-mini";
const TIMEOUT_MS = 20_000;

// Controlled taxonomy — keep narrow on purpose.
//
// Coverage invariant: every ID in ACTIVE_DOCTRINE_TAXONOMY MUST have a
// SourceRequirements bundle reachable via CLASSIFIER_TO_SR_DOCTRINE.
// IDs we recognize semantically but have NOT implemented yet live in
// UNIMPLEMENTED_DOCTRINES — the classifier is allowed to detect them
// (so we get telemetry), but they are NOT promoted to active doctrines
// and do NOT trigger source_requirements.
export const ACTIVE_DOCTRINE_TAXONOMY = [
  "temporary_injunction",
  "stay_of_execution",
  "pre_contractual_good_faith",
  "contract_interpretation",
  "relative_voidness",
  "reasonableness_review",
  "protection_money_extortion",
  "legislative_omission",
] as const;

export const UNIMPLEMENTED_DOCTRINES = [
  "hearing_duty",
  "alternative_remedy_exhaustion",
  "constitutional_limitation_clause",
  "statutory_interpretation",
  "jurisdiction_subject_matter",
] as const;

export const DOCTRINE_TAXONOMY = [
  ...ACTIVE_DOCTRINE_TAXONOMY,
  ...UNIMPLEMENTED_DOCTRINES,
] as const;

export type DoctrineId = typeof DOCTRINE_TAXONOMY[number];
export type ActiveDoctrineId = typeof ACTIVE_DOCTRINE_TAXONOMY[number];
export type UnimplementedDoctrineId = typeof UNIMPLEMENTED_DOCTRINES[number];

export const LEGAL_AREA_TAXONOMY = [
  "criminal_law",
  "constitutional_law",
  "administrative_law",
  "civil_procedure",
  "contract_law",
  "tort_law",
  "property_law",
  "labor_law",
  "tax_law",
  "family_law",
] as const;

export const SOURCE_ROLE_TAXONOMY = [
  "primary_statute_section",
  "binding_case_law",
  "doctrinal_scholarship",
  "government_report",
  "regulation",
  "constitutional_provision",
] as const;

export interface ClassifiedDoctrine {
  id: DoctrineId;
  confidence: number;
  matched_text: string[];
  reason: string;
}

export interface UnmappedDoctrineWarning {
  id: string;
  confidence: number;
  reason: string;
}

export interface DoctrineClassification {
  /** Active doctrines that have a SourceRequirements bundle. */
  doctrines: ClassifiedDoctrine[];
  /** Detected but explicitly unimplemented — telemetry only, no SR trigger. */
  unimplemented_matches: ClassifiedDoctrine[];
  /**
   * Emitted IDs that are neither active nor explicitly unimplemented.
   * Should always be empty if invariants hold; presence indicates the
   * classifier emitted an out-of-taxonomy ID or an active ID lost its
   * SR mapping.
   */
  unmapped_doctrine_warnings: UnmappedDoctrineWarning[];
  legal_areas: string[];
  source_roles_needed: string[];
}

export interface ClassifyArgs {
  question: string;
  plan: PlanV1;
  lovableApiKey: string;
  signal?: AbortSignal;
}

export interface ClassifyResult {
  ok: boolean;
  classification?: DoctrineClassification;
  stageRun: StageRun;
  raw?: string;
}

const SYSTEM_PROMPT = `אתה מסווג דוקטרינות משפטיות. החזר JSON תקני בלבד.
שדות חובה: doctrines[] (id, confidence 0-1, matched_text[], reason), legal_areas[], source_roles_needed[].
השתמש אך ורק במזהים מתוך הטקסונומיה המסופקת. אם אין דוקטרינה מתאימה בביטחון סביר — החזר doctrines: [].
שמור confidence ריאלי: 0.85+ רק כשהשאלה כוללת ביטוי ישיר לדוקטרינה. הסבר reason בעברית קצרה.`;

function userPrompt(args: ClassifyArgs): string {
  const { question, plan } = args;
  const claims = plan.claims.map((c, i) => `${i + 1}. ${c.text}`).join("\n");
  const auths = (plan.expected_authorities || [])
    .map((a) => (typeof a === "string" ? a : (a as { label?: string }).label || ""))
    .filter(Boolean)
    .slice(0, 12)
    .join(" | ");
  const anchors = (plan.factual_anchor_terms || []).slice(0, 12).join(" | ");
  return [
    `שאלה: ${question}`,
    `תזה: ${plan.thesis || ""}`,
    `מסגרת דוקטרינלית: ${plan.doctrinal_frame || ""}`,
    `טענות:\n${claims}`,
    `סמכויות צפויות: ${auths}`,
    `עוגנים עובדתיים: ${anchors}`,
    "",
    `טקסונומיית doctrines: ${DOCTRINE_TAXONOMY.join(", ")}`,
    `טקסונומיית legal_areas: ${LEGAL_AREA_TAXONOMY.join(", ")}`,
    `טקסונומיית source_roles_needed: ${SOURCE_ROLE_TAXONOMY.join(", ")}`,
    "",
    `החזר אובייקט JSON יחיד. אל תוסיף טקסט מחוץ ל-JSON.`,
  ].join("\n");
}

function sanitize(raw: unknown): DoctrineClassification {
  const obj = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
  const docArr = Array.isArray(obj.doctrines) ? obj.doctrines : [];
  const activeIds = new Set<string>(ACTIVE_DOCTRINE_TAXONOMY);
  const unimplementedIds = new Set<string>(UNIMPLEMENTED_DOCTRINES);
  const doctrines: ClassifiedDoctrine[] = [];
  const unimplemented_matches: ClassifiedDoctrine[] = [];
  const unmapped_doctrine_warnings: UnmappedDoctrineWarning[] = [];
  for (const d of docArr) {
    if (!d || typeof d !== "object") continue;
    const dd = d as Record<string, unknown>;
    const id = typeof dd.id === "string" ? dd.id : "";
    if (!id) continue;
    const conf = typeof dd.confidence === "number" ? Math.max(0, Math.min(1, dd.confidence)) : 0;
    const matched = Array.isArray(dd.matched_text)
      ? dd.matched_text.filter((x): x is string => typeof x === "string").slice(0, 6)
      : [];
    const reason = typeof dd.reason === "string" ? dd.reason.slice(0, 240) : "";
    if (activeIds.has(id)) {
      // Invariant guard: active ID must have an SR mapping.
      if (!CLASSIFIER_TO_SR_DOCTRINE[id as ActiveDoctrineId]) {
        unmapped_doctrine_warnings.push({ id, confidence: conf, reason: "active_id_missing_sr_mapping" });
        continue;
      }
      doctrines.push({ id: id as DoctrineId, confidence: conf, matched_text: matched, reason });
    } else if (unimplementedIds.has(id)) {
      unimplemented_matches.push({ id: id as DoctrineId, confidence: conf, matched_text: matched, reason });
    } else {
      unmapped_doctrine_warnings.push({ id, confidence: conf, reason: reason || "out_of_taxonomy" });
    }
  }
  const allowedAreas = new Set<string>(LEGAL_AREA_TAXONOMY);
  const allowedRoles = new Set<string>(SOURCE_ROLE_TAXONOMY);
  const legal_areas = Array.isArray(obj.legal_areas)
    ? obj.legal_areas.filter((x): x is string => typeof x === "string" && allowedAreas.has(x)).slice(0, 6)
    : [];
  const source_roles_needed = Array.isArray(obj.source_roles_needed)
    ? obj.source_roles_needed.filter((x): x is string => typeof x === "string" && allowedRoles.has(x)).slice(0, 8)
    : [];
  return { doctrines, unimplemented_matches, unmapped_doctrine_warnings, legal_areas, source_roles_needed };
}

export async function classifyDoctrines(args: ClassifyArgs): Promise<ClassifyResult> {
  const t0 = Date.now();
  const baseRun = {
    stage: "doctrine_classifier",
    model: MODEL,
  } as Partial<StageRun> & { stage: string };

  if (!args.lovableApiKey) {
    return {
      ok: false,
      stageRun: {
        ...baseRun,
        duration_ms: Date.now() - t0,
        status: "error",
        error: "missing_lovable_api_key",
      } as StageRun,
    };
  }

  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, TIMEOUT_MS);
  const onParentAbort = () => ctrl.abort();
  args.signal?.addEventListener("abort", onParentAbort, { once: true });

  try {
    const r = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        reasoning_effort: "minimal",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt(args) },
        ],
      }),
      signal: ctrl.signal,
    });

    if (!r.ok) {
      const body = await r.text();
      return {
        ok: false,
        stageRun: {
          ...baseRun,
          duration_ms: Date.now() - t0,
          status: "error",
          error: `gateway_${r.status}:${body.slice(0, 160)}`,
        } as StageRun,
      };
    }

    const j = await r.json();
    const raw = j?.choices?.[0]?.message?.content ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return {
        ok: false,
        raw,
        stageRun: {
          ...baseRun,
          duration_ms: Date.now() - t0,
          status: "error",
          error: `parse_error:${(e as Error).message}`,
        } as StageRun,
      };
    }

    const classification = sanitize(parsed);
    return {
      ok: true,
      classification,
      raw,
      stageRun: {
        ...baseRun,
        duration_ms: Date.now() - t0,
        status: "ok",
        metadata: {
          active_doctrines: classification.doctrines.map((d) => ({ id: d.id, confidence: d.confidence })),
          unimplemented_matches: classification.unimplemented_matches.map((d) => ({ id: d.id, confidence: d.confidence })),
          unmapped_doctrine_warnings: classification.unmapped_doctrine_warnings,
          doctrine_count: classification.doctrines.length,
          unimplemented_count: classification.unimplemented_matches.length,
          unmapped_warning_count: classification.unmapped_doctrine_warnings.length,
        },
      } as StageRun,
    };
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    return {
      ok: false,
      stageRun: {
        ...baseRun,
        duration_ms: Date.now() - t0,
        status: "error",
        error: timedOut ? "timeout" : `threw:${msg}`,
      } as StageRun,
    };
  } finally {
    clearTimeout(timer);
    args.signal?.removeEventListener("abort", onParentAbort);
  }
}

/**
 * Map ACTIVE classifier doctrine IDs → sourceRequirements doctrine_id values.
 *
 * Coverage invariant: this map MUST cover every entry in
 * ACTIVE_DOCTRINE_TAXONOMY. The runtime assertion below guards against
 * drift. IDs in UNIMPLEMENTED_DOCTRINES intentionally do NOT appear here —
 * they are recorded as telemetry only.
 */
export const CLASSIFIER_TO_SR_DOCTRINE: Record<ActiveDoctrineId, string> = {
  protection_money_extortion: "protection_money_extortion",
  legislative_omission: "legislative_omission_duty_to_legislate",
  temporary_injunction: "temporary_injunction",
  stay_of_execution: "stay_of_execution",
  pre_contractual_good_faith: "pre_contractual_good_faith",
  contract_interpretation: "contract_interpretation",
  relative_voidness: "relative_voidness",
  reasonableness_review: "reasonableness_review",
};

// Coverage invariant — fail loudly on module load if any active doctrine
// lacks an SR mapping. Cheap O(n) check at import time.
for (const id of ACTIVE_DOCTRINE_TAXONOMY) {
  if (!CLASSIFIER_TO_SR_DOCTRINE[id]) {
    throw new Error(
      `[doctrineClassifier] coverage invariant violated: active doctrine '${id}' has no SourceRequirements mapping. ` +
      `Either add a bundle + entry in CLASSIFIER_TO_SR_DOCTRINE, or move the id to UNIMPLEMENTED_DOCTRINES.`,
    );
  }
}

export const CLASSIFIER_CONFIDENCE_THRESHOLD = 0.65;
