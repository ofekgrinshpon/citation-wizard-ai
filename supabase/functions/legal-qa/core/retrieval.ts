// Research Core v1 — Deliverable 2: per-claim retrieval.
//
// One retrieval path. Four origins, in order:
//   1. local_text       — search_legal_chunks_text (Postgres FTS)
//   2. local_vector     — match_legal_chunks (HNSW)
//   3. exact_authority  — ILIKE on legal_documents for each planner-linked
//                         authority (docket or name). Hypothesis-driven, but
//                         every returned candidate is a REAL row.
//   4. approved_web     — Perplexity sonar-pro restricted to TIER_A domains,
//                         runs in PARALLEL with local origins (not a fallback).
//
// Rules:
//   * Planner's expected_authorities are HYPOTHESES. An authority is
//     "resolved" only if at least one retrieved candidate's title/citation
//     matches its docket or normalized name. Unresolved authorities are
//     reported in metadata and MUST NOT be cited by the drafter.
//   * Never synthesize citations from planner output. Every CandidateSource
//     here originates in a DB row or an approved-web hit.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { TIER_A_DOMAIN_FILTER, citationTier } from "../approvedDomains.ts";
import type {
  AuthorityId,
  CandidateId,
  CandidateOrigin,
  CandidateSource,
  ClaimId,
  ExpectedAuthority,
  PlanV1,
} from "./types.ts";

// ─── Tunables ─────────────────────────────────────────────────────────────
const PER_CLAIM_CAP = 8;
const LOCAL_TEXT_K = 6;
const LOCAL_VECTOR_K = 6;
const EXACT_AUTH_K = 3;
const WEB_PER_CLAIM_CANDIDATES = 2;     // hard cap on web candidates per claim
const WEB_GLOBAL_CAP = 10;              // hard cap on web candidates per answer
const MAX_CONCURRENCY = 3;
const TEXT_QUERY_MAX_CHARS = 80;
const VECTOR_QUERY_MAX_CHARS = 160;
// Anchor pre-pass uses LARGER fan-out + per-document diversity. The intent
// is recall, not precision — verifier remains the relevance gate.
const ANCHOR_TEXT_K = 12;
const ANCHOR_VECTOR_K = 12;
const ANCHOR_MAX_DOCS_PER_LAYER = 8;    // cap unique documents per anchor layer
const EXPECTED_EMBEDDING_DIM = 768;
// Per-claim anchor reserve: small slot quota so anchor candidates survive the
// per-claim cap even when local_text already fills the budget. Reserve is for
// RECALL — verifier still gates relevance.
const PER_CLAIM_ANCHOR_RESERVE = 2;
// Anchor-driven approved_web (Section D). Extra web hits when local recall is
// thin or the claim explicitly needs scholarship/doctrinal_definition.
const ANCHOR_WEB_PER_CLAIM = 2;
const ANCHOR_WEB_THIN_LOCAL_THRESHOLD = 4;
// Government / regulator subset of TIER_A for factual-anchor web queries.
const TIER_A_GOV_HOSTS: readonly string[] = [
  "knesset.gov.il",
  "mevaker.gov.il",
  "justice.gov.il",
  "reshumot.gov.il",
  "competition.gov.il",
  "tax.gov.il",
  "mof.gov.il",
  "supreme.court.gov.il",
  "supremedecisions.court.gov.il",
];
// Academic / scholarship subset of TIER_A for concept-anchor web queries.
const TIER_A_SCHOLARSHIP_HOSTS: readonly string[] = [
  "huji.ac.il",
  "tau.ac.il",
  "biu.ac.il",
  "ssrn.com",
  "jstor.org",
];

// ─── Types ────────────────────────────────────────────────────────────────
export interface AuthorityResolution {
  authority_id: AuthorityId;
  resolved: boolean;
  matched_candidate_ids: CandidateId[];
  reason?: "no_candidate_matched" | "no_docket_no_name" | "matched";
}

export interface WebHarvestTelemetry {
  web_json_parse_ok: boolean;
  web_from_json_count: number;
  web_from_citations_count: number;
  web_from_search_results_count: number;
  web_filtered_tier_a_count: number;
  web_rejected_domain_count: number;
  web_empty_reason?: "no_response" | "no_urls" | "all_rejected" | "ok" | "skipped";
}

export interface ClaimAnchorTelemetry {
  claim_id: ClaimId;
  anchor_kept: number;
  anchor_doc_ids: string[];
  anchor_source_types: string[];
  anchor_displaced_primary: boolean;
}

export interface ClaimWebStubTelemetry {
  claim_id: ClaimId;
  dropped_count: number;
}

export interface ClaimAnchorWebTelemetry {
  claim_id: ClaimId;
  factual_terms: string[];
  concept_terms: string[];
  factual_hits: number;
  concept_hits: number;
}

export interface ClaimRetrievalPack {
  claim_id: ClaimId;
  candidates: CandidateSource[];
  local_text_count: number;
  local_vector_count: number;
  exact_authority_count: number;
  approved_web_count: number;
  approved_web_domains: string[];
  web_skipped_for_global_cap: boolean;
  web_harvest: WebHarvestTelemetry;
  // Section E telemetry
  primary_count: number;
  secondary_count: number;
  // Section A telemetry (anchor slots actually retained)
  anchor_kept: number;
  anchor_doc_ids: string[];
  anchor_source_types: string[];
  anchor_displaced_primary: boolean;
  // Section C telemetry
  approved_web_stubs_dropped: number;
  // Section D telemetry
  anchor_web: ClaimAnchorWebTelemetry;
}

export interface AnchorLayerTelemetry {
  /** "factual" | "concept" — which anchor layer this telemetry describes. */
  layer: "factual" | "concept";
  terms: string[];
  per_term: Array<{ term: string; text_hits: number; vector_hits: number }>;
  text_candidates: number;
  vector_candidates: number;
  unique_documents: number;
  document_ids: string[];
  injected_into_claims: number;
  /** Legacy field kept for back-compat with the old single-anchor telemetry. */
  total_unique: number;
}

export interface VectorHealthDiag {
  calls: number;
  ok: number;
  failed: number;
  dim_mismatches: number;
  last_status?: number;
  last_rpc_error?: string;
  last_rpc_code?: string;
  last_embedding_length?: number;
  /** One probe at threshold=0.0 to distinguish "RPC broken" from "over-filtered". */
  threshold_probe_top_similarity?: number | null;
  threshold_probe_error?: string;
  /** Section B: cold-HNSW warmup ping outcome. */
  warmup_status?: "ok" | "skipped" | "failed" | string;
  /** Section B: count of retries triggered by Postgres statement_timeout (57014). */
  retries_57014?: number;
}

// Legacy alias retained so callers reading retrieval.factual_anchors keep
// compiling. Same shape as AnchorLayerTelemetry above.
export type FactualAnchorTelemetry = AnchorLayerTelemetry;

export interface RetrievalResult {
  packs: ClaimRetrievalPack[];
  authority_resolutions: AuthorityResolution[];
  total_candidates: number;
  total_web_candidates: number;
  web_global_cap_hit: boolean;
  duration_ms: number;
  factual_anchors?: AnchorLayerTelemetry;
  concept_anchors?: AnchorLayerTelemetry;
  anchor_prepass_total_unique?: number;
  anchor_prepass_document_ids?: string[];
  vector_health?: VectorHealthDiag;
  local_metadata_overrides?: number;
  // Aggregated per-claim telemetry for Section A/C/D.
  anchor_slots_used_per_claim?: ClaimAnchorTelemetry[];
  approved_web_stubs_dropped_per_claim?: ClaimWebStubTelemetry[];
  approved_web_anchor_queries?: ClaimAnchorWebTelemetry[];
}

export interface RetrieveArgs {
  adminClient: SupabaseClient;
  plan: PlanV1;
  embed?: (text: string) => Promise<number[] | null>;
  perplexityKey?: string;
  signal?: AbortSignal;
}

// ─── Helpers ──────────────────────────────────────────────────────────────
const HEB_STOP = new Set([
  "של","על","עם","אם","או","את","זה","זו","הוא","היא","אני","אנו","אתה",
  "מה","מי","איך","למה","כי","גם","רק","כל","כמו","יותר","לא","כן","בין",
  "אבל","אך","יש","אין","לפי","לפני","אחרי","אצל","מן","אל","עד","ה",
]);

function strongTokens(text: string, limit = 3): string[] {
  const toks = (text || "")
    .replace(/["׳״'`.,;:?!()\[\]{}]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !HEB_STOP.has(t));
  toks.sort((a, b) => b.length - a.length);
  return [...new Set(toks)].slice(0, limit);
}

function makeLimiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= max) return;
    const job = queue.shift();
    if (!job) return;
    active++;
    job();
  };
  return function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then((v) => { active--; resolve(v); next(); })
          .catch((e) => { active--; reject(e); next(); });
      });
      next();
    });
  };
}

function normalize(s: string): string {
  return (s || "")
    .normalize("NFKC")
    .replace(/[״"׳'`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function escIlike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/[%_]/g, "\\$&");
}

function pickTextQuery(searchTargetTerms: string[][], thesis: string): string {
  const all = searchTargetTerms.flat().filter(Boolean);
  // Prefer a single longest term ≤ 80 chars; else build 3-token query.
  const fit = all.filter((t) => t.length <= TEXT_QUERY_MAX_CHARS);
  if (fit.length > 0) {
    return [...fit].sort((a, b) => b.length - a.length)[0];
  }
  const toks = strongTokens([...all, thesis].join(" "), 3);
  return toks.length >= 2 ? toks.join(" ") : (all[0] || thesis).slice(0, TEXT_QUERY_MAX_CHARS);
}

function pickVectorQuery(searchTargetTerms: string[][], doctrine: string): string {
  const parts: string[] = [];
  const flat = searchTargetTerms.flat().filter(Boolean);
  for (const t of flat) {
    const next = [...parts, t].join(" • ");
    if (next.length > VECTOR_QUERY_MAX_CHARS) break;
    if (!parts.includes(t)) parts.push(t);
  }
  if (parts.length === 0) parts.push(doctrine);
  let out = parts.join(" • ");
  if (out.length > VECTOR_QUERY_MAX_CHARS) out = out.slice(0, VECTOR_QUERY_MAX_CHARS);
  return out;
}

// Extract a docket-like token from a string: "ע"א 4628/93", "בג"ץ 2935/13".
const DOCKET_RE = /(?:ע["״]?א|רע["״]?א|בג["״]?ץ|בש["״]?א|דנ["״]?א|ה?פ|ע["״]?פ|רע["״]?פ)\s*\d{1,5}[\/-]\d{2,4}/g;
function extractDockets(s: string): string[] {
  const m = s.match(DOCKET_RE);
  return m ? Array.from(new Set(m.map((x) => x.replace(/\s+/g, " ").trim()))) : [];
}

function authoritySignatureMatches(
  auth: ExpectedAuthority,
  cand: CandidateSource,
): boolean {
  const hay = normalize(`${cand.title} ${cand.citation}`);
  if (!hay) return false;
  if (auth.docket) {
    const d = normalize(auth.docket);
    // tolerant: also try slash↔dash swap
    const alt = d.replace(/(\d+)\/(\d+)/, "$1-$2");
    if (hay.includes(d) || hay.includes(alt)) return true;
  }
  // Name match: every strong token of name ≥3 chars must appear.
  const name = normalize(auth.name);
  const nameToks = name.split(" ").filter((t) => t.length >= 3 && !HEB_STOP.has(t));
  if (nameToks.length > 0 && nameToks.every((t) => hay.includes(t))) return true;
  return false;
}

// ─── Raw chunk row from RPC ───────────────────────────────────────────────
interface ChunkHit {
  chunk_id?: string;
  document_id: string;
  chunk_content?: string;
  document_title?: string;
  document_citation?: string;
  source_type?: string;
  source_url?: string;
  similarity?: number;
}

function chunkToCandidate(
  h: ChunkHit,
  claimId: ClaimId,
  origin: CandidateOrigin,
  idx: number,
): CandidateSource | null {
  if (!h?.document_id) return null;
  const title = (h.document_title || "").trim();
  const citation = (h.document_citation || "").trim();
  if (!title && !citation) return null;
  return {
    candidate_id: `${claimId}-${origin}-${idx}`,
    claim_id: claimId,
    origin,
    document_id: h.document_id,
    source_type: h.source_type || "",
    title,
    citation,
    url: h.source_url || undefined,
    snippet: (h.chunk_content || "").slice(0, 600),
    metadata: {
      chunk_id: h.chunk_id,
      similarity: h.similarity ?? null,
    },
  };
}

// ─── Per-origin retrievers ────────────────────────────────────────────────
async function localText(
  client: SupabaseClient,
  query: string,
  claimId: ClaimId,
): Promise<CandidateSource[]> {
  try {
    const { data, error } = await client.rpc("search_legal_chunks_text", {
      search_query: query,
      match_count: LOCAL_TEXT_K,
    });
    if (error) {
      console.error(`[core retrieval text] ${claimId}: ${error.message}`);
      return [];
    }
    const rows = Array.isArray(data) ? (data as ChunkHit[]) : [];
    return rows
      .map((r, i) => chunkToCandidate(r, claimId, "local_text", i))
      .filter((c): c is CandidateSource => !!c);
  } catch (e) {
    console.error(`[core retrieval text throw] ${claimId}:`, (e as Error).message);
    return [];
  }
}

function newVectorHealth(): VectorHealthDiag {
  return { calls: 0, ok: 0, failed: 0, dim_mismatches: 0 };
}

async function localVector(
  client: SupabaseClient,
  query: string,
  claimId: ClaimId,
  embed: (t: string) => Promise<number[] | null>,
  health?: VectorHealthDiag,
  matchCount: number = LOCAL_VECTOR_K,
): Promise<CandidateSource[]> {
  const h = health;
  try {
    const emb = await embed(query);
    if (!emb) return [];
    if (h) {
      h.calls++;
      h.last_embedding_length = emb.length;
      if (emb.length !== EXPECTED_EMBEDDING_DIM) {
        h.dim_mismatches++;
        h.last_rpc_error = `dim_mismatch:expected_${EXPECTED_EMBEDDING_DIM}_got_${emb.length}`;
        console.error(`[core retrieval vec] ${claimId}: ${h.last_rpc_error}`);
        h.failed++;
        return [];
      }
    }
    // 0.35 floor: text-embedding-3-small@768d cosine for Hebrew typically lands
    // in 0.30-0.55. The final quality gate (source_pack core-promotion at 0.55
    // in assembleSourcePack) still rejects weak hits — this floor just lets
    // candidates reach ranking. Embedding sent as JSON-array string (pgvector
    // text format), which is what the supabase-js RPC client expects for the
    // `extensions.vector` parameter type.
    const callRpc = async (mc: number) => client.rpc("match_legal_chunks", {
      query_embedding: JSON.stringify(emb),
      match_threshold: 0.35,
      match_count: mc,
    });
    let { data, error, status } = await callRpc(matchCount);
    if (h) h.last_status = status;
    // Section B: one retry on Postgres statement_timeout (57014) with halved K.
    if (error && (error as { code?: string }).code === "57014") {
      if (h) {
        h.retries_57014 = (h.retries_57014 ?? 0) + 1;
        h.last_rpc_error = `57014_retry:${error.message ?? ""}`.slice(0, 240);
        h.last_rpc_code = "57014";
      }
      const halved = Math.max(1, Math.ceil(matchCount / 2));
      console.error(`[core retrieval vec retry 57014] ${claimId}: retrying with match_count=${halved}`);
      ({ data, error, status } = await callRpc(halved));
      if (h) h.last_status = status;
    }
    if (error) {
      if (h) {
        h.failed++;
        h.last_rpc_error = `${error.message ?? ""}${error.details ? ` | ${error.details}` : ""}`.slice(0, 240);
        h.last_rpc_code = (error as { code?: string }).code;
      }
      console.error(`[core retrieval vec] ${claimId}: ${error.message}`, error);
      return [];
    }
    if (h) h.ok++;
    const rows = Array.isArray(data) ? (data as ChunkHit[]) : [];
    return rows
      .map((r, i) => chunkToCandidate(r, claimId, "local_vector", i))
      .filter((c): c is CandidateSource => !!c);
  } catch (e) {
    if (h) {
      h.failed++;
      h.last_rpc_error = `throw:${(e as Error).message}`.slice(0, 240);
    }
    console.error(`[core retrieval vec throw] ${claimId}:`, (e as Error).message);
    return [];
  }
}

/**
 * One-shot probe at threshold=0.0 to capture the TOP similarity actually
 * returned by the RPC. Lets us distinguish "RPC broken / index empty" from
 * "RPC fine but everything sits below our normal threshold."
 */
async function vectorThresholdProbe(
  client: SupabaseClient,
  embedFn: (t: string) => Promise<number[] | null>,
  probeQuery: string,
  health: VectorHealthDiag,
): Promise<void> {
  try {
    const emb = await embedFn(probeQuery);
    if (!emb) {
      health.threshold_probe_top_similarity = null;
      return;
    }
    const { data, error } = await client.rpc("match_legal_chunks", {
      query_embedding: JSON.stringify(emb),
      match_threshold: 0.0,
      match_count: 1,
    });
    if (error) {
      health.threshold_probe_error = `${error.message ?? ""}`.slice(0, 200);
      health.threshold_probe_top_similarity = null;
      return;
    }
    const rows = Array.isArray(data) ? (data as ChunkHit[]) : [];
    health.threshold_probe_top_similarity =
      rows.length > 0 && typeof rows[0].similarity === "number" ? rows[0].similarity : null;
  } catch (e) {
    health.threshold_probe_error = `throw:${(e as Error).message}`.slice(0, 200);
    health.threshold_probe_top_similarity = null;
  }
}

// ─── Section B: cold-HNSW warmup ──────────────────────────────────────────
/**
 * Fires a tiny match_legal_chunks call once before any per-claim/anchor
 * vector RPC. Pays the HNSW load cost on the first request and prevents
 * subsequent calls from hitting Postgres statement_timeout (57014).
 * Errors are swallowed; outcome is recorded in `health.warmup_status`.
 */
async function vectorWarmup(
  client: SupabaseClient,
  health: VectorHealthDiag,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    health.warmup_status = "skipped";
    return;
  }
  try {
    const zero = new Array(EXPECTED_EMBEDDING_DIM).fill(0);
    const { error } = await client.rpc("match_legal_chunks", {
      query_embedding: JSON.stringify(zero),
      match_threshold: 0.99,
      match_count: 1,
    });
    if (error) {
      health.warmup_status = `failed:${(error as { code?: string }).code ?? "unknown"}`;
    } else {
      health.warmup_status = "ok";
    }
  } catch (e) {
    health.warmup_status = `failed:throw:${(e as Error).message.slice(0, 60)}`;
  }
}

// ─── Section C: approved_web stub detection ──────────────────────────────
/**
 * Returns true when a Perplexity-returned candidate looks like a citation
 * stub the drafter cannot render properly (standalone placeholder titles,
 * caselaw without party names, bare docket fragments, too-short citations).
 * Drops happen at the retrieval layer so the citation engine, verifier,
 * drafter, and footnote builder never see these candidates.
 *
 * Applied only to approved_web hits — local DB rows always pass.
 */
const PLACEHOLDER_TITLES = new Set([
  "פסק דין", "החלטה", 'פס"ד', "פס״ד",
  "פסה\"ד", "פסה״ד", "פסק־דין", "פסק-דין",
]);
const PARTY_INDICATOR_RE = /(?:נ['׳]\s|\sנגד\s|\sv\.\s|\sv\s)/;
const BARE_DOCKET_RE = /^\d+(?:[./]\d+){1,2}\s*(?:\([^)]*\))?\s*$/;
const HEB_WORD_RE = /[\u0590-\u05FF]{4,}/;

function stripPunctEdges(s: string): string {
  return (s || "")
    .normalize("NFKC")
    .replace(/^[\s"׳״'`.,;:?!()\[\]{}\-–—]+|[\s"׳״'`.,;:?!()\[\]{}\-–—]+$/g, "")
    .trim();
}

function isApprovedWebStub(c: { source_type?: string; title?: string; citation?: string }): boolean {
  const title = stripPunctEdges(c.title || "");
  const citation = stripPunctEdges(c.citation || "");
  const combined = `${title} ${citation}`.trim();

  // 1) Standalone placeholder title.
  if (PLACEHOLDER_TITLES.has(title)) return true;
  if (!title && PLACEHOLDER_TITLES.has(citation)) return true;

  // 2) Bare docket fragment with no real title text.
  if (BARE_DOCKET_RE.test(citation) && !HEB_WORD_RE.test(title)) return true;

  // 3) Caselaw with no party indicator AND no meaningful Hebrew title.
  const st = (c.source_type || "").toLowerCase();
  if (st === "caselaw") {
    const haystack = `${title} ${citation}`;
    if (!PARTY_INDICATOR_RE.test(haystack)) {
      // Allow if title still has a substantive Hebrew word ≥6 chars AND ≥6 chars.
      const titleHasWord = HEB_WORD_RE.test(title) && title.replace(/\s+/g, "").length >= 6;
      if (!titleHasWord) return true;
    }
  }

  // 4) Generic too-short / no Hebrew word at all.
  if (citation.length < 20 && !HEB_WORD_RE.test(combined)) return true;

  return false;
}

// ─── Section E: primary-vs-secondary classification ─────────────────────
/**
 * Heuristic classification of a candidate as "primary law" (statute,
 * regulation, Supreme-Court binding caselaw, or planner-resolved exact
 * authority) vs "secondary" (research/policy/scholarship/lower-court).
 * Used by the anchor reserve to avoid displacing primary local hits for
 * doctrinal claims that need binding law.
 */
const SUPREME_HINTS_RE = /(עליון|בג["״]?ץ|דנ["״]?א|פ["״]?ד|supreme)/i;
function isPrimaryLaw(c: CandidateSource): boolean {
  if (c.origin === "exact_authority") return true;
  const st = (c.source_type || "").toLowerCase();
  if (st === "statute" || st === "legislation" || st === "regulation") return true;
  if (st === "caselaw") {
    const court = String((c.metadata as Record<string, unknown> | undefined)?.court ?? "");
    const hay = `${court} ${c.title} ${c.citation}`;
    return SUPREME_HINTS_RE.test(hay);
  }
  return false;
}

function requiresBindingLaw(claim: { required_evidence?: string[] }): boolean {
  const re = claim.required_evidence;
  if (!Array.isArray(re)) return false;
  return re.some((k) => k === "binding_caselaw" || k === "statute_section" || k === "regulation");
}



async function exactAuthority(
  client: SupabaseClient,
  auth: ExpectedAuthority,
  claimId: ClaimId,
): Promise<CandidateSource[]> {
  // Build ILIKE patterns: docket (if any) and name tokens.
  const patterns: Array<{ col: "title" | "citation" | "case_number"; pat: string }> = [];
  if (auth.docket) {
    const d = auth.docket.trim();
    patterns.push({ col: "title", pat: `%${escIlike(d)}%` });
    patterns.push({ col: "citation", pat: `%${escIlike(d)}%` });
    patterns.push({ col: "case_number", pat: `%${escIlike(d)}%` });
    // dash form
    const alt = d.replace(/(\d+)\/(\d+)/, "$1-$2");
    if (alt !== d) {
      patterns.push({ col: "title", pat: `%${escIlike(alt)}%` });
      patterns.push({ col: "case_number", pat: `%${escIlike(alt)}%` });
    }
  }
  // Name pattern — first 4-word fragment.
  const nameFrag = auth.name.split(/\s+/).slice(0, 4).join(" ").trim();
  if (nameFrag.length >= 4) {
    patterns.push({ col: "title", pat: `%${escIlike(nameFrag)}%` });
  }
  if (patterns.length === 0) return [];

  const out: CandidateSource[] = [];
  let idx = 0;
  for (const { col, pat } of patterns) {
    if (out.length >= EXACT_AUTH_K) break;
    try {
      const { data, error } = await client
        .from("legal_documents")
        .select("id, title, citation, source_type, source_url, content")
        .ilike(col, pat)
        .limit(EXACT_AUTH_K);
      if (error) continue;
      for (const row of (data || []) as any[]) {
        if (out.some((c) => c.document_id === row.id)) continue;
        out.push({
          candidate_id: `${claimId}-exact-${++idx}`,
          claim_id: claimId,
          origin: "exact_authority",
          document_id: row.id,
          source_type: row.source_type || "",
          title: row.title || "",
          citation: row.citation || "",
          url: row.source_url || undefined,
          snippet: (row.content || "").slice(0, 600),
          metadata: { authority_id: auth.id, matched_by: col, pattern: pat },
        });
        if (out.length >= EXACT_AUTH_K) break;
      }
    } catch (_e) {
      /* swallow */
    }
  }
  return out;
}

interface PerplexityHit { title: string; citation: string; url: string; snippet: string; source_type: string }

interface ApprovedWebResult {
  candidates: CandidateSource[];
  telemetry: WebHarvestTelemetry;
  stubs_dropped: number;
}

interface ApprovedWebOptions {
  allowScholarship?: boolean;
  /** Override TIER_A_DOMAIN_FILTER with a narrower subset (gov/scholarship/etc). */
  domainFilter?: readonly string[];
  /** Extra hint terms (factual/concept anchors) appended to the user prompt. */
  anchorTerms?: string[];
  /** Per-call candidate cap (defaults to WEB_PER_CLAIM_CANDIDATES). */
  maxCandidates?: number;
  /** Tag inserted into candidate metadata so downstream telemetry can see it. */
  candidateTag?: string;
}

function emptyWebTelemetry(reason: WebHarvestTelemetry["web_empty_reason"]): WebHarvestTelemetry {
  return {
    web_json_parse_ok: false,
    web_from_json_count: 0,
    web_from_citations_count: 0,
    web_from_search_results_count: 0,
    web_filtered_tier_a_count: 0,
    web_rejected_domain_count: 0,
    web_empty_reason: reason,
  };
}

async function approvedWeb(
  perplexityKey: string,
  claimText: string,
  doctrine: string,
  authorities: ExpectedAuthority[],
  claimId: ClaimId,
  signal?: AbortSignal,
  allowScholarship = false,
): Promise<ApprovedWebResult> {
  const authHints = authorities
    .slice(0, 4)
    .map((a) => [a.docket, a.name].filter(Boolean).join(" "))
    .filter((s) => s.trim().length > 0);
  const scholarshipClause = allowScholarship
    ? ` בנוסף, מותר להחזיר מאמרים אקדמיים ופרקי ספרים משפטיים ישראליים מהדומיינים האקדמיים המאושרים (lawjournal.huji.ac.il, law.tau.ac.il, mishpatim.tau.ac.il, idclawreview.com וכד'); סמנם source_type:"scholarship".`
    : "";
  const allowedTypes = allowScholarship
    ? `"caselaw"|"statute"|"regulation"|"scholarship"`
    : `"caselaw"|"statute"|"regulation"`;
  const sys = `אתה מחזיר אך ורק מקורות משפטיים ישראליים ראשוניים (פסיקה, חקיקה, תקנות) מתוך התחומים המאושרים.${scholarshipClause} החזר JSON-array בלבד, ללא טקסט נוסף, עד ${WEB_PER_CLAIM_CANDIDATES} פריטים. כל איבר: {"title":"","citation":"","url":"","source_type":${allowedTypes},"snippet":""}.`;
  const hintBlock = authHints.length ? `\nרמזים לסמכויות צפויות: ${authHints.join(" ; ")}` : "";
  const usr = `טענה: ${claimText}\nדוקטרינה: ${doctrine}${hintBlock}\nהחזר עד ${WEB_PER_CLAIM_CANDIDATES} מקורות סמכותיים בלבד.`;

  const telemetry: WebHarvestTelemetry = {
    web_json_parse_ok: false,
    web_from_json_count: 0,
    web_from_citations_count: 0,
    web_from_search_results_count: 0,
    web_filtered_tier_a_count: 0,
    web_rejected_domain_count: 0,
  };

  let data: any;
  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      signal,
      headers: { Authorization: `Bearer ${perplexityKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
        temperature: 0.1,
        max_tokens: 800,
        search_domain_filter: TIER_A_DOMAIN_FILTER,
        return_citations: true,
        return_search_results: true,
      }),
    });
    if (!res.ok) {
      console.error(`[core retrieval web] ${claimId}: ${res.status}`);
      telemetry.web_empty_reason = "no_response";
      return { candidates: [], telemetry };
    }
    data = await res.json();
  } catch (e) {
    console.error(`[core retrieval web throw] ${claimId}:`, (e as Error).message);
    telemetry.web_empty_reason = "no_response";
    return { candidates: [], telemetry };
  }

  // ── Source 1: parsed JSON-array in message content ─────────────────────
  const jsonHits: PerplexityHit[] = [];
  try {
    const raw = data?.choices?.[0]?.message?.content ?? "";
    const cleaned = String(raw).replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      if (Array.isArray(parsed)) {
        for (const h of parsed) {
          if (h?.url) jsonHits.push(h);
        }
        telemetry.web_json_parse_ok = true;
      }
    }
  } catch {
    telemetry.web_json_parse_ok = false;
  }
  telemetry.web_from_json_count = jsonHits.length;

  // ── Source 2: data.search_results[] (preferred when JSON empty) ────────
  const searchResults: Array<{ title?: string; url?: string; snippet?: string; date?: string }> =
    Array.isArray(data?.search_results) ? data.search_results : [];
  telemetry.web_from_search_results_count = searchResults.length;

  // ── Source 3: data.citations[] (string URLs) ───────────────────────────
  const citationUrls: string[] = Array.isArray(data?.citations)
    ? data.citations.filter((u: unknown) => typeof u === "string")
    : [];
  telemetry.web_from_citations_count = citationUrls.length;

  // ── Build unified hit list, preferring richer metadata ─────────────────
  type Hit = { url: string; title: string; citation: string; snippet: string; source_type: string };
  const byUrl = new Map<string, Hit>();
  for (const h of jsonHits) {
    if (!h?.url) continue;
    byUrl.set(h.url, {
      url: h.url,
      title: (h.title || "").trim(),
      citation: (h.citation || "").trim(),
      snippet: (h.snippet || "").slice(0, 600),
      source_type: h.source_type || "",
    });
  }
  for (const sr of searchResults) {
    if (!sr?.url) continue;
    if (byUrl.has(sr.url)) continue;
    byUrl.set(sr.url, {
      url: sr.url,
      title: (sr.title || "").trim(),
      citation: "",
      snippet: (sr.snippet || "").slice(0, 600),
      source_type: "",
    });
  }
  for (const url of citationUrls) {
    if (!url || byUrl.has(url)) continue;
    byUrl.set(url, { url, title: "", citation: "", snippet: "", source_type: "" });
  }

  if (byUrl.size === 0) {
    telemetry.web_empty_reason = "no_urls";
    return { candidates: [], telemetry };
  }

  // ── Tier A filtering ───────────────────────────────────────────────────
  const out: CandidateSource[] = [];
  let i = 0;
  for (const h of byUrl.values()) {
    if (citationTier(h.url) !== "A") {
      telemetry.web_rejected_domain_count++;
      continue;
    }
    telemetry.web_filtered_tier_a_count++;
    out.push({
      candidate_id: `${claimId}-web-${++i}`,
      claim_id: claimId,
      origin: "approved_web",
      source_type: h.source_type,
      title: h.title,
      citation: h.citation,
      url: h.url,
      snippet: h.snippet,
      metadata: { tier: "A" },
    });
    if (out.length >= WEB_PER_CLAIM_CANDIDATES) break;
  }

  telemetry.web_empty_reason = out.length === 0 ? "all_rejected" : "ok";
  return { candidates: out, telemetry };
}



// ─── Orchestrator ─────────────────────────────────────────────────────────
export async function retrieveForPlan(args: RetrieveArgs): Promise<RetrievalResult> {
  const { adminClient, plan, embed, perplexityKey, signal } = args;
  const t0 = Date.now();
  const limiter = makeLimiter(MAX_CONCURRENCY);
  const authMap = new Map<AuthorityId, ExpectedAuthority>();
  for (const a of plan.expected_authorities) authMap.set(a.id, a);

  const packs: ClaimRetrievalPack[] = [];
  let webBudgetRemaining = WEB_GLOBAL_CAP;
  let webGlobalCapHit = false;

  // Single VectorHealthDiag shared across every vector RPC (claim + anchors
  // + probe). Surfaced in metadata.core.retrieval.vector_health.
  const vectorHealth: VectorHealthDiag = newVectorHealth();

  // ─── Anchor pre-pass (factual + concept) ──────────────────────────────
  // The planner often distills the question into PURELY DOCTRINAL search
  // targets ("מחדל חקיקתי", "חובות הגנה חיוביות") and drops both:
  //   (a) the factual subject ("דמי חסות", "קורקינטים", "בתי אבות")
  //   (b) the doctrinal phrasing as used by academic titles
  //       ("חובה לחוקק" → article titled "סעד החובה לחוקק")
  // We run two SEPARATE anchor layers — factual and concept — each with
  // its own FTS + vector pass and per-document diversity. Candidates are
  // seeded into every claim's pool. The verifier remains the relevance
  // gate; anchor pre-pass only widens recall.
  const sanitizeTerms = (raw: unknown): string[] =>
    Array.from(
      new Set(
        (Array.isArray(raw) ? raw : [])
          .map((t) => (typeof t === "string" ? t.trim() : ""))
          .filter((t) => t.length >= 2 && t.length <= TEXT_QUERY_MAX_CHARS),
      ),
    ).slice(0, 8);

  const factualTerms = sanitizeTerms(plan.factual_anchor_terms);
  const conceptTerms = sanitizeTerms((plan as any).concept_anchor_terms);

  /**
   * Run one anchor layer: FTS + vector per term, dedupe with per-document
   * diversity (no single document allowed to crowd the pool).
   */
  async function runAnchorLayer(
    layer: "factual" | "concept",
    terms: string[],
  ): Promise<{ pool: CandidateSource[]; telemetry: AnchorLayerTelemetry }> {
    const telemetry: AnchorLayerTelemetry = {
      layer,
      terms,
      per_term: terms.map((term) => ({ term, text_hits: 0, vector_hits: 0 })),
      text_candidates: 0,
      vector_candidates: 0,
      unique_documents: 0,
      document_ids: [],
      injected_into_claims: 0,
      total_unique: 0,
    };
    if (terms.length === 0) return { pool: [], telemetry };

    // Per-term text + vector (larger K than per-claim; verifier filters).
    const perTerm = await Promise.all(
      terms.map(async (term, i) => {
        const claimSlot = `C0-${layer}-${i}` as ClaimId;
        const [textHits, vecHits] = await Promise.all([
          limiter(() =>
            adminClient
              .rpc("search_legal_chunks_text", {
                search_query: term,
                match_count: ANCHOR_TEXT_K,
              })
              .then(({ data, error }) => {
                if (error) {
                  console.error(`[anchor:${layer}:text] ${term}: ${error.message}`);
                  return [] as CandidateSource[];
                }
                const rows = Array.isArray(data) ? (data as ChunkHit[]) : [];
                return rows
                  .map((r, idx) => chunkToCandidate(r, claimSlot, "local_text", idx))
                  .filter((c): c is CandidateSource => !!c);
              })
              .catch((e) => {
                console.error(`[anchor:${layer}:text throw] ${term}:`, (e as Error).message);
                return [] as CandidateSource[];
              }),
          ),
          embed
            ? limiter(() => localVector(adminClient, term, claimSlot, embed, vectorHealth, ANCHOR_VECTOR_K))
            : Promise.resolve([] as CandidateSource[]),
        ]);
        telemetry.per_term[i].text_hits = textHits.length;
        telemetry.per_term[i].vector_hits = vecHits.length;
        return [...textHits, ...vecHits];
      }),
    );

    const flat = perTerm.flat();
    telemetry.text_candidates = flat.filter((c) => c.origin === "local_text").length;
    telemetry.vector_candidates = flat.filter((c) => c.origin === "local_vector").length;

    // Diversity: one chunk per document_id, cap unique docs.
    const seenDoc = new Set<string>();
    const pool: CandidateSource[] = [];
    for (const c of flat) {
      const k = c.document_id || `${c.origin}:${c.url || c.candidate_id}`;
      if (seenDoc.has(k)) continue;
      seenDoc.add(k);
      pool.push(c);
      if (pool.length >= ANCHOR_MAX_DOCS_PER_LAYER) break;
    }
    telemetry.unique_documents = pool.length;
    telemetry.total_unique = pool.length;
    telemetry.document_ids = pool.map((c) => c.document_id).filter((x): x is string => !!x);
    return { pool, telemetry };
  }

  const [factualLayer, conceptLayer] = await Promise.all([
    runAnchorLayer("factual", factualTerms),
    runAnchorLayer("concept", conceptTerms),
  ]);

  // Threshold=0.0 probe: pick the longest available anchor term, or fall
  // back to the plan thesis. Fires once.
  if (embed) {
    const probeQuery =
      [...factualTerms, ...conceptTerms].sort((a, b) => b.length - a.length)[0] ||
      plan.thesis ||
      plan.doctrinal_frame ||
      "";
    if (probeQuery) {
      await vectorThresholdProbe(adminClient, embed, probeQuery.slice(0, VECTOR_QUERY_MAX_CHARS), vectorHealth);
    }
  }

  // Merge the two anchor pools (keep both layers' provenance via metadata).
  const mergedAnchorPool: CandidateSource[] = [];
  const mergedSeen = new Set<string>();
  for (const layered of [
    { pool: factualLayer.pool, layer: "factual" as const },
    { pool: conceptLayer.pool, layer: "concept" as const },
  ]) {
    for (const c of layered.pool) {
      const k = c.document_id || `${c.origin}:${c.url || c.candidate_id}`;
      if (mergedSeen.has(k)) continue;
      mergedSeen.add(k);
      mergedAnchorPool.push({
        ...c,
        metadata: { ...(c.metadata || {}), anchor_layer: layered.layer },
      });
    }
  }
  const anchorPrepassDocumentIds = mergedAnchorPool
    .map((c) => c.document_id)
    .filter((x): x is string => !!x);

  for (const claim of plan.claims) {
    const terms = claim.search_targets.map((t) => t.hebrew_terms);
    const doctrine = claim.search_targets[0]?.doctrine || plan.doctrinal_frame;
    const tq = pickTextQuery(terms, plan.thesis);
    const vq = pickVectorQuery(terms, doctrine);

    const linkedAuths = claim.supporting_authorities
      .map((id) => authMap.get(id))
      .filter((a): a is ExpectedAuthority => !!a);

    // Allowed web candidates for THIS claim — bounded by per-claim cap AND
    // remaining global budget. approved_web is a first-class parallel origin,
    // NOT a fallback. Skipped only when global budget is exhausted.
    const webAllowedThisClaim = Math.min(WEB_PER_CLAIM_CANDIDATES, webBudgetRemaining);
    const webSkippedForGlobalCap = perplexityKey ? webAllowedThisClaim <= 0 : false;
    if (perplexityKey && webAllowedThisClaim <= 0) webGlobalCapHit = true;

    // Allow Perplexity to return scholarship for claims that explicitly need
    // a doctrinal definition / academic backing. Primary authority remains the
    // default (caselaw/statute/regulation only).
    const allowScholarship = Array.isArray(claim.required_evidence)
      && claim.required_evidence.some((k) => k === "scholarship" || k === "doctrinal_definition");

    // All four origins fire in parallel.
    const [textHits, vecHits, exactGroups, webResult] = await Promise.all([
      limiter(() => localText(adminClient, tq, claim.id)),
      embed
        ? limiter(() => localVector(adminClient, vq, claim.id, embed, vectorHealth))
        : Promise.resolve([] as CandidateSource[]),
      Promise.all(linkedAuths.map((a) => limiter(() => exactAuthority(adminClient, a, claim.id)))),
      perplexityKey && webAllowedThisClaim > 0
        ? limiter(() => approvedWeb(perplexityKey, claim.text, doctrine, linkedAuths, claim.id, signal, allowScholarship))
        : Promise.resolve<ApprovedWebResult>({
            candidates: [],
            telemetry: emptyWebTelemetry(perplexityKey ? "skipped" : "skipped"),
          }),
    ]);
    const exactHits = exactGroups.flat();
    const webHits = webResult.candidates.slice(0, webAllowedThisClaim);
    const webHarvest = webResult.telemetry;
    webBudgetRemaining = Math.max(0, webBudgetRemaining - webHits.length);

    // Dedup by document_id / url. Priority: exact > text > vector > anchor > web.
    const byKey = new Map<string, CandidateSource>();
    const ingest = (arr: CandidateSource[]) => {
      for (const c of arr) {
        const k = c.document_id || `${c.origin}:${c.url || c.candidate_id}`;
        if (!byKey.has(k)) byKey.set(k, c);
      }
    };
    ingest(exactHits);
    ingest(textHits);
    ingest(vecHits);
    // Anchor pool: re-tag each anchor candidate for THIS claim so the
    // downstream pipeline treats it as a per-claim local hit. Preserve origin
    // (local_text/local_vector) and the anchor_layer tag for telemetry.
    if (mergedAnchorPool.length > 0) {
      const reTagged: CandidateSource[] = mergedAnchorPool.map((c, i) => ({
        ...c,
        candidate_id: `${claim.id}-anchor-${(c.metadata as any)?.anchor_layer ?? "x"}-${c.origin}-${i}`,
        claim_id: claim.id,
        metadata: { ...(c.metadata || {}), factual_anchor: true },
      }));
      const before = byKey.size;
      ingest(reTagged);
      const after = byKey.size;
      if (after > before) {
        if (factualLayer.pool.some((c) => reTagged.find((r) => r.document_id === c.document_id))) {
          factualLayer.telemetry.injected_into_claims++;
        }
        if (conceptLayer.pool.some((c) => reTagged.find((r) => r.document_id === c.document_id))) {
          conceptLayer.telemetry.injected_into_claims++;
        }
      }
    }
    ingest(webHits);

    // Web is a first-class origin: reserve slots for it in the per-claim cap
    // so noisy local hits don't crowd it out.
    const all = Array.from(byKey.values());
    const webKept = all.filter((c) => c.origin === "approved_web");
    const localKept = all.filter((c) => c.origin !== "approved_web");
    const localBudget = Math.max(0, PER_CLAIM_CAP - webKept.length);
    const candidates = [...localKept.slice(0, localBudget), ...webKept];


    const counts: Record<CandidateOrigin, number> = {
      local_text: 0, local_vector: 0, exact_authority: 0, approved_web: 0,
    };
    for (const c of candidates) counts[c.origin]++;

    const webDomains = Array.from(new Set(
      candidates
        .filter((c) => c.origin === "approved_web" && c.url)
        .map((c) => { try { return new URL(c.url!).hostname.toLowerCase(); } catch { return ""; } })
        .filter((h) => h.length > 0),
    ));

    packs.push({
      claim_id: claim.id,
      candidates,
      local_text_count: counts.local_text,
      local_vector_count: counts.local_vector,
      exact_authority_count: counts.exact_authority,
      approved_web_count: counts.approved_web,
      approved_web_domains: webDomains,
      web_skipped_for_global_cap: webSkippedForGlobalCap,
      web_harvest: webHarvest,
    });
  }

  // ─── Local-DB metadata override for approved_web candidates ──────────
  // When Perplexity returns a URL we already have in legal_documents, the
  // local row is the canonical metadata source. Swap title/citation/
  // source_type onto the web candidate so the downstream verifier and
  // citation builder see real metadata instead of weak Perplexity strings.
  let localMetadataOverrides = 0;
  try {
    const webUrls = Array.from(new Set(
      packs.flatMap((p) => p.candidates)
        .filter((c) => c.origin === "approved_web" && c.url)
        .map((c) => c.url!),
    ));
    if (webUrls.length > 0) {
      const { data: localRows, error: ovErr } = await adminClient
        .from("legal_documents")
        .select("id, title, citation, source_type, source_url")
        .in("source_url", webUrls);
      if (!ovErr && Array.isArray(localRows)) {
        const byUrl = new Map<string, { id: string; title: string; citation: string; source_type: string }>();
        for (const r of localRows as Array<{ id: string; title: string; citation: string; source_type: string; source_url: string }>) {
          if (r.source_url && (r.title || r.citation)) {
            byUrl.set(r.source_url, {
              id: r.id,
              title: r.title || "",
              citation: r.citation || "",
              source_type: r.source_type || "",
            });
          }
        }
        if (byUrl.size > 0) {
          for (const p of packs) {
            for (const c of p.candidates) {
              if (c.origin !== "approved_web" || !c.url) continue;
              const hit = byUrl.get(c.url);
              if (!hit) continue;
              c.document_id = hit.id;
              if (hit.title) c.title = hit.title;
              if (hit.citation) c.citation = hit.citation;
              if (hit.source_type) c.source_type = hit.source_type;
              c.metadata = { ...(c.metadata || {}), local_metadata_override: true };
              localMetadataOverrides++;
            }
          }
        }
      } else if (ovErr) {
        console.error("[core retrieval] local metadata override query failed:", ovErr.message);
      }
    }
  } catch (e) {
    console.error("[core retrieval] local metadata override threw:", (e as Error).message);
  }

  // Authority resolution across all candidates of all claims.
  const allCandidates = packs.flatMap((p) => p.candidates);
  const authority_resolutions: AuthorityResolution[] = [];
  for (const a of plan.expected_authorities) {
    if (!a.docket && (!a.name || a.name.trim().length < 3)) {
      authority_resolutions.push({
        authority_id: a.id,
        resolved: false,
        matched_candidate_ids: [],
        reason: "no_docket_no_name",
      });
      continue;
    }
    const matched = allCandidates.filter((c) => authoritySignatureMatches(a, c));
    authority_resolutions.push({
      authority_id: a.id,
      resolved: matched.length > 0,
      matched_candidate_ids: matched.map((c) => c.candidate_id),
      reason: matched.length > 0 ? "matched" : "no_candidate_matched",
    });
  }

  const totalWeb = packs.reduce((n, p) => n + p.approved_web_count, 0);

  return {
    packs,
    authority_resolutions,
    total_candidates: allCandidates.length,
    total_web_candidates: totalWeb,
    web_global_cap_hit: webGlobalCapHit,
    duration_ms: Date.now() - t0,
    factual_anchors: factualLayer.telemetry,
    concept_anchors: conceptLayer.telemetry,
    anchor_prepass_total_unique: mergedAnchorPool.length,
    anchor_prepass_document_ids: anchorPrepassDocumentIds,
    vector_health: vectorHealth,
    local_metadata_overrides: localMetadataOverrides,
  };
}

