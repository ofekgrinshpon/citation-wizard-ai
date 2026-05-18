// Research V2 — AnswerMap / Authority Discovery (gated by RESEARCH_V2_ANSWER_MAP=true).
//
// Runs AFTER ResearchPlan and BEFORE claimRetrieval. Two-stage:
//   1. Perplexity sonar-pro orientation, restricted to a wide allowlist of
//      legal/academic domains. Surfaces likely anchor names — never citable.
//   2. GPT-5-mini extraction (tool-call JSON) → DoctrinalAnchor[] with
//      type/name/purpose/centrality/claim_hint/queries.
//
// Hard principle: open web = orientation only. Approved DB / approved domains
// = proof and citation. Anchors are CANDIDATES, not citations. The ledger
// remains the only proof gate.
//
// Caps: Deep 8 anchors, Fast 5 anchors. Failure/timeout returns null so the
// caller proceeds with current V2 unchanged.

import { callPlannerJSON, type PlannerToolDef, type StageRun } from "./aiProvider.ts";
import type { ResearchPlan } from "./researchPlan.ts";

const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");

// Wide allowlist for ORIENTATION. Wikipedia/news/blogs intentionally excluded.
// scholar.google.com + ssrn.com are discovery-only (never become citations).
const ORIENTATION_DOMAINS = [
  "nevo.co.il",
  "takdin.co.il",
  "lite.takdin.co.il",
  "supreme.court.gov.il",
  "court.gov.il",
  "knesset.gov.il",
  "main.knesset.gov.il",
  "fs.knesset.gov.il",
  "mishpatim.tau.ac.il",
  "law.tau.ac.il",
  "law.huji.ac.il",
  "law.biu.ac.il",
  "daat.ac.il",
  "gov.il",
  "scholar.google.com",
  "ssrn.com",
];

export type AnchorType =
  | "statute_section"
  | "regulation"
  | "basic_law_section"
  | "leading_case"
  | "secondary_case"
  | "academic"
  | "committee_report";

export type AnchorCentrality = "seminal" | "supporting" | "peripheral";

export interface DoctrinalAnchor {
  id: string;
  type: AnchorType;
  /** Canonical Hebrew name as a competent researcher would write it. */
  name: string;
  docket?: string;
  section?: string;
  statute?: string;
  /** Why this anchor matters. Not cited; informs reconciliation + telemetry. */
  purpose: string;
  centrality: AnchorCentrality;
  /** Planner claim ids this anchor likely supports (C1..C8). */
  claim_hint?: string[];
  /** Concrete Hebrew queries (exact-title, docket, statute§N). Cap 3. */
  queries: string[];
}

export interface AnswerMap {
  thesis_refined?: string;
  doctrinal_anchors: DoctrinalAnchor[];
  counter_anchors: DoctrinalAnchor[];
  notes?: string;
}

export interface AnswerMapTelemetry {
  status: "completed" | "timeout" | "empty" | "skipped_fast" | "skipped_disabled" | "error";
  model_orientation: string | null;
  model_extraction: string | null;
  duration_ms_orientation: number;
  duration_ms_extraction: number;
  orientation_citation_count: number;
  orientation_chars: number;
  anchors_discovered: number;
  anchors_by_type: Record<string, number>;
  anchors_by_centrality: Record<string, number>;
  counter_anchors_discovered: number;
  error?: string;
}

export function answerMapEnabled(): boolean {
  return (Deno.env.get("RESEARCH_V2_ANSWER_MAP") ?? "false").toLowerCase() === "true";
}

export function anchorCapFor(depth: "fast" | "deep"): number {
  return depth === "deep" ? 8 : 5;
}

// ── Perplexity orientation ─────────────────────────────────────────────────

interface OrientationResult {
  text: string;
  citations: string[];
  duration_ms: number;
  status: "ok" | "timeout" | "http_error" | "no_api_key" | "error";
  error?: string;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function runOrientation(question: string, thesis: string, timeoutMs: number): Promise<OrientationResult> {
  const t0 = Date.now();
  if (!PERPLEXITY_API_KEY) {
    return { text: "", citations: [], duration_ms: 0, status: "no_api_key" };
  }
  const sys = "אתה חוקר משפט ישראלי. אתה מספק התמצאות בלבד: מהי התשובה הסבירה, אילו דוקטרינות, חוקים, סעיפים, פסקי דין מובילים, מאמרים אקדמיים, ודו\"חות ועדה נחשבים העוגנים הקנוניים לסוגיה. אל תכתוב את התשובה המשפטית עצמה — רק רשימה של עוגנים צפויים והקשר קצר על מה כל אחד נדרש. ענה בעברית בלבד.";
  const user = `שאלה משפטית:\n${question}\n\nתזה (מתוך תכנון מחקר):\n${thesis}\n\nציין:\n1. עוגנים עיקריים: שמות פסקי דין מובילים (כולל מספר תיק), סעיפי חוק וסעיפי חוקי יסוד ספציפיים, תקנות רלוונטיות, מאמרים אקדמיים מובילים, דו\"חות ועדה.\n2. עוגני נגד אם קיימים.\n3. מקור (URL) לכל עוגן כשניתן.\nאל תמציא. אם אינך בטוח — דלג.`;
  try {
    const res = await fetchWithTimeout(
      "https://api.perplexity.ai/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "sonar-pro",
          messages: [
            { role: "system", content: sys },
            { role: "user", content: user },
          ],
          search_domain_filter: ORIENTATION_DOMAINS,
          temperature: 0.1,
          max_tokens: 1500,
        }),
      },
      timeoutMs,
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { text: "", citations: [], duration_ms: Date.now() - t0, status: "http_error", error: `${res.status}:${txt.slice(0, 200)}` };
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? "";
    const citations: string[] = Array.isArray(data?.citations) ? data.citations : [];
    return { text: String(text).slice(0, 8000), citations: citations.slice(0, 25), duration_ms: Date.now() - t0, status: "ok" };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    const isAbort = /aborted|abort/i.test(msg);
    return { text: "", citations: [], duration_ms: Date.now() - t0, status: isAbort ? "timeout" : "error", error: msg };
  }
}

// ── Extraction tool ────────────────────────────────────────────────────────

const EXTRACT_TOOL: PlannerToolDef = {
  name: "submit_answer_map",
  description:
    "Extract a deduplicated list of doctrinal anchors (cases / statute sections / committee reports / academic) that an Israeli legal researcher would expect to see cited for this question. Each anchor includes type, canonical Hebrew name, centrality, claim hint, and 1-3 concrete Hebrew search queries that would resolve it in a legal database.",
  parameters: {
    type: "object",
    properties: {
      thesis_refined: { type: "string", description: "אופציונלי: ניסוח תזה מהודק (≤220 תווים)." },
      doctrinal_anchors: {
        type: "array",
        minItems: 0,
        maxItems: 10,
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "A1, A2, …" },
            type: {
              type: "string",
              enum: ["statute_section", "regulation", "basic_law_section", "leading_case", "secondary_case", "academic", "committee_report"],
            },
            name: { type: "string", description: "השם הקנוני בעברית כפי שחוקר ישראלי היה כותב." },
            docket: { type: "string", description: "מספר תיק עם prefix, למשל ע\"א 4628/93." },
            section: { type: "string", description: "מספר סעיף או תקנה, למשל 25 או 95." },
            statute: { type: "string", description: "שם החוק המלא, למשל חוק החוזים (חלק כללי), תשל\"ג-1973." },
            purpose: { type: "string", description: "≤180 תווים: מדוע העוגן הזה רלוונטי לשאלה." },
            centrality: { type: "string", enum: ["seminal", "supporting", "peripheral"] },
            claim_hint: {
              type: "array",
              items: { type: "string", description: "מזהה claim, למשל C1." },
              maxItems: 3,
            },
            queries: {
              type: "array",
              minItems: 1,
              maxItems: 3,
              items: { type: "string", description: "שאילתת חיפוש קונקרטית בעברית — שם מלא של פסק דין, מספר תיק, או 'סעיף N לחוק X'." },
            },
          },
          required: ["id", "type", "name", "purpose", "centrality", "queries"],
          additionalProperties: false,
        },
      },
      counter_anchors: {
        type: "array",
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "AC1, AC2, …" },
            type: { type: "string", enum: ["statute_section", "regulation", "basic_law_section", "leading_case", "secondary_case", "academic", "committee_report"] },
            name: { type: "string" },
            docket: { type: "string" },
            section: { type: "string" },
            statute: { type: "string" },
            purpose: { type: "string" },
            centrality: { type: "string", enum: ["seminal", "supporting", "peripheral"] },
            claim_hint: { type: "array", items: { type: "string" }, maxItems: 3 },
            queries: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
          },
          required: ["id", "type", "name", "purpose", "centrality", "queries"],
          additionalProperties: false,
        },
      },
      notes: { type: "string", description: "הערות פנימיות קצרות." },
    },
    required: ["doctrinal_anchors"],
    additionalProperties: false,
  },
};

const EXTRACT_SYSTEM = `אתה שלב Authority-Discovery בצינור מחקר משפטי ישראלי.
המטרה: לחלץ רשימת עוגנים דוקטרינריים שחוקר ישראלי מוכשר היה מצפה למצוא ציטוט עבורם.

חוקים קריטיים:
- אסור להמציא. אם אתה לא בטוח בשם / מספר תיק / סעיף — אל תכלול. עדיף 3 עוגנים מדויקים מ-8 עוגנים שגויים.
- השמות חייבים להיות בעברית הקנונית כפי שמופיעים בנבו / תקדין / ספרי לימוד.
- ל-leading_case חובה למלא docket אם ידוע. ל-statute_section חובה למלא statute + section.
- centrality="seminal" רק לעוגן שבלעדיו התשובה חסרת ערך (אפרופים לפרשנות חוזה, בנק המזרחי לביקורת חוקתית).
- queries הן שאילתות שתוזנקנה לחיפוש text/vector מקומי. כתוב ספציפי: "ע\"א 4628/93 אפרופים" ולא "פרשנות חוזה".
- claim_hint: שייך לכל עוגן ל-1-3 מזהי claim שאליהם הוא קשור (C1..C8). אם לא ברור — השאר ריק.
- אל תחזור על אותו עוגן בכמה כניסות. דה-דופלקציה לפי name+docket+section.

מקור הנתונים: טקסט התמצאות מ-Perplexity (לא לציטוט!), תכנון המחקר, והשאלה. הטקסט יכול להכיל טעויות — הסתמך על הידע הכללי שלך כשיש סתירה.

החזר JSON דרך הכלי submit_answer_map. אם אין עוגנים בטוחים — החזר doctrinal_anchors=[].`;

function buildExtractUserPrompt(args: {
  question: string;
  plan: ResearchPlan;
  orientationText: string;
  orientationCitations: string[];
}): string {
  const { question, plan, orientationText, orientationCitations } = args;
  const claimsBlock = plan.claims.map((c) => `[${c.id}] ${c.statement}`).join("\n");
  const counterBlock = plan.counter_claims.map((c) => `[${c.id}] ${c.statement}`).join("\n");
  const citesBlock = orientationCitations.length
    ? `\n\nמקורות התמצאות (לא לציטוט):\n${orientationCitations.map((u, i) => `[${i + 1}] ${u}`).join("\n")}`
    : "";
  return `שאלה:\n${question}\n\nתזה:\n${plan.thesis}\n\nטענות בתכנון:\n${claimsBlock}${counterBlock ? `\n\nטענות-נגד:\n${counterBlock}` : ""}\n\nטקסט התמצאות (Perplexity, לא לציטוט — להקשר בלבד):\n${orientationText || "(לא הוחזר טקסט)"}${citesBlock}\n\nחלץ את העוגנים הצפויים. החזר JSON דרך הכלי.`;
}

// ── Sanitization ───────────────────────────────────────────────────────────

const VALID_TYPES = new Set<AnchorType>(["statute_section", "regulation", "basic_law_section", "leading_case", "secondary_case", "academic", "committee_report"]);
const VALID_CENTRALITY = new Set<AnchorCentrality>(["seminal", "supporting", "peripheral"]);

function sanitizeAnchorList(raw: unknown, cap: number, planClaimIds: Set<string>, idPrefix: string): DoctrinalAnchor[] {
  if (!Array.isArray(raw)) return [];
  const out: DoctrinalAnchor[] = [];
  const seen = new Set<string>();
  let i = 0;
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const a = r as Record<string, unknown>;
    const type = typeof a.type === "string" && VALID_TYPES.has(a.type as AnchorType) ? (a.type as AnchorType) : null;
    const name = typeof a.name === "string" ? a.name.trim().slice(0, 240) : "";
    if (!type || name.length < 2) continue;
    const docket = typeof a.docket === "string" ? a.docket.trim().slice(0, 60) : undefined;
    const section = typeof a.section === "string" ? a.section.trim().slice(0, 40) : undefined;
    const statute = typeof a.statute === "string" ? a.statute.trim().slice(0, 200) : undefined;
    const dedupKey = `${type}|${name.toLowerCase()}|${docket ?? ""}|${section ?? ""}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    const purpose = typeof a.purpose === "string" ? a.purpose.trim().slice(0, 200) : "";
    const centrality = typeof a.centrality === "string" && VALID_CENTRALITY.has(a.centrality as AnchorCentrality)
      ? (a.centrality as AnchorCentrality) : "supporting";
    const claimHint = Array.isArray(a.claim_hint)
      ? (a.claim_hint as unknown[])
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim().slice(0, 4))
        .filter((x) => planClaimIds.has(x))
        .slice(0, 3)
      : [];
    const queries = Array.isArray(a.queries)
      ? (a.queries as unknown[])
        .filter((x): x is string => typeof x === "string" && x.trim().length >= 3)
        .map((x) => x.trim().slice(0, 160))
        .slice(0, 3)
      : [];
    if (queries.length === 0) continue;
    out.push({
      id: `${idPrefix}${++i}`,
      type,
      name,
      ...(docket ? { docket } : {}),
      ...(section ? { section } : {}),
      ...(statute ? { statute } : {}),
      purpose,
      centrality,
      ...(claimHint.length ? { claim_hint: claimHint } : {}),
      queries,
    });
    if (out.length >= cap) break;
  }
  // Centrality ordering: seminal > supporting > peripheral, stable within group.
  const ord = { seminal: 0, supporting: 1, peripheral: 2 } as const;
  out.sort((a, b) => ord[a.centrality] - ord[b.centrality]);
  return out.slice(0, cap);
}

// ── Public entry point ─────────────────────────────────────────────────────

export interface BuildAnswerMapArgs {
  question: string;
  plan: ResearchPlan;
  depth: "fast" | "deep";
  /** Total budget (Perplexity + extraction). Default deep=30s, fast=20s. */
  totalBudgetMs?: number;
}

export interface BuildAnswerMapResult {
  answerMap: AnswerMap | null;
  telemetry: AnswerMapTelemetry;
  extractionRun?: StageRun;
}

export async function buildAnswerMap(args: BuildAnswerMapArgs): Promise<BuildAnswerMapResult> {
  const { question, plan, depth } = args;
  const totalBudgetMs = args.totalBudgetMs ?? (depth === "deep" ? 75000 : 35000);
  const orientationBudgetMs = Math.min(45000, Math.floor(totalBudgetMs * 0.6));

  const telemetry: AnswerMapTelemetry = {
    status: "error",
    model_orientation: null,
    model_extraction: null,
    duration_ms_orientation: 0,
    duration_ms_extraction: 0,
    orientation_citation_count: 0,
    orientation_chars: 0,
    anchors_discovered: 0,
    anchors_by_type: {},
    anchors_by_centrality: {},
    counter_anchors_discovered: 0,
  };

  // Fast mode: skip Perplexity, run extraction-only on (question, plan).
  let orientationText = "";
  let orientationCitations: string[] = [];
  if (depth === "deep") {
    const o = await runOrientation(question, plan.thesis, orientationBudgetMs);
    telemetry.model_orientation = "perplexity:sonar-pro";
    telemetry.duration_ms_orientation = o.duration_ms;
    telemetry.orientation_chars = o.text.length;
    telemetry.orientation_citation_count = o.citations.length;
    if (o.status !== "ok") {
      // Orientation failure is NOT fatal — extraction can still run on plan alone.
      console.warn(`[answer_map] orientation ${o.status}: ${o.error ?? ""}`);
    }
    orientationText = o.text;
    orientationCitations = o.citations;
  } else {
    telemetry.model_orientation = null;
  }

  const cap = anchorCapFor(depth);
  const planClaimIds = new Set(plan.claims.map((c) => c.id));
  const extractTimeout = Math.max(8000, totalBudgetMs - telemetry.duration_ms_orientation - 1000);

  const { data, run } = await callPlannerJSON<{ thesis_refined?: string; doctrinal_anchors?: unknown; counter_anchors?: unknown; notes?: string }>(
    EXTRACT_SYSTEM,
    buildExtractUserPrompt({ question, plan, orientationText, orientationCitations }),
    EXTRACT_TOOL,
    {
      stage: "answer_map_extract",
      timeoutMs: extractTimeout,
      reasoningEffort: "minimal",
      openaiModelOverride: "gpt-5-mini",
    },
  );
  telemetry.model_extraction = run.model;
  telemetry.duration_ms_extraction = run.duration_ms;

  if (!data) {
    telemetry.status = run.status === "timeout" ? "timeout" : "error";
    telemetry.error = run.error_message ?? run.status;
    return { answerMap: null, telemetry, extractionRun: run };
  }

  const doctrinal = sanitizeAnchorList(data.doctrinal_anchors, cap, planClaimIds, "A");
  const counter = sanitizeAnchorList(data.counter_anchors, Math.min(4, Math.max(2, Math.floor(cap / 2))), planClaimIds, "AC");

  if (doctrinal.length === 0 && counter.length === 0) {
    telemetry.status = "empty";
    return { answerMap: null, telemetry, extractionRun: run };
  }

  // Tally telemetry.
  const byType: Record<string, number> = {};
  const byCentrality: Record<string, number> = {};
  for (const a of doctrinal) {
    byType[a.type] = (byType[a.type] ?? 0) + 1;
    byCentrality[a.centrality] = (byCentrality[a.centrality] ?? 0) + 1;
  }
  telemetry.anchors_discovered = doctrinal.length;
  telemetry.counter_anchors_discovered = counter.length;
  telemetry.anchors_by_type = byType;
  telemetry.anchors_by_centrality = byCentrality;
  telemetry.status = "completed";

  const answerMap: AnswerMap = {
    ...(typeof data.thesis_refined === "string" ? { thesis_refined: data.thesis_refined.trim().slice(0, 280) } : {}),
    doctrinal_anchors: doctrinal,
    counter_anchors: counter,
    ...(typeof data.notes === "string" ? { notes: data.notes.slice(0, 400) } : {}),
  };
  return { answerMap, telemetry, extractionRun: run };
}

export function summarizeAnswerMap(answerMap: AnswerMap | null): {
  anchor_names: string[];
  seminal_names: string[];
} {
  if (!answerMap) return { anchor_names: [], seminal_names: [] };
  return {
    anchor_names: answerMap.doctrinal_anchors.map((a) => a.name),
    seminal_names: answerMap.doctrinal_anchors.filter((a) => a.centrality === "seminal").map((a) => a.name),
  };
}
