// Schema validators for analyzer + planner outputs.
// Strict in spirit, lenient in shape — we coerce/normalize before validating.

import {
  ANSWER_TYPES,
  AnalyzerOutput,
  AnswerIntent,
  CAPS,
  Claim,
  CONFIDENCE_POSTURES,
  ConfidencePosture,
  EXPECTED_SOURCE_TYPES,
  OUTPUT_SHAPES,
  OutputShape,
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

  return {
    ok: errors.length === 0,
    value: {
      confidence,
      legal_area,
      answer_type,
      claims,
      ...(interpretation_note ? { interpretation_note } : {}),
      ...(answer_intent ? { answer_intent } : {}),
    },
    errors,
    truncated_claims_count,
    truncated_queries_count: 0,
  };
}

// Parse the optional analyzer answer_intent. Tolerant by design: if the model
// omits it or emits an unusable shape, return undefined so validateAnalyzer
// stays ok. Enum values are coerced to safe defaults; arrays are clamped to
// strings and capped at 8 items each. Requires output_shape + confidence_posture
// to be present as strings — otherwise the whole object is dropped.
function parseAnswerIntent(raw: unknown): AnswerIntent | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;

  const shapeRaw = r.output_shape;
  const postureRaw = r.confidence_posture;
  if (typeof shapeRaw !== "string" || typeof postureRaw !== "string") {
    return undefined;
  }

  const output_shape: OutputShape =
    (OUTPUT_SHAPES as readonly string[]).includes(shapeRaw)
      ? (shapeRaw as OutputShape)
      : "other";
  const confidence_posture: ConfidencePosture =
    (CONFIDENCE_POSTURES as readonly string[]).includes(postureRaw)
      ? (postureRaw as ConfidencePosture)
      : "cautious_if_partial";

  const toStrArr = (x: unknown): string[] => {
    if (!Array.isArray(x)) return [];
    return x
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .map((s) => s.trim())
      .slice(0, 8);
  };

  return {
    output_shape,
    must_include: toStrArr(r.must_include),
    must_avoid: toStrArr(r.must_avoid),
    confidence_posture,
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
