// Phase 1 — Legal Issue Router.
//
// A single fast planner call that classifies the legal question BEFORE
// decomposition runs. Output (`LegalIssueRoute`) is used to:
//   1. Bias decomposition (forbidden_topics / target statute / domain).
//   2. Decide whether OpenWebDiscovery should fire (Phase 3).
//   3. Drive `entity_resolution` and `source_pack_gate` (Phase 2/4).
//
// Single-pipeline design: the router itself is gated by
// `modeProfile.legalIssueRouter`. When false, the caller skips this call and
// decomposition runs unbiased (legacy behaviour).
//
// All output is INTERNAL — never serialized to the user response. Telemetry
// lives in `qa_logs.metadata.research_safeguards.router`.

import { callPlannerJSON, type PlannerToolDef, type StageRun } from "./aiProvider.ts";

export type QueryType =
  | "doctrinal"
  | "procedural"
  | "statutory_amendment_comparison"
  | "case_law_application"
  | "comparative"
  | "policy"
  | "factual_legal"
  | "mixed"
  | "unknown";

export type LegalDomain =
  | "contract_law"
  | "tort_law"
  | "criminal_law"
  | "criminal_procedure"
  | "civil_procedure"
  | "constitutional_law"
  | "administrative_law"
  | "family_law"
  | "labor_law"
  | "tax_law"
  | "property_law"
  | "corporate_law"
  | "consumer_law"
  | "evidence_law"
  | "international_law"
  | "other"
  | "unknown";

export interface LegalIssueRoute {
  query_type: QueryType;
  legal_domain: LegalDomain;
  /** Optional secondary domains that may legitimately bear on the question. */
  secondary_domains: LegalDomain[];
  /**
   * Domains the answer must NOT drift into. Drives the `domain_exclusion`
   * ranking penalty in retrieval (Phase 2).
   */
  forbidden_domains: LegalDomain[];
  /**
   * Topic phrases (Hebrew) that are clearly off-topic for this question.
   * Used as a soft ranking signal — short, content-bearing words only.
   */
  forbidden_topics: string[];
  /** Target statute identifiers, when the question is statute-anchored. */
  target_statute: {
    name: string | null;
    section: string | null;
    /** "latest" when the user explicitly asks about the most recent amendment. */
    amendment: string | null;
  };
  /** Whether the answer needs current/up-to-date legal context. */
  requires_current_context: boolean;
  /** Ambiguous Hebrew terms in the question → preferred disambiguation. */
  ambiguous_terms: Record<string, string>;
  /** 0..1; how confident the router is in this routing. */
  confidence: number;
  /** Free-text router note for diagnostics. Never shown to the user. */
  notes: string;
}

const ROUTER_TOOL: PlannerToolDef = {
  name: "submit_legal_issue_route",
  description:
    "Classify the legal research question to bias downstream retrieval and drafting.",
  parameters: {
    type: "object",
    properties: {
      query_type: {
        type: "string",
        enum: [
          "doctrinal",
          "procedural",
          "statutory_amendment_comparison",
          "case_law_application",
          "comparative",
          "policy",
          "factual_legal",
          "mixed",
          "unknown",
        ],
      },
      legal_domain: {
        type: "string",
        enum: [
          "contract_law",
          "tort_law",
          "criminal_law",
          "criminal_procedure",
          "civil_procedure",
          "constitutional_law",
          "administrative_law",
          "family_law",
          "labor_law",
          "tax_law",
          "property_law",
          "corporate_law",
          "consumer_law",
          "evidence_law",
          "international_law",
          "other",
          "unknown",
        ],
      },
      secondary_domains: { type: "array", items: { type: "string" } },
      forbidden_domains: { type: "array", items: { type: "string" } },
      forbidden_topics: {
        type: "array",
        items: { type: "string" },
        description: "ביטויים בעברית (1–4 מילים) שמסמנים נושא לא רלוונטי לשאלה",
      },
      target_statute: {
        type: "object",
        properties: {
          name: { type: ["string", "null"] },
          section: { type: ["string", "null"] },
          amendment: { type: ["string", "null"] },
        },
        required: ["name", "section", "amendment"],
        additionalProperties: false,
      },
      requires_current_context: { type: "boolean" },
      ambiguous_terms: {
        type: "object",
        description: "{ביטוי דו-משמעי: הסבר/בחירה מועדפת}",
        additionalProperties: { type: "string" },
      },
      confidence: { type: "number" },
      notes: { type: "string" },
    },
    required: [
      "query_type",
      "legal_domain",
      "secondary_domains",
      "forbidden_domains",
      "forbidden_topics",
      "target_statute",
      "requires_current_context",
      "ambiguous_terms",
      "confidence",
      "notes",
    ],
    additionalProperties: false,
  },
};

const ROUTER_SYSTEM_PROMPT = `אתה נתב משפטי דטרמיניסטי. תפקידך לסווג שאלת מחקר משפטית ישראלית לפני שלב הפירוק.

הנחיות:
- query_type: בחר את הסיווג המדויק ביותר. "statutory_amendment_comparison" אם השאלה מבקשת להשוות בין נוסח חוק נוכחי לנוסח קודם או לבחון אם תיקון שינה את ההלכה.
- legal_domain: התחום העיקרי של השאלה. אם לא בטוח — "unknown".
- secondary_domains: עד 2 תחומים משניים שעשויים להיות רלוונטיים. אל תכלול תחומים שאינם קשורים.
- forbidden_domains: תחומים שהתשובה אסור לסטות אליהם (למשל: שאלה על דיני חוזים → הוסף "family_law", "criminal_law" אם אינם רלוונטיים בעליל).
- forbidden_topics: 0–6 ביטויים קצרים בעברית (1–4 מילים) שמסמנים נושאים לא רלוונטיים. דוגמאות: "מזונות", "עיכוב הליכים", "פסילת שופט".
- target_statute: אם השאלה ממוקדת בחוק ספציפי — מלא name (שם החוק כפי שמופיע בשאלה). section אם מוזכר סעיף. amendment="latest" אם המשתמש שואל על "התיקון האחרון" / "המצב כיום".
- requires_current_context: true אם נדרש מידע מעודכן (תיקון אחרון, הלכה חדשה, מצב נוכחי).
- ambiguous_terms: אם יש מונח דו-משמעי בעברית (למשל "הפרה" — חוזית או פלילית?) — ספק הבהרה קצרה. אחרת אובייקט ריק.
- confidence: 0..1.
- notes: עד 200 תווים, פנימי בלבד.

החזר JSON בלבד דרך הכלי submit_legal_issue_route.`;

/**
 * Phase 1: route the question. Returns `{ data, run }` matching the rest of
 * the pipeline's StageRun convention. Caller bounds latency via
 * `raceWithTimeout`.
 */
export async function routeLegalIssue(
  question: string,
): Promise<{ data: LegalIssueRoute | null; run: StageRun }> {
  const { data, run } = await callPlannerJSON<LegalIssueRoute>(
    ROUTER_SYSTEM_PROMPT,
    `שאלת המחקר:\n${question}`,
    ROUTER_TOOL,
    {
      stage: "legal_issue_router",
      timeoutMs: 11000,
      reasoningEffort: "minimal",
      forceProvider: "gemini",
    },
  );

  if (!data) return { data: null, run };

  // Defensive normalization — the planner sometimes returns null fields as
  // missing keys. Coerce so downstream consumers don't crash on undefined.
  const normalized: LegalIssueRoute = {
    query_type: (data.query_type ?? "unknown") as QueryType,
    legal_domain: (data.legal_domain ?? "unknown") as LegalDomain,
    secondary_domains: Array.isArray(data.secondary_domains)
      ? (data.secondary_domains as LegalDomain[])
      : [],
    forbidden_domains: Array.isArray(data.forbidden_domains)
      ? (data.forbidden_domains as LegalDomain[])
      : [],
    forbidden_topics: Array.isArray(data.forbidden_topics)
      ? data.forbidden_topics.filter((t) => typeof t === "string" && t.trim().length > 0)
      : [],
    target_statute: {
      name: data.target_statute?.name ?? null,
      section: data.target_statute?.section ?? null,
      amendment: data.target_statute?.amendment ?? null,
    },
    requires_current_context: data.requires_current_context === true,
    ambiguous_terms:
      data.ambiguous_terms && typeof data.ambiguous_terms === "object"
        ? (data.ambiguous_terms as Record<string, string>)
        : {},
    confidence:
      typeof data.confidence === "number" && isFinite(data.confidence)
        ? Math.max(0, Math.min(1, data.confidence))
        : 0.5,
    notes: typeof data.notes === "string" ? data.notes.slice(0, 240) : "",
  };

  return { data: normalized, run };
}

/**
 * Bound a router (or any other StageRun-returning) call by a wall-clock
 * timeout. On timeout we resolve with `data: null` and a synthesized
 * `timeout` StageRun so callers can keep pipeline telemetry consistent.
 */
export async function raceWithTimeout<T>(
  promise: Promise<{ data: T | null; run: StageRun }>,
  timeoutMs: number,
  stageLabel: string,
): Promise<{ data: T | null; run: StageRun; timed_out: boolean }> {
  const startedAt = new Date().toISOString();
  const start = Date.now();

  let timer: number | undefined;
  const timeoutPromise = new Promise<{ data: null; run: StageRun; timed_out: true }>((resolve) => {
    timer = setTimeout(() => {
      const completedAt = new Date().toISOString();
      resolve({
        data: null,
        run: {
          stage: stageLabel,
          provider: "gemini",
          model: "unknown",
          started_at: startedAt,
          completed_at: completedAt,
          duration_ms: Date.now() - start,
          status: "timeout",
          error_message: `wall-clock timeout after ${timeoutMs}ms`,
        },
        timed_out: true,
      });
    }, timeoutMs) as unknown as number;
  });

  const wrapped = promise
    .then((r) => ({ ...r, timed_out: false }))
    .catch((err) => {
      const completedAt = new Date().toISOString();
      return {
        data: null as T | null,
        run: {
          stage: stageLabel,
          provider: "gemini" as const,
          model: "unknown",
          started_at: startedAt,
          completed_at: completedAt,
          duration_ms: Date.now() - start,
          status: "error" as const,
          error_message: (err as Error)?.message ?? String(err),
        },
        timed_out: false,
      };
    });

  const result = await Promise.race([wrapped, timeoutPromise]);
  if (timer !== undefined) clearTimeout(timer);
  return result;
}

/** Build the Hebrew preamble that biases decomposition. Empty string when no useful signal. */
export function buildDecompositionBias(route: LegalIssueRoute | null | undefined): string {
  if (!route) return "";
  const lines: string[] = [];
  if (route.legal_domain && route.legal_domain !== "unknown") {
    lines.push(`תחום משפטי עיקרי: ${route.legal_domain}.`);
  }
  if (route.target_statute?.name) {
    const sec = route.target_statute.section ? `, סעיף ${route.target_statute.section}` : "";
    const amd =
      route.target_statute.amendment === "latest"
        ? " (התיקון האחרון)"
        : route.target_statute.amendment
          ? ` (תיקון ${route.target_statute.amendment})`
          : "";
    lines.push(`חוק יעד: ${route.target_statute.name}${sec}${amd}.`);
  }
  if (route.forbidden_topics.length > 0) {
    lines.push(`להימנע מסטייה לנושאים: ${route.forbidden_topics.slice(0, 6).join(", ")}.`);
  }
  const ambig = Object.entries(route.ambiguous_terms ?? {});
  if (ambig.length > 0) {
    const parts = ambig.slice(0, 4).map(([k, v]) => `${k} → ${v}`);
    lines.push(`מונחים דו-משמעיים: ${parts.join("; ")}.`);
  }
  if (lines.length === 0) return "";
  return `הקשר נתב (פנימי, לשימוש בפירוק בלבד):\n${lines.join("\n")}\n`;
}
