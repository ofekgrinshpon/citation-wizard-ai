// Research V2 — Stage 3+4: Verification + Final Ledger.
//
// Takes per-claim candidate packs from claimRetrieval and runs a verification
// call PER CLAIM. Each (claim, source) pair gets one of:
//   direct_support | partial_support | tangential | unrelated
//
// Verdict rule (HARD, identical to the existing claimVerification.ts rubric):
//   supported            ⇔ ≥1 direct_support
//   partially_supported  ⇔ no direct, but ≥1 partial_support
//   unsupported          ⇔ nothing better than tangential
//
// Only `supported` and `partially_supported` claims survive into the ledger
// the drafter receives. `partially_supported` claims are flagged
// `hedge=true` so the drafter applies `claim.hedge_if_partial` wording.
//
// Per-claim verification calls run in parallel (Promise.all) so total
// latency is roughly one planner round-trip regardless of claim count.
//
// Gated by env `RESEARCH_V2=true`. Not yet wired in index.ts.

import { callPlannerJSON, type PlannerToolDef, type StageRun } from "./aiProvider.ts";
import type { V2Claim } from "./researchPlan.ts";
import type { ClaimCandidatePack, ClaimCandidateSource } from "./claimRetrieval.ts";

export type V2RelevanceScore =
  | "direct_support"
  | "partial_support"
  | "tangential"
  | "unrelated";

export type V2Verdict = "supported" | "partially_supported" | "unsupported";

export interface LedgerEntry {
  claimId: string;
  claim: string;
  verdict: V2Verdict;
  hedge: boolean;
  hedgeTemplate?: string;
  /** Surviving sources (direct or partial). Capped to 3 strongest. */
  sources: Array<Pick<
    ClaimCandidateSource,
    "id" | "chunkId" | "documentId" | "title" | "citation" | "sourceType" | "sourceUrl" | "excerpt"
  > & { support: "direct" | "partial" }>;
  /** Short Hebrew note summarising why the claim survived. */
  evidenceNote: string;
}

export interface Ledger {
  thesis?: string;
  entries: LedgerEntry[];
  dropped: Array<{ claimId: string; claim: string; reason: V2Verdict }>;
}

const TOOL: PlannerToolDef = {
  name: "submit_claim_relevance_v2",
  description:
    "For one claim, score each candidate source using the strict 4-tier rubric. Tangential and unrelated do not support the claim.",
  parameters: {
    type: "object",
    properties: {
      scores: {
        type: "array",
        items: {
          type: "object",
          properties: {
            source_id: { type: "string" },
            score: {
              type: "string",
              enum: ["direct_support", "partial_support", "tangential", "unrelated"],
            },
            rationale: { type: "string", description: "≤180 תווים בעברית." },
          },
          required: ["source_id", "score", "rationale"],
          additionalProperties: false,
        },
      },
    },
    required: ["scores"],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT = `אתה מסווג תמיכה של מקורות בטענה משפטית *אחת*.

רובריקה (חובה לעקוב במדויק):
1. direct_support  — המקור עוסק *ישירות* בנושא הספציפי של הטענה ותומך בה (ציטוט/הלכה/סעיף ספציפי).
2. partial_support — המקור עוסק באותה דוקטרינה/סוגיה אך לא מוכיח את הטענה הספציפית.
3. tangential     — המקור משפטית סמוך/אנלוגי בלבד (דוקטרינה אחרת, תחום אחר, סתם אותו בית משפט).
4. unrelated      — המקור לא נוגע בכלל לסוגיה.

חוקים קשיחים:
- אסור להחזיר direct_support אם המקור רק "מזכיר" את הנושא. נדרשת התייחסות מהותית.
- ניסוח כמו "אף שהמקור לא דן ישירות ב-X, הוא ממחיש את Y" → tangential. תמיד.
- אל תנסה להציל מקור חלש בכוונה טובה.

קלט: טענה אחת + רשימת מקורות מועמדים עם קטעים מתומצתים.
פלט: ציון אחד לכל מקור דרך הכלי submit_claim_relevance_v2.`;

function buildUserPrompt(claim: V2Claim, candidates: ClaimCandidateSource[]): string {
  const lines: string[] = [];
  lines.push(`טענה (${claim.id}):\n${claim.statement}`);
  if (claim.required_evidence.length > 0) {
    lines.push(`סוג ראיה נדרש: ${claim.required_evidence.join(", ")}`);
  }
  lines.push("");
  lines.push("מקורות מועמדים:");
  for (const c of candidates) {
    lines.push(
      `[${c.id}] (${c.sourceType}) ${c.title.slice(0, 140)}\n   קטע: ${c.excerpt.replace(/\s+/g, " ").slice(0, 260)}`,
    );
  }
  lines.push("");
  lines.push("ציין רובריקה לכל מקור. החזר JSON דרך הכלי.");
  return lines.join("\n");
}

export interface VerifyArgs {
  claims: V2Claim[];
  packs: ClaimCandidatePack[];
  depth: "fast" | "deep";
  thesis?: string;
}

export interface VerifyResult {
  ledger: Ledger;
  runs: StageRun[];
}

/**
 * Run verification per claim in parallel. Empty candidate packs are recorded
 * as unsupported without a model call. Returns the assembled ledger plus
 * per-claim StageRun telemetry for qa_logs.metadata.verification_v2.
 */
export async function verifyAndBuildLedger(args: VerifyArgs): Promise<VerifyResult> {
  const { claims, packs, depth, thesis } = args;
  const byId = new Map(packs.map((p) => [p.claimId, p] as const));

  const results = await Promise.all(
    claims.map(async (claim) => {
      const pack = byId.get(claim.id);
      const candidates = pack?.candidates ?? [];
      if (candidates.length === 0) {
        return {
          entry: null,
          dropped: { claimId: claim.id, claim: claim.statement, reason: "unsupported" as V2Verdict },
          run: noOpRun(claim.id, "no_candidates"),
        };
      }
      const { scores, run } = await scoreClaim({ claim, candidates, depth });
      const verdict = computeVerdict(scores);

      if (verdict === "unsupported") {
        return {
          entry: null,
          dropped: { claimId: claim.id, claim: claim.statement, reason: verdict },
          run,
        };
      }

      const supporting = candidates
        .map((c) => {
          const s = scores.find((x) => x.source_id === c.id);
          return s ? { c, score: s.score, rationale: s.rationale } : null;
        })
        .filter(
          (x): x is { c: ClaimCandidateSource; score: V2RelevanceScore; rationale: string } =>
            !!x && (x.score === "direct_support" || x.score === "partial_support"),
        )
        .sort((a, b) => rank(a.score) - rank(b.score))
        .slice(0, 3)
        .map(({ c, score, rationale }) => ({
          id: c.id,
          chunkId: c.chunkId,
          documentId: c.documentId,
          title: c.title,
          citation: c.citation,
          sourceType: c.sourceType,
          sourceUrl: c.sourceUrl,
          excerpt: c.excerpt,
          support: score === "direct_support" ? ("direct" as const) : ("partial" as const),
          rationale,
        }));

      const entry: LedgerEntry = {
        claimId: claim.id,
        claim: claim.statement,
        verdict,
        hedge: verdict === "partially_supported",
        hedgeTemplate:
          verdict === "partially_supported" ? claim.hedge_if_partial : undefined,
        sources: supporting,
        evidenceNote: supporting[0]?.rationale?.slice(0, 200) ?? "",
      };
      return { entry, dropped: null, run };
    }),
  );

  const entries = results
    .map((r) => r.entry)
    .filter((e): e is LedgerEntry => !!e);
  const dropped = results
    .map((r) => r.dropped)
    .filter((d): d is { claimId: string; claim: string; reason: V2Verdict } => !!d);
  const runs = results.map((r) => r.run);

  return {
    ledger: { thesis, entries, dropped },
    runs,
  };
}

function rank(s: V2RelevanceScore): number {
  if (s === "direct_support") return 0;
  if (s === "partial_support") return 1;
  if (s === "tangential") return 2;
  return 3;
}

function computeVerdict(
  scores: Array<{ source_id: string; score: V2RelevanceScore }>,
): V2Verdict {
  if (scores.some((s) => s.score === "direct_support")) return "supported";
  if (scores.some((s) => s.score === "partial_support")) return "partially_supported";
  return "unsupported";
}

async function scoreClaim(args: {
  claim: V2Claim;
  candidates: ClaimCandidateSource[];
  depth: "fast" | "deep";
}): Promise<{
  scores: Array<{ source_id: string; score: V2RelevanceScore; rationale: string }>;
  run: StageRun;
}> {
  const { claim, candidates, depth } = args;
  const { data, run } = await callPlannerJSON<{
    scores: Array<{ source_id: string; score: V2RelevanceScore; rationale: string }>;
  }>(
    SYSTEM_PROMPT,
    buildUserPrompt(claim, candidates),
    TOOL,
    {
      stage: `verify_v2:${claim.id}`,
      timeoutMs: depth === "deep" ? 30000 : 22000,
      reasoningEffort: "minimal",
    },
  );

  if (!data || !Array.isArray(data.scores)) {
    return { scores: [], run };
  }
  const valid = data.scores.filter(
    (s) =>
      s &&
      typeof s.source_id === "string" &&
      ["direct_support", "partial_support", "tangential", "unrelated"].includes(
        s.score as string,
      ),
  );
  return {
    scores: valid.map((s) => ({
      source_id: s.source_id,
      score: s.score,
      rationale: typeof s.rationale === "string" ? s.rationale.slice(0, 200) : "",
    })),
    run,
  };
}

function noOpRun(claimId: string, reason: string): StageRun {
  const now = new Date().toISOString();
  return {
    stage: `verify_v2:${claimId}`,
    provider: "openai",
    model: "(skipped)",
    started_at: now,
    completed_at: now,
    duration_ms: 0,
    status: "no_tool_call",
    error_message: reason,
  };
}

/** Telemetry summary for qa_logs.metadata.ledger_v2. */
export function summarizeLedger(ledger: Ledger) {
  const supported = ledger.entries.filter((e) => e.verdict === "supported").length;
  const partial = ledger.entries.filter((e) => e.verdict === "partially_supported").length;
  return {
    kept: ledger.entries.length,
    dropped: ledger.dropped.length,
    supported,
    partially_supported: partial,
    total_sources: ledger.entries.reduce((n, e) => n + e.sources.length, 0),
    claim_ids_kept: ledger.entries.map((e) => e.claimId),
    claim_ids_dropped: ledger.dropped.map((d) => d.claimId),
  };
}

/** True when the env flag enables the V2 path. Caller decides depth gating. */
export function researchV2Enabled(): boolean {
  return (Deno.env.get("RESEARCH_V2") ?? "").toLowerCase() === "true";
}
