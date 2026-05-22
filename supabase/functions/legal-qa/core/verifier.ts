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
}

async function callJudge(
  apiKey: string,
  claimId: ClaimId,
  claimText: string,
  doctrine: string,
  batch: CandidateSource[],
  signal?: AbortSignal,
): Promise<Verdict[]> {
  const userMsg = VERIFIER_USER({
    claimId,
    claimText,
    doctrine,
    candidates: batch.map((c) => ({
      candidate_id: c.candidate_id,
      title: c.title,
      citation: c.citation,
      snippet: (c.snippet || "").slice(0, MAX_SNIPPET_CHARS),
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
      return [];
    }
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content ?? "";
    let parsed: any;
    try { parsed = JSON.parse(raw); }
    catch {
      const s = raw.indexOf("{"); const e = raw.lastIndexOf("}");
      if (s < 0 || e <= s) return [];
      try { parsed = JSON.parse(raw.slice(s, e + 1)); } catch { return []; }
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
      });
    }
    return out;
  } catch (e) {
    console.error(`[verifier throw] ${claimId}:`, (e as Error).message);
    return [];
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

  const tasks = packs.map((pack) => limiter(async (): Promise<ClaimVerification> => {
    const claim = claimById.get(pack.claim_id);
    if (!claim || pack.candidates.length === 0) {
      return emptyVerification(pack.claim_id);
    }
    const doctrine = claim.search_targets[0]?.doctrine || plan.doctrinal_frame;

    // Batch in chunks of MAX_PER_CALL.
    const verdicts: Verdict[] = [];
    for (let i = 0; i < pack.candidates.length; i += MAX_PER_CALL) {
      const batch = pack.candidates.slice(i, i + MAX_PER_CALL);
      const got = await callJudge(lovableApiKey, pack.claim_id, claim.text, doctrine, batch, signal);
      verdicts.push(...got);
    }

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

  return { per_claim, totals, duration_ms: Date.now() - t0 };
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
