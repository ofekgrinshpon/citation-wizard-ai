/**
 * legal-research-v2 — deterministic Source Renderer.
 *
 * Source search terminates HERE instead of in the answer drafter: the pack is
 * assembled deterministically from the evidence store, the verification
 * outcome and the agent's own memo. No prose answer is generated.
 */

import type {
  EvidenceSource,
  ResearchMemo,
  SearchResult,
  VerificationOutcome,
} from "../types.ts";
import {
  classifySourceGroup,
  SOURCE_GROUP_LABELS_HE,
  SOURCE_GROUP_ORDER,
  type SourceGroupKey,
  sourceTypeLabelHe,
} from "./grouping.ts";
import { normalizeUrlKey } from "../evidence/evidenceStore.ts";

export interface PackSource {
  source_id: string;
  title: string;
  url?: string;
  group: SourceGroupKey;
  source_type_he: string;
  jurisdiction_he: string | null;
  identifier: string | null;
  origin_he: "מאגר מקומי" | "רשת";
  reason_he: string;
  excerpt: string | null;
  /** Body was read and its identity established. Always true in this list. */
  verified: true;
  span_verified: boolean;
  state_he: string;
}

export interface PackLead {
  title: string;
  url?: string;
  group: SourceGroupKey;
  source_type_he: string;
  origin_he: "מאגר מקומי" | "רשת";
  note_he: string;
}

export interface SourceGroupView {
  key: SourceGroupKey;
  label_he: string;
  sources: PackSource[];
}

export interface SourcePack {
  mode: "sources";
  question: string;
  run_id: string;
  recommended: PackSource[];
  groups: SourceGroupView[];
  leads: PackLead[];
  summary: {
    discovered: number;
    fetched: number;
    readable: number;
    recommended: number;
    leads: number;
  };
  unresolved_questions: string[];
}

function originHe(origin: string): "מאגר מקומי" | "רשת" {
  return /corpus|local/i.test(origin) ? "מאגר מקומי" : "רשת";
}

function identifierOf(src: EvidenceSource): string | null {
  const d = src.identity_fields?.dockets?.[0];
  if (d) return d;
  const s = src.identity_fields?.statutes?.[0];
  const sec = src.identity_fields?.sections?.[0];
  if (s) return sec ? `${s}, סעיף ${sec}` : s;
  return null;
}

function jurisdictionOf(src: EvidenceSource): string | null {
  const url = src.url ?? "";
  if (/\.il(\/|$|:)/.test(url) || /\.il$/.test(safeHost(url))) return "ישראל";
  if (src.identity_fields?.dockets?.length || src.identity_fields?.statutes?.length) return "ישראל";
  if (!url) return null;
  return "משפט משווה / זר";
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function trimReason(text: string, max = 260): string {
  const t = (text || "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Deterministic ordering:
 *   1. the agent's own ordering of the sources it relied on (relevance judgment);
 *   2. span-verified before identity-only;
 *   3. stable source_id order.
 * A verified/readable source can never fall below an unverified lead: leads
 * live in a separate list entirely.
 */
export function buildSourcePack(input: {
  run_id: string;
  question: string;
  sources: EvidenceSource[];
  verification: VerificationOutcome | null;
  memo: ResearchMemo | null;
  discovered: SearchResult[];
}): SourcePack {
  const { sources, verification, memo } = input;
  const per = verification?.per_source ?? {};

  // Agent relevance order + reason text, taken from the memo it submitted.
  const agentOrder = new Map<string, number>();
  const agentReason = new Map<string, string>();
  let n = 0;
  for (const claim of memo?.claims ?? []) {
    for (const ev of claim.evidence ?? []) {
      if (!agentOrder.has(ev.source_id)) agentOrder.set(ev.source_id, n++);
      if (!agentReason.has(ev.source_id)) {
        agentReason.set(ev.source_id, ev.reason?.trim() || claim.proposition);
      }
    }
  }

  // Verified spans, per source (only a span that the verifier matched against
  // the stored body may ever be displayed as a verbatim excerpt).
  const verifiedSpan = new Map<string, string>();
  for (const c of verification?.pack.claims ?? []) {
    for (const s of c.sources) {
      if (!verifiedSpan.has(s.source_id) && s.verified_span) {
        verifiedSpan.set(s.source_id, s.verified_span);
      }
    }
  }

  const readable = sources.filter((s) => s.fetch_status === "ok" && s.is_actual_document);

  const recommended: PackSource[] = readable
    .filter((s) => {
      const st = per[s.source_id];
      // Admission: read body + established identity + an agent relevance
      // statement. Never an unread search result.
      return !!st?.identity && (agentReason.has(s.source_id) || verifiedSpan.has(s.source_id));
    })
    .map((s) => {
      const group = classifySourceGroup({
        title: s.title,
        url: s.url,
        identity: s.identity_fields,
      });
      const span = verifiedSpan.get(s.source_id) ?? null;
      return {
        source_id: s.source_id,
        title: s.title,
        url: s.url,
        group,
        source_type_he: sourceTypeLabelHe(group),
        jurisdiction_he: jurisdictionOf(s),
        identifier: identifierOf(s),
        origin_he: originHe(s.origin),
        reason_he: trimReason(agentReason.get(s.source_id) ?? ""),
        excerpt: span ? trimReason(span, 320) : null,
        verified: true as const,
        span_verified: !!span,
        state_he: span ? "נקרא ואומת ציטוט" : "נקרא ואומת מזהה",
      };
    })
    .sort((a, b) => {
      const ao = agentOrder.get(a.source_id) ?? 9999;
      const bo = agentOrder.get(b.source_id) ?? 9999;
      if (ao !== bo) return ao - bo;
      if (a.span_verified !== b.span_verified) return a.span_verified ? -1 : 1;
      return a.source_id.localeCompare(b.source_id, "en", { numeric: true });
    });

  // ── Leads: discovered but not established as read sources ───────────────
  const usedKeys = new Set<string>();
  for (const s of sources) if (s.url) usedKeys.add(normalizeUrlKey(s.url));
  for (const r of recommended) if (r.url) usedKeys.add(normalizeUrlKey(r.url));

  const leads: PackLead[] = [];
  const seenLead = new Set<string>();
  for (const d of input.discovered) {
    const key = d.url ? normalizeUrlKey(d.url) : `t:${d.title}`;
    if (!d.title || usedKeys.has(key) || seenLead.has(key)) continue;
    seenLead.add(key);
    const group = classifySourceGroup({ title: d.title, url: d.url });
    leads.push({
      title: d.title,
      url: d.url,
      group,
      source_type_he: sourceTypeLabelHe(group),
      origin_he: originHe(d.origin),
      note_he: "אותר בחיפוש, לא נקרא ולא אומת",
    });
    if (leads.length >= 12) break;
  }
  // Sources that were fetched but did not yield a usable document are also
  // honest leads — explicitly labelled as such, never as verified sources.
  for (const s of sources) {
    if (leads.length >= 15) break;
    if (s.fetch_status === "ok" && s.is_actual_document) continue;
    const key = s.url ? normalizeUrlKey(s.url) : `t:${s.title}`;
    if (seenLead.has(key)) continue;
    seenLead.add(key);
    const group = classifySourceGroup({ title: s.title, url: s.url });
    leads.push({
      title: s.title,
      url: s.url,
      group,
      source_type_he: sourceTypeLabelHe(group),
      origin_he: originHe(s.origin),
      note_he: "נוסה אחזור, לא התקבל טקסט שמיש",
    });
  }

  const groups: SourceGroupView[] = SOURCE_GROUP_ORDER
    .map((key) => ({
      key,
      label_he: SOURCE_GROUP_LABELS_HE[key],
      sources: recommended.filter((s) => s.group === key),
    }))
    .filter((g) => g.sources.length > 0);

  return {
    mode: "sources",
    question: input.question,
    run_id: input.run_id,
    recommended,
    groups,
    leads,
    summary: {
      discovered: (() => {
        const keys = new Set<string>();
        for (const d of input.discovered) keys.add(d.url ? normalizeUrlKey(d.url) : `t:${d.title}`);
        for (const x of sources) keys.add(x.url ? normalizeUrlKey(x.url) : `t:${x.title}`);
        return keys.size;
      })(),
      fetched: sources.length,
      readable: readable.length,
      recommended: recommended.length,
      leads: leads.length,
    },
    unresolved_questions: memo?.unresolved_questions ?? [],
  };
}
