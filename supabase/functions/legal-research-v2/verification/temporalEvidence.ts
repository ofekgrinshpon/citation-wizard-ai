/**
 * legal-research-v2 — claim-specific temporal evidence selection.
 *
 * The temporal stage used to be shown a bounded PREFIX of up to four
 * current-law-capable documents. For a long statute the relevant provision can
 * sit 50k characters deep, so a section that was already span-verified looked
 * "absent from the supplied text" and the claim was gated as
 * `temporal_unresolved` (Batch 3 / Q29, סעיף 7ג of חוק רישוי עסקים).
 *
 * This module selects, per claim, the text the verifier actually relied on:
 * the verified span (with a little surrounding context), plus the located
 * statute-section window when the claim names a section, and only then a
 * bounded prefix. It does NOT decide temporal status and does NOT relax any
 * gate — it only fixes WHICH text the temporal model reads.
 */

import type { EvidenceSource, VerifiedClaim } from "../types.ts";
import type { EvidenceStore } from "../evidence/evidenceStore.ts";
import { locateSection, normalizeSectionToken } from "../evidence/sectionLocator.ts";
import { isCurrentLawCapable } from "./temporalValidity.ts";

export const TEMPORAL_EVIDENCE_LIMITS = {
  /** Supporting sources inspected per claim. */
  MAX_SOURCES_PER_CLAIM: 3,
  /** Excerpts handed to the model per claim. */
  MAX_EXCERPTS_PER_CLAIM: 6,
  /** Hard ceiling per excerpt — a full body is never injected. */
  MAX_CHARS_PER_EXCERPT: 2_500,
  /** Context kept around a verified span. */
  SPAN_CONTEXT: 700,
  /** Section window requested from the locator. */
  SECTION_WINDOW: 1_800,
  /** Section tokens resolved per claim. */
  MAX_SECTIONS_PER_CLAIM: 2,
  /** Fallback prefix when no claim-specific text exists. */
  PREFIX_CHARS: 2_500,
};

export type TemporalExcerptKind = "verified_span" | "statute_section" | "source_prefix";

export interface TemporalExcerpt {
  source_id: string;
  title: string;
  url?: string;
  kind: TemporalExcerptKind;
  /** Section token when `kind === "statute_section"`. */
  section?: string;
  text: string;
}

export interface ClaimTemporalEvidence {
  claim_id: string;
  excerpts: TemporalExcerpt[];
  /** Sources actually represented in `excerpts`. */
  source_ids: string[];
  /** True when nothing claim-specific was available and a prefix was used. */
  fallback_prefix: boolean;
}

const SECTION_RE = /סעיף\s*(\d{1,3}[א-ת]?(?:\s*\([^)]{1,4}\))?)/gu;

/** Statute section tokens named by a claim ("סעיף 7ג", "סעיף 13(א)"). */
export function extractSectionTokens(text: string): string[] {
  const out: string[] = [];
  for (const m of String(text ?? "").matchAll(SECTION_RE)) {
    const token = normalizeSectionToken(m[1]);
    if (token && !out.includes(token)) out.push(token);
  }
  return out;
}

function clip(text: string, max = TEMPORAL_EVIDENCE_LIMITS.MAX_CHARS_PER_EXCERPT): string {
  const t = (text ?? "").trim();
  return t.length > max ? t.slice(0, max) : t;
}

/** The verified span plus a little surrounding body context, when locatable. */
function spanExcerpt(source: EvidenceSource, span: string): string {
  const body = source.extracted_text ?? "";
  const raw = (span ?? "").trim();
  if (!raw) return "";
  const idx = body.indexOf(raw);
  if (idx < 0) return clip(raw);
  const pad = TEMPORAL_EVIDENCE_LIMITS.SPAN_CONTEXT;
  const from = Math.max(0, idx - pad);
  const to = Math.min(body.length, idx + raw.length + pad);
  return clip(body.slice(from, to));
}

/** Bounded prefix of a source — the old behaviour, kept as last resort only. */
export function prefixExcerpt(source: EvidenceSource): TemporalExcerpt {
  return {
    source_id: source.source_id,
    title: source.title,
    url: source.url,
    kind: "source_prefix",
    text: clip(source.extracted_text ?? "", TEMPORAL_EVIDENCE_LIMITS.PREFIX_CHARS),
  };
}

/**
 * Build the bounded temporal evidence packet for ONE claim, from the sources
 * that actually supported it. Returns an empty packet when the claim has no
 * current-law-capable supporting source — the caller then falls back.
 */
export function buildClaimTemporalEvidence(
  claim: VerifiedClaim,
  store: EvidenceStore,
): ClaimTemporalEvidence {
  const excerpts: TemporalExcerpt[] = [];
  const sourceIds: string[] = [];
  const sections = extractSectionTokens(claim.proposition).slice(
    0,
    TEMPORAL_EVIDENCE_LIMITS.MAX_SECTIONS_PER_CLAIM,
  );

  const refs = (claim.sources ?? []).slice(0, TEMPORAL_EVIDENCE_LIMITS.MAX_SOURCES_PER_CLAIM);
  for (const ref of refs) {
    const source = store.get(ref.source_id);
    if (!source || !isCurrentLawCapable(source)) continue;

    const local: TemporalExcerpt[] = [];
    const tokens = sections.length
      ? sections
      : extractSectionTokens(ref.locator ?? "").slice(
        0,
        TEMPORAL_EVIDENCE_LIMITS.MAX_SECTIONS_PER_CLAIM,
      );

    for (const token of tokens) {
      const located = locateSection(source.extracted_text ?? "", token, {
        window: TEMPORAL_EVIDENCE_LIMITS.SECTION_WINDOW,
        max: 1,
      });
      if (located.found && located.windows.length) {
        local.push({
          source_id: source.source_id,
          title: source.title,
          url: source.url,
          kind: "statute_section",
          section: located.section,
          text: clip(located.windows[0]),
        });
      }
    }

    const span = spanExcerpt(source, ref.verified_span);
    if (span) {
      local.push({
        source_id: source.source_id,
        title: source.title,
        url: source.url,
        kind: "verified_span",
        text: span,
      });
    }

    if (local.length) {
      excerpts.push(...local);
      if (!sourceIds.includes(source.source_id)) sourceIds.push(source.source_id);
    }
  }

  return {
    claim_id: claim.claim_id,
    excerpts: excerpts.slice(0, TEMPORAL_EVIDENCE_LIMITS.MAX_EXCERPTS_PER_CLAIM),
    source_ids: sourceIds,
    fallback_prefix: false,
  };
}

/** Render one claim's packet for the model — claim_id → its own excerpts only. */
export function renderClaimEvidence(ev: ClaimTemporalEvidence): string {
  const rows = ev.excerpts.map((e) => {
    const label = e.kind === "statute_section"
      ? `סעיף ${e.section} מתוך המקור`
      : e.kind === "verified_span"
      ? "קטע מאומת מתוך המקור"
      : "פתיח המקור";
    return `[${label}] מקור ${e.source_id} | ${e.title.slice(0, 120)} | ${e.url ?? ""}\n${e.text}`;
  });
  return rows.join("\n\n");
}
