/**
 * legal-research-v2 — `raw_web_search` tool.
 *
 * An ordinary broad web search: query in, ranked results out. It is backed by
 * Perplexity's dedicated Search API (`POST /search`) with the SAME
 * PERPLEXITY_API_KEY the existing Sonar `search` tool already uses.
 *
 * Discovery ONLY, exactly like `search`: no body, never stored in the evidence
 * store, never seen by the verifier, never citable. It returns no generated
 * answer and no summary of the legal issue.
 */

import type { SearchResult } from "../types.ts";
import { detectDockets } from "../shared/primitives.ts";
import { nextResultId } from "./resultIds.ts";
import { isSafeFetchUrl } from "../shared/urlSafety.ts";

const PPLX_SEARCH_URL = "https://api.perplexity.ai/search";

export const RAW_WEB_SEARCH_LIMITS = {
  MIN_RESULTS: 1,
  MAX_RESULTS: 10,
  DEFAULT_RESULTS: 8,
  MAX_DOMAIN_FILTERS: 5,
  TIMEOUT_MS: 20_000,
} as const;

declare const Deno: { env: { get(key: string): string | undefined } };

export interface RawWebSearchInput {
  query: string;
  limit?: number;
  domain_filter?: string[];
}

export interface RawWebSearchOutput {
  results: SearchResult[];
  /** Normalized dedupe key for this query (durable, per run). */
  query_key: string;
  error?: string;
}

/** Deterministic per-run dedupe key: same query + same domain filter. */
export function rawQueryKey(input: RawWebSearchInput): string {
  const q = String(input.query ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const d = (input.domain_filter ?? [])
    .map((x) => String(x ?? "").toLowerCase().trim())
    .filter(Boolean)
    .sort()
    .join(",");
  return `raw:${q}|${d}`;
}

function domainOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

interface RawApiResult {
  title?: string;
  url?: string;
  snippet?: string;
  date?: string;
  last_updated?: string;
}

export async function runRawWebSearch(
  input: RawWebSearchInput,
  deps?: { fetchImpl?: typeof fetch; apiKey?: string | null },
): Promise<RawWebSearchOutput> {
  const query_key = rawQueryKey(input);
  const query = String(input.query ?? "").trim();
  if (!query) return { results: [], query_key, error: "empty_query" };

  const key = deps?.apiKey ?? (typeof Deno !== "undefined" ? Deno.env.get("PERPLEXITY_API_KEY") : undefined);
  if (!key) return { results: [], query_key, error: "missing_perplexity_credentials" };

  const limit = Math.max(
    RAW_WEB_SEARCH_LIMITS.MIN_RESULTS,
    Math.min(RAW_WEB_SEARCH_LIMITS.MAX_RESULTS, input.limit ?? RAW_WEB_SEARCH_LIMITS.DEFAULT_RESULTS),
  );
  const domains = (input.domain_filter ?? [])
    .map((d) => String(d ?? "").trim())
    .filter(Boolean)
    .slice(0, RAW_WEB_SEARCH_LIMITS.MAX_DOMAIN_FILTERS);

  const doFetch = deps?.fetchImpl ?? fetch;
  let r: Response;
  try {
    r = await doFetch(PPLX_SEARCH_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        max_results: limit,
        ...(domains.length ? { search_domain_filter: domains } : {}),
      }),
    });
  } catch (e) {
    return { results: [], query_key, error: `network_error: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    if (r.status === 401 && body.includes("insufficient_quota")) {
      return { results: [], query_key, error: "perplexity_credits_exhausted" };
    }
    return { results: [], query_key, error: `perplexity_http_${r.status}` };
  }
  const json = await r.json().catch(() => null) as { results?: RawApiResult[] } | null;
  const raw = Array.isArray(json?.results) ? json!.results! : [];

  const results: SearchResult[] = [];
  for (const item of raw.slice(0, limit)) {
    const url = typeof item.url === "string" && /^https?:\/\//i.test(item.url) ? item.url : undefined;
    // Unsafe targets are dropped at discovery time as well as at fetch time.
    if (url && !isSafeFetchUrl(url)) continue;
    const title = String(item.title ?? "").trim() || url || "(ללא כותרת)";
    const snippet = typeof item.snippet === "string" ? item.snippet.slice(0, 400) : undefined;
    results.push({
      result_id: nextResultId(),
      title,
      url,
      snippet,
      origin: "perplexity:raw_web",
      possible_docket: detectDockets(`${title} ${snippet ?? ""}`)[0]?.number,
      domain: domainOf(url),
      published_date: typeof item.date === "string" ? item.date : undefined,
      query_key,
      candidate_kind: "document",
    });
  }
  return { results, query_key };
}
