// P3 — Perplexity retrieval. Role-aware web search with structured output.
// Drops no-URL, generic-title, bad-domain, role-mismatch. One retry for
// important roles when 0 valid results.

import {
  Candidate,
  CAPS,
  DroppedSource,
  Query,
  SourceRole,
  StageRun,
} from "../lib/types.ts";

const PPLX_TIMEOUT_MS = 25_000;

const CASELAW_DOMAINS = new Set([
  "nevo.co.il",
  "supreme.court.gov.il",
  "supremedecisions.court.gov.il",
  "takdin.co.il",
  "lite.takdin.co.il",
  "psakdin.co.il",
  "din.org.il",
  "court.gov.il",
]);

const STATUTE_DOMAINS = new Set([
  "nevo.co.il",
  "main.knesset.gov.il",
  "knesset.gov.il",
  "fs.knesset.gov.il",
  "justice.gov.il",
  "gov.il",
]);

const SCHOLARSHIP_DOMAINS_HINT = [
  "huji.ac.il", "tau.ac.il", "biu.ac.il", "haifa.ac.il", "colman.ac.il",
  "idc.ac.il", "openu.ac.il", "academia.edu", "ssrn.com", "jstor.org",
  "hebrewu.ac.il", "law.bgu.ac.il", "ono.ac.il", "mishpat.ac.il",
];

const REPORT_DOMAINS_HINT = [
  "gov.il", "knesset.gov.il", "mevaker.gov.il", "boi.org.il",
  "cbs.gov.il", "btl.gov.il",
];

const GENERIC_TITLE_RE = /^(ויקיפדיה|wikipedia|מקור|לא ידוע|untitled|home|דף הבית|לוח|index)\b/i;

const ROLE_PROMPT: Record<SourceRole, { focus: string; hint: string }> = {
  primary_statute: {
    focus: "חקיקה ראשית ישראלית: חוקים וסעיפי חוק רלוונטיים",
    hint: "החזר כותרת מלאה של החוק, סעיף ספציפי, וקישור ל־nevo.co.il או knesset.gov.il/justice.gov.il/gov.il",
  },
  regulation: {
    focus: "תקנות וצווים ישראליים",
    hint: "החזר את שם התקנה והסעיף, וקישור ל־nevo.co.il / knesset.gov.il / gov.il",
  },
  binding_case_law: {
    focus: "פסיקה מחייבת — בעיקר בית המשפט העליון ובג\"ץ",
    hint: "החזר שם הצדדים, מספר תיק, ערכאה (עליון/בג\"ץ), וקישור ל־nevo / supreme.court.gov.il / court.gov.il / takdin / psakdin",
  },
  persuasive_case_law: {
    focus: "פסיקה מנחה — מחוזי, שלום, בתי דין מיוחדים",
    hint: "החזר שם הצדדים, מספר תיק, ערכאה, וקישור למאגר פסיקה מוכר (nevo, takdin, psakdin, din.org.il)",
  },
  scholarship: {
    focus: "ספרות אקדמית משפטית: מאמרים, ספרים, פרקים",
    hint: "החזר מחבר, כותרת, כתב עת/הוצאה ושנה. קישור אקדמי (אוניברסיטה, ssrn, jstor) או mavet/nevo",
  },
  factual_report: {
    focus: "דו\"חות עובדתיים, נתונים סטטיסטיים, מחקרי מדיניות",
    hint: "מקור רשמי או מכון מחקר מוכר; קישור ישיר למסמך",
  },
  government_report: {
    focus: "דו\"חות ממשלתיים, מבקר המדינה, ועדות חקירה, ניירות עמדה של משרדי ממשלה",
    hint: "קישור ל־gov.il, mevaker.gov.il, knesset.gov.il או דומיין רשמי",
  },
};

const RETRY_ROLES = new Set<SourceRole>([
  "primary_statute",
  "regulation",
  "binding_case_law",
]);

interface PplxSource {
  title: string;
  source_type?: string;
  url?: string;
  snippet?: string;
}

function getDomain(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function domainAllowedForRole(role: SourceRole, domain: string): boolean {
  if (!domain) return false;
  switch (role) {
    case "primary_statute":
    case "regulation":
      return STATUTE_DOMAINS.has(domain) || CASELAW_DOMAINS.has(domain);
    case "binding_case_law":
    case "persuasive_case_law":
      return CASELAW_DOMAINS.has(domain) || domain === "nevo.co.il";
    case "scholarship":
      return (
        SCHOLARSHIP_DOMAINS_HINT.some((d) => domain.endsWith(d)) ||
        domain === "nevo.co.il"
      );
    case "factual_report":
    case "government_report":
      return REPORT_DOMAINS_HINT.some((d) => domain.endsWith(d));
  }
}

async function callPerplexity(query: Query): Promise<{
  raw: PplxSource[];
  ms: number;
  ok: boolean;
  http?: number;
}> {
  const key = Deno.env.get("PERPLEXITY_API_KEY");
  if (!key) return { raw: [], ms: 0, ok: false };
  const role = ROLE_PROMPT[query.role];
  const sys =
    `אתה מאתר מקורות משפטיים ישראליים. עבור התפקיד: ${role.focus}. ${role.hint}. ` +
    `החזר עד ${CAPS.PERPLEXITY_PER_QUERY} מקורות עם כתובת URL ישירה. אל תמציא קישורים.`;
  const t0 = Date.now();
  try {
    const r = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: query.query_he },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "sources",
            schema: {
              type: "object",
              properties: {
                sources: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      source_type: { type: "string" },
                      url: { type: "string" },
                      snippet: { type: "string" },
                    },
                    required: ["title"],
                  },
                },
              },
              required: ["sources"],
            },
          },
        },
      }),
      signal: AbortSignal.timeout(PPLX_TIMEOUT_MS),
    });
    const ms = Date.now() - t0;
    if (!r.ok) return { raw: [], ms, ok: false, http: r.status };
    const j = await r.json();
    const content = j?.choices?.[0]?.message?.content ?? "";
    const citations: string[] = Array.isArray(j?.citations) ? j.citations : [];
    let parsed: { sources?: PplxSource[] } = {};
    try { parsed = JSON.parse(content); } catch { /* tolerate */ }
    const raw = Array.isArray(parsed.sources)
      ? parsed.sources.slice(0, CAPS.PERPLEXITY_PER_QUERY).map((s, i) => ({
          title: String(s.title ?? "").trim(),
          source_type: String(s.source_type ?? "").trim(),
          url: (s.url && String(s.url).trim()) || citations[i] || "",
          snippet: s.snippet ? String(s.snippet).slice(0, 400) : undefined,
        }))
      : [];
    return { raw, ms, ok: true, http: r.status };
  } catch (e) {
    return { raw: [], ms: Date.now() - t0, ok: false, http: 0 };
  }
}

function filterPplxSources(
  query: Query,
  raw: PplxSource[],
): { kept: Candidate[]; dropped: DroppedSource[] } {
  const kept: Candidate[] = [];
  const dropped: DroppedSource[] = [];
  for (const s of raw) {
    const title = (s.title || "").trim();
    const url = (s.url || "").trim();
    const domain = getDomain(url);
    if (!url) {
      dropped.push({
        query_he: query.query_he, claim_id: query.claim_id, role: query.role,
        origin: "perplexity", title, url, drop_reason: "no_url",
      });
      continue;
    }
    if (!title || title.length < 5 || GENERIC_TITLE_RE.test(title)) {
      dropped.push({
        query_he: query.query_he, claim_id: query.claim_id, role: query.role,
        origin: "perplexity", title, url, drop_reason: "generic_title",
      });
      continue;
    }
    if (!domainAllowedForRole(query.role, domain)) {
      dropped.push({
        query_he: query.query_he, claim_id: query.claim_id, role: query.role,
        origin: "perplexity", title, url,
        drop_reason: `bad_domain_for_role:${domain}`,
      });
      continue;
    }
    kept.push({
      candidate_id: crypto.randomUUID(),
      claim_id: query.claim_id,
      role: query.role,
      origin: "perplexity",
      retrieval_method: "perplexity",
      title,
      source_type: s.source_type || query.expected_source_type || "other",
      source_url: url,
      snippet: s.snippet ?? null,
      query_he: query.query_he,
      score: 0.7,
      expected_source_type: query.expected_source_type,
      metadata: { domain },
    });
  }
  return { kept, dropped };
}

export interface PerplexityRetrievalResult {
  candidates: Candidate[];
  dropped: DroppedSource[];
  per_query: Array<{
    claim_id: string;
    role: string;
    query_he: string;
    http?: number;
    raw_count: number;
    kept: number;
    dropped: number;
    retried: boolean;
    ms: number;
  }>;
  stage_runs: StageRun[];
  ms: number;
}

export async function runPerplexityRetrieval(
  queries: Query[],
): Promise<PerplexityRetrievalResult> {
  const t0 = Date.now();
  const key = Deno.env.get("PERPLEXITY_API_KEY");
  if (!key) {
    return {
      candidates: [], dropped: [], per_query: [],
      stage_runs: [{ stage: "perplexity_retrieval.skipped", ms: 0, ok: false }],
      ms: 0,
    };
  }
  const targets = queries.filter((q) => q.targets.includes("perplexity"));

  const candidates: Candidate[] = [];
  const dropped: DroppedSource[] = [];
  const per_query: PerplexityRetrievalResult["per_query"] = [];

  // Sequential to be polite to the API.
  for (const q of targets) {
    const first = await callPerplexity(q);
    let { kept, dropped: drop1 } = filterPplxSources(q, first.raw);
    let retried = false;
    let totalMs = first.ms;

    if (kept.length === 0 && RETRY_ROLES.has(q.role) && first.ok) {
      retried = true;
      const retryQuery: Query = {
        ...q,
        query_he: `${q.query_he} ישראל חוק פסיקה`.trim(),
      };
      const second = await callPerplexity(retryQuery);
      const r2 = filterPplxSources(q, second.raw);
      kept = r2.kept;
      drop1 = [...drop1, ...r2.dropped];
      totalMs += second.ms;
    }

    candidates.push(...kept);
    dropped.push(...drop1);
    per_query.push({
      claim_id: q.claim_id,
      role: q.role,
      query_he: q.query_he,
      http: first.http,
      raw_count: first.raw.length,
      kept: kept.length,
      dropped: drop1.length,
      retried,
      ms: totalMs,
    });
  }

  return {
    candidates,
    dropped,
    per_query,
    stage_runs: [{ stage: "perplexity_retrieval", ms: Date.now() - t0, ok: true }],
    ms: Date.now() - t0,
  };
}
