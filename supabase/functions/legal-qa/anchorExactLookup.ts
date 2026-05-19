// Step 4 (lookup-only fix) — Anchor Materialization: exact local lookup.
//
// Audit findings driving this rewrite:
//   • Israeli primary + secondary legislation live in source_type="israeli_law"
//     (5,013 rows). Use metadata.law_type / metadata.is_basic_law to taxonomize.
//   • PostgREST `.or()` strings break on Hebrew quotes (" / ״), colons,
//     parentheses, brackets — silently returning [] on the audit set (0/13).
//   • `shortStatuteName` kept `[נוסח משולב]` and used a comma split that
//     didn't strip brackets / extra clauses → ILIKE never matched DB title.
//   • Statute names suffer Ktiv male/חסר variance (לעניינים ↔ לענינים) and
//     "חוק-יסוד" vs "חוק יסוד" vs "חו״י".
//   • `metadata.section` doesn't exist; section text lives inside the chunk.
//   • supreme_court_il.case_number is NULL for 302 rows; docket lives inside
//     the title (often with dash form 6821-93 instead of slash 6821/93).
//
// Scope: lookup-only. Do not touch retrieval, ledger, drafter, citation
// engine, Rule 37, Step 3, Fast, academic, or Perplexity policy.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import type { ClaimCandidateSource } from "./claimRetrieval.ts";
import type { V3ExpectedAnchor } from "./legalResearchPlanV3.ts";

const PER_ANCHOR_TIMEOUT_MS = 4000;
const MAX_DOCS_PER_ANCHOR = 2;

const LEGISLATION_SOURCE_TYPES = [
  "israeli_law",
  "legislation_primary",
  "legislation_secondary",
];

const CASELAW_SOURCE_TYPES = [
  "caselaw",
  "case_law",
  "supreme_court_il",
];

export type AnchorMatchConfidence = "high" | "medium" | "none";
export type AnchorMatchBasis =
  | "docket"
  | "dash_docket"
  | "title_in_text" // docket-style token found inside title (supreme_court_il)
  | "title_plus_section"
  | "section_chunk"
  | "title_plus_author"
  | "title_only"
  | "normalized_title"
  | "citation_only"
  | "none";

export interface AnchorLookupDetail {
  anchor_id: string;
  anchor_type: string;
  lookup_queries_attempted: string[];
  matched_by: AnchorMatchBasis;
  source_type?: string;
  law_type?: string;
  is_basic_law?: boolean;
  confidence: AnchorMatchConfidence;
  selected_chunk_contains_section?: boolean;
  error_message?: string;
}

export interface AnchorExactMatch {
  anchor_id: string;
  confidence: AnchorMatchConfidence;
  match_basis: AnchorMatchBasis;
  candidates: ClaimCandidateSource[];
  docs_found: number;
  detail: AnchorLookupDetail;
}

// ---------- normalization helpers ----------

/** Escape value for a PostgREST .ilike() pattern. Only %, _ and \ are special. */
function escIlikeVal(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/[%_]/g, "\\$&");
}

/** Collapse whitespace, drop control chars. */
function squish(s: string): string {
  return (s || "").replace(/[\u200e\u200f]/g, "").replace(/\s+/g, " ").trim();
}

/** Hebrew geresh/gershayim → ASCII; brackets/parens normalized to spaces. */
function normalizeStatuteText(s: string): string {
  let n = squish(s);
  // Replace "חו"י" / "חו״י" / "חוק-יסוד" variants with canonical "חוק יסוד".
  n = n.replace(/חו["״]י/g, "חוק יסוד");
  n = n.replace(/חוק\s*[-־]\s*יסוד/g, "חוק יסוד");
  // Hebrew typographic quotes → ASCII so token compares survive.
  n = n.replace(/[״׳]/g, '"').replace(/[\u2018\u2019\u201C\u201D]/g, '"');
  // Strip everything in [...] (e.g. [נוסח משולב], [נוסח חדש]).
  n = n.replace(/\[[^\]]*\]/g, " ");
  // Drop year/gazette/page tails ("ס"ח ...", "ק"ת ...", ", התש...-1992" etc.).
  n = n.replace(/,\s*ס["]ח.*$/i, "");
  n = n.replace(/,\s*ק["]ת.*$/i, "");
  n = n.replace(/,\s*התש[\u0590-\u05ff"\-–\d ]+$/i, "");
  // Replace hyphens between words with space (already handled "חוק-יסוד").
  n = n.replace(/[־-]/g, " ");
  // Collapse residual whitespace.
  return squish(n);
}

/** Strip a leading "סעיף N ל" / "תקנה N ל" prefix if present. */
function stripSectionPrefix(s: string): string {
  return s.replace(/^(?:סעיף|תקנה)\s+[\dא-ת()."'\-–\/]+\s+ל/, "");
}

/** Generate ktiv male/חסר variants: לעניינים ↔ לענינים, etc. */
function ktivVariants(s: string): string[] {
  const out = new Set<string>([s]);
  // Common male→חסר collapse: double yod → single yod between consonants.
  const haser = s.replace(/יי/g, "י");
  out.add(haser);
  // Also try male: single yod → double yod for known patterns.
  const male = s.replace(/לענינים/g, "לעניינים");
  out.add(male);
  return Array.from(out).filter((x) => x && x.length >= 3);
}

/** Build candidate short-name forms to try as ILIKE patterns. */
function statuteSearchForms(rawName: string): string[] {
  const stripped = stripSectionPrefix(squish(rawName));
  const normalized = normalizeStatuteText(stripped);
  const candidates = new Set<string>();
  candidates.add(normalized);

  // Also try a tighter "head" — first 6 words — to tolerate trailing
  // qualifiers that DB title may not contain.
  const head = normalized.split(" ").slice(0, 6).join(" ");
  if (head.length >= 3) candidates.add(head);

  // Variant: strip parenthetical clauses entirely.
  const noParen = normalized.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (noParen.length >= 3) candidates.add(noParen);

  // Ktiv variants for each form.
  const out = new Set<string>();
  for (const c of candidates) {
    for (const v of ktivVariants(c)) out.add(v.slice(0, 80));
  }
  return Array.from(out).filter((x) => x.length >= 3);
}

function normalizeDocketSlash(docket: string): string {
  const m = (docket || "").match(/(\d+)\s*[\/\-]\s*(\d+)/);
  return m ? `${m[1]}/${m[2]}` : "";
}

function extractAcademicSurname(name: string): string {
  const head = (name || "").split(/[,(]/)[0].trim();
  if (!head) return "";
  const parts = head.split(/\s+/).filter((p) => p.length >= 2);
  return parts.length ? parts[parts.length - 1] : "";
}

function inferSourceType(a: V3ExpectedAnchor, docSourceType?: string): string {
  if (docSourceType) return docSourceType;
  switch (a.type) {
    case "leading_case": return "case_law";
    case "statute_section":
    case "basic_law_section":
    case "regulation": return "legislation_primary";
    case "academic": return "journal_article";
    case "committee_report": return "official_publication";
    default: return "other";
  }
}

// ---------- chunk fetchers ----------

async function fetchFirstChunk(
  client: SupabaseClient,
  docId: string,
): Promise<{ chunk_id: string; content: string } | null> {
  try {
    const { data, error } = await client
      .from("legal_document_chunks")
      .select("id, content")
      .eq("document_id", docId)
      .order("chunk_index", { ascending: true })
      .limit(1);
    if (error || !data || !data.length) return null;
    return { chunk_id: data[0].id as string, content: (data[0].content as string) ?? "" };
  } catch {
    return null;
  }
}

/**
 * Try to find a chunk in this doc that actually contains the cited
 * section/regulation marker. Returns null if no such chunk exists.
 */
async function fetchSectionChunk(
  client: SupabaseClient,
  docId: string,
  section: string,
  isRegulation: boolean,
): Promise<{ chunk_id: string; content: string } | null> {
  const sec = section.trim();
  if (!sec) return null;
  const escSec = escIlikeVal(sec);
  // Build a small set of plausible textual markers.
  const markers: string[] = isRegulation
    ? [`תקנה ${escSec}`, `תקנה  ${escSec}`, `תקנה(${escSec})`]
    : [`סעיף ${escSec}`, `סעיף(${escSec})`, `ס' ${escSec}`, `ס׳ ${escSec}`];
  for (const m of markers) {
    try {
      const { data, error } = await client
        .from("legal_document_chunks")
        .select("id, content")
        .eq("document_id", docId)
        .ilike("content", `%${m}%`)
        .order("chunk_index", { ascending: true })
        .limit(1);
      if (error) continue;
      if (data && data.length) {
        return { chunk_id: data[0].id as string, content: (data[0].content as string) ?? "" };
      }
    } catch {
      // fall through to next marker
    }
  }
  return null;
}

// ---------- per-type lookups ----------

interface LookupOutcome {
  docs: Array<Record<string, unknown>>;
  basis: AnchorMatchBasis;
  queriesAttempted: string[];
  error?: string;
}

async function singleQueryIlike(
  client: SupabaseClient,
  field: "title" | "citation" | "case_number",
  pattern: string,
  limit: number,
  sourceTypes?: string[],
): Promise<{ data: Array<Record<string, unknown>>; error?: string }> {
  try {
    let q = client
      .from("legal_documents")
      .select("id, title, citation, source_type, source_url, case_number, metadata")
      .ilike(field, pattern)
      .limit(limit);
    if (sourceTypes && sourceTypes.length) q = q.in("source_type", sourceTypes);
    const { data, error } = await q;
    if (error) return { data: [], error: error.message };
    return { data: (data as Array<Record<string, unknown>>) ?? [] };
  } catch (e) {
    return { data: [], error: (e as Error).message };
  }
}

async function lookupCaselaw(
  client: SupabaseClient,
  a: V3ExpectedAnchor,
): Promise<LookupOutcome> {
  const queries: string[] = [];
  const docket = (a.docket || "").trim();
  if (!docket) return { docs: [], basis: "none", queriesAttempted: queries };
  const slashed = normalizeDocketSlash(docket);
  if (!slashed) return { docs: [], basis: "none", queriesAttempted: queries };
  const dashed = slashed.replace("/", "-");

  // 1. case_number exact (slash form).
  let pat = `%${escIlikeVal(slashed)}%`;
  queries.push(`case_number ILIKE ${pat}`);
  let r = await singleQueryIlike(client, "case_number", pat, MAX_DOCS_PER_ANCHOR + 1, CASELAW_SOURCE_TYPES);
  if (r.error) return { docs: [], basis: "none", queriesAttempted: queries, error: r.error };
  if (r.data.length) return { docs: r.data.slice(0, MAX_DOCS_PER_ANCHOR), basis: "docket", queriesAttempted: queries };

  // 2. citation ILIKE slash.
  queries.push(`citation ILIKE ${pat}`);
  r = await singleQueryIlike(client, "citation", pat, MAX_DOCS_PER_ANCHOR + 1, CASELAW_SOURCE_TYPES);
  if (r.error) return { docs: [], basis: "none", queriesAttempted: queries, error: r.error };
  if (r.data.length) return { docs: r.data.slice(0, MAX_DOCS_PER_ANCHOR), basis: "citation_only", queriesAttempted: queries };

  // 3. case_number/citation dash form (supreme_court_il + variants).
  pat = `%${escIlikeVal(dashed)}%`;
  queries.push(`case_number ILIKE ${pat}`);
  r = await singleQueryIlike(client, "case_number", pat, MAX_DOCS_PER_ANCHOR + 1, CASELAW_SOURCE_TYPES);
  if (r.error) return { docs: [], basis: "none", queriesAttempted: queries, error: r.error };
  if (r.data.length) return { docs: r.data.slice(0, MAX_DOCS_PER_ANCHOR), basis: "dash_docket", queriesAttempted: queries };

  queries.push(`citation ILIKE ${pat}`);
  r = await singleQueryIlike(client, "citation", pat, MAX_DOCS_PER_ANCHOR + 1, CASELAW_SOURCE_TYPES);
  if (r.error) return { docs: [], basis: "none", queriesAttempted: queries, error: r.error };
  if (r.data.length) return { docs: r.data.slice(0, MAX_DOCS_PER_ANCHOR), basis: "dash_docket", queriesAttempted: queries };

  // 4. title ILIKE — supreme_court_il often embeds docket inside title.
  queries.push(`title ILIKE ${pat}`);
  r = await singleQueryIlike(client, "title", pat, MAX_DOCS_PER_ANCHOR + 1, CASELAW_SOURCE_TYPES);
  if (r.error) return { docs: [], basis: "none", queriesAttempted: queries, error: r.error };
  if (r.data.length) return { docs: r.data.slice(0, MAX_DOCS_PER_ANCHOR), basis: "title_in_text", queriesAttempted: queries };

  return { docs: [], basis: "none", queriesAttempted: queries };
}

async function lookupStatute(
  client: SupabaseClient,
  a: V3ExpectedAnchor,
): Promise<LookupOutcome> {
  const queries: string[] = [];
  const forms = statuteSearchForms(a.name || "");
  if (!forms.length) return { docs: [], basis: "none", queriesAttempted: queries };

  let lastErr: string | undefined;

  for (const form of forms) {
    // Token-wildcard pattern: words must appear in order but any separators
    // (hyphens, colons, brackets, punctuation) between them are accepted.
    // This is the key fix for "חוק-יסוד: כבוד האדם וחירותו" etc.
    const tokens = form.split(" ").filter((t) => t.length >= 1);
    if (!tokens.length) continue;
    const tokenPat = `%${tokens.map(escIlikeVal).join("%")}%`;
    const literalPat = `%${escIlikeVal(form)}%`;
    const patterns = literalPat === tokenPat ? [literalPat] : [tokenPat, literalPat];

    for (const pat of patterns) {
      // Try title first across the legislation source_types.
      queries.push(`title ILIKE ${pat}`);
      const t = await singleQueryIlike(client, "title", pat, MAX_DOCS_PER_ANCHOR + 3, LEGISLATION_SOURCE_TYPES);
      if (t.error) lastErr = t.error;
      if (t.data.length) {
        return {
          docs: t.data.slice(0, MAX_DOCS_PER_ANCHOR),
          basis: pat === tokenPat ? "normalized_title" : "title_only",
          queriesAttempted: queries,
          error: lastErr,
        };
      }

      // Then citation.
      queries.push(`citation ILIKE ${pat}`);
      const c = await singleQueryIlike(client, "citation", pat, MAX_DOCS_PER_ANCHOR + 3, LEGISLATION_SOURCE_TYPES);
      if (c.error) lastErr = c.error;
      if (c.data.length) {
        return {
          docs: c.data.slice(0, MAX_DOCS_PER_ANCHOR),
          basis: "citation_only",
          queriesAttempted: queries,
          error: lastErr,
        };
      }
    }
  }

  return { docs: [], basis: "none", queriesAttempted: queries, error: lastErr };
}

async function lookupAcademic(
  client: SupabaseClient,
  a: V3ExpectedAnchor,
): Promise<LookupOutcome> {
  const queries: string[] = [];
  const shortName = normalizeStatuteText(a.name || "").split(" ").slice(0, 8).join(" ");
  if (shortName.length < 4) return { docs: [], basis: "none", queriesAttempted: queries };
  const pat = `%${escIlikeVal(shortName)}%`;
  queries.push(`title ILIKE ${pat}`);
  const r = await singleQueryIlike(client, "title", pat, MAX_DOCS_PER_ANCHOR + 3);
  if (r.error) return { docs: [], basis: "none", queriesAttempted: queries, error: r.error };
  if (!r.data.length) return { docs: [], basis: "none", queriesAttempted: queries };

  const surname = extractAcademicSurname(a.name || "");
  if (surname && surname.length >= 3) {
    const preferred = r.data.filter(
      (row) =>
        ((row.title as string) || "").includes(surname) ||
        ((row.citation as string) || "").includes(surname),
    );
    if (preferred.length) {
      return {
        docs: preferred.slice(0, MAX_DOCS_PER_ANCHOR),
        basis: "title_plus_author",
        queriesAttempted: queries,
      };
    }
  }
  return { docs: r.data.slice(0, MAX_DOCS_PER_ANCHOR), basis: "title_only", queriesAttempted: queries };
}

// ---------- orchestrator ----------

export async function lookupAnchorExact(
  client: SupabaseClient,
  a: V3ExpectedAnchor,
  anchorIdx: number,
): Promise<AnchorExactMatch> {
  const detail: AnchorLookupDetail = {
    anchor_id: a.id,
    anchor_type: a.type,
    lookup_queries_attempted: [],
    matched_by: "none",
    confidence: "none",
  };
  const empty: AnchorExactMatch = {
    anchor_id: a.id,
    confidence: "none",
    match_basis: "none",
    candidates: [],
    docs_found: 0,
    detail,
  };

  let outcome: LookupOutcome | null = null;
  const isRegulation = a.type === "regulation";

  try {
    if (a.type === "leading_case") {
      outcome = await lookupCaselaw(client, a);
    } else if (
      a.type === "statute_section" ||
      a.type === "basic_law_section" ||
      a.type === "regulation"
    ) {
      outcome = await lookupStatute(client, a);
    } else if (a.type === "academic") {
      outcome = await lookupAcademic(client, a);
    } else if (a.type === "committee_report") {
      outcome = await lookupStatute(client, a);
    }
  } catch (e) {
    detail.error_message = (e as Error).message;
    console.warn("[anchor_exact_lookup] error:", a.id, detail.error_message);
    return { ...empty, detail };
  }

  if (!outcome) return empty;
  detail.lookup_queries_attempted = outcome.queriesAttempted;
  if (outcome.error) detail.error_message = outcome.error;

  if (!outcome.docs.length) {
    detail.matched_by = "none";
    return { ...empty, detail };
  }

  // Per-doc chunk selection — section-aware for statute/regulation/basic-law.
  const wantsSection =
    (a.type === "statute_section" ||
      a.type === "basic_law_section" ||
      a.type === "regulation") &&
    !!(a.section && a.section.trim());

  const chunkResults = await Promise.all(
    outcome.docs.map(async (d) => {
      const docId = d.id as string;
      if (wantsSection) {
        const sc = await fetchSectionChunk(client, docId, a.section!.trim(), isRegulation);
        if (sc) return { chunk: sc, containsSection: true };
      }
      const fc = await fetchFirstChunk(client, docId);
      return fc ? { chunk: fc, containsSection: false } : null;
    }),
  );

  let confidence: AnchorMatchConfidence;
  let basis: AnchorMatchBasis = outcome.basis;
  let chunkHasSection = false;

  if (a.type === "leading_case") {
    confidence = outcome.docs.length === 1 ? "high" : "medium";
  } else if (
    a.type === "statute_section" ||
    a.type === "basic_law_section" ||
    a.type === "regulation"
  ) {
    chunkHasSection = chunkResults.some((r) => r?.containsSection);
    if (chunkHasSection) {
      basis = "section_chunk";
      confidence = "high";
    } else if (wantsSection) {
      // We expected a section but couldn't locate it — lower confidence.
      confidence = "medium";
    } else {
      confidence = outcome.docs.length === 1 ? "high" : "medium";
    }
  } else if (a.type === "academic") {
    confidence = basis === "title_plus_author" ? "high" : "medium";
  } else {
    confidence = "medium";
  }

  // Capture top-doc metadata for telemetry.
  const top = outcome.docs[0];
  const topMeta = (top?.metadata as Record<string, unknown>) || {};
  detail.matched_by = basis;
  detail.source_type = (top?.source_type as string) || undefined;
  detail.law_type = (topMeta?.law_type as string) || undefined;
  detail.is_basic_law = typeof topMeta?.is_basic_law === "boolean"
    ? (topMeta.is_basic_law as boolean)
    : undefined;
  detail.confidence = confidence;
  if (wantsSection) detail.selected_chunk_contains_section = chunkHasSection;

  const score = confidence === "high" ? 0.95 : 0.85;
  const candidates: ClaimCandidateSource[] = [];
  outcome.docs.forEach((d, i) => {
    const cr = chunkResults[i];
    if (!cr) return;
    candidates.push({
      id: `EA${anchorIdx}-L${i}`,
      chunkId: cr.chunk.chunk_id,
      documentId: d.id as string,
      title: (d.title as string) || "",
      citation: (d.citation as string) || "",
      sourceType: inferSourceType(a, d.source_type as string | undefined),
      sourceUrl: (d.source_url as string) || undefined,
      excerpt: (cr.chunk.content || "").slice(0, 800),
      score,
      origin: "anchor",
      anchorId: a.id,
    });
  });

  if (!candidates.length) {
    return { ...empty, detail };
  }

  return {
    anchor_id: a.id,
    confidence,
    match_basis: basis,
    candidates,
    docs_found: outcome.docs.length,
    detail,
  };
}

export async function lookupAnchorsExact(
  client: SupabaseClient,
  anchors: V3ExpectedAnchor[],
): Promise<Map<string, AnchorExactMatch>> {
  const tasks = anchors.map((a, i) =>
    Promise.race<AnchorExactMatch>([
      lookupAnchorExact(client, a, i),
      new Promise<AnchorExactMatch>((resolve) =>
        setTimeout(
          () =>
            resolve({
              anchor_id: a.id,
              confidence: "none",
              match_basis: "none",
              candidates: [],
              docs_found: 0,
              detail: {
                anchor_id: a.id,
                anchor_type: a.type,
                lookup_queries_attempted: [],
                matched_by: "none",
                confidence: "none",
                error_message: "per_anchor_timeout",
              },
            }),
          PER_ANCHOR_TIMEOUT_MS,
        )
      ),
    ]).catch((e) => ({
      anchor_id: a.id,
      confidence: "none" as const,
      match_basis: "none" as const,
      candidates: [],
      docs_found: 0,
      detail: {
        anchor_id: a.id,
        anchor_type: a.type,
        lookup_queries_attempted: [],
        matched_by: "none" as const,
        confidence: "none" as const,
        error_message: (e as Error)?.message || "unknown",
      },
    })),
  );
  const results = await Promise.all(tasks);
  const out = new Map<string, AnchorExactMatch>();
  for (const r of results) out.set(r.anchor_id, r);
  return out;
}
