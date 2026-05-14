// Phase 7 / Stage 1 — Issue Map (broad open web, never cited).
//
// Discovers the doctrinal landscape around a question using broad open web
// search (no `search_domain_filter`). The output is descriptors only — no
// URLs, no quotes, no "according to X" — and it MUST NOT enter the
// SourcePack. Raw URLs/snippets are kept for telemetry/audit only.
//
// Single source of truth for the Issue Map shape lives in `contracts.ts`
// (see `IssueMap`). This module owns the call + sanitization.

import type { IssueMap } from "./contracts.ts";
import type { StageRun } from "./aiProvider.ts";

export type IssueMapMode = "off" | "lite" | "full";

export interface IssueMapResult {
  issueMap: IssueMap | null;
  run: StageRun;
  /** Raw URLs returned by Perplexity. Telemetry/audit only. */
  rawUrls: string[];
}

const SYSTEM_PROMPT = `אתה שכבת ISSUE MAP עבור צינור מחקר משפטי ישראלי.

מטרתך: לבנות מפת סוגיה תיאורית רחבה לשאלה משפטית — דוקטרינות, פסיקה מובילה, חקיקה, ספרות משנית, עמדות מתחרות, ושאלות פתוחות.

חוקים קריטיים:
1. אסור לצטט מקור או להציג מסקנה משפטית. רק תיאור הסוגיה (descriptors).
2. אסור לכלול URLs, ציטוטים מילוליים, או "לפי X" / "פסק הדין נקבע ש".
3. השתמש בשפה תיאורית: "הדוקטרינה עוסקת ב..."; "פסק הדין הזה מזוהה כמכונן בסוגיה"; "עמדה אחת גורסת... עמדה אחרת גורסת...".
4. אם אינך בטוח — השמט. אל תמציא שמות פסקי דין או חוקים.

החזר JSON בלבד בסכמה הבאה (ללא markdown, ללא הסברים):
{
  "framing": "string — משפט תיאורי על הסוגיה המרכזית",
  "doctrines":           [{"name": "string", "summary": "string"}],
  "leading_cases":       [{"name": "string", "docket": "string?", "relevance": "string"}],
  "statutes":            [{"name": "string", "year": "string?", "relevance": "string"}],
  "secondary_sources":   [{"author": "string?", "title": "string?", "type": "academic|committee|report|news|other", "relevance": "string"}],
  "competing_positions": [{"stance": "string", "rationale": "string"}],
  "open_questions":      ["string"]
}`;

/**
 * Run Stage 1. Returns `issueMap=null` on any failure — pipeline degrades to
 * today's behavior with no regression.
 */
export async function runIssueMap(
  question: string,
  mode: IssueMapMode,
  signal?: AbortSignal,
): Promise<IssueMapResult> {
  const startedAt = new Date().toISOString();
  const tStart = Date.now();
  // v7.1: drop to `sonar` even in Deep — `sonar-pro` consistently exceeded the
  // 15s budget on the frozen-embryo eval. Issue Map is a broad descriptor sweep,
  // not a citation-quality stage; `sonar` is sufficient and ~2× faster.
  const model = "sonar";
  const timeoutMs = mode === "full" ? 25000 : 12000;
  const baseRun: Omit<StageRun, "completed_at" | "duration_ms" | "status"> = {
    stage: "issue_map",
    provider: "perplexity",
    model,
    started_at: startedAt,
  };

  if (mode === "off") {
    return {
      issueMap: null,
      rawUrls: [],
      run: {
        ...baseRun,
        completed_at: new Date().toISOString(),
        duration_ms: 0,
        status: "no_api_key",
        error_message: "issueMap mode=off",
      },
    };
  }

  const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
  if (!PERPLEXITY_API_KEY) {
    return {
      issueMap: null,
      rawUrls: [],
      run: {
        ...baseRun,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - tStart,
        status: "no_api_key",
        error_message: "PERPLEXITY_API_KEY missing",
      },
    };
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  // Cancel on outer abort too.
  signal?.addEventListener("abort", () => ctl.abort());

  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `שאלת המחקר:\n${question}\n\nהחזר JSON בלבד.` },
        ],
        temperature: 0.2,
        max_tokens: mode === "full" ? 1200 : 800,
        // Intentionally NO search_domain_filter — Stage 1 is BROAD by design.
      }),
      signal: ctl.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        issueMap: null,
        rawUrls: [],
        run: {
          ...baseRun,
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - tStart,
          status: "http_error",
          http_status: res.status,
          error_message: errText.slice(0, 200),
        },
      };
    }

    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content ?? "";
    const rawUrls: string[] = Array.isArray(data?.citations) ? data.citations : [];

    const parsed = parseIssueMap(raw);
    if (!parsed) {
      return {
        issueMap: null,
        rawUrls,
        run: {
          ...baseRun,
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - tStart,
          status: "parse_error",
          error_message: "could not parse issue map JSON",
        },
      };
    }

    return {
      issueMap: sanitizeIssueMap(parsed),
      rawUrls,
      run: {
        ...baseRun,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - tStart,
        status: "success",
      },
    };
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    return {
      issueMap: null,
      rawUrls: [],
      run: {
        ...baseRun,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - tStart,
        status: /aborted|abort/i.test(msg) ? "timeout" : "error",
        error_message: msg,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

export function parseIssueMap(raw: string): IssueMap | null {
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    return JSON.parse(cleaned.slice(start, end + 1)) as IssueMap;
  } catch {
    return null;
  }
}

const URL_RE = /https?:\/\/\S+/g;

function stripUrls(s: string | undefined | null): string {
  if (!s || typeof s !== "string") return "";
  return s.replace(URL_RE, "").replace(/\s{2,}/g, " ").trim();
}

/**
 * Final scrub: kill any URL the model tried to embed in a descriptor field.
 * Bounds string lengths. Drops malformed entries silently.
 */
export function sanitizeIssueMap(m: IssueMap): IssueMap {
  const trim = (s: string, n: number) => stripUrls(s).slice(0, n);
  return {
    framing: trim(m.framing ?? "", 400),
    doctrines: (m.doctrines ?? [])
      .filter((d) => d && typeof d.name === "string" && d.name.trim())
      .slice(0, 8)
      .map((d) => ({ name: trim(d.name, 120), summary: trim(d.summary ?? "", 280) })),
    leading_cases: (m.leading_cases ?? [])
      .filter((c) => c && typeof c.name === "string" && c.name.trim())
      .slice(0, 10)
      .map((c) => ({
        name: trim(c.name, 160),
        docket: c.docket ? trim(c.docket, 60) || undefined : undefined,
        relevance: trim(c.relevance ?? "", 240),
      })),
    statutes: (m.statutes ?? [])
      .filter((s) => s && typeof s.name === "string" && s.name.trim())
      .slice(0, 10)
      .map((s) => ({
        name: trim(s.name, 160),
        year: s.year ? trim(s.year, 20) || undefined : undefined,
        relevance: trim(s.relevance ?? "", 240),
      })),
    secondary_sources: (m.secondary_sources ?? [])
      .filter((s) => s && (s.author || s.title))
      .slice(0, 10)
      .map((s) => ({
        author: s.author ? trim(s.author, 120) || undefined : undefined,
        title: s.title ? trim(s.title, 200) || undefined : undefined,
        type: ["academic", "committee", "report", "news", "other"].includes(s.type as string)
          ? (s.type as IssueMap["secondary_sources"][number]["type"])
          : "other",
        relevance: trim(s.relevance ?? "", 240),
      })),
    competing_positions: (m.competing_positions ?? [])
      .filter((p) => p && typeof p.stance === "string")
      .slice(0, 6)
      .map((p) => ({
        stance: trim(p.stance, 200),
        rationale: trim(p.rationale ?? "", 280),
      })),
    open_questions: (m.open_questions ?? [])
      .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
      .slice(0, 6)
      .map((q) => trim(q, 240)),
  };
}

export function isIssueMapEmpty(m: IssueMap | null): boolean {
  if (!m) return true;
  return (
    !m.framing &&
    m.doctrines.length === 0 &&
    m.leading_cases.length === 0 &&
    m.statutes.length === 0 &&
    m.secondary_sources.length === 0 &&
    m.competing_positions.length === 0
  );
}

/** Telemetry summary for `qa_logs.metadata.research_safeguards.issue_map`. */
export function summarizeIssueMap(m: IssueMap | null): Record<string, number> {
  if (!m) {
    return {
      doctrines: 0, leading_cases: 0, statutes: 0,
      secondary_sources: 0, competing_positions: 0, open_questions: 0,
    };
  }
  return {
    doctrines: m.doctrines.length,
    leading_cases: m.leading_cases.length,
    statutes: m.statutes.length,
    secondary_sources: m.secondary_sources.length,
    competing_positions: m.competing_positions.length,
    open_questions: m.open_questions.length,
  };
}
