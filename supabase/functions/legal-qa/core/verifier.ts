// Research Core v1 — Deliverable 3: per-claim verifier.
//
// For each claim, asks a strict LLM judge to label every candidate as
//   direct | partial | tangential | unrelated
// The verifier is origin-blind on purpose: a web candidate must pass the
// same bar as a local DB candidate. Trust is established by the snippet,
// not by where the candidate came from.

import type {
  CandidateSource,
  ClaimId,
  PlanV1,
  Support,
  Verdict,
  VerificationResult,
} from "./types.ts";
import { VERIFIER_SYSTEM, VERIFIER_USER } from "./prompts.ts";
import type { ClaimRetrievalPack } from "./retrieval.ts";

const MODEL = "openai/gpt-5-mini";
const REASONING_EFFORT: "minimal" | "low" | "medium" | "high" = "low";
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MAX_BATCH = 24;            // hard cap of candidates per single LLM call
const LEGACY_CHUNK = 8;          // historical chunk size — used only to estimate "calls_before"
const SNIPPET_TIERS = [1200, 700, 450]; // chars for ranks [0..7], [8..15], [16..23]
const MAX_CONCURRENCY = 3;
const TIMEOUT_MS = 60_000;

function snippetBudgetFor(rank: number): number {
  if (rank < 8) return SNIPPET_TIERS[0];
  if (rank < 16) return SNIPPET_TIERS[1];
  return SNIPPET_TIERS[2];
}

export interface ClaimVerification {
  claim_id: ClaimId;
  verdicts: AnnotatedVerdict[];
  aggregates: {
    local_verified_direct: number;
    local_verified_partial: number;
    local_rejected: number;
    web_verified_direct: number;
    web_verified_partial: number;
    web_rejected: number;
    exact_authority_verified_direct: number;
    exact_authority_verified_partial: number;
    counts_by_support: Record<Support, number>;
  };
}

export interface AnnotatedVerdict extends Verdict {
  origin: CandidateSource["origin"];
  title: string;
  citation: string;
  url?: string;
  domain?: string;
  snippet: string;
}

export interface VerifyArgs {
  plan: PlanV1;
  packs: ClaimRetrievalPack[];
  lovableApiKey: string;
  signal?: AbortSignal;
}

export interface VerifyTelemetry {
  verifier_batch_size_max: number;
  verifier_batch_size_avg: number;
  verifier_calls_before_estimate: number;
  verifier_calls_after: number;
  verifier_duration_ms: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  // Quality / safety counters
  missing_verdict_count: number;              // sum over claims of (candidates − parsed verdicts) after final attempt
  malformed_batch_count: number;              // batch calls where the LLM returned a non-JSON or non-array body
  zero_parseable_verdict_claim_count: number; // claims whose batch call returned 0 usable verdicts
  http_error_count: number;                   // non-2xx responses from the gateway
  json_parse_error_count: number;             // JSON.parse failures on the gateway body
  batch_fallback_count: number;               // claims that fell back to legacy chunked verification
}


export interface VerifyResult {
  per_claim: ClaimVerification[];
  totals: {
    candidates_seen: number;
    direct: number;
    partial: number;
    tangential: number;
    unrelated: number;
    web_kept: number;
    web_dropped: number;
  };
  duration_ms: number;
  telemetry: VerifyTelemetry;
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

function domainOf(url?: string): string | undefined {
  if (!url) return undefined;
  try { return new URL(url).hostname.toLowerCase(); } catch { return undefined; }
}

function asSupport(v: unknown): Support | null {
  if (v === "direct" || v === "partial" || v === "tangential" || v === "unrelated") return v;
  return null;
}

interface RawVerdict {
  candidate_id?: string;
  support?: string;
  rationale?: string;
  pinpoint?: string;
  confidence?: unknown;
}

interface JudgeUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface JudgeOutcome {
  verdicts: Verdict[];
  usage?: JudgeUsage;
  batch_size: number;
}

function clampConfidence(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return undefined;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

async function callJudge(
  apiKey: string,
  claimId: ClaimId,
  claimText: string,
  doctrine: string,
  batch: CandidateSource[],
  signal?: AbortSignal,
): Promise<JudgeOutcome> {
  const userMsg = VERIFIER_USER({
    claimId,
    claimText,
    doctrine,
    candidates: batch.map((c, i) => ({
      candidate_id: c.candidate_id,
      title: c.title,
      citation: c.citation,
      snippet: (c.snippet || "").slice(0, snippetBudgetFor(i)),
    })),
  });
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort);
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(GATEWAY_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        reasoning_effort: REASONING_EFFORT,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: VERIFIER_SYSTEM },
          { role: "user", content: userMsg },
        ],
      }),
    });
    if (!res.ok) {
      console.error(`[verifier] ${claimId} ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return { verdicts: [], batch_size: batch.length };
    }
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content ?? "";
    const usage: JudgeUsage | undefined = data?.usage ? {
      prompt_tokens: Number(data.usage.prompt_tokens) || undefined,
      completion_tokens: Number(data.usage.completion_tokens) || undefined,
      total_tokens: Number(data.usage.total_tokens) || undefined,
    } : undefined;
    let parsed: any;
    try { parsed = JSON.parse(raw); }
    catch {
      const s = raw.indexOf("{"); const e = raw.lastIndexOf("}");
      if (s < 0 || e <= s) return { verdicts: [], usage, batch_size: batch.length };
      try { parsed = JSON.parse(raw.slice(s, e + 1)); } catch { return { verdicts: [], usage, batch_size: batch.length }; }
    }
    const arr: RawVerdict[] = Array.isArray(parsed?.verdicts) ? parsed.verdicts : [];
    const byId = new Map<string, CandidateSource>(batch.map((c) => [c.candidate_id, c]));
    const out: Verdict[] = [];
    for (const v of arr) {
      const cid = v.candidate_id;
      if (!cid || !byId.has(cid)) continue;
      const sup = asSupport(v.support);
      if (!sup) continue;
      out.push({
        candidate_id: cid,
        support: sup,
        rationale: (v.rationale || "").toString().slice(0, 400),
        pinpoint: v.pinpoint ? String(v.pinpoint).slice(0, 60) : undefined,
        confidence: clampConfidence(v.confidence),
      });
    }
    return { verdicts: out, usage, batch_size: batch.length };
  } catch (e) {
    console.error(`[verifier throw] ${claimId}:`, (e as Error).message);
    return { verdicts: [], batch_size: batch.length };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function verify(args: VerifyArgs): Promise<VerifyResult> {
  const { plan, packs, lovableApiKey, signal } = args;
  const t0 = Date.now();
  const limiter = makeLimiter(MAX_CONCURRENCY);
  const claimById = new Map(plan.claims.map((c) => [c.id, c]));

  // Telemetry accumulators
  let callsAfter = 0;
  let callsBeforeEstimate = 0;
  let batchSizeSum = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let sawUsage = false;

  const tasks = packs.map((pack) => limiter(async (): Promise<ClaimVerification> => {
    const claim = claimById.get(pack.claim_id);
    if (!claim || pack.candidates.length === 0) {
      return emptyVerification(pack.claim_id);
    }
    const doctrine = claim.search_targets[0]?.doctrine || plan.doctrinal_frame;

    // Estimate what the legacy chunked verifier would have done.
    callsBeforeEstimate += Math.ceil(pack.candidates.length / LEGACY_CHUNK);

    // Single LLM call per claim, capped at MAX_BATCH candidates.
    const batch = pack.candidates.slice(0, MAX_BATCH);
    const outcome = await callJudge(lovableApiKey, pack.claim_id, claim.text, doctrine, batch, signal);
    callsAfter += 1;
    batchSizeSum += outcome.batch_size;
    if (outcome.usage) {
      sawUsage = true;
      promptTokens += outcome.usage.prompt_tokens ?? 0;
      completionTokens += outcome.usage.completion_tokens ?? 0;
      totalTokens += outcome.usage.total_tokens ?? 0;
    }
    const verdicts: Verdict[] = [...outcome.verdicts];

    // Ensure every candidate gets a verdict; missing → unrelated.
    const seen = new Set(verdicts.map((v) => v.candidate_id));
    for (const c of pack.candidates) {
      if (!seen.has(c.candidate_id)) {
        verdicts.push({
          candidate_id: c.candidate_id,
          support: "unrelated",
          rationale: "לא הוחזר פסק־דין מהאמת על־ידי המסווג; ברירת מחדל: לא קשור.",
        });
      }
    }

    const annot = annotate(pack.candidates, verdicts);
    return {
      claim_id: pack.claim_id,
      verdicts: annot,
      aggregates: aggregate(annot),
    };
  }));

  const per_claim = await Promise.all(tasks);

  const totals = { candidates_seen: 0, direct: 0, partial: 0, tangential: 0, unrelated: 0, web_kept: 0, web_dropped: 0 };
  for (const cv of per_claim) {
    for (const v of cv.verdicts) {
      totals.candidates_seen++;
      totals[v.support]++;
      if (v.origin === "approved_web") {
        if (v.support === "direct" || v.support === "partial") totals.web_kept++;
        else totals.web_dropped++;
      }
    }
  }

  const duration_ms = Date.now() - t0;
  const telemetry: VerifyTelemetry = {
    verifier_batch_size_max: MAX_BATCH,
    verifier_batch_size_avg: callsAfter > 0 ? +(batchSizeSum / callsAfter).toFixed(2) : 0,
    verifier_calls_before_estimate: callsBeforeEstimate,
    verifier_calls_after: callsAfter,
    verifier_duration_ms: duration_ms,
    prompt_tokens: sawUsage ? promptTokens : undefined,
    completion_tokens: sawUsage ? completionTokens : undefined,
    total_tokens: sawUsage ? totalTokens : undefined,
  };

  console.log(
    `[verify] claims=${packs.length} before=${callsBeforeEstimate} after=${callsAfter} ` +
    `avgBatch=${telemetry.verifier_batch_size_avg} dur=${duration_ms}ms ` +
    (sawUsage ? `toks=${totalTokens}` : "toks=n/a"),
  );

  return { per_claim, totals, duration_ms, telemetry };
}

function emptyVerification(claim_id: ClaimId): ClaimVerification {
  return {
    claim_id,
    verdicts: [],
    aggregates: {
      local_verified_direct: 0, local_verified_partial: 0, local_rejected: 0,
      web_verified_direct: 0, web_verified_partial: 0, web_rejected: 0,
      exact_authority_verified_direct: 0, exact_authority_verified_partial: 0,
      counts_by_support: { direct: 0, partial: 0, tangential: 0, unrelated: 0 },
    },
  };
}

function annotate(candidates: CandidateSource[], verdicts: Verdict[]): AnnotatedVerdict[] {
  const byId = new Map(candidates.map((c) => [c.candidate_id, c]));
  const out: AnnotatedVerdict[] = [];
  for (const v of verdicts) {
    const c = byId.get(v.candidate_id);
    if (!c) continue;
    out.push({
      ...v,
      origin: c.origin,
      title: c.title,
      citation: c.citation,
      url: c.url,
      domain: domainOf(c.url),
      snippet: (c.snippet || "").slice(0, 280),
    });
  }
  return out;
}

function aggregate(verdicts: AnnotatedVerdict[]): ClaimVerification["aggregates"] {
  const a = emptyVerification("C0" as ClaimId).aggregates;
  for (const v of verdicts) {
    a.counts_by_support[v.support]++;
    const isLocal = v.origin === "local_text" || v.origin === "local_vector" || v.origin === "exact_authority";
    if (isLocal) {
      if (v.support === "direct") a.local_verified_direct++;
      else if (v.support === "partial") a.local_verified_partial++;
      else a.local_rejected++;
    }
    if (v.origin === "approved_web") {
      if (v.support === "direct") a.web_verified_direct++;
      else if (v.support === "partial") a.web_verified_partial++;
      else a.web_rejected++;
    }
    if (v.origin === "exact_authority") {
      if (v.support === "direct") a.exact_authority_verified_direct++;
      else if (v.support === "partial") a.exact_authority_verified_partial++;
    }
  }
  return a;
}
