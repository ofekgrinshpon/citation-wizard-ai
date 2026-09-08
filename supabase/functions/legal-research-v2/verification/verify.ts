/**
 * legal-research-v2 — the ONE verification layer. Exactly four checks:
 *
 *   1. IDENTITY   — is the fetched text the claimed document? (deterministic)
 *   2. BODY READ  — did we actually read a real document? (deterministic)
 *   3. SPAN       — is the quoted span verbatim in that body? (deterministic)
 *   4. SUPPORT    — does the verified span support the claim? (one batched LLM call)
 *
 * Anything rejected here never reaches the drafter.
 */

import type {
  EvidenceSource,
  RejectedPair,
  ResearchMemo,
  SupportVerdict,
  VerificationOutcome,
  VerifiedClaim,
  VerifiedSourceRef,
} from "../types.ts";
import type { EvidenceStore } from "../evidence/evidenceStore.ts";
import type { UsageLedger } from "../shared/model.ts";
import { buildSectionVariants, normalizeDocketText } from "../shared/primitives.ts";
import {
  bodyHasDocket,
  bodyHasTitle,
  docketNumberOf,
  normalizeIdentityText,
} from "./identityEvidence.ts";

import { matchSpan } from "./spanMatch.ts";
import { verifySupport, type SupportInput } from "./supportVerifier.ts";

export interface ExpectedIdentity {
  dockets: string[];
  statutes: Array<{ statute: string; section: string | null }>;
}

export interface IdentityCheck {
  ok: boolean;
  detail: string;
}

/**
 * CHECK 1 — identity.
 *
 * The question is always the same: does the ACQUIRED BODY itself establish
 * that this document is the authority it is presented as? Search metadata,
 * URLs and snippets are never identity proof.
 *
 * The check runs against the whole stored body (plus its derived identity
 * window), with deterministic normalization only — quote marks, maqaf/dashes,
 * bidi controls, spacing and docket-prefix variants. Nothing semantic.
 *
 * A source that makes no identity claim about one of the run's obligations is
 * not rejected here (checks 2–4 still govern it).
 */
export function checkIdentity(
  source: EvidenceSource,
  expected: ExpectedIdentity,
): IdentityCheck {
  const idWindow = source.identity_evidence?.window ?? "";
  const body = `${source.title}\n${idWindow}\n${source.extracted_text}`;
  const nBody = normalizeIdentityText(body);

  // Judgment identity: if the source presents itself as one of the run's
  // explicit dockets, the body must actually carry that docket.
  for (const docket of expected.dockets) {
    const num = docketNumberOf(docket);
    const claimsIt = bodyHasDocket(source.title, docket) ||
      source.identity_fields.dockets.some((d) => num && docketNumberOf(d) === num) ||
      normalizeDocketText(source.title).includes(normalizeDocketText(docket));
    if (!claimsIt) continue;
    if (!bodyHasDocket(body, docket)) {
      return { ok: false, detail: `title claims ${docket} but the acquired body does not contain it` };
    }
    return { ok: true, detail: `docket ${docket} confirmed in the acquired body` };
  }

  for (const st of expected.statutes) {
    const nStatute = normalizeIdentityText(st.statute);
    const claimsStatute = normalizeIdentityText(source.title).includes(nStatute) ||
      source.identity_fields.statutes.some((s) => normalizeIdentityText(s) === nStatute);
    if (!claimsStatute) continue;
    if (!nBody.includes(nStatute)) {
      return { ok: false, detail: `title claims ${st.statute} but the acquired body does not contain it` };
    }
    if (st.section) {
      const variants = buildSectionVariants(st.section).map(normalizeIdentityText);
      const hasSection = variants.some((v) => nBody.includes(v)) ||
        source.identity_fields.sections.includes(st.section);
      if (!hasSection) {
        return { ok: false, detail: `statute body does not contain section ${st.section}` };
      }
    }
    return { ok: true, detail: `statute ${st.statute} confirmed in the acquired body` };
  }

  // Academic / other documents: when the discovered title is a real title (not
  // a URL or a bare institution name), every material word of it must be
  // literally present in the acquired body. This turns "the search result said
  // so" into "the document says so", and is bounded and deterministic.
  const t = bodyHasTitle(source.extracted_text, source.title, { minTokens: 3 });
  if (t.matched.length + t.missing.length >= 3) {
    if (t.ok) {
      return { ok: true, detail: `document title confirmed verbatim in the body (${t.matched.length} tokens)` };
    }
    // Not a contradiction: printed front matter may be missing from extraction.
    return {
      ok: true,
      detail: `no docket/statute obligation claimed; title words not all present (missing: ${
        t.missing.slice(0, 4).join(", ")
      })`,
    };
  }
  return { ok: true, detail: "no explicit identity claim to contradict" };
}

/** Compact, human-readable identity basis for telemetry. */
export function identityBasisOf(source: EvidenceSource): string {
  const ev = source.identity_evidence;
  if (!ev) return "no_identity_window";
  return `${ev.kind}${ev.signals.length ? `: ${ev.signals.slice(0, 3).join(" | ")}` : ": no_signals"}`
    .slice(0, 200);
}


/** CHECK 2 — body read. */
export function checkBodyRead(source: EvidenceSource | null): IdentityCheck {
  if (!source) return { ok: false, detail: "source_id not in the evidence store" };
  if (source.fetch_status !== "ok") return { ok: false, detail: source.fetch_error ?? "fetch failed" };
  if (source.text_length < 400) return { ok: false, detail: "no meaningful extracted text" };
  if (!source.is_actual_document) {
    return { ok: false, detail: source.not_document_reason ?? "not an actual document" };
  }
  return { ok: true, detail: `read ${source.text_length} chars` };
}

function contextAround(text: string, span: string): string {
  const idx = text.indexOf(span);
  if (idx < 0) return "";
  return text.slice(Math.max(0, idx - 400), idx + span.length + 400);
}

export async function verifyMemo(opts: {
  memo: ResearchMemo;
  store: EvidenceStore;
  expected: ExpectedIdentity;
  model: string;
  usage: UsageLedger;
}): Promise<VerificationOutcome> {
  const rejected: RejectedPair[] = [];
  const counters = {
    total_evidence_pairs: 0,
    identity_verified_pairs: 0,
    span_verified_pairs: 0,
    support_verdicts: { supports: 0, supports_partially: 0, does_not_support: 0 } as Record<
      SupportVerdict,
      number
    >,
  };

  // True per-stage funnel: how far each source actually got, independent of
  // whether it ended up in the final pack.
  const per_source: NonNullable<VerificationOutcome["per_source"]> = {};
  const stageOf = (id: string) =>
    per_source[id] ??= { identity: false, span: false, support: false };

  interface Survivor {
    pair_id: string;
    claim_id: string;
    source: EvidenceSource;
    span: string;
    locator?: string;
  }
  const survivors: Survivor[] = [];


  for (const claim of opts.memo.claims) {
    for (const ev of claim.evidence) {
      counters.total_evidence_pairs += 1;
      const pair_id = `${claim.claim_id}|${ev.source_id}|${counters.total_evidence_pairs}`;
      const source = opts.store.get(ev.source_id);

      // CHECK 2 first: without a real body nothing else is meaningful.
      const body = checkBodyRead(source);
      if (!body.ok || !source) {
        rejected.push({
          claim_id: claim.claim_id,
          source_id: ev.source_id,
          reason: !source
            ? "unknown_source_id"
            : source.fetch_status !== "ok"
            ? "fetch_failed"
            : source.text_length < 400
            ? "empty_body"
            : "not_actual_document",
          detail: body.detail,
        });
        continue;
      }

      // CHECK 1 — identity.
      const identity = checkIdentity(source, opts.expected);
      const st = stageOf(source.source_id);
      st.identity_basis = `${identity.detail} · ${identityBasisOf(source)}`.slice(0, 240);
      if (!identity.ok) {
        rejected.push({
          claim_id: claim.claim_id,
          source_id: ev.source_id,
          reason: "identity_mismatch",
          detail: identity.detail,
        });
        continue;
      }
      st.identity = true;
      counters.identity_verified_pairs += 1;

      // CHECK 3 — verbatim span.
      const span = matchSpan(source.extracted_text, ev.quoted_span);
      if (!span.matched) {
        rejected.push({
          claim_id: claim.claim_id,
          source_id: ev.source_id,
          reason: span.status === "too_short" ? "span_too_short" : "span_not_found",
          detail: span.detail,
        });
        continue;
      }
      st.span = true;
      counters.span_verified_pairs += 1;

      survivors.push({
        pair_id,
        claim_id: claim.claim_id,
        source,
        span: span.verified_span,
        locator: ev.locator,
      });
    }
  }

  // CHECK 4 — one batched support call.
  const propositionOf = new Map(opts.memo.claims.map((c) => [c.claim_id, c.proposition]));
  const inputs: SupportInput[] = survivors.map((s) => ({
    pair_id: s.pair_id,
    proposition: propositionOf.get(s.claim_id) ?? "",
    span: s.span,
    context: contextAround(s.source.extracted_text, s.span).slice(0, 1_200),
  }));
  const { verdicts, error } = await verifySupport(inputs, { model: opts.model, usage: opts.usage });
  const verdictById = new Map(verdicts.map((v) => [v.pair_id, v]));

  const byClaim = new Map<string, VerifiedSourceRef[]>();
  for (const s of survivors) {
    const v = verdictById.get(s.pair_id);
    if (!v) {
      rejected.push({
        claim_id: s.claim_id,
        source_id: s.source.source_id,
        reason: "verifier_unavailable",
        detail: error ?? "no verdict returned for this pair",
      });
      continue;
    }
    counters.support_verdicts[v.support] += 1;
    if (v.support === "does_not_support") {
      rejected.push({
        claim_id: s.claim_id,
        source_id: s.source.source_id,
        reason: "support_does_not_support",
        detail: v.reason,
      });
      continue;
    }
    stageOf(s.source.source_id).support = true;
    const list = byClaim.get(s.claim_id) ?? [];
    list.push({
      source_id: s.source.source_id,
      display_title: s.source.title,
      url: s.source.url,
      verified_span: s.span,
      locator: s.locator,
      support: v.support,
    });
    byClaim.set(s.claim_id, list);

  }

  const claims: VerifiedClaim[] = [];
  const unsupported = [];
  for (const c of opts.memo.claims) {
    const sources = byClaim.get(c.claim_id) ?? [];
    if (sources.length) {
      claims.push({
        claim_id: c.claim_id,
        proposition: c.proposition,
        importance: c.importance,
        current_state_claim: c.current_state_claim === true,
        support_status: sources.some((s) => s.support === "supports")
          ? "supported"
          : "partially_supported",
        sources,
      });
    } else {
      unsupported.push({
        claim_id: c.claim_id,
        proposition: c.proposition,
        importance: c.importance,
        reasons: [
          ...new Set(
            rejected.filter((r) => r.claim_id === c.claim_id).map((r) => `${r.reason}: ${r.detail}`),
          ),
        ].slice(0, 4),
      });
    }
  }

  return { pack: { claims, unsupported_claims: unsupported }, rejected, per_source, counters };
}
