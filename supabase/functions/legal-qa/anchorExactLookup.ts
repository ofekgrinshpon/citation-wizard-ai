// Step 4 — Anchor Materialization: exact local lookup.
//
// For each V3 ExpectedAnchor, try to confirm the planned authority exists in
// the local DB via discriminating fields:
//   • leading_case      — docket number match on legal_documents.case_number
//                         (with citation fallback). Single doc → high.
//   • statute / basic   — short title ILIKE; if `section` is present AND a
//     law / regulation    document references "סעיף <section>" → high.
//   • academic          — title ILIKE; if `name` carries a surname that also
//                         appears in title/citation → high. Else medium.
//   • committee_report  — title ILIKE only → medium.
//
// Confidence drives the candidate score:
//   high   → 0.95   (strong, will land near top of verifier pack)
//   medium → 0.85   (still above generic chunks; verifier remains the gate)
//
// We return real (chunkId, documentId) pairs so the verifier sees real
// excerpts (not synthetic IDs).
//
// Hard caps: 2 docs per anchor, 1 chunk per doc, 4s per anchor wall-clock,
// all anchors in parallel.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import type { ClaimCandidateSource } from "./claimRetrieval.ts";
import type { V3ExpectedAnchor } from "./legalResearchPlanV3.ts";

const PER_ANCHOR_TIMEOUT_MS = 4000;
const MAX_DOCS_PER_ANCHOR = 2;

export type AnchorMatchConfidence = "high" | "medium" | "none";
export type AnchorMatchBasis =
  | "docket"
  | "title_plus_section"
  | "title_plus_author"
  | "title_only"
  | "none";

export interface AnchorExactMatch {
  anchor_id: string;
  confidence: AnchorMatchConfidence;
  match_basis: AnchorMatchBasis;
  candidates: ClaimCandidateSource[];
  docs_found: number;
}

function escapeIlike(s: string): string {
  // Postgres ILIKE: escape % and _; we also strip commas which break .or() filter syntax.
  return s.replace(/[%_]/g, "\\$&").replace(/,/g, " ").trim();
}

function normalizeDocketNumber(docket: string): string {
  // "ע\"א 6821/93" → "6821/93"; tolerate dash / slash; pick the first match.
  const m = docket.match(/(\d+)\s*[\/\-]\s*(\d+)/);
  if (!m) return "";
  return `${m[1]}/${m[2]}`;
}

function shortStatuteName(name: string): string {
  let n = (name || "").trim().split(",")[0];
  n = n.replace(/\s+ס["״]ח.*$/i, "").replace(/\s+ק["״]ת.*$/i, "");
  return n.trim().slice(0, 80);
}

function extractAcademicSurname(name: string): string {
  // Very rough — academic refs are heterogeneous. Take the last word of the
  // leading author phrase (before the first comma or open-paren).
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

async function fetchOneChunk(
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

async function lookupCaselaw(
  client: SupabaseClient,
  a: V3ExpectedAnchor,
): Promise<{ docs: Array<Record<string, unknown>>; basis: AnchorMatchBasis }> {
  const docket = (a.docket || "").trim();
  if (!docket) return { docs: [], basis: "none" };
  const slashed = normalizeDocketNumber(docket);
  if (!slashed) return { docs: [], basis: "none" };
  const dashed = slashed.replace("/", "-");
  const s = escapeIlike(slashed);
  const d = escapeIlike(dashed);
  try {
    const { data, error } = await client
      .from("legal_documents")
      .select("id, title, citation, source_type, source_url, case_number")
      .or(
        `case_number.ilike.%${s}%,case_number.ilike.%${d}%,citation.ilike.%${s}%,citation.ilike.%${d}%`,
      )
      .limit(MAX_DOCS_PER_ANCHOR + 1);
    if (error) return { docs: [], basis: "none" };
    return {
      docs: (data ?? []).slice(0, MAX_DOCS_PER_ANCHOR),
      basis: data && data.length ? "docket" : "none",
    };
  } catch {
    return { docs: [], basis: "none" };
  }
}

async function lookupStatute(
  client: SupabaseClient,
  a: V3ExpectedAnchor,
): Promise<{ docs: Array<Record<string, unknown>>; basis: AnchorMatchBasis }> {
  const shortName = shortStatuteName(a.name || "");
  if (shortName.length < 3) return { docs: [], basis: "none" };
  const escaped = escapeIlike(shortName);
  try {
    const { data, error } = await client
      .from("legal_documents")
      .select("id, title, citation, source_type, source_url")
      .or(`title.ilike.%${escaped}%,citation.ilike.%${escaped}%`)
      .limit(MAX_DOCS_PER_ANCHOR + 3);
    if (error || !data || !data.length) return { docs: [], basis: "none" };

    const section = (a.section || "").trim();
    if (section) {
      const sectionRe = new RegExp(
        `סעיף\\s*${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      );
      const preferred = data.filter(
        (row: Record<string, unknown>) =>
          sectionRe.test((row.title as string) || "") ||
          sectionRe.test((row.citation as string) || ""),
      );
      if (preferred.length) {
        return {
          docs: preferred.slice(0, MAX_DOCS_PER_ANCHOR),
          basis: "title_plus_section",
        };
      }
    }
    return { docs: data.slice(0, MAX_DOCS_PER_ANCHOR), basis: "title_only" };
  } catch {
    return { docs: [], basis: "none" };
  }
}

async function lookupAcademic(
  client: SupabaseClient,
  a: V3ExpectedAnchor,
): Promise<{ docs: Array<Record<string, unknown>>; basis: AnchorMatchBasis }> {
  const shortName = shortStatuteName(a.name || "");
  if (shortName.length < 4) return { docs: [], basis: "none" };
  const escaped = escapeIlike(shortName);
  try {
    const { data, error } = await client
      .from("legal_documents")
      .select("id, title, citation, source_type, source_url")
      .ilike("title", `%${escaped}%`)
      .limit(MAX_DOCS_PER_ANCHOR + 3);
    if (error || !data || !data.length) return { docs: [], basis: "none" };

    const surname = extractAcademicSurname(a.name || "");
    if (surname && surname.length >= 3) {
      const preferred = data.filter(
        (row: Record<string, unknown>) =>
          ((row.title as string) || "").includes(surname) ||
          ((row.citation as string) || "").includes(surname),
      );
      if (preferred.length) {
        return {
          docs: preferred.slice(0, MAX_DOCS_PER_ANCHOR),
          basis: "title_plus_author",
        };
      }
    }
    return { docs: data.slice(0, MAX_DOCS_PER_ANCHOR), basis: "title_only" };
  } catch {
    return { docs: [], basis: "none" };
  }
}

export async function lookupAnchorExact(
  client: SupabaseClient,
  a: V3ExpectedAnchor,
  anchorIdx: number,
): Promise<AnchorExactMatch> {
  const empty: AnchorExactMatch = {
    anchor_id: a.id,
    confidence: "none",
    match_basis: "none",
    candidates: [],
    docs_found: 0,
  };

  let docs: Array<Record<string, unknown>> = [];
  let basis: AnchorMatchBasis = "none";
  let confidence: AnchorMatchConfidence = "none";

  try {
    if (a.type === "leading_case") {
      const r = await lookupCaselaw(client, a);
      docs = r.docs; basis = r.basis;
      if (docs.length) confidence = docs.length === 1 ? "high" : "medium";
    } else if (
      a.type === "statute_section" ||
      a.type === "basic_law_section" ||
      a.type === "regulation"
    ) {
      const r = await lookupStatute(client, a);
      docs = r.docs; basis = r.basis;
      if (docs.length) confidence = basis === "title_plus_section" ? "high" : "medium";
    } else if (a.type === "academic") {
      const r = await lookupAcademic(client, a);
      docs = r.docs; basis = r.basis;
      if (docs.length) confidence = basis === "title_plus_author" ? "high" : "medium";
    } else if (a.type === "committee_report") {
      const r = await lookupStatute(client, a);
      docs = r.docs;
      basis = docs.length ? "title_only" : "none";
      if (docs.length) confidence = "medium";
    }
  } catch {
    return empty;
  }

  if (!docs.length) return empty;

  // One real chunk per doc — verifier needs an excerpt.
  const chunkResults = await Promise.all(
    docs.map((d) => fetchOneChunk(client, d.id as string)),
  );

  const score = confidence === "high" ? 0.95 : 0.85;
  const candidates: ClaimCandidateSource[] = [];
  docs.forEach((d, i) => {
    const chunk = chunkResults[i];
    if (!chunk) return;
    candidates.push({
      id: `EA${anchorIdx}-L${i}`,
      chunkId: chunk.chunk_id,
      documentId: d.id as string,
      title: (d.title as string) || "",
      citation: (d.citation as string) || "",
      sourceType: inferSourceType(a, d.source_type as string | undefined),
      sourceUrl: (d.source_url as string) || undefined,
      excerpt: (chunk.content || "").slice(0, 800),
      score,
      origin: "anchor",
      anchorId: a.id,
    });
  });

  if (!candidates.length) return empty;
  return {
    anchor_id: a.id,
    confidence,
    match_basis: basis,
    candidates,
    docs_found: docs.length,
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
            }),
          PER_ANCHOR_TIMEOUT_MS,
        )
      ),
    ]).catch(() => ({
      anchor_id: a.id,
      confidence: "none" as const,
      match_basis: "none" as const,
      candidates: [],
      docs_found: 0,
    })),
  );
  const results = await Promise.all(tasks);
  const out = new Map<string, AnchorExactMatch>();
  for (const r of results) out.set(r.anchor_id, r);
  return out;
}
