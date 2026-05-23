// P3 — Candidate pool: merge local + Perplexity, dedupe, cap.

import { CAPS, Candidate } from "../lib/types.ts";

function normTitle(t: string): string {
  return (t || "")
    .toLowerCase()
    .replace(/[\u0590-\u05FF]/g, (ch) => ch) // keep Hebrew
    .replace(/["׳'`״]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normUrl(u: string | null | undefined): string {
  if (!u) return "";
  try {
    const x = new URL(u);
    return (x.hostname + x.pathname).replace(/\/+$/, "").toLowerCase();
  } catch {
    return (u || "").toLowerCase().trim();
  }
}

// Extract a statute "title§section" key when discoverable.
const STATUTE_SECTION_RE = /סעיף\s*(\d+[א-ת]?)/;
function statuteKey(c: Candidate): string {
  if (c.role !== "primary_statute" && c.role !== "regulation") return "";
  const m = c.title.match(STATUTE_SECTION_RE) || (c.snippet || "").match(STATUTE_SECTION_RE);
  if (!m) return "";
  const titleBase = normTitle(c.title).replace(/סעיף\s*\d+[א-ת]?/g, "").trim();
  return `${titleBase}§${m[1]}`;
}

// Extract a docket number from title/snippet for case dedup.
const DOCKET_RE = /\b(בג"?ץ|ע"?א|רע"?א|ע"?פ|בש"?א|ב"?ש|תא|תפ|תק|רעא|עפ)\s*\d{1,5}\/\d{2,4}\b/;
function docketKey(c: Candidate): string {
  if (c.role !== "binding_case_law" && c.role !== "persuasive_case_law") return "";
  const hay = `${c.title} ${c.snippet || ""}`;
  const m = hay.match(DOCKET_RE);
  return m ? m[0].replace(/\s+/g, " ").trim() : "";
}

export interface PoolResult {
  candidates: Candidate[];
  found: number;
  after_dedup: number;
  dedup_drops: number;
  counts: {
    by_origin: Record<string, number>;
    by_role: Record<string, number>;
    by_claim: Record<string, number>;
  };
}

const MAX_VECTOR_PER_CLAIM = 2;

export function buildCandidatePool(all: Candidate[]): PoolResult {
  const seenDoc = new Set<string>();
  const seenUrl = new Set<string>();
  const seenStatute = new Set<string>();
  const seenDocket = new Set<string>();
  const seenTitle = new Map<string, Candidate>(); // role+normTitle → kept
  const vectorPerClaim = new Map<string, number>();

  // P3.2 #3: priority — exact_authority > text > perplexity > vector.
  // Score still tie-breaks within a tier.
  const tierOf = (c: Candidate): number => {
    if (c.retrieval_method === "exact_authority") return 0;
    if (c.retrieval_method === "text") return 1;
    if (c.retrieval_method === "perplexity") return 2;
    return 3; // vector
  };
  const sorted = [...all].sort((a, b) => {
    const t = tierOf(a) - tierOf(b);
    if (t !== 0) return t;
    return b.score - a.score;
  });
  const out: Candidate[] = [];
  let dedup_drops = 0;

  for (const c of sorted) {
    if (c.retrieval_method === "vector") {
      const n = vectorPerClaim.get(c.claim_id) ?? 0;
      if (n >= MAX_VECTOR_PER_CLAIM) { dedup_drops++; continue; }
    }
    const docId = c.document_id ? `doc:${c.document_id}` : "";
    const url = normUrl(c.source_url);
    const urlKey = url ? `url:${url}` : "";
    const stKey = statuteKey(c);
    const stK = stKey ? `st:${stKey}` : "";
    const dkKey = docketKey(c);
    const dk = dkKey ? `dk:${dkKey}` : "";
    const ttKey = `tt:${c.role}:${normTitle(c.title)}`;

    if (docId && seenDoc.has(docId)) { dedup_drops++; continue; }
    if (urlKey && seenUrl.has(urlKey)) { dedup_drops++; continue; }
    if (stK && seenStatute.has(stK)) { dedup_drops++; continue; }
    if (dk && seenDocket.has(dk)) { dedup_drops++; continue; }
    if (seenTitle.has(ttKey)) { dedup_drops++; continue; }

    if (docId) seenDoc.add(docId);
    if (urlKey) seenUrl.add(urlKey);
    if (stK) seenStatute.add(stK);
    if (dk) seenDocket.add(dk);
    seenTitle.set(ttKey, c);
    if (c.retrieval_method === "vector") {
      vectorPerClaim.set(c.claim_id, (vectorPerClaim.get(c.claim_id) ?? 0) + 1);
    }
    out.push(c);
    if (out.length >= CAPS.MAX_CANDIDATES) break;
  }

  const counts = {
    by_origin: {} as Record<string, number>,
    by_role: {} as Record<string, number>,
    by_claim: {} as Record<string, number>,
  };
  for (const c of out) {
    counts.by_origin[c.origin] = (counts.by_origin[c.origin] ?? 0) + 1;
    counts.by_role[c.role] = (counts.by_role[c.role] ?? 0) + 1;
    counts.by_claim[c.claim_id] = (counts.by_claim[c.claim_id] ?? 0) + 1;
  }

  return {
    candidates: out,
    found: all.length,
    after_dedup: out.length,
    dedup_drops,
    counts,
  };
}
