// Dynamic, query-adaptive reranker.
//
// Replaces the static rerank gate (caselaw>=5 / non-caselaw>=3 / top-6) with a
// signal-fusion + adaptive-gate + MMR pipeline. Behaviour is gated behind
// DYNAMIC_RERANK_ENABLED so we can ship shadow-A/B before flipping default.
//
// Design notes:
// • Query profiling is heuristic-only (no extra LLM call). The plan called for
//   an optional LLM profiler — we keep it as an upgrade path but ship without
//   it because every extra gateway hit adds 429 surface area.
// • LLM scoring is batched in groups of 8 with a shared concurrency limiter,
//   jittered staggered starts, and per-batch retry/backoff on 429/5xx.
//   Terminal batch failure → fallback `llm_score = vector_sim * 10`. The full
//   request never fails because of rerank.
// • For the diversity pass, we use lexical Jaccard similarity over the doc
//   title + first chunk slice — LocalMatch does NOT carry chunk embeddings,
//   and re-embedding 15+ chunks for MMR would cost more than the rerank itself.
//   Jaccard catches the "6 copies of the same landmark case" failure mode in
//   practice; we can swap to true cosine MMR later if we start carrying
//   embeddings through retrieval.

// ─── Public types ─────────────────────────────────────────────────────────

export type Intent = "define" | "apply" | "criticize" | "comparative";

export interface QueryProfile {
  branches: string[];
  intent: Intent;
  /** Surface markers (e.g. בג"ץ, פסיקה) that flag a caselaw-domain question. */
  isCaselawDomain: boolean;
  /** Whether recency materially matters (caselaw + legislation queries). */
  recencyMatters: boolean;
}

export interface RerankInputDoc {
  /** Stable doc id used by index.ts to merge chunks back in. */
  docId: string;
  title: string;
  /** Concatenated chunk text (used for the LLM rerank prompt + Jaccard). */
  chunkText: string;
  /** Best per-doc retrieval similarity (0–1). */
  vectorSim: number;
  /** Best per-doc text-rank score (0–1+, may be > 1 from ts_rank). */
  textRank: number;
  source_type: string;
  /** Index into original matches array — preserved as MMR/tiebreaker key. */
  originalIndex: number;
}

export interface SignalBreakdown {
  vector: number;
  text: number;
  llm: number;
  branch: number;
  recency: number;
  action_verb: number;
  final_score: number;
  mmr_picked: boolean;
}

export interface RerankV2Telemetry {
  profile: QueryProfile;
  weights_applied: WeightVector;
  per_doc: Array<{
    title: string;
    source_type: string;
    breakdown: SignalBreakdown;
    kept: boolean;
    drop_reason?: string;
  }>;
  gate_floor: number;
  dropped_count: number;
  batches: {
    total: number;
    retried_429: number;
    retried_5xx: number;
    failed_fallback: number;
    p95_ms: number;
  };
}

export interface RerankedDoc {
  docId: string;
  finalScore: number;
  breakdown: SignalBreakdown;
}

// ─── Intent → weight table ────────────────────────────────────────────────

export interface WeightVector {
  vector: number;
  text: number;
  llm: number;
  branch: number;
  recency: number;
}

/**
 * Intent-aware weights. `comparative` intent zeroes out `branch` because the
 * whole point of a comparative question (e.g. contracts vs tort remedies) is
 * to cross branch boundaries — punishing off-branch hits there is wrong.
 * Total per row must sum to 1.0; checked at module load below.
 */
export const INTENT_WEIGHTS: Record<Intent, WeightVector> = {
  define:      { vector: 0.25, text: 0.15, llm: 0.45, branch: 0.10, recency: 0.05 },
  apply:       { vector: 0.25, text: 0.15, llm: 0.45, branch: 0.10, recency: 0.05 },
  criticize:   { vector: 0.20, text: 0.15, llm: 0.50, branch: 0.10, recency: 0.05 },
  // branch=0 by design; the 0.10 is redistributed to vector + text so the
  // gate leans harder on retrieval evidence when branches legitimately mix.
  comparative: { vector: 0.30, text: 0.20, llm: 0.45, branch: 0.00, recency: 0.05 },
};

// Sanity-check at module load — better to crash on cold start than silently
// produce skewed scores.
for (const [intent, w] of Object.entries(INTENT_WEIGHTS)) {
  const sum = w.vector + w.text + w.llm + w.branch + w.recency;
  if (Math.abs(sum - 1) > 1e-6) {
    throw new Error(`INTENT_WEIGHTS[${intent}] sums to ${sum}, expected 1.0`);
  }
}

// ─── Heuristic query profiler ─────────────────────────────────────────────
// No LLM call: a single regex pass over the question. Cheap, deterministic,
// and avoids contributing to the gateway rate-limit budget.

const BRANCH_PATTERNS: Array<{ branch: string; re: RegExp }> = [
  { branch: "constitutional", re: /(חוקתי|חוק[\s־-]?יסוד|בג["״]ץ|זכויות יסוד|כבוד האדם)/ },
  { branch: "criminal",       re: /(פלילי|פלילים|עברה|עבירה|נאשם|כתב\s+אישום|ענישה|מעצר|חיפוש|חקירה|ע["״]פ)/ },
  { branch: "civil_contracts",re: /(חוזה|חוזים|חוזית|הפרת\s+חוזה|תרופות.*חוזה|תום\s+לב|אכיפה)/ },
  { branch: "torts",          re: /(נזיקין|נזק|רשלנות|מטרד|הפרת\s+חובה|אחריות\s+נזיקית)/ },
  { branch: "family",         re: /(משפחה|גירוש|גירושין|משמורת|מזונות|הסכם\s+ממון|כתובה|ידועים\s+בציבור)/ },
  { branch: "labor",          re: /(עבודה|מעביד|עובד|פיטור|פיצויי\s+פיטור|הסכם\s+קיבוצי|זכויות\s+עובדים)/ },
  { branch: "tax",            re: /(מס|מיסוי|מע["״]מ|מס\s+הכנסה|פקיד\s+שומה|הכנסה\s+חייבת)/ },
  { branch: "admin",          re: /(מנהלי|רשות\s+מנהלית|שיקול\s+דעת|סבירות|מידתיות|בג["״]ץ|עתירה\s+מנהלית)/ },
  { branch: "corporate",      re: /(חברות|דירקטור|בעל\s+מניות|פירוק|חוק\s+החברות)/ },
  { branch: "property",       re: /(מקרקעין|נדל["״]ן|חכירה|בעלות|רישום\s+מקרקעין|טאבו)/ },
];

const COMPARATIVE_RE =
  /(השוו|השוואה|הבדל|הבדלים|בהשוואה ל|לעומת|מנגד|שונה מ|דומה ל|להבדיל מ|בניגוד ל)/;
const DEFINE_RE =
  /(מהו|מהי|מהם|הגדר|הגדרת|מה זה|מה היא|מה הוא|מהות|מושג)/;
const CRITICIZE_RE =
  /(ביקורת|מבקר|חולשה|כשל|בעייתי|סוגיה ביקורתית|להציע|רפורמה|תיקון חקיקתי)/;
const CASELAW_DOMAIN_RE =
  /(בג["״]ץ|ע["״]א|רע["״]א|ע["״]פ|פס["״]ד|פסק\s+דין|פסיקה|הלכה|תקדים|בית\s+המשפט\s+העליון)/;
const RECENCY_RE =
  /(לאחרונה|חדש|עדכני|תיקון|תיקונים|תיקון\s+\d{4}|2020|2021|2022|2023|2024|2025|2026)/;

/**
 * Heuristic profile from the raw user question. Stable: same input → same
 * output. The plan called for an optional LLM profiler too; we omit it
 * because every extra gateway hit hurts 429 budget and the heuristic is
 * good enough for the weight table we have.
 */
export function profileQuery(question: string): QueryProfile {
  const branches: string[] = [];
  for (const { branch, re } of BRANCH_PATTERNS) {
    if (re.test(question)) branches.push(branch);
  }
  let intent: Intent = "apply";
  if (COMPARATIVE_RE.test(question)) intent = "comparative";
  else if (DEFINE_RE.test(question)) intent = "define";
  else if (CRITICIZE_RE.test(question)) intent = "criticize";

  return {
    branches,
    intent,
    isCaselawDomain: CASELAW_DOMAIN_RE.test(question),
    recencyMatters: RECENCY_RE.test(question),
  };
}

// ─── Concurrency limiter (dependency-free) ────────────────────────────────
// Plain semaphore so we can cap parallel gateway calls. Shared across all
// rerank batches in a single request — and exported so future stages (critic,
// completion) can opt-in to the same global budget.

export class Limiter {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>(resolve => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

const MAX_RERANK_CONCURRENCY = Number(
  Deno.env.get("MAX_RERANK_CONCURRENCY") ?? 3,
);
export const rerankLimiter = new Limiter(MAX_RERANK_CONCURRENCY);

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const jitter = (maxMs: number) => Math.floor(Math.random() * Math.max(1, maxMs));

// ─── Batched LLM rerank ───────────────────────────────────────────────────

const LLM_BATCH_SIZE = 8;
const RETRY_DELAYS_429 = [400, 1200, 3000]; // ms; jittered, honors Retry-After

export interface BatchStats {
  total: number;
  retried_429: number;
  retried_5xx: number;
  failed_fallback: number;
  durations_ms: number[];
}

function buildRerankPrompt(
  question: string,
  docs: RerankInputDoc[],
  profile: QueryProfile,
): string {
  const sourceList = docs.map((d, i) => {
    const body = d.chunkText.slice(0, 400);
    return `[${i}] ${d.title}\nתוכן: ${body}`;
  }).join("\n\n");

  // Branch-mismatch hint is included ONLY when intent != comparative. The plan
  // requires comparative questions to allow cross-branch sources without
  // penalty — so we omit the warning from the prompt entirely.
  const branchHint = profile.intent === "comparative"
    ? "השאלה משווה בין ענפי דין שונים — מקורות מענפים שונים יכולים להיות רלוונטיים כאשר הם מאירים את ההשוואה."
    : `התאמה בין ענף הדין חיונית. אל תהסס לתת ציון 0–2 למקורות מענף דין שונה גם אם מילות מפתח דומות.`;

  return `אתה מדרג רלוונטיות מהותית של מקורות משפטיים לשאלה. עליך להיות מחמיר.

שאלה: ${question}

מקורות:
${sourceList}

דרג כל מקור 0–10 לפי רלוונטיות מהותית בלבד לשאלה הספציפית.
- 0–2 = לא קשור לסוגיה / עוסק בנושא אחר לחלוטין.
- 3–4 = נוגע באופן רחוק / רקע כללי בלבד.
- 5–6 = רלוונטי לסוגיה הקרובה.
- 7–10 = עוסק ישירות בסוגיה הספציפית הנשאלת.

${branchHint}

החזר רק מערך JSON של מספרים, ציון אחד לכל מקור לפי הסדר.
דוגמה: [8, 1, 9, 0, 6]`;
}

/**
 * Score one batch via the AI gateway, with retry/backoff. Returns parsed
 * 0–10 scores aligned to `docs`, or `null` on terminal failure (caller falls
 * back to vector_sim * 10 for those docs).
 */
async function scoreBatchWithRetry(
  docs: RerankInputDoc[],
  question: string,
  profile: QueryProfile,
  apiKey: string,
  stats: BatchStats,
): Promise<number[] | null> {
  const prompt = buildRerankPrompt(question, docs, profile);
  // Staggered start — spreads concurrent fires across ~120ms so the gateway's
  // per-second bucket doesn't see them as simultaneous.
  await sleep(jitter(120));

  const t0 = Date.now();
  let lastErr = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_429.length; attempt++) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 12_000);
      let res: Response;
      try {
        res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-lite",
            max_tokens: 200,
            messages: [{ role: "user", content: prompt }],
          }),
          signal: ctl.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (res.status === 429) {
        if (attempt < RETRY_DELAYS_429.length) {
          stats.retried_429++;
          // Honor Retry-After if present (seconds or HTTP-date).
          const retryAfter = res.headers.get("Retry-After");
          let waitMs = RETRY_DELAYS_429[attempt] + jitter(200);
          if (retryAfter) {
            const secs = Number(retryAfter);
            if (Number.isFinite(secs) && secs > 0) waitMs = Math.min(secs * 1000, 8000);
          }
          console.warn(`[rerank:429] attempt ${attempt + 1}, backing off ${waitMs}ms`);
          await sleep(waitMs);
          continue;
        }
        lastErr = `429 after ${RETRY_DELAYS_429.length} retries`;
        break;
      }
      if (res.status === 402) {
        // Credits exhausted — fail fast, no retry. Caller falls back.
        lastErr = "402_credits";
        console.error("[rerank:402] credits exhausted — falling back");
        break;
      }
      if (res.status >= 500 && res.status < 600) {
        if (attempt === 0) {
          stats.retried_5xx++;
          await sleep(800 + jitter(300));
          continue;
        }
        lastErr = `5xx_${res.status}`;
        break;
      }
      if (!res.ok) {
        lastErr = `http_${res.status}`;
        break;
      }

      const data = await res.json();
      const text: string = data?.choices?.[0]?.message?.content ?? "";
      const arrayMatch = text.match(/\[[\d\s,.\-]+\]/);
      if (!arrayMatch) {
        lastErr = "parse_no_array";
        break;
      }
      const parsed = JSON.parse(arrayMatch[0]);
      if (!Array.isArray(parsed)) {
        lastErr = "parse_not_array";
        break;
      }
      // Pad/truncate to docs.length so caller indexing is safe.
      const out: number[] = [];
      for (let i = 0; i < docs.length; i++) {
        const v = Number(parsed[i]);
        out.push(Number.isFinite(v) ? Math.max(0, Math.min(10, v)) : 4);
      }
      stats.durations_ms.push(Date.now() - t0);
      return out;
    } catch (err) {
      lastErr = (err as Error).message ?? String(err);
      if (attempt < RETRY_DELAYS_429.length && /aborted|abort|network/i.test(lastErr)) {
        stats.retried_5xx++;
        await sleep(600 + jitter(300));
        continue;
      }
      break;
    }
  }

  stats.failed_fallback++;
  stats.durations_ms.push(Date.now() - t0);
  console.error(`[rerank:batch_fallback] ${lastErr} — falling back to vector_sim`);
  return null;
}

/**
 * Run LLM rerank across all docs, batched in groups of 8, capped at
 * MAX_RERANK_CONCURRENCY parallel batches. Docs in a batch that fails its
 * retries fall back to `vector_sim * 10`.
 */
export async function runBatchedRerank(
  docs: RerankInputDoc[],
  question: string,
  profile: QueryProfile,
  apiKey: string,
): Promise<{ scores: Map<string, number>; stats: BatchStats }> {
  const stats: BatchStats = {
    total: 0,
    retried_429: 0,
    retried_5xx: 0,
    failed_fallback: 0,
    durations_ms: [],
  };
  const scores = new Map<string, number>();
  if (docs.length === 0) return { scores, stats };

  const batches: RerankInputDoc[][] = [];
  for (let i = 0; i < docs.length; i += LLM_BATCH_SIZE) {
    batches.push(docs.slice(i, i + LLM_BATCH_SIZE));
  }
  stats.total = batches.length;

  await Promise.all(batches.map(batch =>
    rerankLimiter.run(async () => {
      const result = await scoreBatchWithRetry(batch, question, profile, apiKey, stats);
      if (result) {
        for (let i = 0; i < batch.length; i++) {
          scores.set(batch[i].docId, result[i]);
        }
      } else {
        // Fallback: vector_sim * 10. Caller still ranks these — they just
        // can't benefit from semantic LLM judgement.
        for (const d of batch) {
          scores.set(d.docId, Math.max(0, Math.min(10, d.vectorSim * 10)));
        }
      }
    })
  ));

  return { scores, stats };
}

// ─── Branch / source-type / recency / verb signals ────────────────────────

const CASELAW_TYPES = new Set(["case_law", "caselaw", "ruling"]);

function isCaselawType(sourceType: string): boolean {
  return CASELAW_TYPES.has(sourceType);
}

/**
 * Branch match score. Heuristic: scan chunk text for any branch pattern that
 * matches the query's profile. 1 = direct match, 0.5 = adjacent branch (any
 * non-target branch pattern fires), 0 = no branch signal.
 * If query profile has zero branches detected, we return 0.5 (neutral) so we
 * don't punish docs for ambiguous queries.
 */
function branchMatch(chunkText: string, profile: QueryProfile): number {
  if (profile.branches.length === 0) return 0.5;
  let directHit = false;
  let otherHit = false;
  for (const { branch, re } of BRANCH_PATTERNS) {
    if (!re.test(chunkText)) continue;
    if (profile.branches.includes(branch)) directHit = true;
    else otherHit = true;
  }
  if (directHit) return 1;
  if (otherHit) return 0;
  return 0.5;
}

/**
 * Source-type fit. Caselaw-domain question favours caselaw; otherwise neutral.
 * Light signal — most of the lifting is done by branch + llm.
 */
function sourceTypeFit(sourceType: string, profile: QueryProfile): number {
  if (!profile.isCaselawDomain) return 0.6;
  return isCaselawType(sourceType) ? 1 : 0.4;
}

/**
 * Recency bonus — only fires when `profile.recencyMatters` AND we can find
 * a 20XX year in the chunk text. Cheap proxy; better signals exist (case
 * date metadata) but they're not on LocalMatch today.
 */
function recencyBonus(chunkText: string, profile: QueryProfile): number {
  if (!profile.recencyMatters) return 0.5;
  const yearMatch = chunkText.match(/\b(20\d{2})\b/);
  if (!yearMatch) return 0.3;
  const y = Number(yearMatch[1]);
  if (y >= 2022) return 1;
  if (y >= 2018) return 0.7;
  return 0.4;
}

// Verb topical bonus (kept from legacy rerank — small but useful signal).
const VERB_TOPIC_PAIRS: Array<{ trigger: RegExp; topicTerms: string[] }> = [
  { trigger: /(לפטר|פיטור|להדיח|הדחה|להפסיק\s+כהונ|הפסקת\s+כהונ|לסיים\s+כהונ|סיום\s+כהונ)/, topicTerms: ["פיטור", "פיטורי", "הפסקת כהונ", "סיום כהונ", "הדחה", "הדחת"] },
  { trigger: /(למנות|מינוי|להתמנות)/, topicTerms: ["מינוי", "מינויי", "למנות", "התמנות"] },
  { trigger: /(לעצור|מעצר|מעצרים)/, topicTerms: ["מעצר", "עצור", "עוצר", "מעצרים"] },
  { trigger: /(חיפוש|לערוך\s+חיפוש|צו\s+חיפוש)/, topicTerms: ["חיפוש", "צו חיפוש"] },
  { trigger: /(חקירה|חשד|לחקור)/, topicTerms: ["חקירה", "חשד", "חקירת"] },
];

function actionVerbBonus(chunkText: string, question: string): number {
  const active = VERB_TOPIC_PAIRS.filter(p => p.trigger.test(question));
  if (active.length === 0) return 0;
  for (const pair of active) {
    if (pair.topicTerms.some(t => chunkText.includes(t))) return 0.1;
  }
  return 0;
}

// ─── Scorer + adaptive gate + MMR ─────────────────────────────────────────

export interface ScoredDoc extends RerankInputDoc {
  llmScore: number; // 0–10
  breakdown: SignalBreakdown;
}

export function scoreCandidates(
  docs: RerankInputDoc[],
  llmScores: Map<string, number>,
  question: string,
  profile: QueryProfile,
): ScoredDoc[] {
  const w = INTENT_WEIGHTS[profile.intent];
  return docs.map(d => {
    const llmRaw = llmScores.get(d.docId) ?? Math.max(0, Math.min(10, d.vectorSim * 10));
    // Normalize llm 0–10 → 0–1 so weights remain interpretable.
    const llmNorm = llmRaw / 10;
    const branch = branchMatch(d.chunkText, profile);
    const typeFit = sourceTypeFit(d.source_type, profile);
    const recency = recencyBonus(d.chunkText, profile);
    const verb = actionVerbBonus(d.chunkText, question);

    // Per-mode `vector` weight also absorbs source-type fit as a small multiplier
    // (keeps the weight table simpler — typeFit is a soft factor, not a free axis).
    const vector = d.vectorSim * typeFit;
    // text_rank can exceed 1 in raw form (ts_rank can return >1); clamp.
    const text = Math.max(0, Math.min(1, d.textRank));

    const final =
      w.vector * vector +
      w.text * text +
      w.llm * llmNorm +
      w.branch * branch +
      w.recency * recency +
      verb; // additive — caps at ~0.1

    return {
      ...d,
      llmScore: llmRaw,
      breakdown: {
        vector,
        text,
        llm: llmNorm,
        branch,
        recency,
        action_verb: verb,
        final_score: final,
        mmr_picked: false,
      },
    };
  });
}

/**
 * Pool-relative gate: keep docs with `final_score >= max(absoluteMin, p75 - delta)`.
 * For tiny pools (≤3) the gate is a no-op so we never accidentally empty the
 * source pack on narrow corpora.
 */
export function adaptiveGate(
  scored: ScoredDoc[],
  opts: { absoluteMin: number; deltaFromP75: number },
): { kept: ScoredDoc[]; dropped: ScoredDoc[]; floor: number } {
  if (scored.length <= 3) {
    return { kept: [...scored], dropped: [], floor: 0 };
  }
  const sorted = [...scored].sort((a, b) => a.breakdown.final_score - b.breakdown.final_score);
  const p75 = sorted[Math.floor(sorted.length * 0.75)].breakdown.final_score;
  const floor = Math.max(opts.absoluteMin, p75 - opts.deltaFromP75);
  const kept: ScoredDoc[] = [];
  const dropped: ScoredDoc[] = [];
  for (const d of scored) {
    if (d.breakdown.final_score >= floor) kept.push(d);
    else dropped.push(d);
  }
  // Never return zero — bottom-of-the-barrel beats empty pack.
  if (kept.length === 0 && sorted.length > 0) {
    const best = sorted[sorted.length - 1];
    kept.push(best);
    const idx = dropped.indexOf(best);
    if (idx >= 0) dropped.splice(idx, 1);
  }
  return { kept, dropped, floor };
}

// Token-set Jaccard for MMR redundancy. Cheap and works on Hebrew text without
// a tokenizer because we just split on whitespace + punctuation.
function tokenize(s: string): Set<string> {
  const out = new Set<string>();
  for (const t of s.split(/[\s,.;:!?\-–—()״"'׳`\[\]{}|/\\]+/)) {
    if (t.length >= 3) out.add(t);
  }
  return out;
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return inter / union;
}

/**
 * MMR selection over scored docs. `lambda` weights relevance vs novelty;
 * 1.0 = ignore diversity, 0.0 = pure novelty.
 */
export function mmrSelect(
  scored: ScoredDoc[],
  k: number,
  lambda = 0.7,
): ScoredDoc[] {
  if (scored.length <= k) {
    return scored.map(d => ({
      ...d,
      breakdown: { ...d.breakdown, mmr_picked: true },
    }));
  }
  const tokens = new Map<string, Set<string>>();
  for (const d of scored) tokens.set(d.docId, tokenize(d.title + " " + d.chunkText.slice(0, 800)));

  const picked: ScoredDoc[] = [];
  const remaining = [...scored];
  // Always pick best-scoring doc first.
  remaining.sort((a, b) => b.breakdown.final_score - a.breakdown.final_score);
  picked.push(remaining.shift()!);

  while (picked.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestMmr = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const candTokens = tokens.get(cand.docId)!;
      let maxSim = 0;
      for (const p of picked) {
        const s = jaccard(candTokens, tokens.get(p.docId)!);
        if (s > maxSim) maxSim = s;
      }
      const mmr = lambda * cand.breakdown.final_score - (1 - lambda) * maxSim;
      if (mmr > bestMmr) {
        bestMmr = mmr;
        bestIdx = i;
      }
    }
    picked.push(remaining.splice(bestIdx, 1)[0]);
  }
  // Tag the breakdown on returned picks. Mutating original objects is fine —
  // they're all rebuilt per request.
  for (const d of picked) d.breakdown.mmr_picked = true;
  return picked;
}

// ─── Top-level orchestrator ───────────────────────────────────────────────

export interface DynamicRerankOpts {
  question: string;
  apiKey: string;
  /** Final pick count after MMR. Maps to `k` in the plan. */
  k: number;
  /** MMR diversity weight. */
  mmrLambda: number;
  /** Adaptive-gate knobs. */
  gate: { absoluteMin: number; deltaFromP75: number };
}

export interface DynamicRerankResult {
  picks: ScoredDoc[];
  telemetry: RerankV2Telemetry;
}

export async function dynamicRerank(
  docs: RerankInputDoc[],
  opts: DynamicRerankOpts,
): Promise<DynamicRerankResult> {
  const profile = profileQuery(opts.question);
  const weights = INTENT_WEIGHTS[profile.intent];

  const { scores, stats } = await runBatchedRerank(docs, opts.question, profile, opts.apiKey);
  const scored = scoreCandidates(docs, scores, opts.question, profile);
  const { kept, dropped, floor } = adaptiveGate(scored, opts.gate);
  const picks = mmrSelect(kept, opts.k, opts.mmrLambda);

  const pickIds = new Set(picks.map(p => p.docId));
  const per_doc = scored.map(d => ({
    title: d.title.slice(0, 80),
    source_type: d.source_type,
    breakdown: d.breakdown,
    kept: pickIds.has(d.docId),
    drop_reason: pickIds.has(d.docId)
      ? undefined
      : dropped.includes(d) ? "below_adaptive_floor" : "mmr_top_k_slice",
  }));

  const sortedDurations = [...stats.durations_ms].sort((a, b) => a - b);
  const p95 = sortedDurations.length === 0
    ? 0
    : sortedDurations[Math.min(sortedDurations.length - 1, Math.floor(sortedDurations.length * 0.95))];

  const telemetry: RerankV2Telemetry = {
    profile,
    weights_applied: weights,
    per_doc,
    gate_floor: floor,
    dropped_count: scored.length - picks.length,
    batches: {
      total: stats.total,
      retried_429: stats.retried_429,
      retried_5xx: stats.retried_5xx,
      failed_fallback: stats.failed_fallback,
      p95_ms: p95,
    },
  };
  return { picks, telemetry };
}
