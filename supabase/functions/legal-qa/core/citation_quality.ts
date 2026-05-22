// Research Core v1 — Deliverable 6.3: CitationQualityPass.
//
// Two phases:
//   Phase A — filter LedgerSourceCitations (failed / off_domain / etc).
//   Phase B — strip stripped LS markers from the drafter answer, run the
//             footnote builder, validate both canonical and Rule-37 forms,
//             flag/remove malformed footnotes, decide final status.
//
// Never calls an LLM.

import type {
  ClaimId,
  CitationQualityResult,
  CitationQualityStatus,
  FlaggedFootnote,
  Footnote,
  LedgerSource,
  LedgerSourceCitation,
  LedgerSourceId,
  RemovedCitation,
} from "./types.ts";
import { buildFootnotes } from "./footnotes.ts";
import type { LedgerEntry, LedgerResult } from "./types.ts";

// ── Host-based declared_type inference ────────────────────────────────────
// Used to rescue approved_web ledger sources that the verifier marked
// `direct` but which arrived with empty/weak source_type / title metadata
// (e.g. "[DOC] nevo.co.il"). The host alone tells us this is a primary
// legal source; we should not drop it just because the label is thin.
const CASELAW_HOSTS = [
  "supremedecisions.court.gov.il",
  "supreme.court.gov.il",
  "court.gov.il",
  "takdin.co.il",
  "lite.takdin.co.il",
  "psakdin.co.il",
  "din.org.il",
];
const LEGISLATION_HOSTS = [
  "main.knesset.gov.il",
  "fs.knesset.gov.il",
  "knesset.gov.il",
  "reshumot.gov.il",
];

const LAW_RE =
  /(חוק|פקודת|פקודה|תקנות|תקנה|צו|כללי|הוראות|חוק[\s-]יסוד|ס["״]ח|ק["״]ת)/;
const CASE_RE = /(נ['׳]\s|בג"ץ|בג״ץ|ע"א|ע״א|ע"פ|ע״פ|רע"א|רע״א|דנ"א|דנ״א|פ"ד|פ״ד|תק-על|פסק[\s-]דין)/;

function hostFromUrl(url?: string): string {
  if (!url) return "";
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}
function hostMatchesAny(host: string, list: string[]): boolean {
  if (!host) return false;
  for (const h of list) if (host === h || host.endsWith("." + h)) return true;
  return false;
}
function inferDeclaredFromSource(
  ls: LedgerSource | undefined,
): "statute" | "caselaw" | "none" {
  if (!ls) return "none";
  const host = hostFromUrl(ls.url);
  const text = `${ls.title || ""}\n${ls.citation || ""}\n${ls.snippet || ""}`;
  if (hostMatchesAny(host, CASELAW_HOSTS)) return "caselaw";
  if (hostMatchesAny(host, LEGISLATION_HOSTS)) return "statute";
  // nevo.co.il is mixed — disambiguate by text.
  if (host === "nevo.co.il" || host.endsWith(".nevo.co.il")) {
    if (CASE_RE.test(text)) return "caselaw";
    if (LAW_RE.test(text)) return "statute";
  }
  // gov.il fallback: only rescue when the title/citation clearly names a law.
  if (host.endsWith("gov.il") && LAW_RE.test(text)) return "statute";
  return "none";
}

const INSUFFICIENT_SENTENCE =
  "המקורות המאומתים שאותרו אינם מספיקים לגיבוש מסקנה חד-משמעית.";
const CITE_RE = /\[cite:(LS\d+)\]/g;

// Allowed Rule-37 shapes for repeated footnotes.
const RE_SHEM = /^שם(,\s+.+)?\.\s*$/;
const RE_SUPRA = /לעיל ה["״]ש\s*\d+/;
const RE_LEG_CROSS = /^ס['׳]\s.+\sל.+\.\s*$/;

export interface CitationQualityArgs {
  answer: string;
  ledger: LedgerResult;
  citations: Map<LedgerSourceId, LedgerSourceCitation>;
}

interface KeptDecision {
  kept: boolean;
  reason: string;
}

function decideKept(c: LedgerSourceCitation): KeptDecision {
  if (c.citation_quality === "failed") {
    return { kept: false, reason: `quality_failed:${c.citation_errors.join(",")}` };
  }
  const isPartialEnriched = c.citation_errors.includes("partial_enriched");
  // needs_review = engine produced something but it isn't safe to ship
  // (bare reporter without docket/parties, unresolved journal pipe-artifact).
  // EXCEPTION: enrichment safety-net entries are marked needs_review +
  // partial_enriched and carry a usable docket+parties canonical_citation.
  // Keep those (the recovery pass is the whole reason they're here).
  if (c.citation_quality === "needs_review") {
    if (
      isPartialEnriched &&
      !c.citation_errors.includes("failed_bare_reporter") &&
      !c.citation_errors.includes("journal_pipe_unresolved") &&
      c.canonical_citation && c.canonical_citation.trim()
    ) {
      return { kept: true, reason: "partial_enriched_accepted" };
    }
    return { kept: false, reason: `needs_review:${c.citation_errors.join(",")}` };
  }
  const offDomain = c.citation_errors.find((e) => e.startsWith("off_domain:"));
  if (offDomain) {
    return { kept: false, reason: offDomain };
  }
  // Drop approved_web sources with uninformative labels (e.g. "[DOC] nevo.co.il")
  // or empty source_type. Primary/local sources are kept (handled by ledger origin).
  const hasUninformative = c.citation_errors.includes("uninformative_label") ||
    c.citation_errors.includes("empty_source_type");
  if (hasUninformative && c.declared_type === "none") {
    return { kept: false, reason: "uninformative_label" };
  }
  if (c.citation_quality === "partial") {
    if (c.placeholders.length > 0) {
      return { kept: true, reason: `placeholder_accepted:${c.placeholders.join(",")}` };
    }
    return { kept: true, reason: "passthrough_accepted" };
  }
  return { kept: true, reason: "ok" };
}

function markersInAnswer(text: string): LedgerSourceId[] {
  return [...text.matchAll(CITE_RE)].map((m) => m[1] as LedgerSourceId);
}

function stripMarkers(answer: string, dropped: Set<LedgerSourceId>): {
  text: string;
  removed: LedgerSourceId[];
} {
  const removed: LedgerSourceId[] = [];
  const text = answer.replace(CITE_RE, (full, id) => {
    if (dropped.has(id as LedgerSourceId)) {
      removed.push(id as LedgerSourceId);
      return "";
    }
    return full;
  })
    // Tidy: collapse stray "  " left behind, and " ." → "."
    .replace(/ {2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1");
  return { text, removed };
}

function claimIdForLs(
  ls_id: LedgerSourceId,
  ledger: LedgerResult,
): ClaimId | undefined {
  for (const e of ledger.entries) {
    for (const s of e.sources) if (s.ls_id === ls_id) return e.claim_id;
  }
  return undefined;
}

function computeLostClaims(
  ledger: LedgerResult,
  survivingMarkers: LedgerSourceId[],
): ClaimId[] {
  const surviving = new Set(survivingMarkers);
  const lost: ClaimId[] = [];
  for (const e of ledger.entries) {
    const claimLsIds = new Set(e.sources.map((s) => s.ls_id));
    const anyAlive = [...claimLsIds].some((id) => surviving.has(id));
    if (!anyAlive) lost.push(e.claim_id);
  }
  return lost;
}

function validateFootnote(
  fn: Footnote,
  cit: LedgerSourceCitation | undefined,
  footnotes: Footnote[],
): string | null {
  const t = (fn.text || "").trim();
  if (!t) return "empty_text";
  if (/\(ציטוט חסר\)/.test(t)) return "placeholder_text";
  if (/\[cite:/.test(t)) return "leftover_marker_in_text";

  if (!cit) return "no_citation_record";

  if (!fn.is_repeated) {
    // First use: must equal canonical_citation when engine resolved it.
    if (cit.engine_used === "resolver" && cit.citation_quality !== "failed") {
      if (t.replace(/\s+/g, " ") !== cit.canonical_citation.replace(/\s+/g, " ")) {
        return "canonical_mismatch";
      }
    }
    return null;
  }

  // Repeated use:
  // Shape gate: must look like one of שם / לעיל ה"ש N / legislation cross-form.
  const isShem = RE_SHEM.test(t);
  const isSupra = RE_SUPRA.test(t);
  const isLegCross = RE_LEG_CROSS.test(t);
  if (!isShem && !isSupra && !isLegCross) return "short_form_shape_invalid";

  // Rule 37.5: no לעיל ה"ש for legislation.
  if (cit.short_form_inputs.is_legislation && isSupra) {
    return "legislation_supra_forbidden";
  }

  // first_footnote_number cross-check.
  if (fn.first_footnote_number == null) return "missing_first_footnote_number";
  const prior = footnotes.find((f) => f.number === fn.first_footnote_number);
  if (!prior) return "first_footnote_number_not_found";
  if (prior.ls_id !== fn.ls_id) return "first_footnote_number_ls_mismatch";
  if (prior.is_repeated) return "first_footnote_points_to_repeat";

  return null;
}

export function runCitationQuality(args: CitationQualityArgs): CitationQualityResult {
  const t0 = Date.now();
  const { answer, ledger, citations } = args;

  // ─── Phase A: filter citations ────────────────────────────────────────
  // Pre-pass: rescue approved_web sources the verifier accepted as `direct`
  // but whose label/source_type was uninformative. Infer declared_type from
  // the host so the `uninformative_label && declared_type==="none"` gate in
  // decideKept doesn't drop them and collapse claim support.
  const lsById = new Map<LedgerSourceId, LedgerSource>();
  for (const e of ledger.entries) for (const s of e.sources) lsById.set(s.ls_id, s);
  let approved_web_rescued = 0;
  for (const [id, c] of citations) {
    if (c.declared_type !== "none") continue;
    const hasUninformative =
      c.citation_errors.includes("uninformative_label") ||
      c.citation_errors.includes("empty_source_type");
    if (!hasUninformative) continue;
    // Hard gates still apply — don't rescue bare-reporter or pipe-artefact failures.
    if (
      c.citation_errors.includes("failed_bare_reporter") ||
      c.citation_errors.includes("journal_pipe_unresolved")
    ) continue;
    // Off-domain stays dropped (we only rescue approved hosts).
    if (c.citation_errors.some((e) => e.startsWith("off_domain:"))) continue;
    const ls = lsById.get(id);
    if (!ls || ls.origin !== "approved_web" || ls.support !== "direct") continue;
    if (!c.canonical_citation || !c.canonical_citation.trim()) continue;
    const inferred = inferDeclaredFromSource(ls);
    if (inferred === "none") continue;
    c.declared_type = inferred;
    // Metadata is thin by definition — keep but mark partial so downstream
    // gates treat it as needing review rather than as a strong canonical.
    if (c.citation_quality === "ok" || c.citation_quality === "needs_review") {
      c.citation_quality = "partial";
    }
    if (!c.citation_errors.includes("approved_web_inferred_type")) {
      c.citation_errors.push("approved_web_inferred_type");
    }
    approved_web_rescued++;
  }

  const decisions = new Map<LedgerSourceId, KeptDecision>();
  const dropped = new Set<LedgerSourceId>();
  const summary = {
    ok: 0, partial: 0, failed: 0, off_domain: 0,
    repeated: 0, legislation_supra_blocked: 0,
    partial_enriched_kept: 0,
    footnote_text_sources: {
      canonical_citation: 0,
      repeated_rule37: 0,
      passthrough_fallback: 0,
    },
  };
  for (const [id, c] of citations) {
    const d = decideKept(c);
    decisions.set(id, d);
    if (!d.kept) {
      dropped.add(id);
      if (d.reason.startsWith("off_domain")) summary.off_domain++;
      else summary.failed++;
    } else {
      if (c.citation_quality === "ok") summary.ok++;
      else summary.partial++;
      if (d.reason === "partial_enriched_accepted") summary.partial_enriched_kept++;
    }
  }

  // Also pre-strip any marker in the answer whose LS is unknown — either not
  // in the ledger or not in the citations map. This prevents the drafter
  // from emitting markers (e.g. [cite:LS23] when only 22 sources exist) that
  // would otherwise leak through as orphan superscripts.
  const ledgerLsIds = new Set<LedgerSourceId>();
  for (const e of ledger.entries) for (const s of e.sources) ledgerLsIds.add(s.ls_id);
  const extraReasons = new Map<LedgerSourceId, string>();
  for (const m of answer.matchAll(CITE_RE)) {
    const id = m[1] as LedgerSourceId;
    if (dropped.has(id)) continue;
    if (!ledgerLsIds.has(id)) {
      dropped.add(id);
      extraReasons.set(id, "unknown_marker_not_in_ledger");
      summary.failed++;
    } else if (!citations.has(id)) {
      dropped.add(id);
      extraReasons.set(id, "unknown_marker_not_in_citations");
      summary.failed++;
    }
  }

  // ─── Phase B: strip dropped markers ───────────────────────────────────
  const { text: cleaned1, removed: removedIds1 } = stripMarkers(answer, dropped);
  const removed_citations: RemovedCitation[] = removedIds1.map((id) => ({
    ls_id: id,
    claim_id: claimIdForLs(id, ledger),
    reason: decisions.get(id)?.reason ?? extraReasons.get(id) ?? "unknown",
  }));

  // Build footnotes — pass 1.
  let bf = buildFootnotes({ answer: cleaned1, citations });

  // Validate every footnote; collect flagged with reasons.
  let flagged_footnotes: FlaggedFootnote[] = [];
  const flaggedLs = new Set<LedgerSourceId>();
  for (const fn of bf.footnotes) {
    const r = validateFootnote(fn, citations.get(fn.ls_id), bf.footnotes);
    if (r) {
      flagged_footnotes.push({ number: fn.number, ls_id: fn.ls_id, reason: r });
      flaggedLs.add(fn.ls_id);
      if (r === "legislation_supra_forbidden") summary.legislation_supra_blocked++;
    }
  }

  // Fixed-point: if any footnote failed validation, strip those LS markers
  // entirely from the answer (single retry pass) and rebuild.
  let cleaned2 = cleaned1;
  if (flaggedLs.size > 0) {
    const r2 = stripMarkers(cleaned1, flaggedLs);
    cleaned2 = r2.text;
    for (const id of r2.removed) {
      removed_citations.push({
        ls_id: id,
        claim_id: claimIdForLs(id, ledger),
        reason: `footnote_invalid:${flagged_footnotes.find((f) => f.ls_id === id)?.reason ?? "unknown"}`,
      });
    }
    bf = buildFootnotes({ answer: cleaned2, citations });
    // Re-validate; anything still bad is reported but markers were already stripped.
    flagged_footnotes = [];
    for (const fn of bf.footnotes) {
      const r = validateFootnote(fn, citations.get(fn.ls_id), bf.footnotes);
      if (r) flagged_footnotes.push({ number: fn.number, ls_id: fn.ls_id, reason: r });
    }
  }

  // Repeated count.
  summary.repeated = bf.footnotes.filter((f) => f.is_repeated).length;
  // Footnote-text-source tally (telemetry; not used for gating).
  for (const f of bf.footnotes) {
    const src = f.footnote_text_source;
    if (src && src in summary.footnote_text_sources) {
      summary.footnote_text_sources[src]++;
    }
  }

  // Lost-support analysis using surviving markers.
  const survivingMarkers = markersInAnswer(cleaned2);
  const claims_lost_all_support = computeLostClaims(ledger, survivingMarkers);

  // Status decision.
  const survivingSupported = ledger.entries.filter((e) => {
    if (e.status !== "supported") return false;
    return e.sources.some((s) => survivingMarkers.includes(s.ls_id));
  }).length;

  let status: CitationQualityStatus = "ok";
  let rendered = bf.rendered_answer;
  if (claims_lost_all_support.length > 0 && survivingSupported < 2) {
    status = "insufficient_verified_sources";
    if (!rendered.includes(INSUFFICIENT_SENTENCE)) {
      rendered = `${INSUFFICIENT_SENTENCE}\n\n${rendered}`.trim();
    }
  } else if (claims_lost_all_support.length > 0) {
    status = "needs_review";
    rendered = `${rendered}\n\nהערה למערכת: הטענות הבאות נותרו ללא אסמכתא לאחר ביקורת איכות: ${claims_lost_all_support.join(", ")}.`;
  }

  return {
    status,
    rendered_answer: rendered,
    footnotes: bf.footnotes,
    marker_to_footnote: bf.marker_to_footnote,
    removed_citations,
    flagged_footnotes,
    claims_lost_all_support,
    citation_summary: summary,
    duration_ms: Date.now() - t0,
  };
}

// Re-export to keep the runner imports tidy.
export type { LedgerEntry };
