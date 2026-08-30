// Schema validators for analyzer + planner outputs.
// Strict in spirit, lenient in shape — we coerce/normalize before validating.

import {
  ANSWER_TYPES,
  AnalyzerOutput,
  ANSWER_STRATEGIES,
  AnswerIntent,
  AnswerStrategy,
  AuthorityRequirements,
  CAPS,
  Claim,
  EXPECTED_SOURCE_TYPES,
  OUTPUT_SHAPES,
  OutputShape,
  PLAN_CONFIDENCES,
  PlanConfidence,
  SOURCE_USE_INTENTS,
  SourceUseIntent,
  SourceUsePlan,
  USER_TASK_INTENTS,
  UserTaskIntent,
  PlannerOutput,
  QUERY_TARGETS,
  Query,
  SOURCE_ROLES,
  SourceRole,
  AnswerType,
  QueryTarget,
  ExpectedSourceType,
} from "./types.ts";

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  errors: string[];
  truncated_claims_count: number;
  truncated_queries_count: number;
}

function isStr(x: unknown): x is string {
  return typeof x === "string" && x.length > 0;
}

// ─── Analyzer ──────────────────────────────────────────────────────────────
export function validateAnalyzer(raw: unknown): ValidationResult<AnalyzerOutput> {
  const errors: string[] = [];
  const r = (raw ?? {}) as Record<string, unknown>;

  let confidence = Number(r.confidence);
  if (!Number.isFinite(confidence)) {
    errors.push("confidence: not a finite number");
    confidence = 0;
  } else {
    confidence = Math.max(0, Math.min(1, confidence));
  }

  const legal_area = isStr(r.legal_area) ? (r.legal_area as string) : "";
  if (!legal_area) errors.push("legal_area: missing/empty");

  let answer_type = r.answer_type as AnswerType;
  if (!ANSWER_TYPES.includes(answer_type)) {
    errors.push(`answer_type: invalid (${String(r.answer_type)})`);
    answer_type = "other";
  }

  const claimsRaw = Array.isArray(r.claims) ? r.claims : [];
  if (claimsRaw.length === 0) errors.push("claims: empty");

  let truncated_claims_count = 0;
  let workingClaims = claimsRaw;
  if (workingClaims.length > CAPS.MAX_CLAIMS) {
    truncated_claims_count = workingClaims.length - CAPS.MAX_CLAIMS;
    workingClaims = workingClaims.slice(0, CAPS.MAX_CLAIMS);
  }

  const claims: Claim[] = [];
  workingClaims.forEach((c, i) => {
    const cr = (c ?? {}) as Record<string, unknown>;
    const claim_id = isStr(cr.claim_id) ? (cr.claim_id as string) : `C${i + 1}`;
    const text_he = isStr(cr.text_he) ? (cr.text_he as string) : "";
    if (!text_he) errors.push(`claims[${i}].text_he: missing`);

    const rolesArr = Array.isArray(cr.required_roles) ? cr.required_roles : [];
    const required_roles = rolesArr.filter((x): x is SourceRole =>
      typeof x === "string" && (SOURCE_ROLES as readonly string[]).includes(x)
    );
    // Note: empty required_roles is a soft signal — escalation B4 will catch it.

    const is_black_letter = cr.is_black_letter === true;
    const reason = isStr(cr.reason) ? (cr.reason as string) : "";

    claims.push({ claim_id, text_he, required_roles, is_black_letter, reason });
  });

  const interpretation_note = isStr(r.interpretation_note)
    ? (r.interpretation_note as string).trim()
    : undefined;

  const answer_intent = parseAnswerIntent(r.answer_intent);
  const source_use_plan = parseSourceUsePlan(r.source_use_plan);

  return {
    ok: errors.length === 0,
    value: {
      confidence,
      legal_area,
      answer_type,
      claims,
      ...(interpretation_note ? { interpretation_note } : {}),
      ...(answer_intent ? { answer_intent } : {}),
      ...(source_use_plan ? { source_use_plan } : {}),
    },
    errors,
    truncated_claims_count,
    truncated_queries_count: 0,
  };
}

// Parse the optional analyzer answer_intent. Tolerant by design: if the model
// omits it or emits an unusable shape, return undefined so validateAnalyzer
// stays ok. This is a *format hint* only — no confidence/caveat fields.
function parseAnswerIntent(raw: unknown): AnswerIntent | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const shapeRaw = r.output_shape;
  if (typeof shapeRaw !== "string") return undefined;
  const output_shape: OutputShape =
    (OUTPUT_SHAPES as readonly string[]).includes(shapeRaw)
      ? (shapeRaw as OutputShape)
      : "unknown";
  if (output_shape === "unknown") return undefined;
  return { output_shape };
}

// source_use_intent_planning_v1 — parse the optional task/source-use plan.
// Tolerant: unusable payloads return undefined so the deterministic
// normalizer (stages/sourceUseIntent.ts) supplies a conservative fallback.
function parseSourceUsePlan(raw: unknown): SourceUsePlan | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const task = r.user_task_intent;
  if (typeof task !== "string" || !(USER_TASK_INTENTS as readonly string[]).includes(task)) {
    return undefined;
  }
  const user_task_intent = task as UserTaskIntent;

  const useArr = Array.isArray(r.source_use_intent) ? r.source_use_intent : [];
  const source_use_intent = useArr.filter((x): x is SourceUseIntent =>
    typeof x === "string" && (SOURCE_USE_INTENTS as readonly string[]).includes(x)
  );

  const stratRaw = r.answer_strategy;
  const answer_strategy: AnswerStrategy =
    typeof stratRaw === "string" && (ANSWER_STRATEGIES as readonly string[]).includes(stratRaw)
      ? (stratRaw as AnswerStrategy)
      : "limited_answer_with_gaps";

  const confRaw = r.plan_confidence;
  const plan_confidence: PlanConfidence =
    typeof confRaw === "string" && (PLAN_CONFIDENCES as readonly string[]).includes(confRaw)
      ? (confRaw as PlanConfidence)
      : "low";

  const ar = (r.authority_requirements ?? {}) as Record<string, unknown>;
  const authority_requirements: AuthorityRequirements = {
    requires_judgment_body: ar.requires_judgment_body === true,
    requires_official_statute: ar.requires_official_statute === true,
    secondary_sources_can_support: ar.secondary_sources_can_support === true,
    found_only_allowed_as_reading_list: ar.found_only_allowed_as_reading_list === true,
    // Never model-controlled.
    found_only_can_support_claims: false,
  };

  const secondaryRaw = r.secondary_task_intent;
  const secondary_task_intent =
    typeof secondaryRaw === "string" &&
      (USER_TASK_INTENTS as readonly string[]).includes(secondaryRaw) &&
      secondaryRaw !== user_task_intent
      ? (secondaryRaw as UserTaskIntent)
      : undefined;

  return {
    user_task_intent,
    source_use_intent,
    answer_strategy,
    authority_requirements,
    plan_confidence,
    mixed_plan: r.mixed_plan === true || !!secondary_task_intent,
    ...(secondary_task_intent ? { secondary_task_intent } : {}),
    ...(typeof r.reason === "string" && r.reason.trim() ? { reason: r.reason.trim() } : {}),
  };
}


// ─── Planner ────────────────────────────────────────────────────────────────
export function validatePlanner(
  raw: unknown,
  knownClaimIds: string[],
): ValidationResult<PlannerOutput> {
  const errors: string[] = [];
  const r = (raw ?? {}) as Record<string, unknown>;
  const queriesRaw = Array.isArray(r.queries) ? r.queries : [];
  if (queriesRaw.length === 0) errors.push("queries: empty");

  const validClaimIds = new Set(knownClaimIds);
  const perClaimCount: Record<string, number> = {};
  let truncated_queries_count = 0;
  const queries: Query[] = [];

  for (let i = 0; i < queriesRaw.length; i++) {
    const q = (queriesRaw[i] ?? {}) as Record<string, unknown>;
    const claim_id = isStr(q.claim_id) ? (q.claim_id as string) : "";
    if (!claim_id || !validClaimIds.has(claim_id)) {
      errors.push(`queries[${i}].claim_id: unknown (${claim_id})`);
      continue;
    }
    const role = q.role as SourceRole;
    if (!(SOURCE_ROLES as readonly string[]).includes(role as string)) {
      errors.push(`queries[${i}].role: invalid (${String(q.role)})`);
      continue;
    }
    const query_he = isStr(q.query_he) ? (q.query_he as string).trim() : "";
    if (!query_he) {
      errors.push(`queries[${i}].query_he: missing`);
      continue;
    }
    const targetsArr = Array.isArray(q.targets) ? q.targets : [];
    const targets = targetsArr.filter((t): t is QueryTarget =>
      typeof t === "string" && (QUERY_TARGETS as readonly string[]).includes(t)
    );
    if (targets.length === 0) {
      errors.push(`queries[${i}].targets: empty`);
      continue;
    }
    let expected_source_type = q.expected_source_type as ExpectedSourceType;
    if (!(EXPECTED_SOURCE_TYPES as readonly string[]).includes(expected_source_type as string)) {
      expected_source_type = "other";
    }
    const reason = isStr(q.reason) ? (q.reason as string) : "";

    const seen = perClaimCount[claim_id] ?? 0;
    if (seen >= CAPS.MAX_QUERIES_PER_CLAIM) {
      truncated_queries_count++;
      continue;
    }
    perClaimCount[claim_id] = seen + 1;
    queries.push({ claim_id, role, query_he, targets, expected_source_type, reason });
  }

  return {
    ok: errors.length === 0,
    value: { queries },
    errors,
    truncated_claims_count: 0,
    truncated_queries_count,
  };
}

// JSON schemas for the tool-call (structured output) request body.
export const ANALYZER_TOOL_PARAMETERS: Record<string, unknown> = {
  type: "object",
  properties: {
    confidence: { type: "number", minimum: 0, maximum: 1 },
    legal_area: { type: "string" },
    answer_type: { type: "string", enum: [...ANSWER_TYPES] },
    interpretation_note: {
      type: "string",
      description:
        "Optional free-text note (Hebrew) recording how the analyzer disambiguated a key legal term in the user's question. Emit only when a disambiguation rule from the system prompt actually fired. Example: 'מנדטורי פורש כפקודה מתקופת המנדט הבריטי'.",
    },
    claims: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          claim_id: { type: "string" },
          text_he: { type: "string" },
          required_roles: {
            type: "array",
            items: { type: "string", enum: [...SOURCE_ROLES] },
          },
          is_black_letter: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["claim_id", "text_he", "required_roles", "is_black_letter", "reason"],
        additionalProperties: false,
      },
    },
    answer_intent: {
      type: "object",
      description:
        "Optional lightweight output-shape hint for the drafter. Emit whenever the user's phrasing clearly implies a specific format (quote, definition, list of items, timeline/dates, case holding, analysis, comparison). Omit entirely when unclear. This is a format signal only — do NOT use it to signal confidence or evidentiary posture.",
      properties: {
        output_shape: { type: "string", enum: [...OUTPUT_SHAPES] },
      },
      required: ["output_shape"],
      additionalProperties: false,
    },
    source_use_plan: {
      type: "object",
      description:
        "Substance-based plan of what the user is asking the system to DO with sources. Judge the substance of the request, never a phrase trigger. Emit whenever you can characterise the task; omit only when genuinely unclear. Ordinary legal/doctrinal questions must NOT be planned as source_recommendation / literature_map / bibliography_only — those apply only when the user genuinely asks for research guidance, literature mapping, seminar planning or reading recommendations. When the user asks the system to WRITE academic prose (מבוא, רקע תיאורטי, פרק תיאורטי, הצגת נושא, פסקת טיעון, מתווה פרקים, פרק לסמינריון/עבודה אקדמית) plan user_task_intent=academic_writing with answer_strategy=draft_academic_text — never as a doctrinal explanation or a source-gap report; when the user asks only for sources/bibliography for a paper, keep literature_map / source_recommendation. Set mixed_plan=true (with secondary_task_intent) when the question genuinely combines legal explanation with research guidance, and prefer mixed_plan over forcing one intent when plan_confidence is low.",
      properties: {
        user_task_intent: { type: "string", enum: [...USER_TASK_INTENTS] },
        source_use_intent: {
          type: "array",
          items: { type: "string", enum: [...SOURCE_USE_INTENTS] },
        },
        answer_strategy: { type: "string", enum: [...ANSWER_STRATEGIES] },
        plan_confidence: { type: "string", enum: [...PLAN_CONFIDENCES] },
        mixed_plan: { type: "boolean" },
        secondary_task_intent: { type: "string", enum: [...USER_TASK_INTENTS] },
        authority_requirements: {
          type: "object",
          properties: {
            requires_judgment_body: { type: "boolean" },
            requires_official_statute: { type: "boolean" },
            secondary_sources_can_support: { type: "boolean" },
            found_only_allowed_as_reading_list: { type: "boolean" },
          },
          required: [
            "requires_judgment_body",
            "requires_official_statute",
            "secondary_sources_can_support",
            "found_only_allowed_as_reading_list",
          ],
          additionalProperties: false,
        },
        reason: { type: "string" },
      },
      required: [
        "user_task_intent",
        "source_use_intent",
        "answer_strategy",
        "plan_confidence",
        "mixed_plan",
        "authority_requirements",
      ],
      additionalProperties: false,
    },
  },
  required: ["confidence", "legal_area", "answer_type", "claims"],
  additionalProperties: false,
};


export const PLANNER_TOOL_PARAMETERS: Record<string, unknown> = {
  type: "object",
  properties: {
    queries: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          claim_id: { type: "string" },
          role: { type: "string", enum: [...SOURCE_ROLES] },
          query_he: { type: "string" },
          targets: {
            type: "array",
            items: { type: "string", enum: [...QUERY_TARGETS] },
            minItems: 1,
          },
          expected_source_type: { type: "string", enum: [...EXPECTED_SOURCE_TYPES] },
          reason: { type: "string" },
        },
        required: ["claim_id", "role", "query_he", "targets", "expected_source_type", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["queries"],
  additionalProperties: false,
};
