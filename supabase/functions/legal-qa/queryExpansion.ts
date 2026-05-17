// Query expansion for the Legal QA retrieval pipeline.
//
// Goal: widen RECALL only. The expanded query set is fed to vector + text
// retrieval to build the *candidate pool*. Candidates do NOT enter the
// SourcePack unless they pass Claim Verification (direct/partial support).
//
// Inputs:
//   - userQuestion: the raw Hebrew question
//   - mainIssue:   decomposition.mainIssue (Hebrew)
//   - plannerSynonyms: optional lexical synonyms supplied by the legal
//                      research planner (camelCase contract field
//                      `lexicalSynonyms`). NOT URLs, NOT citation strings.
//
// Output: { expandedQueries, doctrineHits, source } where expandedQueries is
// capped at MAX_EXPANSIONS to bound cost (each query becomes one embedding
// call + one text RPC call).

import {
  expandDoctrineTerms,
  type ExpandedTerms,
} from "../_shared/legalDoctrineSynonyms.ts";

export const MAX_EXPANSIONS = 6;

export interface ExpansionResult {
  /** Final list of queries to feed retrieval, original first. */
  expandedQueries: string[];
  /** Doctrine dictionary ids that fired (for telemetry). */
  doctrineHits: string[];
  /** Which source(s) contributed: "doctrine" | "planner" | "none". */
  source: "doctrine" | "planner" | "doctrine+planner" | "none";
}

function normalize(s: string): string {
  return (s || "")
    .replace(/[\u00A0\s]+/g, " ")
    .trim();
}

export function expandQuery(args: {
  userQuestion: string;
  mainIssue?: string;
  plannerSynonyms?: string[];
}): ExpansionResult {
  const original = normalize(args.userQuestion);
  const combined = `${original}\n${normalize(args.mainIssue || "")}`;

  const dict: ExpandedTerms = expandDoctrineTerms(combined);
  const planner = (args.plannerSynonyms || [])
    .map(normalize)
    .filter((s) => s.length >= 2);

  const seen = new Set<string>();
  const out: string[] = [];
  const push = (q: string) => {
    const k = q.toLowerCase();
    if (!q || seen.has(k)) return;
    seen.add(k);
    out.push(q);
  };

  // Always run the original query first.
  push(original);

  // Doctrine synonyms next (they are the most reliable widening).
  for (const s of dict.synonyms) {
    if (out.length >= MAX_EXPANSIONS) break;
    push(s);
  }

  // Planner-supplied synonyms last.
  for (const s of planner) {
    if (out.length >= MAX_EXPANSIONS) break;
    push(s);
  }

  let source: ExpansionResult["source"] = "none";
  if (dict.synonyms.length && planner.length) source = "doctrine+planner";
  else if (dict.synonyms.length) source = "doctrine";
  else if (planner.length) source = "planner";

  return {
    expandedQueries: out,
    doctrineHits: dict.hits,
    source,
  };
}

// ───────────────────────────────────────────────────────────────────────
// Hebrew lexical fallback: stages 1 → 2 → 3.
//
// Used as a wrapper around `search_legal_chunks_text` when the original
// query returns zero rows. Caller is responsible for the supabase admin
// client.
//
// Strategy:
//   1) Re-run search_legal_chunks_text against each expanded query.
//   2) If still zero, call search_legal_chunks_trigram with the strongest
//      2-3 terms (length ≥ 3, non-stopword).
//   3) If still zero, ILIKE scan over title/citation only, limited to 2-3
//      strong terms and 200 rows total.
//
// Returns { rows, level } where level is the telemetry value for
// `lexical_fallback_used`.

type AdminClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  from: (t: string) => {
    select: (cols: string) => {
      or: (filter: string) => { limit: (n: number) => Promise<{ data: unknown; error: unknown }> };
    };
  };
};

export interface LexicalFallbackResult {
  rows: any[];
  level: "none" | "rpc_expanded" | "trigram" | "ilike";
}

const HEB_STOPWORDS = new Set([
  "של","על","עם","אם","או","את","זה","זו","הוא","היא","אני","אנו","אתה",
  "מה","מי","איך","למה","כי","גם","רק","כל","כמו","יותר","לא","כן","בין",
  "אבל","אך","אך גם","יש","אין","לפי","לפני","אחרי","אצל","מן","אל","עד",
]);

function strongTerms(query: string, limit = 3): string[] {
  const toks = query
    .replace(/["׳״'`.,;:?!()\[\]{}]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !HEB_STOPWORDS.has(t));
  // Prefer longer tokens (often more discriminating in Hebrew).
  toks.sort((a, b) => b.length - a.length);
  return [...new Set(toks)].slice(0, limit);
}

export async function searchLegalChunksTextResilient(args: {
  adminClient: AdminClient;
  originalQuery: string;
  expandedQueries: string[];
  matchCount?: number;
}): Promise<LexicalFallbackResult> {
  const matchCount = args.matchCount ?? 8;

  // Caller already tried the original query and got 0 rows by the time we're
  // invoked. Stage 1: re-run each expanded query and merge results.
  const merged = new Map<string, any>();
  for (const q of args.expandedQueries) {
    if (q === args.originalQuery) continue;
    try {
      const { data } = await args.adminClient.rpc("search_legal_chunks_text", {
        search_query: q,
        match_count: matchCount,
      });
      if (Array.isArray(data)) {
        for (const r of data as any[]) {
          const key = String(r.chunk_id ?? `${r.document_id}:${r.chunk_content?.slice(0, 40)}`);
          const existing = merged.get(key);
          if (!existing || (r.similarity ?? 0) > (existing.similarity ?? 0)) {
            merged.set(key, r);
          }
        }
      }
    } catch (_e) { /* swallow — fallback continues */ }
  }
  if (merged.size > 0) {
    return { rows: [...merged.values()], level: "rpc_expanded" };
  }

  // Stage 2: trigram fallback (title/citation only).
  const candidateText = [args.originalQuery, ...args.expandedQueries].join(" ");
  const terms = strongTerms(candidateText, 3);
  if (terms.length) {
    try {
      const { data } = await args.adminClient.rpc("search_legal_chunks_trigram", {
        search_terms: terms,
        match_count: matchCount,
        similarity_threshold: 0.25,
      });
      if (Array.isArray(data) && data.length > 0) {
        return { rows: data as any[], level: "trigram" };
      }
    } catch (_e) { /* fall through to ILIKE */ }
  }

  // Stage 3: ILIKE scan over title/citation (≤ 200 rows hard cap).
  if (terms.length) {
    try {
      const ilikeTerms = terms.slice(0, 3);
      const filter = ilikeTerms
        .flatMap((t) => [`title.ilike.%${t}%`, `citation.ilike.%${t}%`])
        .join(",");
      const { data } = await args.adminClient
        .from("legal_documents")
        .select("id,title,citation,source_type,source_url,metadata")
        .or(filter)
        .limit(200);
      if (Array.isArray(data) && data.length > 0) {
        // Shape-match the RPC return as best we can; no chunk_content here.
        const rows = (data as any[]).map((d) => ({
          chunk_id: null,
          document_id: d.id,
          chunk_content: "",
          document_title: d.title,
          document_citation: d.citation,
          source_type: d.source_type,
          source_url: d.source_url,
          metadata: d.metadata,
          similarity: 0.2,
        }));
        return { rows, level: "ilike" };
      }
    } catch (_e) { /* nothing else to try */ }
  }

  return { rows: [], level: "none" };
}
