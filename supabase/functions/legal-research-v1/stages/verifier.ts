// P4 — Source Verifier (P6.2a: batched).
// Verifier runs at most 1–2 batched LLM calls per run instead of one call per
// claim. Each batch contains one or more whole claims plus all their
// candidates; the model emits one verdict per (candidate_id, claim_id) pair
// it was given. role_match is still computed deterministically in code.
// Acceptance behavior (direct/partial usable, tangential/unrelated dropped)
// and per-candidate aggregation are unchanged from the per-claim version.

import { callOpenAIJsonTool } from "../lib/openai.ts";
import {
  Candidate,
  Claim,
  DroppedCandidate,
  MODEL_FULL,
  MODEL_MINI,
  StageRun,
  SUPPORT_LEVELS,
  SourceRole,
  SupportLevel,
  UsableCandidate,
  Verdict,
} from "../lib/types.ts";

// Batching threshold (total candidates across all claims in this run).
const SINGLE_BATCH_MAX = 24;
// If any individual claim has more candidates than this, it gets its own call.
const PER_CLAIM_OVERSIZED = 24;

const SYSTEM_PROMPT = `אתה מאמת מקורות משפטי (Source Verifier) במערכת מחקר משפטי ישראלית.
תקבל שאלה אחת של המשתמש, רשימת טענות משפטיות (claims), ורשימת מועמדים (candidates) שאוחזרו עבורן.
כל מועמד מתויג עם ה-claim_id של הטענה שעבורה אוחזר.
המשימה: לקבוע עבור כל זוג (candidate_id, claim_id) שסיפקתי לך עד כמה המועמד תומך בטענה הספציפית הזו.

ערכי support מותרים: direct, partial, tangential, unrelated.

הגדרות:
- direct: המקור עוסק ישירות בטענה ויכול לשמש בסיס לכתיבה (סעיף חוק רלוונטי, פסק דין על אותה דוקטרינה, מאמר שעוסק מפורשות בנושא).
- partial: עוסק בנושא הקרוב או באספקט מסוים של הטענה, שמיש כתמיכה משלימה.
- tangential: נוגע רק בשולי הנושא (אזכור צדדי, רקע רחב, מקור על תחום סמוך).
- unrelated: לא קשור לטענה כלל (גם אם הכותרת נראית דומה).

כללים:
- חוק (primary_statute) יכול לתמוך ישירות בכלל משפטי "ספרי" (black-letter).
- פסיקה (binding_case_law / persuasive_case_law) יכולה לתמוך בדוקטרינה וביישומה.
- ספרות (scholarship) מסבירה דוקטרינה אך אינה תחליף לחוק/פסיקה כשנדרש דין מהותי.
- דו"חות (factual_report / government_report) מתאימים לרקע עובדתי, לא לכלל משפטי בפני עצמם.
- דחה (unrelated) מועמדי exact_authority "רועשים": אם הכותרת והקטע אינם נוגעים לטענה, גם אם השם דמה — לדוגמה "החוק העותומני על האגודות", "חוק אמנת האג", תקנות גמלאות לשרים, חוקי אמנת חברות בינלאומיות וכד' כאשר הטענה היא על פיצוי מוסכם / סעיף 15 לחוק החוזים תרופות.
- בטענות על "השתק פלוגתא" / "מעשה בית דין" / issue preclusion: מועמדים העוסקים ב"השתק מחמת מצג" / promissory estoppel / estoppel by representation הם unrelated אלא אם הטענה מציינת מפורשות הבטחה/מצג/הסתמכות.
- supported_points: 1–3 נקודות קצרות בעברית המסבירות *מה* בדיוק תומך (ריק אם unrelated).
- reason: משפט קצר בעברית המסביר את ההחלטה, ובפרט עבור tangential/unrelated — מדוע נדחה.

החזר רק דרך הקריאה לכלי emit_verdicts. כלול verdict אחד לכל זוג (candidate_id, claim_id) שסיפקתי לך — בדיוק לפי אותם candidate_id ו-claim_id, ללא המצאות.`;

const VERIFIER_TOOL_PARAMETERS: Record<string, unknown> = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          candidate_id: { type: "string" },
          claim_id: { type: "string" },
          support: { type: "string", enum: [...SUPPORT_LEVELS] },
          supported_points: {
            type: "array",
            items: { type: "string" },
            maxItems: 3,
          },
          reason: { type: "string" },
        },
        required: ["candidate_id", "claim_id", "support", "supported_points", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdicts"],
  additionalProperties: false,
};

interface RawVerdict {
  candidate_id?: unknown;
  claim_id?: unknown;
  support?: unknown;
  supported_points?: unknown;
  reason?: unknown;
}

function pairKey(candidate_id: string, claim_id: string): string {
  return `${candidate_id}::${claim_id}`;
}

function validateBatchVerdicts(
  raw: unknown,
  expectedPairs: Set<string>,
): { ok: boolean; verdicts: Verdict[]; errors: string[]; missing: string[] } {
  const errors: string[] = [];
  const r = (raw ?? {}) as Record<string, unknown>;
  const arr = Array.isArray(r.verdicts) ? (r.verdicts as RawVerdict[]) : [];
  const verdicts: Verdict[] = [];
  const seen = new Set<string>();
  for (const v of arr) {
    const candidate_id = typeof v.candidate_id === "string" ? v.candidate_id : "";
    const claim_id = typeof v.claim_id === "string" ? v.claim_id : "";
    if (!candidate_id || !claim_id) {
      errors.push(`missing candidate_id/claim_id`);
      continue;
    }
    const key = pairKey(candidate_id, claim_id);
    if (!expectedPairs.has(key)) {
      errors.push(`unknown pair: ${key}`);
      continue;
    }
    if (seen.has(key)) {
      errors.push(`duplicate pair: ${key}`);
      continue;
    }
    const support = typeof v.support === "string" &&
        (SUPPORT_LEVELS as readonly string[]).includes(v.support)
      ? (v.support as SupportLevel)
      : null;
    if (!support) {
      errors.push(`invalid support for ${key}: ${String(v.support)}`);
      continue;
    }
    const supported_points = Array.isArray(v.supported_points)
      ? (v.supported_points as unknown[]).filter((p): p is string => typeof p === "string" && p.length > 0).slice(0, 3)
      : [];
    const reason = typeof v.reason === "string" ? v.reason : "";
    seen.add(key);
    verdicts.push({
      candidate_id,
      claim_id,
      support,
      role_match: false, // filled in by caller
      supported_points,
      reason,
    });
  }
  const missing: string[] = [];
  for (const k of expectedPairs) {
    if (!seen.has(k)) missing.push(k);
  }
  // We tolerate a few unknown-pair errors without failing the whole batch,
  // but require that no expected pair is missing for the batch to be "ok".
  return { ok: missing.length === 0 && errors.length === 0, verdicts, errors, missing };
}

function buildBatchUserMessage(
  question: string,
  claims: Claim[],
  cands: Candidate[],
): string {
  const lines: string[] = [];
  lines.push(`שאלת המשתמש: ${question}`);
  lines.push("");
  lines.push(`טענות בקבוצה זו (${claims.length}):`);
  for (const cl of claims) {
    lines.push("---");
    lines.push(`claim_id: ${cl.claim_id}`);
    lines.push(`טענה: ${cl.text_he}`);
    lines.push(`required_roles: ${cl.required_roles.join(", ") || "(none)"}`);
    lines.push(`is_black_letter: ${cl.is_black_letter}`);
  }
  lines.push("");
  lines.push(`מועמדים בקבוצה זו (${cands.length}). כל מועמד אוחזר עבור claim_id הספציפי שלו ויש לחוות עליו דעה ביחס לאותה טענה בלבד:`);
  for (const c of cands) {
    const snip = (c.snippet || "").replace(/\s+/g, " ").trim().slice(0, 600);
    lines.push("---");
    lines.push(`candidate_id: ${c.candidate_id}`);
    lines.push(`claim_id: ${c.claim_id}`);
    lines.push(`role: ${c.role}`);
    lines.push(`source_type: ${c.source_type}`);
    lines.push(`origin: ${c.origin} (${c.retrieval_method})`);
    lines.push(`title: ${c.title}`);
    if (c.source_url) lines.push(`url: ${c.source_url}`);
    if (snip) lines.push(`snippet: ${snip}`);
  }
  lines.push("");
  lines.push(
    `החזר verdicts עבור כל ${cands.length} הזוגות (candidate_id, claim_id) לעיל, בשימוש באותם מזהים בדיוק.`,
  );
  return lines.join("\n");
}

function rolesMatch(candidateRole: SourceRole, required: SourceRole[]): boolean {
  if (required.length === 0) return true;
  if (required.includes(candidateRole)) return true;
  if (
    (candidateRole === "binding_case_law" && required.includes("persuasive_case_law")) ||
    (candidateRole === "persuasive_case_law" && required.includes("binding_case_law"))
  ) return true;
  return false;
}

const SUPPORT_RANK: Record<SupportLevel, number> = {
  direct: 0,
  partial: 1,
  tangential: 2,
  unrelated: 3,
};

export interface VerifierResult {
  ms: number;
  model_initial: string;
  model_final: string;
  escalated_claims: string[];
  per_claim_ms: Record<string, number>;
  verdicts: Verdict[];
  counts: {
    by_support: Record<SupportLevel, number>;
    by_role_match: { true: number; false: number };
  };
  candidates_verified: number;
  candidates_usable: number;
  candidates_dropped: number;
  usable: UsableCandidate[];
  dropped: DroppedCandidate[];
  stage_runs: StageRun[];
  errors: Array<{ claim_id: string; reason: string }>;
  batches: Array<{ label: string; claim_ids: string[]; candidates: number; escalated: boolean; ms: number }>;
}

interface Batch {
  label: string;
  claims: Claim[];
  candidates: Candidate[];
}

function planBatches(claims: Claim[], byClaim: Map<string, Candidate[]>): Batch[] {
  const present = claims.filter((c) => (byClaim.get(c.claim_id)?.length ?? 0) > 0);
  if (present.length === 0) return [];

  const oversized: Claim[] = [];
  const normal: Claim[] = [];
  for (const c of present) {
    const n = byClaim.get(c.claim_id)?.length ?? 0;
    if (n > PER_CLAIM_OVERSIZED) oversized.push(c);
    else normal.push(c);
  }

  const batches: Batch[] = [];
  // Oversized claims each get a dedicated batch.
  for (const c of oversized) {
    batches.push({
      label: `oversized.${c.claim_id}`,
      claims: [c],
      candidates: byClaim.get(c.claim_id) ?? [],
    });
  }

  const totalNormal = normal.reduce((s, c) => s + (byClaim.get(c.claim_id)?.length ?? 0), 0);
  if (totalNormal === 0) return batches;

  if (totalNormal <= SINGLE_BATCH_MAX) {
    batches.push({
      label: `batch1`,
      claims: normal,
      candidates: normal.flatMap((c) => byClaim.get(c.claim_id) ?? []),
    });
    return batches;
  }

  // Split normal claims greedily into 2 buckets balanced by candidate count,
  // largest-first.
  const sorted = [...normal].sort(
    (a, b) => (byClaim.get(b.claim_id)?.length ?? 0) - (byClaim.get(a.claim_id)?.length ?? 0),
  );
  const buckets: Claim[][] = [[], []];
  const sizes = [0, 0];
  for (const c of sorted) {
    const n = byClaim.get(c.claim_id)?.length ?? 0;
    const target = sizes[0] <= sizes[1] ? 0 : 1;
    buckets[target].push(c);
    sizes[target] += n;
  }
  buckets.forEach((claimsInBucket, i) => {
    if (claimsInBucket.length === 0) return;
    batches.push({
      label: `batch${i + 1}`,
      claims: claimsInBucket,
      candidates: claimsInBucket.flatMap((c) => byClaim.get(c.claim_id) ?? []),
    });
  });
  return batches;
}

export async function runVerifier(
  question: string,
  claims: Claim[],
  candidates: Candidate[],
): Promise<VerifierResult> {
  const t_total = Date.now();
  const stage_runs: StageRun[] = [];
  const errors: Array<{ claim_id: string; reason: string }> = [];
  const per_claim_ms: Record<string, number> = {};
  const escalated_claims: string[] = [];
  const allVerdicts: Verdict[] = [];
  const batchesMeta: VerifierResult["batches"] = [];

  // Group candidates by claim_id.
  const byClaim = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const arr = byClaim.get(c.claim_id) ?? [];
    arr.push(c);
    byClaim.set(c.claim_id, arr);
  }
  const claimsById = new Map(claims.map((c) => [c.claim_id, c]));

  const batches = planBatches(claims, byClaim);

  let anyEscalated = false;

  for (const batch of batches) {
    // Validate that all batch claims exist in analyzer output.
    for (const cl of batch.claims) {
      if (!claimsById.has(cl.claim_id)) {
        errors.push({ claim_id: cl.claim_id, reason: "claim not found in analyzer output" });
      }
    }
    const expectedPairs = new Set<string>(
      batch.candidates.map((c) => pairKey(c.candidate_id, c.claim_id)),
    );
    const userMsg = buildBatchUserMessage(question, batch.claims, batch.candidates);
    const t0 = Date.now();
    let resp = await callOpenAIJsonTool<unknown>({
      model: MODEL_MINI,
      system: SYSTEM_PROMPT,
      user: userMsg,
      tool: {
        name: "emit_verdicts",
        description: "Emit one verdict per (candidate_id, claim_id) pair provided.",
        parameters: VERIFIER_TOOL_PARAMETERS,
      },
    });
    stage_runs.push({
      stage: `verifier.${batch.label}.initial`,
      model: MODEL_MINI,
      ms: Date.now() - t0,
      ok: !!resp.data,
    });
    let parsed = validateBatchVerdicts(resp.data, expectedPairs);
    let escalated = false;

    if (!parsed.ok) {
      escalated = true;
      anyEscalated = true;
      for (const cl of batch.claims) escalated_claims.push(cl.claim_id);
      const t1 = Date.now();
      resp = await callOpenAIJsonTool<unknown>({
        model: MODEL_FULL,
        system: SYSTEM_PROMPT,
        user: userMsg,
        tool: {
          name: "emit_verdicts",
          description: "Emit one verdict per (candidate_id, claim_id) pair provided.",
          parameters: VERIFIER_TOOL_PARAMETERS,
        },
      });
      stage_runs.push({
        stage: `verifier.${batch.label}.escalated`,
        model: MODEL_FULL,
        ms: Date.now() - t1,
        ok: !!resp.data,
        escalated: true,
      });
      parsed = validateBatchVerdicts(resp.data, expectedPairs);
    }

    if (parsed.errors.length) {
      errors.push({
        claim_id: batch.claims.map((c) => c.claim_id).join(","),
        reason: parsed.errors.slice(0, 3).join("; "),
      });
    }

    // Fill role_match deterministically + backfill missing pairs as unrelated.
    const candById = new Map(batch.candidates.map((c) => [c.candidate_id, c]));
    for (const v of parsed.verdicts) {
      const cand = candById.get(v.candidate_id);
      const claim = claimsById.get(v.claim_id);
      if (cand && claim) v.role_match = rolesMatch(cand.role, claim.required_roles);
      allVerdicts.push(v);
    }
    for (const missingKey of parsed.missing) {
      const [candidate_id, claim_id] = missingKey.split("::");
      const cand = candById.get(candidate_id);
      const claim = claimsById.get(claim_id);
      if (!cand || !claim) continue;
      allVerdicts.push({
        candidate_id,
        claim_id,
        support: "unrelated",
        role_match: rolesMatch(cand.role, claim.required_roles),
        supported_points: [],
        reason: "verifier did not return a verdict for this candidate",
      });
    }

    const batchMs = Date.now() - t0;
    for (const cl of batch.claims) per_claim_ms[cl.claim_id] = batchMs;
    batchesMeta.push({
      label: batch.label,
      claim_ids: batch.claims.map((c) => c.claim_id),
      candidates: batch.candidates.length,
      escalated,
      ms: batchMs,
    });
  }

  // Aggregate per-candidate best/worst across all its verdicts.
  const bestByCand = new Map<string, Verdict>();
  const allByCand = new Map<string, Verdict[]>();
  for (const v of allVerdicts) {
    const arr = allByCand.get(v.candidate_id) ?? [];
    arr.push(v);
    allByCand.set(v.candidate_id, arr);
    const prev = bestByCand.get(v.candidate_id);
    if (!prev || SUPPORT_RANK[v.support] < SUPPORT_RANK[prev.support]) {
      bestByCand.set(v.candidate_id, v);
    }
  }
  const candById = new Map(candidates.map((c) => [c.candidate_id, c]));

  const usable: UsableCandidate[] = [];
  const dropped: DroppedCandidate[] = [];
  for (const c of candidates) {
    const best = bestByCand.get(c.candidate_id);
    if (!best) continue;
    if (best.support === "direct" || best.support === "partial") {
      const claimIds = (allByCand.get(c.candidate_id) ?? [])
        .filter((v) => v.support === "direct" || v.support === "partial")
        .map((v) => v.claim_id);
      usable.push({
        candidate_id: c.candidate_id,
        best_support: best.support,
        role_match: best.role_match,
        verdict_claim_ids: Array.from(new Set(claimIds)),
      });
    } else {
      const verdicts = allByCand.get(c.candidate_id) ?? [];
      const tangential = verdicts.find((v) => v.support === "tangential" && v.reason);
      const unrelated = verdicts.find((v) => v.support === "unrelated" && v.reason);
      const chosen = tangential ?? unrelated ?? best;
      dropped.push({
        candidate_id: c.candidate_id,
        title: c.title,
        role: c.role,
        origin: c.origin,
        retrieval_method: c.retrieval_method,
        reason: chosen.reason || "no reason given",
        worst_support: best.support,
      });
    }
  }

  const counts = {
    by_support: { direct: 0, partial: 0, tangential: 0, unrelated: 0 } as Record<SupportLevel, number>,
    by_role_match: { true: 0, false: 0 },
  };
  for (const v of allVerdicts) {
    counts.by_support[v.support] = (counts.by_support[v.support] ?? 0) + 1;
    if (v.role_match) counts.by_role_match.true++;
    else counts.by_role_match.false++;
  }

  return {
    ms: Date.now() - t_total,
    model_initial: MODEL_MINI,
    model_final: anyEscalated ? MODEL_FULL : MODEL_MINI,
    escalated_claims: Array.from(new Set(escalated_claims)),
    per_claim_ms,
    verdicts: allVerdicts,
    counts,
    candidates_verified: candById.size,
    candidates_usable: usable.length,
    candidates_dropped: dropped.length,
    usable,
    dropped,
    stage_runs,
    errors,
    batches: batchesMeta,
  };
}
