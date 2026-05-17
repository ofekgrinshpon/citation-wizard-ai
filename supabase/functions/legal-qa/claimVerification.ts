// Phase 7 / Stage 3 — Per-Claim Verification (strict).
//
// For every CandidateClaim, score every existing SourcePack item against
// THE CLAIM (not against the question). The score uses a hard 4-tier rubric:
//
//   direct_support  — source DIRECTLY discusses the claim's specific subject
//                     and supports the asserted proposition.
//   partial_support — source discusses the same legal doctrine / issue but
//                     does not prove the claim about the specific subject.
//   tangential      — source is legally adjacent or analogical only
//                     (different statute, different domain, same court).
//   ANTI-PATTERN: "although this source does not directly
//                     discuss X, it illustrates Y" → tangential.
//   unrelated       — source does not address the claim's subject or doctrine.
//
// Verdict rule (HARD):
//   supported            ⇔ ≥1 direct_support  hit
//   partially_supported  ⇔ no direct, but ≥1 partial_support hit
//   unsupported          ⇔ nothing better than tangential
//
// Tangential and unrelated NEVER support a claim.
//
// This module does NOT call the DB or Perplexity for new retrieval — it
// scores the *existing* SourcePack the rest of the pipeline already
// assembled. The plan's Stage 3 also envisions per-claim DB/allowlist
// fan-out; that's a strictly additive future expansion. The minimum-viable
// fix the user asked for is to stop tangential sources from supporting
// claims, which is achieved by per-claim relevance scoring + verdict-based
// pruning.

import { callPlannerJSON, type PlannerToolDef, type StageRun } from "./aiProvider.ts";
import type {
  CandidateClaim,
  ClaimLedger,
  ClaimLedgerItem,
  ClaimRelevanceHit,
  ClaimRelevanceScore,
  ClaimVerdict,
  LegalSourcePack,
  LegalSourcePackItem,
} from "./contracts.ts";

const TOOL: PlannerToolDef = {
  name: "submit_claim_relevance",
  description:
    "Score every (claim, source) pair using the strict 4-tier rubric. Tangential and unrelated sources do not support a claim.",
  parameters: {
    type: "object",
    properties: {
      scores: {
        type: "array",
        items: {
          type: "object",
          properties: {
            claim_id: { type: "string" },
            source_id: { type: "string" },
            score: {
              type: "string",
              enum: ["direct_support", "partial_support", "tangential", "unrelated"],
            },
            rationale: { type: "string", description: "Short Hebrew rationale (≤200 chars)." },
          },
          required: ["claim_id", "source_id", "score", "rationale"],
          additionalProperties: false,
        },
      },
    },
    required: ["scores"],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT = `אתה מסווג תמיכה של מקורות בטענות משפטיות. עליך לציין עבור כל זוג (טענה, מקור) את רמת התמיכה.

רובריקה (חובה לעקוב אחריה בדייקנות):

1. **direct_support** — המקור עוסק *ישירות* בנושא הספציפי של הטענה ותומך בה.
   דוגמה: טענה "בית המשפט נטל על עצמו תפקיד חקיקתי בסכסוך עוברים מוקפאים בנחמני" → פסק דין נחמני עצמו = direct_support.

2. **partial_support** — המקור עוסק באותה דוקטרינה / סוגיה רחבה אבל לא מוכיח את הטענה הספציפית.
   דוגמה: אותה טענה על נחמני → מאמר על אקטיביזם שיפוטי בדיני משפחה באופן כללי = partial_support.

3. **tangential** — המקור משפטי-סמוך / אנלוגי בלבד (חוק אחר, תחום אחר, אותה ערכאה).
   **דפוס אסור (anti-pattern):** אם ההצדקה היא "אף שהמקור הזה לא עוסק ישירות ב-X, הוא ממחיש Y" — הציון הוא **tangential**.
   דוגמאות לטעות נפוצה: לציין "חוק בית המשפט לימאות" כתמיכה בטענה על עוברים מוקפאים, או פסק דין על פיברומיאלגיה כתמיכה בדיני משפחה.

4. **unrelated** — המקור לא נוגע לנושא או לדוקטרינה של הטענה.

חוקים קשיחים:
- אל תמציא תמיכה. אם יש ספק — סווג tangential או unrelated.
- ערכאת בית המשפט לבדה אינה מבססת תמיכה. הקשר הספציפי לנושא הטענה הוא הקובע.
- direct_support דורש שהמקור עוסק *באותה סוגיה ספציפית* של הטענה.
- partial_support דורש שהמקור עוסק *באותה דוקטרינה רחבה* של הטענה — לא רק "באותו תחום משפטי".

החזר JSON בלבד דרך הכלי submit_claim_relevance עם ציון לכל זוג (טענה, מקור) שאתה רואה ברשימה.`;

const SCORES: ClaimRelevanceScore[] = ["direct_support", "partial_support", "tangential", "unrelated"];

function normalizeScore(s: unknown): ClaimRelevanceScore {
  return SCORES.includes(s as ClaimRelevanceScore) ? (s as ClaimRelevanceScore) : "unrelated";
}

interface PackItemView {
  /** Stable contract id ("S1") if available; otherwise numeric pack id. */
  id: string;
  title: string;
  excerpt?: string;
  sourceType: string;
  caseNumber?: string;
}

function viewItem(item: LegalSourcePackItem, fallbackId: string): PackItemView {
  return {
    id: item.contractId || item.sourceId || fallbackId,
    title: item.title || "(ללא כותרת)",
    excerpt: item.excerpt ? item.excerpt.replace(/\s+/g, " ").slice(0, 320) : undefined,
    sourceType: item.sourceType,
    caseNumber: item.caseNumber,
  };
}

function flattenPack(pack: LegalSourcePack): { items: LegalSourcePackItem[]; views: PackItemView[]; idMap: Map<string, LegalSourcePackItem> } {
  const items: LegalSourcePackItem[] = [
    ...pack.coreSources,
    ...pack.supportingSources,
    ...pack.secondarySources,
  ];
  const views: PackItemView[] = [];
  const idMap = new Map<string, LegalSourcePackItem>();
  items.forEach((it, idx) => {
    const v = viewItem(it, `pack-${idx}`);
    views.push(v);
    idMap.set(v.id, it);
  });
  return { items, views, idMap };
}

function buildUserPrompt(claims: CandidateClaim[], views: PackItemView[]): string {
  const claimLines = claims.map((c) => `[${c.id}] (${c.kind}) ${c.statement}`).join("\n");
  const sourceLines = views.map((v) => {
    const meta = [v.sourceType, v.caseNumber].filter(Boolean).join(" / ");
    return `[${v.id}] (${meta})\nכותרת: ${v.title}${v.excerpt ? `\nתקציר: ${v.excerpt}` : ""}`;
  }).join("\n\n");
  return `טענות מועמדות:\n${claimLines}\n\nמקורות מאומתים זמינים:\n\n${sourceLines}\n\nציין ציון לכל זוג (טענה, מקור).`;
}

export interface VerificationSummary {
  supported: number;
  partially_supported: number;
  unsupported: number;
  dropped_tangential: number;
  dropped_unrelated: number;
  /** Sources that received no direct or partial support for any claim. */
  pruned_source_ids: string[];
}

export interface ClaimVerificationResult {
  ledger: ClaimLedger;
  summary: VerificationSummary;
  run: StageRun;
}

/**
 * Score every claim against every pack item, build the Claim Ledger, and
 * return the set of source ids that should be pruned (no claim found them
 * direct/partial). When the model fails entirely, every claim falls to
 * `unsupported` and no sources are pruned.
 */
export async function verifyClaimsAgainstPack(args: {
  claims: CandidateClaim[];
  pack: LegalSourcePack;
}): Promise<ClaimVerificationResult> {
  const { claims, pack } = args;

  if (claims.length === 0) {
    const emptyRun: StageRun = {
      stage: "claim_verification",
      provider: "gemini",
      model: "noop",
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: 0,
      status: "success",
    };
    return {
      ledger: { claims: [] },
      summary: {
        supported: 0, partially_supported: 0, unsupported: 0,
        dropped_tangential: 0, dropped_unrelated: 0, pruned_source_ids: [],
      },
      run: emptyRun,
    };
  }

  const { items, views, idMap } = flattenPack(pack);

  if (items.length === 0) {
    const noPackRun: StageRun = {
      stage: "claim_verification",
      provider: "gemini",
      model: "noop",
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: 0,
      status: "success",
      error_message: "empty source pack",
    };
    return {
      ledger: {
        claims: claims.map((c) => ({
          id: c.id,
          statement: c.statement,
          verdict: "unsupported" as ClaimVerdict,
          sourceIds: [],
          evidenceNotes: "no sources in pack",
          hits: [],
        })),
      },
      summary: {
        supported: 0,
        partially_supported: 0,
        unsupported: claims.length,
        dropped_tangential: 0, dropped_unrelated: 0, pruned_source_ids: [],
      },
      run: noPackRun,
    };
  }

  // Pass A: batch verification to avoid 30s timeout on large packs.
  // Split sources into batches of ≤BATCH_SIZE; each batch gets its own
  // ≤20s budget. Merge scores. Track per-batch success so callers can
  // distinguish "fully failed" (all batches errored → safe to keep
  // standard cards) from "partial" (still trustworthy enough to prune).
  const BATCH_SIZE = 8;
  const BATCH_TIMEOUT_MS = 20000;
  const batches: PackItemView[][] = [];
  for (let i = 0; i < views.length; i += BATCH_SIZE) {
    batches.push(views.slice(i, i + BATCH_SIZE));
  }

  const claimIds = new Set(claims.map((c) => c.id));
  const sourceIds = new Set(views.map((v) => v.id));
  const hitsByClaim = new Map<string, ClaimRelevanceHit[]>();
  for (const c of claims) hitsByClaim.set(c.id, []);

  const batchStartedAt = new Date().toISOString();
  const batchT0 = Date.now();
  let succeededBatches = 0;
  let failedBatches = 0;
  let lastRun: StageRun | null = null;
  let lastModel = "unknown";
  let lastProvider: "openai" | "gemini" = "gemini";

  for (const batch of batches) {
    const { data, run } = await callPlannerJSON<{
      scores: Array<{ claim_id: string; source_id: string; score: string; rationale: string }>;
    }>(
      SYSTEM_PROMPT,
      buildUserPrompt(claims, batch),
      TOOL,
      {
        stage: "claim_verification",
        timeoutMs: BATCH_TIMEOUT_MS,
        reasoningEffort: "low",
        forceProvider: "gemini",
      },
    );
    lastRun = run;
    lastModel = run.model;
    lastProvider = run.provider as "openai" | "gemini";

    if (run.status !== "success" || !data || !Array.isArray(data.scores)) {
      failedBatches++;
      continue;
    }
    succeededBatches++;
    for (const s of data.scores) {
      if (!s || typeof s !== "object") continue;
      const cid = typeof s.claim_id === "string" ? s.claim_id : "";
      const sid = typeof s.source_id === "string" ? s.source_id : "";
      if (!claimIds.has(cid) || !sourceIds.has(sid)) continue;
      hitsByClaim.get(cid)!.push({
        sourceId: sid,
        score: normalizeScore(s.score),
        rationale: typeof s.rationale === "string" ? s.rationale.slice(0, 200) : "",
      });
    }
  }

  // Build the ledger using the hard verdict rule.
  const ledgerClaims: ClaimLedgerItem[] = claims.map((c) => {
    const hits = (hitsByClaim.get(c.id) ?? []).sort((a, b) =>
      SCORES.indexOf(a.score) - SCORES.indexOf(b.score),
    );
    const direct = hits.filter((h) => h.score === "direct_support");
    const partial = hits.filter((h) => h.score === "partial_support");
    let verdict: ClaimVerdict;
    let supportingIds: string[];
    if (direct.length > 0) {
      verdict = "supported";
      supportingIds = direct.map((h) => h.sourceId);
    } else if (partial.length > 0) {
      verdict = "partially_supported";
      supportingIds = partial.map((h) => h.sourceId);
    } else {
      verdict = "unsupported";
      supportingIds = [];
    }
    const evidenceNotes = (direct[0] ?? partial[0])?.rationale ?? "";
    return {
      id: c.id,
      statement: c.statement,
      verdict,
      sourceIds: supportingIds,
      evidenceNotes,
      hits,
    };
  });

  // Identify sources nobody found direct/partial-supportive — these should
  // be pruned from the source pack before drafting (unless they're statutory
  // anchors needed for citation hygiene; that decision is made by the caller
  // when applying the pruning).
  const supportiveSourceIds = new Set<string>();
  for (const item of ledgerClaims) {
    for (const sid of item.sourceIds) supportiveSourceIds.add(sid);
  }
  const pruned: string[] = [];
  for (const v of views) {
    if (!supportiveSourceIds.has(v.id)) pruned.push(v.id);
  }

  // Roll-up counters
  let droppedTangential = 0, droppedUnrelated = 0;
  for (const item of ledgerClaims) {
    for (const h of item.hits) {
      if (h.score === "tangential") droppedTangential++;
      else if (h.score === "unrelated") droppedUnrelated++;
    }
  }

  const summary: VerificationSummary = {
    supported: ledgerClaims.filter((c) => c.verdict === "supported").length,
    partially_supported: ledgerClaims.filter((c) => c.verdict === "partially_supported").length,
    unsupported: ledgerClaims.filter((c) => c.verdict === "unsupported").length,
    dropped_tangential: droppedTangential,
    dropped_unrelated: droppedUnrelated,
    pruned_source_ids: pruned,
  };

  // idMap available for callers that want to inspect items by id
  void idMap;

  // Synthesise an aggregate StageRun from the per-batch runs. Status is
  // "success" iff at least one batch produced scores; "error" only when
  // ALL batches failed (caller uses this to decide whether to keep
  // standard-retrieval cards on timeout).
  const aggregateRun: StageRun = {
    stage: "claim_verification",
    provider: lastProvider,
    model: lastModel,
    started_at: batchStartedAt,
    completed_at: new Date().toISOString(),
    duration_ms: Date.now() - batchT0,
    status: succeededBatches > 0 ? "success" : "error",
    error_message:
      failedBatches > 0
        ? `batches: ${succeededBatches} ok / ${failedBatches} failed`
        : undefined,
  };
  void lastRun; // last run preserved through aggregate
  return { ledger: { claims: ledgerClaims }, summary, run: aggregateRun };
}

/**
 * Build the human-readable Claim Ledger block injected into the drafter
 * prompt. Lists supported/partial/unsupported lines with their source ids.
 * Drafter is told that `unsupported` claims are omitted by default.
 */
export function buildClaimLedgerPromptBlock(ledger: ClaimLedger): string {
  if (!ledger?.claims?.length) return "";
  const lines: string[] = [];
  lines.push("<CLAIM_LEDGER>");
  lines.push("חובה: אל תציג טענה שאינה ברשימה. אל תצטט מקור שאינו מופיע ב-src.");
  lines.push("- supported            → ניתן לקבוע במפורש; חובה לצרף את ה-src המופיע.");
  lines.push("- partially_supported  → חובה להסתייג (\"יש הסוברים\", \"נטען כי\", \"עמדה אחת גורסת\") + לצטט.");
  lines.push("- unsupported          → השמט כברירת מחדל. ציון פער רק כשההשמטה תוביל להטעיה: משפט בודד \"יצוין כי טענת X לא אומתה במקור מהימן ועל כן אינה נכללת בניתוח\" — בלי הערת שוליים.");
  lines.push("");
  for (const c of ledger.claims) {
    const src = c.sourceIds.length ? `src=[${c.sourceIds.join(",")}]` : "src=[]";
    lines.push(`${c.id} [${c.verdict}] "${c.statement.replace(/"/g, "'")}"  → ${src}`);
  }
  lines.push("</CLAIM_LEDGER>");
  return lines.join("\n");
}

/**
 * Apply the Claim Ledger as a hard filter on the source pack: any pack item
 * not referenced by at least one supported/partially_supported claim is
 * removed. Statutory primary legislation kept as anchor (citation hygiene).
 *
 * @param opts.restrictToCandidateRecall - when true, ONLY prune items whose
 *   provenanceInternal is "claim_verified_recall". Standard-retrieval cards
 *   (local / perplexity / document) are kept as-is. Used on verification
 *   timeout to avoid nuking legitimately-retrieved cards.
 */
export function pruneSourcePackByLedger(
  pack: LegalSourcePack,
  ledger: ClaimLedger,
  opts: { restrictToCandidateRecall?: boolean } = {},
): { pruned: LegalSourcePack; removedIds: string[] } {
  const keepIds = new Set<string>();
  for (const c of ledger.claims) {
    for (const sid of c.sourceIds) keepIds.add(sid);
  }

  const filterBucket = (bucket: LegalSourcePackItem[], removed: string[]): LegalSourcePackItem[] =>
    bucket.filter((item) => {
      const id = item.contractId || item.sourceId;
      // Always keep primary legislation / user docs as anchors even if no
      // claim attached — the citation engine still needs them for footnote
      // hygiene (e.g. statute the question names by hand).
      if (
        item.authorityClass === "primary_legislation" ||
        item.authorityClass === "user_document"
      ) {
        return true;
      }
      // Pass A safe-prune mode: only candidate-pool entries are subject to
      // pruning. Standard cards survive whether or not verification reached
      // them. Caller invokes this branch when verification timed out.
      if (opts.restrictToCandidateRecall) {
        if (item.provenanceInternal !== "claim_verified_recall") return true;
      }
      if (keepIds.has(id)) return true;
      removed.push(id);
      return false;
    });

  const removed: string[] = [];
  return {
    pruned: {
      coreSources: filterBucket(pack.coreSources, removed),
      supportingSources: filterBucket(pack.supportingSources, removed),
      secondarySources: filterBucket(pack.secondarySources, removed),
    },
    removedIds: removed,
  };
}
