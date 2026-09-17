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
  AuthorityPromotionTelemetry,
  EvidenceSource,
  RejectedPair,
  ResearchMemo,
  SupportVerdict,
  VerificationStage,
  VerificationOutcome,
  VerifiedClaim,
  VerifiedSourceRef,
} from "../types.ts";
import type { EvidenceStore } from "../evidence/evidenceStore.ts";
import type { UsageLedger } from "../shared/model.ts";
import { buildSectionVariants, normalizeDocketText } from "../shared/primitives.ts";
import { matchSpan } from "./spanMatch.ts";
import { verifySupport, type SupportInput } from "./supportVerifier.ts";
import {
  isLegalPropositionClaim,
  locatorForOffset,
  userDocumentCitationTitle,
  userDocumentIsAuthority,
} from "../../_shared/userDocumentsCore.ts";

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
 * Only applies where the run carries an explicit identity obligation AND the
 * source claims to be that authority. A source with no identity claim is not
 * rejected here (check 2 and 3 still govern it).
 */
export function checkIdentity(
  source: EvidenceSource,
  expected: ExpectedIdentity,
): IdentityCheck {
  // body_only_identity_v1: a title/filename/discovery label may CLAIM an
  // identity; only the extracted body may CONFIRM it. The title is therefore
  // read for the claim side only and never enters the corroboration text.
  const body = source.extracted_text ?? "";
  const bodyCanonical = source.body_identity?.body_docket_ids ??
    canonicalDocketIdsOf(body);
  for (const docket of expected.dockets) {
    const inTitle = normalizeDocketText(source.title).includes(normalizeDocketText(docket));
    if (!inTitle) continue;
    const expectedIds = canonicalDocketIdsOf(docket);
    const inBody = expectedIds.some((id) => bodyCanonical.includes(id)) ||
      normalizeDocketText(body).includes(normalizeDocketText(docket));
    if (!inBody) {
      return { ok: false, detail: `title claims ${docket} but the body does not contain it` };
    }
    return { ok: true, detail: `docket ${docket} confirmed in body` };
  }
  for (const st of expected.statutes) {
    const claimsStatute = source.title.includes(st.statute);
    if (!claimsStatute) continue;
    if (!body.includes(st.statute)) {
      return { ok: false, detail: `title claims ${st.statute} but the body does not contain it` };
    }
    if (st.section) {
      const variants = buildSectionVariants(st.section);
      const hasSection = variants.some((v) => body.includes(v)) ||
        (source.body_identity?.sections ?? []).includes(st.section);
      if (!hasSection) {
        return { ok: false, detail: `statute body does not contain section ${st.section}` };
      }
    }
    return { ok: true, detail: `statute ${st.statute} confirmed in body` };
  }
  return { ok: true, detail: "no explicit identity claim to contradict" };
}

/**
 * Authority promotion for an uploaded document, from body identity only.
 * Returns the decision plus the telemetry row (never user-facing).
 */
export function assessUserDocumentAuthority(
  source: EvidenceSource,
  expected: ExpectedIdentity,
): { ok: boolean; telemetry: AuthorityPromotionTelemetry } {
  const expected_docket_ids = [
    ...new Set(expected.dockets.flatMap((d) => canonicalDocketIdsOf(d))),
  ];
  const bodyIdentity = source.body_identity ??
    bodyIdentityOf(source.extracted_text ?? "", {
      identity_zone_chars: source.user_document?.page_map?.[0]?.end,
    });
  const decision = userDocumentIsAuthority(bodyIdentity, {
    docket_ids: expected_docket_ids,
    statutes: expected.statutes,
  });
  return {
    ok: decision.ok,
    telemetry: {
      source_id: source.source_id,
      origin: source.origin,
      expected_docket_ids,
      expected_statutes: expected.statutes.map((s) => s.statute),
      primary_docket_ids: bodyIdentity.primary_docket_ids,
      body_docket_ids: bodyIdentity.body_docket_ids,
      identity_zone_chars: bodyIdentity.identity_zone_chars,
      reversed_pdf_detected: bodyIdentity.reversed_pdf_detected,
      accepted: decision.ok,
      reason: decision.reason,
    },
  };
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
  // whether it ended up in the final pack. Observability only — no stage below
  // changes any acceptance decision.
  const per_source: NonNullable<VerificationOutcome["per_source"]> = {};
  const stageOf = (id: string) =>
    per_source[id] ??= { readable: false, identity: false, span: false, support: false };
  const fail = (id: string, stage: VerificationStage, code: string, detail: string) => {
    const st = stageOf(id);
    st.terminal_stage = stage;
    st.rejection_code = code;
    st.rejection_detail = detail.slice(0, 240);
  };

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
        const reason = !source
          ? "unknown_source_id"
          : source.fetch_status !== "ok"
          ? "fetch_failed"
          : source.text_length < 400
          ? "empty_body"
          : "not_actual_document";
        rejected.push({
          claim_id: claim.claim_id,
          source_id: ev.source_id,
          reason,
          detail: body.detail,
          stage: "readable",
        });
        fail(ev.source_id, "readable", reason, body.detail);
        continue;
      }
      const st = stageOf(source.source_id);
      st.readable = true;

      // CHECK 1 — identity.
      const identity = checkIdentity(source, opts.expected);
      st.identity_basis = identity.detail.slice(0, 240);
      if (!identity.ok) {
        rejected.push({
          claim_id: claim.claim_id,
          source_id: ev.source_id,
          reason: "identity_mismatch",
          detail: identity.detail,
          stage: "identity",
        });
        fail(ev.source_id, "identity", "identity_mismatch", identity.detail);
        continue;
      }
      st.identity = true;
      counters.identity_verified_pairs += 1;

      // CHECK 1b — user-document claim type (v2_attachments_v1).
      // A private uploaded file proves what IT says. It becomes legal
      // authority only when its own body corroborates an authority the run
      // explicitly asked about (uploaded judgment / statute). The filename
      // never qualifies, and no gate below is relaxed for attachments.
      if (source.origin === "user_document" && isLegalPropositionClaim(claim.proposition)) {
        const authority = userDocumentIsAuthority(source.identity_fields, opts.expected);
        if (!authority) {
          const detail = "private user document cannot establish a proposition of law";
          rejected.push({
            claim_id: claim.claim_id,
            source_id: ev.source_id,
            reason: "user_document_not_legal_authority",
            detail,
            stage: "identity",
          });
          fail(ev.source_id, "identity", "user_document_not_legal_authority", detail);
          continue;
        }
      }

      // CHECK 3 — verbatim span.
      const span = matchSpan(source.extracted_text, ev.quoted_span);
      if (!span.matched) {
        const reason = span.status === "too_short" ? "span_too_short" : "span_not_found";
        rejected.push({
          claim_id: claim.claim_id,
          source_id: ev.source_id,
          reason,
          detail: span.detail,
          stage: "span",
        });
        fail(ev.source_id, "span", reason, span.detail);
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
      const detail = error ?? "no verdict returned for this pair";
      rejected.push({
        claim_id: s.claim_id,
        source_id: s.source.source_id,
        reason: "verifier_unavailable",
        detail,
        stage: "support",
      });
      fail(s.source.source_id, "support", "verifier_unavailable", detail);
      continue;
    }
    counters.support_verdicts[v.support] += 1;
    if (v.support === "does_not_support") {
      rejected.push({
        claim_id: s.claim_id,
        source_id: s.source.source_id,
        reason: "support_does_not_support",
        detail: v.reason,
        stage: "support",
      });
      fail(s.source.source_id, "support", "support_does_not_support", v.reason);
      continue;
    }
    stageOf(s.source.source_id).support = true;

    const list = byClaim.get(s.claim_id) ?? [];
    const ud = s.source.user_document;
    // User documents cite as "<file title> שצורף, עמ' N" with a deterministic
    // page/section locator and no expiring signed URL.
    const isUploadedAuthority = !!ud &&
      userDocumentIsAuthority(s.source.identity_fields, opts.expected);
    list.push({
      source_id: s.source.source_id,
      display_title: ud && !isUploadedAuthority
        ? userDocumentCitationTitle(ud.file_name)
        : s.source.title,
      url: ud ? undefined : s.source.url,
      verified_span: s.span,
      locator: ud
        ? locatorForOffset(
          { kind: ud.kind, pages: ud.page_map.map((p) => ({ ...p, text: "" })) },
          s.source.extracted_text.indexOf(s.span),
        ) ?? s.locator
        : s.locator,
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
