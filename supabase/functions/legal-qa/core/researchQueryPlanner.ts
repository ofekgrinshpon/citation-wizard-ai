// Phase B — Research Query Planner (telemetry only).
//
// Given the question + PlanV1, produce structured research queries per
// claim, grouped by source role (primary_statute, binding_case_law,
// scholarship, etc.). Output is stored on `metadata.core.research_queries`
// and (best-effort) attached to PlanV1.claims[i].research_queries.
//
// CRITICAL (Phase B): retrieval, Perplexity, verifier, drafter, citation
// engine, and footnotes MUST ignore this output. It is observational only.
// Phase C+ will wire it into local retrieval; Phase D into Perplexity.

import type { PlanV1 } from "./types.ts";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const PRIMARY_MODEL = "openai/gpt-5-mini";
const FALLBACK_MODEL = "openai/gpt-5-nano";
const PRIMARY_TIMEOUT_MS = 25_000;
const FALLBACK_TIMEOUT_MS = 18_000;
const MAX_QUERIES_PER_CLAIM = 5;
const MAX_CLAIMS = 8;

export const RESEARCH_ROLE_TAXONOMY = [
  "primary_statute",
  "binding_case_law",
  "persuasive_case_law",
  "scholarship",
  "secondary_legislation",
  "committee_report",
  "factual_background",
  "comparative_law",
] as const;
export type ResearchRole = typeof RESEARCH_ROLE_TAXONOMY[number];

export const RESEARCH_TARGET_TAXONOMY = ["local_db", "approved_web"] as const;
export type ResearchTarget = typeof RESEARCH_TARGET_TAXONOMY[number];

export const RESEARCH_EXPECTED_TYPE_TAXONOMY = [
  "statute",
  "case",
  "academic",
  "committee",
  "news",
  "regulation",
] as const;
export type ResearchExpectedType = typeof RESEARCH_EXPECTED_TYPE_TAXONOMY[number];

export interface ResearchQuery {
  role: ResearchRole;
  purpose: string;
  query_he: string;
  targets: ResearchTarget[];
  expected_source_type: ResearchExpectedType;
  reason: string;
}

export interface ResearchQueriesByClaim {
  [claimId: string]: ResearchQuery[];
}

export interface BuildResearchQueriesResult {
  ok: boolean;
  byClaim: ResearchQueriesByClaim;
  totalQueries: number;
  model?: string;
  error?: string;
}

const SYSTEM_PROMPT = `אתה מתכנן שאילתות מחקר משפטי לישראל. עבור כל טענה, החזר רשימה קטנה של שאילתות עבריות *ספציפיות*, מקובצות לפי תפקיד המקור.

חוקים:
1. עבור כל טענה דוקטרינלית — חובה לכלול לפחות primary_statute אחת ו-binding_case_law אחת אם קיימים.
2. scholarship רק כשהטענה פרשנית/נורמטיבית.
3. factual_background רק לטענה אמפירית/עובדתית.
4. שאילתה חייבת להיות ספציפית — לכלול שם חוק + סעיף, או דוקטרינה + נושא/צד, או מזהי תיק. אסור "אקטיביזם שיפוטי" סתם.
5. targets: סמן local_db תמיד; approved_web כשסביר שמקור איכותי קיים ברשת (ילקוט/נבו/בית המשפט העליון/כתבי עת).
6. אסור להמציא ציטוטים. שדה reason הוא הסבר קצר בעברית.
7. מקסימום ${MAX_QUERIES_PER_CLAIM} שאילתות לטענה.

החזר JSON תקני בלבד דרך הכלי submit_research_queries.`;

interface RawTool {
  claims: Array<{
    claim_id: string;
    queries: Array<{
      role: string;
      purpose?: string;
      query_he: string;
      targets?: string[];
      expected_source_type?: string;
      reason?: string;
    }>;
  }>;
}

function buildUserPrompt(question: string, plan: PlanV1): string {
  const claims = plan.claims.slice(0, MAX_CLAIMS).map((c) => {
    const ev = (c.required_evidence || []).join(", ");
    return `- ${c.id}: ${c.text}${ev ? ` [evidence: ${ev}]` : ""}`;
  }).join("\n");
  const auths = (plan.expected_authorities || [])
    .slice(0, 10)
    .map((a) => `${a.type}: ${a.name}${a.section ? ` §${a.section}` : ""}${a.docket ? ` (${a.docket})` : ""}`)
    .join(" | ");
  return [
    `שאלה: ${question}`,
    `תזה: ${plan.thesis || ""}`,
    `מסגרת דוקטרינלית: ${plan.doctrinal_frame || ""}`,
    `טענות:`,
    claims,
    `סמכויות צפויות: ${auths || "(אין)"}`,
    "",
    `תפקידי מקור מותרים: ${RESEARCH_ROLE_TAXONOMY.join(", ")}`,
    `סוגי מקור צפויים: ${RESEARCH_EXPECTED_TYPE_TAXONOMY.join(", ")}`,
    `מטרות: ${RESEARCH_TARGET_TAXONOMY.join(", ")}`,
    `הפק שאילתות מחקר לכל טענה. החזר דרך הכלי.`,
  ].join("\n");
}

const TOOL = {
  type: "function" as const,
  function: {
    name: "submit_research_queries",
    description: "Submit structured research queries grouped by claim and source role.",
    parameters: {
      type: "object",
      properties: {
        claims: {
          type: "array",
          items: {
            type: "object",
            properties: {
              claim_id: { type: "string" },
              queries: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    role: { type: "string", enum: [...RESEARCH_ROLE_TAXONOMY] },
                    purpose: { type: "string" },
                    query_he: { type: "string" },
                    targets: { type: "array", items: { type: "string", enum: [...RESEARCH_TARGET_TAXONOMY] } },
                    expected_source_type: { type: "string", enum: [...RESEARCH_EXPECTED_TYPE_TAXONOMY] },
                    reason: { type: "string" },
                  },
                  required: ["role", "query_he", "targets", "expected_source_type"],
                  additionalProperties: false,
                },
              },
            },
            required: ["claim_id", "queries"],
            additionalProperties: false,
          },
        },
      },
      required: ["claims"],
      additionalProperties: false,
    },
  },
};

function sanitize(raw: unknown, validClaimIds: Set<string>): ResearchQueriesByClaim {
  const out: ResearchQueriesByClaim = {};
  if (!raw || typeof raw !== "object") return out;
  const tool = raw as RawTool;
  if (!Array.isArray(tool.claims)) return out;
  const validRoles = new Set<string>(RESEARCH_ROLE_TAXONOMY);
  const validTargets = new Set<string>(RESEARCH_TARGET_TAXONOMY);
  const validTypes = new Set<string>(RESEARCH_EXPECTED_TYPE_TAXONOMY);
  for (const c of tool.claims) {
    if (!c || typeof c.claim_id !== "string" || !validClaimIds.has(c.claim_id)) continue;
    if (!Array.isArray(c.queries)) continue;
    const qs: ResearchQuery[] = [];
    for (const q of c.queries) {
      if (!q || typeof q.query_he !== "string" || q.query_he.trim().length < 3) continue;
      if (!validRoles.has(q.role)) continue;
      const targets = Array.isArray(q.targets)
        ? q.targets.filter((t): t is ResearchTarget => typeof t === "string" && validTargets.has(t))
        : [];
      if (targets.length === 0) targets.push("local_db");
      const expected = typeof q.expected_source_type === "string" && validTypes.has(q.expected_source_type)
        ? (q.expected_source_type as ResearchExpectedType)
        : "case";
      qs.push({
        role: q.role as ResearchRole,
        purpose: typeof q.purpose === "string" ? q.purpose.slice(0, 240) : "",
        query_he: q.query_he.trim().slice(0, 240),
        targets,
        expected_source_type: expected,
        reason: typeof q.reason === "string" ? q.reason.slice(0, 240) : "",
      });
      if (qs.length >= MAX_QUERIES_PER_CLAIM) break;
    }
    if (qs.length) out[c.claim_id] = qs;
  }
  return out;
}

interface AttemptArgs {
  model: string;
  timeoutMs: number;
  apiKey: string;
  system: string;
  user: string;
  parentSignal?: AbortSignal;
}

interface AttemptOutcome {
  ok: boolean;
  raw?: unknown;
  error?: string;
}

async function runAttempt(a: AttemptArgs): Promise<AttemptOutcome> {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, a.timeoutMs);
  const onParent = () => ctrl.abort();
  a.parentSignal?.addEventListener("abort", onParent, { once: true });
  try {
    const r = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${a.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: a.model,
        reasoning_effort: "minimal",
        messages: [
          { role: "system", content: a.system },
          { role: "user", content: a.user },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "submit_research_queries" } },
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const body = await r.text();
      return { ok: false, error: `gateway_${r.status}:${body.slice(0, 160)}` };
    }
    const j = await r.json();
    const call = j?.choices?.[0]?.message?.tool_calls?.[0];
    const argsStr = call?.function?.arguments;
    if (typeof argsStr !== "string") return { ok: false, error: "no_tool_call" };
    let parsed: unknown;
    try { parsed = JSON.parse(argsStr); }
    catch (e) { return { ok: false, error: `parse_error:${(e as Error).message}` }; }
    return { ok: true, raw: parsed };
  } catch (e) {
    return { ok: false, error: timedOut ? "timeout" : `threw:${(e as Error).message}` };
  } finally {
    clearTimeout(timer);
    a.parentSignal?.removeEventListener("abort", onParent);
  }
}

export async function buildResearchQueries(args: {
  question: string;
  plan: PlanV1;
  lovableApiKey: string;
  signal?: AbortSignal;
}): Promise<BuildResearchQueriesResult> {
  const { question, plan, lovableApiKey, signal } = args;
  if (!lovableApiKey) {
    return { ok: false, byClaim: {}, totalQueries: 0, error: "missing_lovable_api_key" };
  }
  const validIds = new Set<string>(plan.claims.map((c) => c.id));
  const user = buildUserPrompt(question, plan);

  const a1 = await runAttempt({
    model: PRIMARY_MODEL, timeoutMs: PRIMARY_TIMEOUT_MS, apiKey: lovableApiKey,
    system: SYSTEM_PROMPT, user, parentSignal: signal,
  });
  if (a1.ok && a1.raw) {
    const byClaim = sanitize(a1.raw, validIds);
    return {
      ok: true, byClaim,
      totalQueries: Object.values(byClaim).reduce((n, arr) => n + arr.length, 0),
      model: PRIMARY_MODEL,
    };
  }
  if (signal?.aborted) {
    return { ok: false, byClaim: {}, totalQueries: 0, model: PRIMARY_MODEL, error: a1.error ?? "aborted" };
  }
  console.warn(`[research_query_planner] primary ${PRIMARY_MODEL} failed: ${a1.error} — retrying ${FALLBACK_MODEL}`);
  const a2 = await runAttempt({
    model: FALLBACK_MODEL, timeoutMs: FALLBACK_TIMEOUT_MS, apiKey: lovableApiKey,
    system: SYSTEM_PROMPT, user, parentSignal: signal,
  });
  if (a2.ok && a2.raw) {
    const byClaim = sanitize(a2.raw, validIds);
    return {
      ok: true, byClaim,
      totalQueries: Object.values(byClaim).reduce((n, arr) => n + arr.length, 0),
      model: FALLBACK_MODEL,
    };
  }
  return {
    ok: false, byClaim: {}, totalQueries: 0,
    model: FALLBACK_MODEL, error: a2.error ?? a1.error ?? "unknown",
  };
}

export function summarizeResearchQueries(byClaim: ResearchQueriesByClaim) {
  const claims = Object.keys(byClaim);
  const total = claims.reduce((n, k) => n + byClaim[k].length, 0);
  const byRole: Record<string, number> = {};
  const byTarget: Record<string, number> = { local_db: 0, approved_web: 0 };
  for (const qs of Object.values(byClaim)) {
    for (const q of qs) {
      byRole[q.role] = (byRole[q.role] ?? 0) + 1;
      for (const t of q.targets) byTarget[t] = (byTarget[t] ?? 0) + 1;
    }
  }
  return { claim_count: claims.length, total_queries: total, by_role: byRole, by_target: byTarget };
}
