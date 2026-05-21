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
}

export interface FactualAnchorTelemetry {
  terms: string[];
  text_candidates: number;
  vector_candidates: number;
  total_unique: number;
  injected_into_claims: number;
}

export interface RetrievalResult {
  packs: ClaimRetrievalPack[];
  authority_resolutions: AuthorityResolution[];
  total_candidates: number;
  total_web_candidates: number;
  web_global_cap_hit: boolean;
  duration_ms: number;
  factual_anchors?: FactualAnchorTelemetry;
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

async function localVector(
  client: SupabaseClient,
  query: string,
  claimId: ClaimId,
  embed: (t: string) => Promise<number[] | null>,
): Promise<CandidateSource[]> {
  try {
    const emb = await embed(query);
    if (!emb) return [];
    const { data, error } = await client.rpc("match_legal_chunks", {
      query_embedding: JSON.stringify(emb),
      match_threshold: 0.55,
      match_count: LOCAL_VECTOR_K,
    });
    if (error) {
      console.error(`[core retrieval vec] ${claimId}: ${error.message}`);
      return [];
    }
    const rows = Array.isArray(data) ? (data as ChunkHit[]) : [];
    return rows
      .map((r, i) => chunkToCandidate(r, claimId, "local_vector", i))
      .filter((c): c is CandidateSource => !!c);
  } catch (e) {
    console.error(`[core retrieval vec throw] ${claimId}:`, (e as Error).message);
    return [];
  }
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
): Promise<ApprovedWebResult> {
  const authHints = authorities
    .slice(0, 4)
    .map((a) => [a.docket, a.name].filter(Boolean).join(" "))
    .filter((s) => s.trim().length > 0);
  const sys = `אתה מחזיר אך ורק מקורות משפטיים ישראליים ראשוניים (פסיקה, חקיקה, תקנות) מתוך התחומים המאושרים. החזר JSON-array בלבד, ללא טקסט נוסף, עד ${WEB_PER_CLAIM_CANDIDATES} פריטים. כל איבר: {"title":"","citation":"","url":"","source_type":"caselaw"|"statute"|"regulation","snippet":""}.`;
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

    // All four origins fire in parallel.
    const [textHits, vecHits, exactGroups, webResult] = await Promise.all([
      limiter(() => localText(adminClient, tq, claim.id)),
      embed ? limiter(() => localVector(adminClient, vq, claim.id, embed)) : Promise.resolve([] as CandidateSource[]),
      Promise.all(linkedAuths.map((a) => limiter(() => exactAuthority(adminClient, a, claim.id)))),
      perplexityKey && webAllowedThisClaim > 0
        ? limiter(() => approvedWeb(perplexityKey, claim.text, doctrine, linkedAuths, claim.id, signal))
        : Promise.resolve<ApprovedWebResult>({
            candidates: [],
            telemetry: emptyWebTelemetry(perplexityKey ? "skipped" : "skipped"),
          }),
    ]);
    const exactHits = exactGroups.flat();
    const webHits = webResult.candidates.slice(0, webAllowedThisClaim);
    const webHarvest = webResult.telemetry;
    webBudgetRemaining = Math.max(0, webBudgetRemaining - webHits.length);

    // Dedup by document_id / url. Priority: exact > text > vector > web.
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
  };
}

