// P3.2 — Local DB retrieval. Per-query exact authority + compact text + vector.
// - Exact-authority extraction reads original question + analyzer claims + planner query_he.
// - FTS uses compact_query_he (4–8 core legal terms), not the full normalized model text.
// - Vector recall capped: max 2 per claim (applied in candidatePool too); ordering ensured by score weights.

import type { RetrievalGovernor } from "./retrievalGovernor.ts";
// @ts-ignore — remote Deno module, resolved at deploy time.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

declare const Deno: { env: { get(key: string): string | undefined } };
import { Candidate, CAPS, Claim, Query, StageRun } from "../lib/types.ts";
import { buildHebrewFtsQuery } from "./hebrewFts.ts";

type Admin = ReturnType<typeof createClient>;

const EMBED_TIMEOUT_MS = 10_000;
const RPC_TIMEOUT_MS = 20_000;
const EXACT_TIMEOUT_MS = 8_000;

// ─── Compact legal-term query extractor for FTS ─────────────────────────────
// Goal: 4–8 strong terms / short phrases. Strip question words, role-noise.

const COMPACT_STOPWORDS = new Set([
  "האם", "מה", "מהם", "מהי", "מתי", "כיצד", "איך", "למה", "מדוע",
  "של", "על", "את", "אל", "עם", "או", "גם", "כי", "אם", "וגם", "אבל",
  "לפי", "בפני", "בית", "המשפט", "ידי", "פסק", "פסקי", "בעניין",
  "תנאי", "תנאים", "ל", "לכך", "כך", "זה", "זו", "אלו",
]);

// Strong multi-word legal phrases to preserve verbatim if present in source.
const PHRASE_BANK: string[] = [
  "פיצוי מוסכם", "פיצויים מוסכמים", "הפחתת פיצוי מוסכם", "תניית פיצוי מוסכם",
  "סעיף 15 לחוק החוזים", "חוק החוזים תרופות", "תרופות בשל הפרת חוזה",
  "השתק פלוגתא", "מעשה בית דין", "זהות פלוגתא", "הכרעה חיונית", "פסק דין חלוט",
  "השתק עילה", "השתק הגנה", "סופיות הדיון",
  "הבטחה מנהלית", "עילת הסבירות", "ביקורת שיפוטית",
  "סבירות", "מידתיות", "תום לב", "חוסר סמכות", "שיקול דעת",
  "צו מניעה זמני", "סעדים זמניים", "סיכויי תביעה", "מאזן הנוחות",
];

function detectPhrases(corpus: string): string[] {
  const found = new Set<string>();
  for (const p of PHRASE_BANK) {
    if (corpus.includes(p)) found.add(p);
  }
  return [...found];
}

function tokenize(s: string): string[] {
  return String(s || "")
    .replace(/["׳״''`,.;:?!()[\]{}<>«»—–]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t && t.length >= 2 && !COMPACT_STOPWORDS.has(t));
}

// ─── General Hebrew legal noun-phrase preservation ──────────────────────────
// Dictionary-free: keep contiguous runs of 2–4 Hebrew content tokens from the
// planner query together instead of atomizing them into single terms
// ("יורש אחר יורש", "מבחן ההשתלבות", "תום לב במשא ומתן"). A run is cut by
// punctuation, question words, and generic connectors (COMPACT_STOPWORDS),
// which is what separates noun phrases in Hebrew legal writing in practice.
const HEBREW_TOKEN_RE = /^[\u0590-\u05FF][\u0590-\u05FF"'׳״-]*$/;
const PHRASE_MAX_TOKENS = 4;

function detectHebrewNounPhrases(text: string): string[] {
  const raw = String(text || "")
    .replace(/["׳״''`,.;:?!()[\]{}<>«»—–]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ");
  const phrases: string[] = [];
  let run: string[] = [];
  const flush = () => {
    while (run.length >= 2) {
      phrases.push(run.slice(0, Math.min(PHRASE_MAX_TOKENS, run.length)).join(" "));
      if (run.length <= PHRASE_MAX_TOKENS) break;
      run = run.slice(PHRASE_MAX_TOKENS);
    }
    run = [];
  };
  for (const tok of raw) {
    const isContent = tok.length >= 2 && !COMPACT_STOPWORDS.has(tok) && HEBREW_TOKEN_RE.test(tok);
    if (isContent) run.push(tok);
    else flush();
  }
  flush();
  return phrases;
}

// local_retrieval_precision_tuning_v1 — phrases detected for a query, exposed
// so the lexical lane can keep them phrase-sensitive in the tsquery.
function compactQueryPhrases(plannerQuery: string, ctxCorpus: string): string[] {
  const bank = detectPhrases(plannerQuery + " " + ctxCorpus);
  const nouns = detectHebrewNounPhrases(plannerQuery)
    .filter((p) => !bank.some((b) => b.includes(p) || p.includes(b)));
  return [...bank, ...nouns].filter((p) => p.split(" ").length >= 2);
}

// Build compact FTS query from planner-query plus optional original-question/claim context.
function buildCompactQuery(plannerQuery: string, ctxCorpus: string): string {
  // 1. preserved phrases first (highest priority)
  const bankPhrases = detectPhrases(plannerQuery + " " + ctxCorpus);
  // 1b. general Hebrew noun phrases from the planner query itself
  const nounPhrases = detectHebrewNounPhrases(plannerQuery)
    .filter((p) => !bankPhrases.some((b) => b.includes(p) || p.includes(b)));
  const phrases = [...bankPhrases, ...nounPhrases];
  // 2. residual single tokens from planner query
  const corpus = (plannerQuery + " " + ctxCorpus).slice(0, 600);
  const phraseTokens = new Set<string>(
    phrases.flatMap((p) => p.split(" ").filter((t) => t.length >= 2)),
  );
  const residual: string[] = [];
  const seen = new Set<string>();
  for (const tok of tokenize(plannerQuery)) {
    if (phraseTokens.has(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    residual.push(tok);
  }
  // Always include statute-section signal if present
  const ss = corpus.match(/סעיף\s+[\dא-ת]+/);
  if (ss && !residual.includes(ss[0]) && !phrases.some((p) => p.includes(ss[0]))) {
    residual.unshift(ss[0]);
  }
  const parts: string[] = [...phrases, ...residual];
  // Cap to ~10 terms / ~100 chars — phrases are admitted whole (never split),
  // so a multi-word doctrine is either fully kept or skipped.
  const out: string[] = [];
  const emitted = new Set<string>();
  let len = 0;
  for (const p of parts) {
    const words = p.split(" ").filter((w) => w && !emitted.has(w));
    if (!words.length) continue;
    const piece = words.join(" ");
    if (out.length + words.length > 10) continue;
    if (len + piece.length + 1 > 100) continue;
    out.push(piece);
    for (const w of words) emitted.add(w);
    len += piece.length + 1;
  }
  return out.join(" ");
}


// ─── Exact authority detection ──────────────────────────────────────────────

interface ExactClue {
  kind: "statute_section" | "statute" | "regulation" | "docket";
  source: "question" | "claim" | "planner_query";
  law_name?: string;
  section?: string;
  docket?: string;
  search_terms: string[];
}

const STATUTE_SECTION_RE = /סעיף\s+([\dא-ת]+(?:[א-ת])?)\s+ל?(\s*חוק[^,?.\n]{2,80})/g;
// local_primary_anchor_resolution_v1 — the previous pattern was lazy
// (`{2,80}?`), so every bare law mention collapsed to two characters
// ("חוק יס") and was then rejected as `too_short`. The head alternation makes
// `חוק-יסוד` / `חוק יסוד` first-class, and the body is greedy up to a clause
// break, so full statute names survive.
const LAW_BARE_RE =
  /((?:חוק\s*[-־–]\s*יסוד\s*:?|חוק\s+יסוד|חוק)\s+[^,?.\n]{2,80})/g;
const DOCKET_RE = /\b(בג"?ץ|בג״ץ|ע"?א|ע״א|רע"?א|רע״א|ע"?פ|ע״פ|דנ"?א|דנ״א|בש"?פ|בש״פ|תפ"?ח|תפ״ח)\s*\d{1,5}\/\d{2,4}\b/g;
const REGULATION_RE = /תקנות\s+[^,?.\n]{2,80}/g;

/** Trailing prepositions / dangling connectives left by a clause cut. */
export function cleanLawClue(raw: string): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[,;:.]+$/, "")
    .replace(/\s+(?:ל|ב|מ|כ|ו|של|לפי|על|את|לעניין|בעניין)$/u, "")
    .trim();
}

export interface LawClueExtraction {
  raw_text: string;
  extracted_clues: string[];
  normalized_clues: string[];
  rejected_low_signal: string[];
  rejection_reason: Record<string, string>;
}

/**
 * Extract statute-name clues from free text and report what survived
 * normalization. Rejection happens only *after* full normalization.
 */
export function extractLawClues(text: string): LawClueExtraction {
  const out: LawClueExtraction = {
    raw_text: String(text ?? "").slice(0, 400),
    extracted_clues: [],
    normalized_clues: [],
    rejected_low_signal: [],
    rejection_reason: {},
  };
  const seen = new Set<string>();
  for (const m of String(text ?? "").matchAll(LAW_BARE_RE)) {
    const raw = m[1].trim();
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.extracted_clues.push(raw);
    const normalized = cleanLawClue(raw);
    const guard = applyExactAuthorityGuard(normalized);
    if (guard.exact_lookup_skipped) {
      out.rejected_low_signal.push(normalized);
      out.rejection_reason[normalized] = guard.skipped_reason ?? "low_signal";
      continue;
    }
    out.normalized_clues.push(normalized);
  }
  return out;
}

function detectExactClues(
  text: string,
  source: ExactClue["source"],
): ExactClue[] {
  const clues: ExactClue[] = [];
  for (const m of text.matchAll(DOCKET_RE)) {
    clues.push({ kind: "docket", source, docket: m[0], search_terms: [m[0]] });
  }
  for (const m of text.matchAll(STATUTE_SECTION_RE)) {
    const law = cleanLawClue(m[2]);
    clues.push({
      kind: "statute_section", source,
      law_name: law, section: m[1],
      search_terms: [law, `סעיף ${m[1]}`],
    });
  }
  // Bare law mentions only if no statute_section already covers it
  const seenLaws = new Set(clues.filter((c) => c.law_name).map((c) => c.law_name));
  for (const m of text.matchAll(LAW_BARE_RE)) {
    const law = cleanLawClue(m[1]);
    if (!law || seenLaws.has(law)) continue;
    if (seenLaws.has(law)) continue;
    clues.push({ kind: "statute", source, law_name: law, search_terms: [law] });
    seenLaws.add(law);
  }
  for (const m of text.matchAll(REGULATION_RE)) {
    clues.push({ kind: "regulation", source, law_name: cleanLawClue(m[0]), search_terms: [cleanLawClue(m[0])] });
  }
  return clues;
}


function dedupeClues(clues: ExactClue[]): ExactClue[] {
  const seen = new Map<string, ExactClue>();
  for (const c of clues) {
    const k = `${c.kind}|${(c.law_name || c.docket || "").toLowerCase()}|${c.section || ""}`;
    if (!seen.has(k)) seen.set(k, c);
  }
  return [...seen.values()];
}

// P3.3: planner-role → DB source_type. DB actually uses these values:
//   caselaw, knesset_research, israeli_law, journal_article, supreme_court_il
// (legislation_primary / legislation_secondary do NOT exist).
export const ROLE_SOURCE_TYPES: Record<string, string[]> = {
  primary_statute: ["israeli_law"],
  regulation: ["israeli_law"],
  binding_case_law: ["caselaw", "supreme_court_il"],
  persuasive_case_law: ["caselaw", "supreme_court_il"],
  scholarship: ["journal_article"],
  factual_report: ["knesset_research"],
  government_report: ["knesset_research"],
};

const TITLE_STOPWORDS = new Set([
  "של", "על", "את", "אל", "עם", "או", "גם", "כי", "אם", "ל", "לכך",
  "חוק", "תקנות", "צו", "פקודה", "פקודת", "התש", "תש",
]);

function titleTokens(name: string): string[] {
  return name
    .replace(/[()[\]{}"׳״''`,.;:?!<>«»—–]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t.length >= 2 && !TITLE_STOPWORDS.has(t))
    .slice(0, 6);
}

interface ClueLookupDiag {
  clue_kind: ExactClue["kind"];
  clue_source: ExactClue["source"];
  law_name?: string;
  section?: string;
  title_match_query: string;
  source_type_filter: string[] | null;
  matched_document_ids: string[];
  matched_titles: string[];
  matched_chunk_id?: string;
  status: "ok" | "empty" | "error" | "timeout" | "skipped_low_signal";
  error?: string;
  // Confidence-guard diagnostics (statute / regulation clues only; dockets bypass).
  raw_clue?: string;
  normalized_clue?: string;
  body_after_head_strip?: string;
  candidate_title_tokens?: string[];     // raw output of titleTokens(), may include short tokens
  title_tokens_for_ilike?: string[];     // tokens actually used in ilike chain; length>=3, count>=2
  exact_lookup_skipped?: boolean;
  skipped_reason?: "too_short" | "body_too_short" | "too_few_tokens" | "single_token";
}

// Heads stripped (single pass, case-exact, anchored at start) for body-length guard.
// No domain stopwords — purely structural prefixes.
const LEGAL_HEADS = ["חוק-יסוד", "חוק יסוד", "חוק", "פקודת", "פקודה", "תקנות"];
export function stripLegalHead(s: string): string {
  for (const h of LEGAL_HEADS) {
    if (s.startsWith(h)) return s.slice(h.length).trimStart();
  }
  return s;
}

export interface GuardResult {
  raw_clue: string;
  normalized_clue: string;
  body_after_head_strip: string;
  candidate_title_tokens: string[];
  title_tokens_for_ilike: string[];
  exact_lookup_skipped: boolean;
  skipped_reason?: "too_short" | "body_too_short" | "too_few_tokens" | "single_token";
}

// Generic confidence guard for exact_authority lookups (statute/regulation only).
// Dockets are not passed through this guard.
export function applyExactAuthorityGuard(raw: string): GuardResult {
  const raw_clue = String(raw ?? "");
  const normalized_clue = raw_clue.trim().replace(/\s+/g, " ");
  const body_after_head_strip = stripLegalHead(normalized_clue);
  const candidate_title_tokens = titleTokens(normalized_clue);
  const title_tokens_for_ilike = candidate_title_tokens.filter((t) => t.length >= 3);

  const base: GuardResult = {
    raw_clue, normalized_clue, body_after_head_strip,
    candidate_title_tokens, title_tokens_for_ilike: [],
    exact_lookup_skipped: true,
  };
  if (normalized_clue.length < 10) return { ...base, skipped_reason: "too_short" };
  if (body_after_head_strip.length < 4) return { ...base, skipped_reason: "body_too_short" };
  if (title_tokens_for_ilike.length < 2) {
    return {
      ...base,
      skipped_reason: title_tokens_for_ilike.length === 1 ? "single_token" : "too_few_tokens",
    };
  }
  return { ...base, title_tokens_for_ilike, exact_lookup_skipped: false };
}

async function exactAuthorityLookup(
  admin: Admin,
  clues: ExactClue[],
  role: string,
  perQueryLimit: number,
): Promise<{
  rows: RpcRow[];
  status: "ok" | "empty" | "error";
  error?: string;
  diags: ClueLookupDiag[];
  ms: number;
}> {
  const t0 = Date.now();
  const diags: ClueLookupDiag[] = [];
  if (!clues.length) return { rows: [], status: "empty", diags, ms: Date.now() - t0 };
  const allowedTypes: string[] | null = ROLE_SOURCE_TYPES[role] ?? null;
  const collected: RpcRow[] = [];
  // Track which collected row came from which clue (for section snippet lookup).
  const rowClue = new Map<string, ExactClue>();
  try {
    for (const cl of clues) {
      const primary = cl.law_name || cl.docket || cl.search_terms[0];
      if (!primary) continue;
      const cleaned = primary.replace(/[%_]/g, " ").slice(0, 120);
      const diag: ClueLookupDiag = {
        clue_kind: cl.kind, clue_source: cl.source,
        law_name: cl.law_name, section: cl.section,
        title_match_query: cleaned,
        source_type_filter: allowedTypes,
        matched_document_ids: [], matched_titles: [], status: "empty",
      };
      const timer = new Promise<null>((res) => setTimeout(() => res(null), EXACT_TIMEOUT_MS));
      // deno-lint-ignore no-explicit-any
      let q: any = admin
        .from("legal_documents")
        .select("id,title,citation,source_type,source_url,metadata")
        .limit(perQueryLimit);
      if (cl.kind === "docket") {
        // Docket: keep substring OR match. Bypasses confidence guard by design.
        if (cleaned.length < 4) { diag.status = "skipped_low_signal"; diag.exact_lookup_skipped = true; diags.push(diag); continue; }
        const pat = `%${cleaned}%`;
        q = q.or(`title.ilike.${pat},citation.ilike.${pat}`);
      } else {
        // Statute / regulation: confidence guard before issuing any title ilike.
        const guard = applyExactAuthorityGuard(cleaned);
        diag.raw_clue = guard.raw_clue;
        diag.normalized_clue = guard.normalized_clue;
        diag.body_after_head_strip = guard.body_after_head_strip;
        diag.candidate_title_tokens = guard.candidate_title_tokens;
        diag.title_tokens_for_ilike = guard.title_tokens_for_ilike;
        diag.exact_lookup_skipped = guard.exact_lookup_skipped;
        if (guard.exact_lookup_skipped) {
          diag.skipped_reason = guard.skipped_reason;
          diag.status = "skipped_low_signal";
          diag.title_match_query = "";
          diags.push(diag);
          continue;
        }
        for (const t of guard.title_tokens_for_ilike) q = q.ilike("title", `%${t}%`);
        diag.title_match_query = guard.title_tokens_for_ilike.join(" AND ");
      }

      if (allowedTypes) q = q.in("source_type", allowedTypes);
      const r = (await Promise.race([q, timer])) as
        | { data: Array<{ id: string; title: string; citation: string; source_type: string; source_url: string | null; metadata: Record<string, unknown> }> | null; error: { message?: string } | null }
        | null;
      if (!r) { diag.status = "timeout"; diags.push(diag); continue; }
      if (r.error) {
        diag.status = "error"; diag.error = r.error.message || String(r.error);
        diags.push(diag); continue;
      }
      const data = r.data || [];
      if (!data.length) { diag.status = "empty"; diags.push(diag); continue; }
      for (const d of data) {
        const row: RpcRow = {
          document_id: d.id,
          document_title: d.title,
          source_type: d.source_type,
          source_url: d.source_url ?? null,
          chunk_content: null,
          metadata: {
            ...(d.metadata || {}),
            // Docket clue matched by title/citation ILIKE → the row *contains*
            // the docket by construction, so flag it for downstream trust.
            ...(cl.kind === "docket" ? { docket_match: true } : {}),
          },
          similarity: cl.kind === "statute_section" ? 1.0 : 0.9,
        };
        collected.push(row);
        rowClue.set(d.id, cl);
        diag.matched_document_ids.push(d.id);
        diag.matched_titles.push(d.title);
      }
      diag.status = "ok";
      diags.push(diag);
    }

    // Section-snippet enrichment for statute_section clues.
    const sectionTargets = collected.filter((r) => {
      const cl = rowClue.get(r.document_id);
      return cl?.kind === "statute_section" && cl.section;
    });
    for (const row of sectionTargets) {
      const cl = rowClue.get(row.document_id)!;
      const section = cl.section!;
      // Match e.g. "15. ", "15.", "סעיף 15", "פיצויים מוסכמים"
      const pats = [
        `${section}.`,
        `סעיף ${section}`,
      ];
      const orExpr = pats.map((p) => `content.ilike.%${p.replace(/[%_]/g, " ")}%`).join(",");
      const timer = new Promise<null>((res) => setTimeout(() => res(null), EXACT_TIMEOUT_MS));
      // deno-lint-ignore no-explicit-any
      const cq: any = admin
        .from("legal_document_chunks")
        .select("id,content,chunk_index")
        .eq("document_id", row.document_id)
        .or(orExpr)
        .order("chunk_index", { ascending: true })
        .limit(1);
      const cr = (await Promise.race([cq, timer])) as
        | { data: Array<{ id: string; content: string }> | null; error: unknown }
        | null;
      if (cr && !("error" in cr && cr.error) && cr.data && cr.data.length) {
        const chunk = cr.data[0];
        const content: string = chunk.content || "";
        // Centre snippet around section marker if found.
        const idx = content.indexOf(`${section}.`) >= 0
          ? content.indexOf(`${section}.`)
          : content.indexOf(`סעיף ${section}`);
        const start = idx > 200 ? idx - 200 : 0;
        row.chunk_content = content.slice(start, start + 600);
        // attach matched_chunk_id to the corresponding diag entry
        const d = diags.find((x) => x.matched_document_ids.includes(row.document_id));
        if (d) d.matched_chunk_id = chunk.id;
      }
    }
  } catch (e) {
    return {
      rows: collected, status: "error",
      error: e instanceof Error ? e.message : String(e), diags,
      ms: Date.now() - t0,
    };
  }
  // Dedup by document_id (prefer rows that gained a snippet).
  const byId = new Map<string, RpcRow>();
  for (const r of collected) {
    const prev = byId.get(r.document_id);
    if (!prev || (!prev.chunk_content && r.chunk_content)) byId.set(r.document_id, r);
  }
  const unique = [...byId.values()];
  return { rows: unique, status: unique.length ? "ok" : "empty", diags, ms: Date.now() - t0 };
}

// ─── RPC helpers ────────────────────────────────────────────────────────────

async function runRpcDiag<T extends unknown[] = unknown[]>(
  promise: PromiseLike<{ data: unknown; error: { message?: string } | null }>,
  ms: number,
): Promise<{ status: "ok" | "empty" | "error" | "timeout"; rows: T; error?: string; ms: number }> {
  const t0 = Date.now();
  let timedOut = false;
  const empty = [] as unknown as T;
  const timer = new Promise<null>((res) => setTimeout(() => { timedOut = true; res(null); }, ms));
  try {
    const res = (await Promise.race([promise, timer])) as
      | { data: unknown; error: { message?: string } | null }
      | null;
    const elapsed = Date.now() - t0;
    if (timedOut || !res) return { status: "timeout", rows: empty, ms: elapsed };
    if (res.error) return { status: "error", rows: empty, error: res.error.message || String(res.error), ms: elapsed };
    const rows = (Array.isArray(res.data) ? res.data : []) as T;
    return { status: rows.length ? "ok" : "empty", rows, ms: elapsed };
  } catch (e) {
    return { status: "error", rows: empty, error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 };
  }
}

async function embed(text: string): Promise<{ vec: number[] | null; ms: number; error?: string }> {
  const t0 = Date.now();
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return { vec: null, ms: 0, error: "no_api_key" };
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), EMBED_TIMEOUT_MS);
    const r = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text.slice(0, 2000),
        dimensions: 768,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!r.ok) return { vec: null, ms: Date.now() - t0, error: `http_${r.status}` };
    const d = await r.json();
    return { vec: d.data?.[0]?.embedding ?? null, ms: Date.now() - t0 };
  } catch (e) {
    return { vec: null, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
  }
}

interface RpcRow {
  document_id: string;
  document_title: string;
  source_type: string;
  source_url?: string | null;
  chunk_content?: string | null;
  metadata?: Record<string, unknown>;
  similarity?: number;
}

// ─── Vector-quota authority signal ──────────────────────────────────────────
const MIN_VECTOR_FLOOR = 4;
const SNIPPET_DEFAULT = 400;
const SNIPPET_ANCHOR = 1200;
// Only statutory/regulatory texts count as "official primary" for the purpose
// of shrinking vector recall. Case-law rows count only via an exact docket
// match, otherwise every Nevo hit would suppress doctrinal vector recall.
const OFFICIAL_SOURCE_TYPES = new Set([
  "legislation_primary", "legislation_secondary", "regulation", "statute",
]);
const OFFICIAL_HOST_RE = /(^|\.)(knesset\.gov\.il|gov\.il|court\.gov\.il|nevo\.co\.il)/i;

export interface AuthoritySignal {
  has_signal: boolean;
  exact_docket: boolean;
  exact_statute_section: boolean;
  official_primary: boolean;
  phrase_overlap: boolean;
}

function textAuthoritySignal(
  rows: RpcRow[],
  clues: ExactClue[],
  compactQuery: string,
): AuthoritySignal {
  const sig: AuthoritySignal = {
    has_signal: false, exact_docket: false, exact_statute_section: false,
    official_primary: false, phrase_overlap: false,
  };
  if (!rows.length) return sig;

  const dockets = clues.filter((c) => c.kind === "docket").map((c) => c.docket || "").filter(Boolean);
  const sections = clues.filter((c) => c.kind === "statute_section");
  // Multi-word phrases from the compact query (dictionary-free overlap test).
  const phrases = detectHebrewNounPhrases(compactQuery)
    .filter((p) => p.split(" ").length >= 2 && p.length >= 8);

  for (const r of rows) {
    const hay = `${r.document_title || ""} ${r.source_url || ""}`;
    if (dockets.some((d) => hay.includes(d))) sig.exact_docket = true;
    for (const s of sections) {
      const nameHit = s.law_name ? (r.document_title || "").includes(s.law_name.replace(/^ל/, "")) : false;
      const secHit = `${r.document_title || ""} ${r.chunk_content || ""}`.includes(`סעיף ${s.section}`);
      if (nameHit && secHit) sig.exact_statute_section = true;
    }
    if (OFFICIAL_SOURCE_TYPES.has(r.source_type) && OFFICIAL_HOST_RE.test(r.source_url || "")) {
      sig.official_primary = true;
    }
    if (phrases.some((p) => (r.document_title || "").includes(p))) {
      sig.phrase_overlap = true;
    }
  }
  sig.has_signal = sig.exact_docket || sig.exact_statute_section || sig.official_primary || sig.phrase_overlap;
  return sig;
}


function isPlaceholderTitle(t: string | null | undefined): boolean {
  const s = (t || "").trim();
  if (!s) return true;
  return /^(פרטי\s+מסמך|ללא\s+כותרת)/i.test(s);
}

export interface LocalRetrievalResult {
  candidates: Candidate[];
  per_query: Array<{
    claim_id: string;
    role: string;
    original_query_he: string;
    compact_query_he: string;
    exact_clues: ExactClue[];
    exact_hits: number;
    text_hits: number;
    vector_hits: number;
    vector_budget: number;
    text_authority_signal: AuthoritySignal;
    kept: number;
    ms: number;
    diag: {
      exact_status: "ok" | "empty" | "error";
      exact_error?: string;
      exact_ms: number;
      parallel_batch_ms: number;
      exact_clue_lookups: ClueLookupDiag[];
      law_clue_extraction?: LawClueExtraction;
      role_to_source_type_filter: string[] | null;
      text_status: "ok" | "empty" | "error" | "timeout";
      text_error?: string;
      text_ms: number;
      /** local_retrieval_precision_tuning_v1 — which lexical RPC served this
       *  query: the Hebrew-aware tsquery helper or the legacy fallback. */
      text_lane?: "tsquery" | "legacy";
      hebrew_fts_normalization?: unknown;
      hebrew_fts_term_selection?: unknown;
      tsq_primary?: string;
      vector_status: "ok" | "empty" | "error" | "timeout" | "no_embedding";
      vector_error?: string;
      vector_ms: number;
      embedding_length: number | null;
      embedding_ms: number;
      embedding_error?: string;
      top_exact_titles: string[];
      top_text_titles: string[];
      top_vector_titles: string[];
    };
  }>;
  stage_runs: StageRun[];
  ms: number;
  global_exact: {
    clues_from_question: ExactClue[];
    clues_from_claims: ExactClue[];
  };
  aggregate: {
    wall_ms: number;
    queries_executed: number;
    duplicate_query_count: number;
    text_timeout_count: number;
    vector_timeout_count: number;
    exact_error_count: number;
    sum_query_ms: number;
    max_query_ms: number;
    slowest_query: { claim_id: string; role: string; query_he: string; ms: number; exact_ms: number; text_ms: number; vector_ms: number; embedding_ms: number } | null;
    method_total_ms: { exact: number; text: number; embedding: number; vector: number };
    slowest_method: "exact" | "text" | "embedding" | "vector";
    candidates_by_method: { exact_authority: number; text: number; vector: number };
    bottleneck_hypothesis: string;
  };
}

export async function runLocalRetrieval(
  admin: Admin,
  queries: Query[],
  ctx: { question: string; claims: Claim[] },
  opts: { budget?: RetrievalGovernor | null } = {},
): Promise<LocalRetrievalResult> {
  const budget = opts.budget ?? null;
  const t0 = Date.now();
  const targets = queries.filter((q) => q.targets.includes("local_db"));
  const candidates: Candidate[] = [];
  const per_query: LocalRetrievalResult["per_query"] = [];

  // Global exact clues from original question + analyzer claims (P3.2 #1)
  const questionClues = dedupeClues(detectExactClues(ctx.question || "", "question"));
  const claimClues = dedupeClues(
    (ctx.claims || []).flatMap((c) => detectExactClues(c.text_he || "", "claim")),
  );
  const ctxCorpus = [ctx.question, ...(ctx.claims || []).map((c) => c.text_he)].join(" ");

  // retrieval_budget_enforcement_v1: bounded worker pool instead of an
  // unbounded Promise.all over every planner/facet query, plus a launch gate.
  const runOneLocalQuery = async (q: Query) => {
      const qStart = Date.now();
      const compact = buildCompactQuery(q.query_he, ctxCorpus);
      // local_retrieval_precision_tuning_v1 — deterministic Hebrew lexical
      // query: prefix variants + salience-selected required terms.
      const fts = buildHebrewFtsQuery(
        compact || q.query_he,
        compactQueryPhrases(q.query_he, ctxCorpus),
      );
      const plannerClues = detectExactClues(q.query_he, "planner_query");
      // Merge global + planner clues — but only inject question/claim clues
      // when the role is statute/regulation/case (otherwise they're noise).
      const roleAcceptsExact =
        q.role === "primary_statute" || q.role === "regulation" ||
        q.role === "binding_case_law" || q.role === "persuasive_case_law";

      // Docket-anchor synthetic clues: the anchor carries all string variants
      // (Hebrew canonical, gershayim, no-quote, English, dash-separated),
      // some of which DOCKET_RE cannot parse from q.query_he alone. Emit one
      // docket clue per variant so exactAuthorityLookup can ILIKE all of them.
      const qMeta = (q.metadata ?? {}) as Record<string, unknown>;
      const isDocketAnchor = qMeta.is_docket_anchor === true;
      const docketVariants = Array.isArray(qMeta.docket_variants)
        ? (qMeta.docket_variants as string[]) : [];
      const anchorDocketClues: ExactClue[] = isDocketAnchor
        ? docketVariants
            .filter((v) => v && v.length >= 4)
            .map((v) => ({ kind: "docket" as const, source: "planner_query" as const, docket: v, search_terms: [v] }))
        : [];

      const clues = dedupeClues([
        ...anchorDocketClues,
        ...plannerClues,
        ...(roleAcceptsExact ? [...questionClues, ...claimClues] : []),
      ]);

      const exactP = exactAuthorityLookup(admin, clues, q.role, CAPS.LOCAL_PER_QUERY);
      const embedP = embed(compact || q.query_he);
      // Precise lane first; the legacy RPC stays as a fail-open fallback so a
      // tsquery syntax problem can never remove the lexical lane entirely.
      const textP = (async () => {
        if (fts.tsq_primary) {
          const d = await runRpcDiag<RpcRow[]>(
            // deno-lint-ignore no-explicit-any
            (admin.rpc("search_legal_chunks_tsquery", {
              tsq_primary: fts.tsq_primary,
              tsq_fallback: fts.tsq_fallback,
              raw_query: compact || q.query_he,
              match_count: CAPS.LOCAL_PER_QUERY,
            }) as any),
            RPC_TIMEOUT_MS,
          );
          if (d.status === "ok" || d.status === "empty") {
            return { ...d, lane: "tsquery" as const };
          }
        }
        const legacy = await runRpcDiag<RpcRow[]>(
          // deno-lint-ignore no-explicit-any
          (admin.rpc("search_legal_chunks_text", {
            search_query: compact || q.query_he,
            match_count: CAPS.LOCAL_PER_QUERY,
          }) as any),
          RPC_TIMEOUT_MS,
        );
        return { ...legacy, lane: "legacy" as const };
      })();

      const parallelT0 = Date.now();
      const [exactRes, embedRes, textDiag] = await Promise.all([exactP, embedP, textP]);
      const parallelBatchMs = Date.now() - parallelT0;
      const exactMs = exactRes.ms;

      let vectorBudgetUsed = 0;
      let authoritySignal: AuthoritySignal = {
        has_signal: false, exact_docket: false, exact_statute_section: false,
        official_primary: false, phrase_overlap: false,
      };
      let vectorDiag: {
        status: "ok" | "empty" | "error" | "timeout" | "no_embedding";
        rows: RpcRow[];
        error?: string;
        ms: number;
      };

      if (!embedRes.vec) {
        vectorDiag = { status: "no_embedding", rows: [], ms: 0, error: embedRes.error };
      } else {
        // Shrink the vector quota only when the text hits already carry a
        // high-confidence authority signal (exact docket / exact statute
        // section / official primary source / strong phrase overlap).
        // Otherwise keep a vector floor so noisy text hits cannot crowd out
        // doctrinal recall.
        const authority = textAuthoritySignal(textDiag.rows, clues, q.query_he);
        const vectorBudget = authority.has_signal
          ? 2
          : Math.max(MIN_VECTOR_FLOOR, CAPS.LOCAL_PER_QUERY);
        vectorBudgetUsed = vectorBudget;
        authoritySignal = authority;

        const d = await runRpcDiag<RpcRow[]>(
          // deno-lint-ignore no-explicit-any
          (admin.rpc("match_legal_chunks", {
            query_embedding: JSON.stringify(embedRes.vec),
            match_threshold: 0.5,
            match_count: vectorBudget,
          }) as any),
          RPC_TIMEOUT_MS,
        );
        vectorDiag = d;
      }

      const exactRows = exactRes.rows;
      const textRows = textDiag.rows;
      const vecRows = vectorDiag.rows;

      let kept = 0;
      const seenInQuery = new Set<string>();
      // P3.2 #3: weights enforce exact > text > vector ordering inside the pool.
      const push = (m: RpcRow, method: "text" | "vector" | "exact_authority", weight: number) => {
        if (!m?.document_id || isPlaceholderTitle(m.document_title)) return;
        const meta = (m.metadata || {}) as Record<string, unknown>;
        if (meta.broken_title === true) return;
        const key = `${method}:${m.document_id}`;
        if (seenInQuery.has(key)) return;
        seenInQuery.add(key);
        // Docket-anchor: mark docket_match ONLY when the docket string appears
        // in title/url (not the chunk snippet). Snippet mentions frequently
        // come from later cases citing the target ruling and must not satisfy
        // the anchor (B2 Ka'adan regression).
        let docket_match = meta.docket_match === true;
        if (isDocketAnchor && !docket_match) {
          const hay = `${m.document_title}\n${m.source_url ?? ""}`;
          for (const v of docketVariants) {
            if (v.length < 4) continue;
            if (hay.includes(v)) { docket_match = true; break; }
          }
        }

        // Step 3: larger snippets ONLY for anchor / lead-grade candidates —
        // required anchors, exact docket/statute matches, exact-authority rows.
        const isAnchorGrade =
          Boolean(q.metadata?.required_anchor_id) ||
          docket_match ||
          method === "exact_authority";
        const snippetLimit = isAnchorGrade ? SNIPPET_ANCHOR : SNIPPET_DEFAULT;

        candidates.push({
          candidate_id: crypto.randomUUID(),
          claim_id: q.claim_id,
          role: q.role,
          origin: "local_db",
          retrieval_method: method as any,
          title: m.document_title,
          source_type: m.source_type,
          document_id: m.document_id,
          source_url: m.source_url ?? null,
          snippet: (m.chunk_content || "").slice(0, snippetLimit),


          query_he: q.query_he,
          // Small docket-match boost so exact-holding rows sort above adjacent
          // cases inside the same tier at pool time.
          score: ((m.similarity ?? 0) as number) * weight + (docket_match ? 0.05 : 0),
          expected_source_type: q.expected_source_type,
          metadata: {
            ...meta,
            // Reserve text for the synthesis snippet budget. Not shown to the
            // drafter unless the source qualifies (judgment / statute in a
            // synthesis role) — the displayed snippet cap is unchanged.
            ...((m.chunk_content || "").length > snippetLimit
              ? { extended_text: (m.chunk_content || "").slice(0, 1600) }
              : {}),
            ...(docket_match ? { docket_match: true } : {}),
            ...(q.metadata?.required_anchor_id
              ? { required_anchor_id: q.metadata.required_anchor_id }
              : {}),
          },

        });
        kept++;
      };
      for (const r of exactRows) push(r, "exact_authority", 1.5);
      for (const r of textRows) push(r, "text", 1.0);
      for (const r of vecRows) push(r, "vector", 0.6);

      per_query.push({
        claim_id: q.claim_id,
        role: q.role,
        original_query_he: q.query_he,
        compact_query_he: compact,
        exact_clues: clues,
        exact_hits: exactRows.length,
        text_hits: textRows.length,
        vector_hits: vecRows.length,
        vector_budget: vectorBudgetUsed,
        text_authority_signal: authoritySignal,
        kept,
        ms: Date.now() - qStart,
        diag: {
          exact_status: exactRes.status,
          exact_error: exactRes.error,
          exact_ms: exactMs,
          parallel_batch_ms: parallelBatchMs,
          exact_clue_lookups: exactRes.diags,
          law_clue_extraction: extractLawClues(q.query_he ?? ""),
          role_to_source_type_filter: ROLE_SOURCE_TYPES[q.role] ?? null,
          text_lane: textDiag.lane,
          hebrew_fts_normalization: fts.normalization,
          hebrew_fts_term_selection: fts.term_selection,
          tsq_primary: fts.tsq_primary.slice(0, 600),
          text_status: textDiag.status,
          text_error: textDiag.error,
          text_ms: textDiag.ms,
          vector_status: vectorDiag.status,
          vector_error: vectorDiag.error,
          vector_ms: vectorDiag.ms,
          embedding_length: embedRes.vec ? embedRes.vec.length : null,
          embedding_ms: embedRes.ms,
          embedding_error: embedRes.error,
          top_exact_titles: exactRows.slice(0, 5).map((r) => r.document_title),
          top_text_titles: textRows.slice(0, 5).map((r) => r.document_title),
          top_vector_titles: vecRows.slice(0, 5).map((r) => r.document_title),
        },
      });
  };

  {
    const LOCAL_CONCURRENCY = 4;
    let next = 0;
    const worker = async () => {
      while (true) {
        const i = next++;
        if (i >= targets.length) return;
        if (budget && !budget.canLaunch()) {
          budget.noteAborted();
          continue;
        }
        await runOneLocalQuery(targets[i]);
      }
    };
    await Promise.all(
      Array.from({ length: Math.max(1, Math.min(LOCAL_CONCURRENCY, targets.length)) }, worker),
    );
  }


  const wallMs = Date.now() - t0;

  // ── Aggregate telemetry (P7 E.2) ─────────────────────────────────────────
  const seenQ = new Map<string, number>();
  for (const pq of per_query) {
    const k = pq.original_query_he;
    seenQ.set(k, (seenQ.get(k) ?? 0) + 1);
  }
  const duplicate_query_count = [...seenQ.values()].reduce((s, n) => s + (n > 1 ? n - 1 : 0), 0);
  const text_timeout_count = per_query.filter((p) => p.diag.text_status === "timeout").length;
  const vector_timeout_count = per_query.filter((p) => p.diag.vector_status === "timeout").length;
  const exact_error_count = per_query.filter((p) => p.diag.exact_status === "error").length;
  const sum_query_ms = per_query.reduce((s, p) => s + p.ms, 0);
  let slowest = per_query[0] ?? null;
  for (const p of per_query) if (!slowest || p.ms > slowest.ms) slowest = p;
  const method_total_ms = {
    exact: per_query.reduce((s, p) => s + (p.diag.exact_ms || 0), 0),
    text: per_query.reduce((s, p) => s + (p.diag.text_ms || 0), 0),
    embedding: per_query.reduce((s, p) => s + (p.diag.embedding_ms || 0), 0),
    vector: per_query.reduce((s, p) => s + (p.diag.vector_ms || 0), 0),
  };
  const slowest_method = (Object.entries(method_total_ms).sort((a, b) => b[1] - a[1])[0]?.[0]
    ?? "text") as "exact" | "text" | "embedding" | "vector";
  const candidates_by_method = {
    exact_authority: candidates.filter((c) => c.retrieval_method === "exact_authority").length,
    text: candidates.filter((c) => c.retrieval_method === "text").length,
    vector: candidates.filter((c) => c.retrieval_method === "vector").length,
  };
  const max_query_ms = slowest?.ms ?? 0;
  let bottleneck_hypothesis = "unknown";
  if (text_timeout_count + vector_timeout_count > 0) {
    bottleneck_hypothesis = `rpc_timeout_cap (text_timeouts=${text_timeout_count}, vector_timeouts=${vector_timeout_count}, RPC_TIMEOUT_MS=${RPC_TIMEOUT_MS})`;
  } else if (max_query_ms > 0 && max_query_ms >= wallMs * 0.85 && per_query.length > 1) {
    bottleneck_hypothesis = `single_slow_query (max=${max_query_ms}ms ≈ wall=${wallMs}ms)`;
  } else if (max_query_ms > 0 && max_query_ms < wallMs * 0.6) {
    bottleneck_hypothesis = `parallel_aggregate (wall=${wallMs}ms >> max_query=${max_query_ms}ms; serialization or contention)`;
  } else {
    bottleneck_hypothesis = `dominant_method=${slowest_method} (sum=${method_total_ms[slowest_method]}ms across ${per_query.length} queries)`;
  }

  return {
    candidates,
    per_query,
    stage_runs: [{ stage: "local_retrieval", ms: wallMs, ok: true }],
    ms: wallMs,
    global_exact: {
      clues_from_question: questionClues,
      clues_from_claims: claimClues,
    },
    aggregate: {
      wall_ms: wallMs,
      queries_executed: per_query.length,
      duplicate_query_count,
      text_timeout_count,
      vector_timeout_count,
      exact_error_count,
      sum_query_ms,
      max_query_ms,
      slowest_query: slowest
        ? {
            claim_id: slowest.claim_id,
            role: slowest.role,
            query_he: slowest.original_query_he,
            ms: slowest.ms,
            exact_ms: slowest.diag.exact_ms,
            text_ms: slowest.diag.text_ms,
            vector_ms: slowest.diag.vector_ms,
            embedding_ms: slowest.diag.embedding_ms,
          }
        : null,
      method_total_ms,
      slowest_method,
      candidates_by_method,
      bottleneck_hypothesis,
    },
  };
}
