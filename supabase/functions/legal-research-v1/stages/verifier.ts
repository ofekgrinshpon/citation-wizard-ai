// P4 — Source Verifier.
// For each P3 candidate, emit one verdict per claim it was retrieved for.
// One LLM call per claim (batched over its candidates). gpt-5-mini default,
// escalate that single claim once to gpt-5 if the response is invalid/short.

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

const SYSTEM_PROMPT = `אתה מאמת מקורות משפטי (Source Verifier) במערכת מחקר משפטי ישראלית.
תקבל טענה משפטית אחת (claim) ורשימת מועמדים (candidates) שאוחזרו עבורה.
המשימה: לקבוע עבור כל מועמד עד כמה הוא תומך בטענה.

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

החזר רק דרך הקריאה לכלי emit_verdicts. כלול verdict אחד לכל מועמד שקיבלת, לפי אותם candidate_id וclaim_id שסיפקתי.`;

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

function validateVerdicts(
  raw: unknown,
  expectedClaimId: string,
  expectedCandidateIds: Set<string>,
): { ok: boolean; verdicts: Verdict[]; errors: string[]; missing: string[] } {
  const errors: string[] = [];
  const r = (raw ?? {}) as Record<string, unknown>;
  const arr = Array.isArray(r.verdicts) ? (r.verdicts as RawVerdict[]) : [];
  const verdicts: Verdict[] = [];
  const seen = new Set<string>();
  for (const v of arr) {
    const candidate_id = typeof v.candidate_id === "string" ? v.candidate_id : "";
    const claim_id = typeof v.claim_id === "string" ? v.claim_id : expectedClaimId;
    if (!candidate_id || !expectedCandidateIds.has(candidate_id)) {
      errors.push(`unknown candidate_id: ${candidate_id}`);
      continue;
    }
    if (claim_id !== expectedClaimId) {
      errors.push(`wrong claim_id for ${candidate_id}: ${claim_id}`);
      continue;
    }
    const support = typeof v.support === "string" &&
        (SUPPORT_LEVELS as readonly string[]).includes(v.support)
      ? (v.support as SupportLevel)
      : null;
    if (!support) {
      errors.push(`invalid support for ${candidate_id}: ${String(v.support)}`);
      continue;
    }
    const supported_points = Array.isArray(v.supported_points)
      ? (v.supported_points as unknown[]).filter((p): p is string => typeof p === "string" && p.length > 0).slice(0, 3)
      : [];
    const reason = typeof v.reason === "string" ? v.reason : "";
    seen.add(candidate_id);
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
  for (const id of expectedCandidateIds) {
    if (!seen.has(id)) missing.push(id);
  }
  return { ok: errors.length === 0 && missing.length === 0, verdicts, errors, missing };
}

function buildUserMessage(question: string, claim: Claim, cands: Candidate[]): string {
  const lines: string[] = [];
  lines.push(`שאלת המשתמש: ${question}`);
  lines.push("");
  lines.push(`טענה (${claim.claim_id}):`);
  lines.push(claim.text_he);
  lines.push(`required_roles: ${claim.required_roles.join(", ") || "(none)"}`);
  lines.push(`is_black_letter: ${claim.is_black_letter}`);
  lines.push("");
  lines.push(`מועמדים (${cands.length}):`);
  for (const c of cands) {
    const snip = (c.snippet || "").replace(/\s+/g, " ").trim().slice(0, 600);
    lines.push("---");
    lines.push(`candidate_id: ${c.candidate_id}`);
    lines.push(`role: ${c.role}`);
    lines.push(`source_type: ${c.source_type}`);
    lines.push(`origin: ${c.origin} (${c.retrieval_method})`);
    lines.push(`title: ${c.title}`);
    if (c.source_url) lines.push(`url: ${c.source_url}`);
    if (snip) lines.push(`snippet: ${snip}`);
  }
  lines.push("");
  lines.push(
    `החזר verdicts עבור כל ${cands.length} המועמדים, באמצעות אותם candidate_id ועם claim_id="${claim.claim_id}".`,
  );
  return lines.join("\n");
}

function rolesMatch(candidateRole: SourceRole, required: SourceRole[]): boolean {
  if (required.length === 0) return true;
  if (required.includes(candidateRole)) return true;
  // Treat persuasive/binding as interchangeable for role_match purposes.
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

  // Group candidates by claim_id.
  const byClaim = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const arr = byClaim.get(c.claim_id) ?? [];
    arr.push(c);
    byClaim.set(c.claim_id, arr);
  }
  const claimsById = new Map(claims.map((c) => [c.claim_id, c]));

  for (const [claim_id, cands] of byClaim) {
    if (cands.length === 0) continue;
    const claim = claimsById.get(claim_id);
    if (!claim) {
      errors.push({ claim_id, reason: "claim not found in analyzer output" });
      continue;
    }
    const expectedIds = new Set(cands.map((c) => c.candidate_id));
    const userMsg = buildUserMessage(question, claim, cands);
    const t0 = Date.now();
    let modelUsed: string = MODEL_MINI;
    let resp = await callOpenAIJsonTool<unknown>({
      model: MODEL_MINI,
      system: SYSTEM_PROMPT,
      user: userMsg,
      tool: {
        name: "emit_verdicts",
        description: "Emit one verdict per provided candidate for this claim.",
        parameters: VERIFIER_TOOL_PARAMETERS,
      },
    });
    stage_runs.push({
      stage: `verifier.${claim_id}.initial`,
      model: MODEL_MINI,
      ms: Date.now() - t0,
      ok: !!resp.data,
    });
    let parsed = validateVerdicts(resp.data, claim_id, expectedIds);

    if (!parsed.ok) {
      // Escalate this single claim once.
      escalated_claims.push(claim_id);
      const t1 = Date.now();
      modelUsed = MODEL_FULL;
      resp = await callOpenAIJsonTool<unknown>({
        model: MODEL_FULL,
        system: SYSTEM_PROMPT,
        user: userMsg,
        tool: {
          name: "emit_verdicts",
          description: "Emit one verdict per provided candidate for this claim.",
          parameters: VERIFIER_TOOL_PARAMETERS,
        },
      });
      stage_runs.push({
        stage: `verifier.${claim_id}.escalated`,
        model: MODEL_FULL,
        ms: Date.now() - t1,
        ok: !!resp.data,
        escalated: true,
      });
      parsed = validateVerdicts(resp.data, claim_id, expectedIds);
    }

    if (parsed.errors.length) {
      errors.push({ claim_id, reason: parsed.errors.slice(0, 3).join("; ") });
    }
    // Fill in role_match deterministically; backfill missing as 'unrelated'.
    const candById = new Map(cands.map((c) => [c.candidate_id, c]));
    for (const v of parsed.verdicts) {
      const cand = candById.get(v.candidate_id);
      if (cand) v.role_match = rolesMatch(cand.role, claim.required_roles);
      allVerdicts.push(v);
    }
    for (const missingId of parsed.missing) {
      const cand = candById.get(missingId);
      if (!cand) continue;
      allVerdicts.push({
        candidate_id: missingId,
        claim_id,
        support: "unrelated",
        role_match: rolesMatch(cand.role, claim.required_roles),
        supported_points: [],
        reason: "verifier did not return a verdict for this candidate",
      });
    }
    per_claim_ms[claim_id] = Date.now() - t0;
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
      // Pick the most informative rejection reason: prefer tangential over
      // unrelated when both exist (tangential explains *why* it nearly fit).
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
        worst_support: best.support, // best == worst here since all are tangential/unrelated
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
    model_final: escalated_claims.length > 0 ? MODEL_FULL : MODEL_MINI,
    escalated_claims,
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
  };
}
