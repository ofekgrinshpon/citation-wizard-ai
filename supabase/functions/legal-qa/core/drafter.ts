// Research Core v1 — Deliverable 5: Drafter.
//
// Turns the ledger into a Hebrew prose memo, under strict rules:
//   * may assert only ledger claims (supported + hedged)
//   * may cite only ledger source IDs (LS#)
//   * supported claims = confident voice
//   * hedged claims = hedging language ("נראה כי", "ייתכן ש-", ...)
//   * unsupported claims must not appear
//   * no new sources, no invented citations
//   * no markdown headings; **bold** sub-labels allowed
//   * each kept claim must carry >=1 [cite:LS#] marker
//   * if supported<2, must include the insufficient-sources sentence
//
// The drafter does NOT build footnotes — that is Deliverable 6.

import type {
  ClaimId,
  LedgerEntry,
  LedgerResult,
  LedgerSourceId,
  PlanV1,
} from "./types.ts";
import { DRAFTER_SYSTEM, DRAFTER_USER } from "./prompts.ts";

const DEFAULT_MODEL = "openai/gpt-5";
const REASONING_EFFORT: "minimal" | "low" | "medium" | "high" = "low";
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 90_000;
const MAX_SNIPPET_CHARS = 600;

const INSUFFICIENT_SENTENCE =
  "המקורות המאומתים שאותרו אינם מספיקים לגיבוש מסקנה חד-משמעית.";

const CITE_RE = /\[cite:(LS\d+)\]/g;

// ─── Public types ─────────────────────────────────────────────────────────

export interface DraftQualityCheck {
  claim_id: ClaimId;
  status: "supported" | "hedged";
  markers_for_claim: LedgerSourceId[]; // markers whose source belongs to this claim
  has_marker: boolean;
}

export interface DraftResult {
  answer: string;
  citations_used: LedgerSourceId[];           // unique LS ids referenced in body
  unknown_markers: string[];                  // [cite:LSx] not in ledger (stripped)
  paragraph_count: number;
  per_claim_checks: DraftQualityCheck[];
  unsupported_claim_leaks: ClaimId[];         // unsupported claim ids whose text appears in answer
  insufficient_sources_sentence_present: boolean;
  insufficient_sources_sentence_required: boolean;
  duration_ms: number;
  model: string;
  warnings: string[];
}

export interface DraftArgs {
  plan: PlanV1;
  ledger: LedgerResult;
  lovableApiKey: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  forceModel?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function ledgerToPromptText(ledger: LedgerResult): string {
  const lines: string[] = [];
  for (const e of ledger.entries) {
    lines.push(`CLAIM ${e.claim_id} [${e.status}]: ${e.text}`);
    for (const s of e.sources) {
      const bits = [
        `  - ${s.ls_id} (${s.origin}${s.is_primary ? ", primary" : ""}, ${s.support})`,
        `      title:    ${s.title || "(ללא כותרת)"}`,
        `      citation: ${s.citation || "(ללא ציטוט)"}`,
      ];
      if (s.pinpoint) bits.push(`      pinpoint: ${s.pinpoint}`);
      if (s.url) bits.push(`      url:      ${s.url}`);
      const snip = (s.snippet || "").replace(/\s+/g, " ").trim().slice(0, MAX_SNIPPET_CHARS);
      if (snip) bits.push(`      snippet:  ${snip}`);
      lines.push(bits.join("\n"));
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

function stripUnknownMarkers(
  text: string,
  validIds: Set<LedgerSourceId>,
): { cleaned: string; unknown: string[] } {
  const unknown: string[] = [];
  const cleaned = text.replace(CITE_RE, (m, id) => {
    if (validIds.has(id as LedgerSourceId)) return m;
    unknown.push(id);
    return "";
  });
  return { cleaned, unknown };
}

function uniqueMarkers(text: string): LedgerSourceId[] {
  const set = new Set<LedgerSourceId>();
  for (const m of text.matchAll(CITE_RE)) set.add(m[1] as LedgerSourceId);
  return [...set];
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/g)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function buildSourceClaimMap(entries: LedgerEntry[]): Map<LedgerSourceId, ClaimId> {
  const m = new Map<LedgerSourceId, ClaimId>();
  for (const e of entries) for (const s of e.sources) m.set(s.ls_id, e.claim_id);
  return m;
}

// Detects whether an unsupported claim's text appears in the answer.
// We use a coarse signature: the longest informative noun-phrase-ish slice.
function unsupportedLeakCheck(answer: string, plan: PlanV1, ledger: LedgerResult): ClaimId[] {
  const kept = new Set<ClaimId>(ledger.entries.map((e) => e.claim_id));
  const leaks: ClaimId[] = [];
  for (const c of plan.claims) {
    if (kept.has(c.id)) continue;
    const norm = c.text.replace(/[״"'.,;:()]/g, "").trim();
    // pick the longest run of >=4 Hebrew word tokens
    const words = norm.split(/\s+/).filter((w) => w.length >= 2);
    if (words.length < 4) continue;
    const probe = words.slice(0, Math.min(words.length, 6)).join(" ");
    if (probe.length >= 12 && answer.includes(probe)) leaks.push(c.id);
  }
  return leaks;
}

// ─── Public API ───────────────────────────────────────────────────────────

export async function draft(args: DraftArgs): Promise<DraftResult> {
  const t0 = Date.now();
  const { plan, ledger, lovableApiKey, signal, timeoutMs, forceModel } = args;
  const MODEL = (forceModel && forceModel.trim()) ? forceModel.trim() : DEFAULT_MODEL;
  const TIMEOUT_MS = typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const warnings: string[] = [];

  const validIds = new Set<LedgerSourceId>(
    ledger.entries.flatMap((e) => e.sources.map((s) => s.ls_id)),
  );
  const sourceToClaim = buildSourceClaimMap(ledger.entries);

  const supportedCount = ledger.totals.supported;
  const insufficientRequired = supportedCount < 2;

  const ledgerText = ledgerToPromptText(ledger);
  const userMsg = DRAFTER_USER({
    doctrinalFrame: plan.doctrinal_frame,
    thesis: plan.thesis,
    ledgerText,
  });

  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort);
  let selfTimedOut = false;
  const timer = setTimeout(() => { selfTimedOut = true; ctrl.abort(); }, TIMEOUT_MS);

  let raw = "";
  try {
    const res = await fetch(GATEWAY_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        reasoning_effort: REASONING_EFFORT,
        messages: [
          { role: "system", content: DRAFTER_SYSTEM },

          { role: "user", content: userMsg },
        ],
      }),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 400);
      throw new Error(`drafter gateway ${res.status}: ${body}`);
    }
    const data = await res.json();
    raw = (data?.choices?.[0]?.message?.content ?? "").toString();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }

  if (!raw.trim()) {
    warnings.push("drafter_empty_response");
  }

  // Strip any markdown headings the model may have added despite the rules.
  raw = raw.replace(/^#{1,6}\s+.*$/gm, "").replace(/\n{3,}/g, "\n\n").trim();

  // Drop any "מקורות" list at the end if the model added one.
  raw = raw.replace(/\n+\*?\*?מקורות\*?\*?\s*:[\s\S]*$/u, "").trim();

  // Strip raw Unicode superscript runs the drafter may have emitted despite
  // the rules. Footnote numbering is owned by the Footnote Builder; any
  // superscript here is a prompt violation that would otherwise trip the
  // sup_no_footnote acceptance gate. We remove the run and any single
  // space immediately preceding it (so "word¹ ." → "word.").
  const SUP_RUN = /[\u00B2\u00B3\u00B9\u2070-\u2079]+/g;
  const supMatches = raw.match(SUP_RUN);
  if (supMatches && supMatches.length > 0) {
    raw = raw
      .replace(/ ?[\u00B2\u00B3\u00B9\u2070-\u2079]+/g, "")
      .replace(/ {2,}/g, " ")
      .replace(/\s+([.,;:])/g, "$1")
      .trim();
    warnings.push(`raw_superscript_stripped:${supMatches.length}`);
  }


  // Strip unknown citation markers (and remember them).
  const { cleaned, unknown } = stripUnknownMarkers(raw, validIds);
  let answer = cleaned;

  // Enforce insufficient-sources sentence if required.
  const presentNow = answer.includes(INSUFFICIENT_SENTENCE);
  if (insufficientRequired && !presentNow) {
    answer = `${INSUFFICIENT_SENTENCE}\n\n${answer}`.trim();
    warnings.push("insufficient_sources_sentence_injected");
  }
  const insufficient_sources_sentence_present = answer.includes(INSUFFICIENT_SENTENCE);

  const citationsUsed = uniqueMarkers(answer);

  // Per-claim citation coverage check.
  const per_claim_checks: DraftQualityCheck[] = ledger.entries.map((e) => {
    const markers_for_claim = citationsUsed.filter((id) => sourceToClaim.get(id) === e.claim_id);
    return {
      claim_id: e.claim_id,
      status: e.status === "unsupported" ? "supported" : e.status, // unsupported never reaches here
      markers_for_claim,
      has_marker: markers_for_claim.length > 0,
    };
  });

  for (const c of per_claim_checks) {
    if (!c.has_marker) warnings.push(`claim_${c.claim_id}_missing_citation_marker`);
  }

  const unsupported_claim_leaks = unsupportedLeakCheck(answer, plan, ledger);
  for (const cid of unsupported_claim_leaks) {
    warnings.push(`unsupported_claim_${cid}_leaked`);
  }

  // Reject any unknown markers (they were already stripped, just warn).
  for (const id of unknown) warnings.push(`unknown_marker_${id}_stripped`);

  return {
    answer,
    citations_used: citationsUsed,
    unknown_markers: unknown,
    paragraph_count: splitParagraphs(answer).length,
    per_claim_checks,
    unsupported_claim_leaks,
    insufficient_sources_sentence_present,
    insufficient_sources_sentence_required: insufficientRequired,
    duration_ms: Date.now() - t0,
    model: MODEL,
    warnings,
  };
}
