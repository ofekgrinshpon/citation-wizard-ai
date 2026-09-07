/**
 * legal-research-v2 — `search` tool.
 *
 * Discovery ONLY. A search result can never become a citation: it carries no
 * body, is never stored in the evidence store, and the verifier never sees it.
 *
 * Scopes are backends/hints, not research modes:
 *   web       → Perplexity (lowest useful primitive: query in, sources out)
 *   official  → Perplexity, biased to official Israeli sources
 *   academic  → Perplexity, biased to Israeli legal scholarship
 *   corpus    → local lexical retrieval (`search_legal_chunks_text`)
 *
 * No admission logic, no candidate shaping, no roles, no ranking, no caps,
 * no recovery. The agent decides what to do with the list.
 */

import type { SearchResult, SearchScope } from "../types.ts";
import { buildHebrewFtsQuery, detectDockets, type SupabaseClient } from "../shared/primitives.ts";

const PPLX_URL = "https://api.perplexity.ai/chat/completions";

const SCOPE_INSTRUCTION: Record<Exclude<SearchScope, "corpus">, string> = {
  web:
    "אתר מקורות משפטיים ישראליים רלוונטיים (פסיקה, חקיקה, כתיבה משפטית). החזר קישורים ישירים בלבד.",
  official:
    "התמקד אך ורק במקורות רשמיים ישראליים: אתר בתי המשפט (court.gov.il), ספר החוקים ואתר הכנסת (knesset.gov.il), gov.il, נבו. החזר קישורים ישירים למסמך עצמו, לא לדפי חיפוש.",
  academic:
    "התמקד בכתיבה אקדמית משפטית ישראלית: כתבי עת משפטיים, מאמרים אקדמיים, ספרות משפטית. החזר קישורים ישירים למאמר עצמו (PDF או עמוד המאמר).",
};

interface PplxSource {
  title?: string;
  url?: string;
  snippet?: string;
  source_type?: string;
}

let counter = 0;
function nextResultId(): string {
  counter += 1;
  return `R${counter}`;
}

/** Test seam: reset the per-process result-id counter. */
export function resetSearchResultIds(): void {
  counter = 0;
}

async function perplexitySearch(
  query: string,
  scope: Exclude<SearchScope, "corpus">,
  limit: number,
): Promise<{ results: SearchResult[]; error?: string }> {
  const key = Deno.env.get("PERPLEXITY_API_KEY");
  if (!key) return { results: [], error: "missing_perplexity_credentials" };
  const sys = `${SCOPE_INSTRUCTION[scope]} החזר עד ${limit} מקורות. אל תמציא קישורים.`;
  let r: Response;
  try {
    r = await fetch(PPLX_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: query },
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
                      url: { type: "string" },
                      snippet: { type: "string" },
                      source_type: { type: "string" },
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
    });
  } catch (e) {
    return { results: [], error: `network_error: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    if (r.status === 401 && body.includes("insufficient_quota")) {
      return { results: [], error: "perplexity_credits_exhausted" };
    }
    return { results: [], error: `perplexity_http_${r.status}` };
  }
  const json = await r.json().catch(() => null) as Record<string, unknown> | null;
  const content = ((json?.choices as Array<Record<string, unknown>> | undefined)?.[0]
    ?.message as Record<string, unknown> | undefined)?.content;
  let parsed: { sources?: PplxSource[] } | null = null;
  if (typeof content === "string") {
    try {
      parsed = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          parsed = JSON.parse(m[0]);
        } catch { /* unparseable */ }
      }
    }
  }
  const raw = Array.isArray(parsed?.sources) ? parsed!.sources! : [];
  const results = raw.slice(0, limit).map((s) => toResult({
    title: String(s.title ?? "").trim() || "(ללא כותרת)",
    url: typeof s.url === "string" && /^https?:\/\//i.test(s.url) ? s.url : undefined,
    snippet: typeof s.snippet === "string" ? s.snippet.slice(0, 400) : undefined,
    origin: `perplexity:${scope}`,
    possible_source_type: typeof s.source_type === "string" ? s.source_type : undefined,
  }));
  return { results };
}

function toResult(input: Omit<SearchResult, "result_id" | "possible_docket"> & {
  possible_docket?: string;
}): SearchResult {
  const dockets = detectDockets(`${input.title} ${input.snippet ?? ""}`);
  return {
    result_id: nextResultId(),
    ...input,
    possible_docket: input.possible_docket ?? dockets[0]?.number,
  };
}

async function corpusSearch(
  admin: SupabaseClient,
  query: string,
  limit: number,
): Promise<{ results: SearchResult[]; error?: string }> {
  const fts = buildHebrewFtsQuery(query);
  const searchQuery = fts.tsq_primary || fts.tsq_fallback || query;
  try {
    const { data, error } = await admin.rpc("search_legal_chunks_text", {
      search_query: searchQuery,
      match_count: limit,
    });
    if (error) return { results: [], error: `corpus_rpc_error: ${error.message}` };
    const rows = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;
    return {
      results: rows.slice(0, limit).map((row) =>
        toResult({
          title: String(row.document_title ?? "מסמך מקומי"),
          url: typeof row.source_url === "string" ? row.source_url : undefined,
          snippet: typeof row.chunk_content === "string" ? row.chunk_content.slice(0, 600) : undefined,
          origin: "corpus",
          possible_source_type: typeof row.source_type === "string" ? row.source_type : undefined,
        })
      ),
    };
  } catch (e) {
    return { results: [], error: `corpus_error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export interface SearchToolInput {
  query: string;
  scope?: SearchScope;
  limit?: number;
}

export interface SearchToolOutput {
  results: SearchResult[];
  scope: SearchScope;
  error?: string;
}

export async function runSearch(
  admin: SupabaseClient,
  input: SearchToolInput,
): Promise<SearchToolOutput> {
  const scope: SearchScope = input.scope ?? "web";
  const limit = Math.max(1, Math.min(10, input.limit ?? 6));
  const query = String(input.query ?? "").trim();
  if (!query) return { results: [], scope, error: "empty_query" };
  const out = scope === "corpus"
    ? await corpusSearch(admin, query, limit)
    : await perplexitySearch(query, scope, limit);
  return { results: out.results, scope, error: out.error };
}
