/**
 * legal-research-v2 — bounded authority acquisition.
 *
 * One job: once the agent has decided WHICH authority it needs, make a small,
 * deterministic, bounded effort to obtain a real usable body for it — instead
 * of relying on the model to remember search results and hand-recover from
 * failed URLs.
 *
 * What this module is NOT:
 *   • not a ranking layer  — candidate order is stable and provenance-based;
 *   • not a source tier    — no domains, no allowlists, no quality scoring;
 *   • not a new budget     — every attempt consumes the ordinary fetch budget;
 *   • not an admission path — every body still goes through `runFetch`, with
 *     the same safety, document, identity and corroboration gates. Discovery
 *     stays broad; evidence admission stays exactly as strict as before.
 *
 * Hard ceilings, persisted per authority for the whole run:
 *   MAX_CONCRETE_ATTEMPTS_PER_AUTHORITY concrete attempts, and
 *   MAX_DISCOVERY_REFRESHES_PER_AUTHORITY targeted discovery refresh.
 */

import type { SearchResult } from "../types.ts";
import type { EvidenceStore } from "../evidence/evidenceStore.ts";
import {
  AcquisitionLedger,
  MAX_CONCRETE_ATTEMPTS_PER_AUTHORITY,
  type TargetCandidate,
} from "./acquisitionLedger.ts";
import { runFetch, type FetchOutput } from "./fetch.ts";
import { isSafeFetchUrl } from "../shared/urlSafety.ts";
import { classifyCandidateUrlShape } from "../shared/urlShape.ts";
import { locateSection, normalizeSectionToken } from "../evidence/sectionLocator.ts";
import { textCarriesDocket } from "./localCorpusBody.ts";
import { normalizeAuthorityText, statuteCoreName } from "./authorityCorroboration.ts";
import type { SupabaseClient } from "../shared/primitives.ts";

export type AcquireStatus =
  | "acquired"
  | "already_acquired"
  | "needs_discovery"
  | "exhausted"
  | "fetch_budget_exhausted"
  | "target_not_found";

export interface AcquireAttemptRecord {
  candidate: string;
  outcome: "acquired" | "failed" | "skipped";
  reason: string;
}

export interface AcquireAuthorityOutput {
  ok: boolean;
  authority_key: string;
  status: AcquireStatus;
  source_id?: string;
  basis?: string;
  title?: string;
  summary?: string;
  windows?: string[];
  exact_source_text?: Array<{ quote_id: string; text: string }>;
  attempts_used: number;
  attempts_remaining: number;
  discovery_refresh_available: boolean;
  tried: AcquireAttemptRecord[];
  instruction?: string;
}

/** Counters the agent folds into run telemetry. Nothing branches on them. */
export interface AcquisitionStats {
  authority_targets_opened: number;
  authority_candidates_attached: number;
  authority_concrete_attempts: number;
  authority_discovery_refreshes: number;
  authority_targets_acquired: number;
  authority_targets_exhausted: number;
  authority_candidates_skipped_attempted: number;
  authority_candidates_skipped_discovery_entry: number;
  authority_parent_statute_reuse: number;
  authority_section_from_parent: number;
  authority_identity_conflicts: number;
  authority_memo_gate_used: number;
}

export function emptyAcquisitionStats(): AcquisitionStats {
  return {
    authority_targets_opened: 0,
    authority_candidates_attached: 0,
    authority_concrete_attempts: 0,
    authority_discovery_refreshes: 0,
    authority_targets_acquired: 0,
    authority_targets_exhausted: 0,
    authority_candidates_skipped_attempted: 0,
    authority_candidates_skipped_discovery_entry: 0,
    authority_parent_statute_reuse: 0,
    authority_section_from_parent: 0,
    authority_identity_conflicts: 0,
    authority_memo_gate_used: 0,
  };
}

export interface AcquireDeps {
  store: EvidenceStore;
  discovered: Map<string, SearchResult>;
  ledger: AcquisitionLedger;
  admin?: SupabaseClient;
  /** Run-wide fetch budget: may another acquisition be started at all? */
  canFetch: () => boolean;
  /** Consume one unit of the ordinary run-wide fetch budget. */
  noteFetch: () => void;
  stats?: AcquisitionStats;
  /** Test seam. Production always uses the real `runFetch`. */
  fetchImpl?: typeof runFetch;
  /** Cap for this single call. Never raises the per-authority ceiling. */
  maxAttempts?: number;
}

// ─── candidate classification / attachment ──────────────────────────────────

/** Is this candidate a concrete document we may spend an attempt on? */
export function isConcreteCandidate(c: TargetCandidate | SearchResult): boolean {
  const kind = (c as TargetCandidate).candidate_kind;
  if (kind === "discovery_entry") return false;
  if ((c as TargetCandidate).local_document_id) return true;
  const url = (c as TargetCandidate).url;
  if (!url) return false;
  return classifyCandidateUrlShape(url) === "concrete_document";
}

function originOfResult(r: SearchResult): TargetCandidate["origin"] {
  if (r.local_document_id) return "local_corpus";
  if (r.origin?.startsWith("perplexity:raw_web")) return "raw_web";
  if (r.origin === "lookup:derived" || r.origin?.includes("derived")) return "derived";
  return "search";
}

export function candidateFromResult(r: SearchResult, basis: string): TargetCandidate {
  return {
    result_id: r.result_id,
    url: r.url,
    label: r.title,
    local_document_id: r.local_document_id,
    candidate_kind: r.local_document_id ? "local_document" : (r.candidate_kind ?? "document"),
    origin: originOfResult(r),
    attach_basis: basis,
  };
}

/** Does this discovery result carry the identity signal of the target? */
export function resultMatchesTarget(
  r: SearchResult,
  target: { authority_key: string; expected_identity?: { docket?: string; statute?: string } },
): string | null {
  if (r.authority_key && r.authority_key === target.authority_key) return "provenance";
  const hay = `${r.title ?? ""} ${r.snippet ?? ""}`;
  const docket = target.expected_identity?.docket ??
    (target.authority_key.startsWith("case:") ? target.authority_key.slice(5) : undefined);
  if (docket) {
    if (r.possible_docket && textCarriesDocket(r.possible_docket, docket)) return "docket_signal";
    return textCarriesDocket(hay, docket) ? "docket_signal" : null;
  }
  const statute = target.expected_identity?.statute ??
    (target.authority_key.startsWith("statute:")
      ? target.authority_key.slice(8).split("#")[0]
      : undefined);
  if (statute) {
    const core = statuteCoreName(statute);
    if (core.length >= 4 && normalizeAuthorityText(hay).includes(normalizeAuthorityText(core))) {
      return "statute_name_signal";
    }
  }
  return null;
}

/**
 * Link freshly discovered results to acquisition targets.
 *
 * `forAuthority` is an explicit statement by the agent that the search was run
 * for that target: concrete results are then linked in order, identity matches
 * first. Without it, a result is linked only when it actually carries the
 * target's docket / statute name, or was produced while resolving it.
 */
export function attachDiscoveryResults(
  ledger: AcquisitionLedger,
  results: SearchResult[],
  opts: { forAuthority?: string; basis?: string; stats?: AcquisitionStats } = {},
): { attached: number; targets: string[]; unknown_target?: string } {
  const concrete = results.filter((r) => isConcreteCandidate(r));
  const touched = new Set<string>();
  let attached = 0;

  const link = (key: string, rs: Array<{ r: SearchResult; basis: string }>) => {
    const n = ledger.attachCandidates(key, rs.map(({ r, basis }) => candidateFromResult(r, basis)));
    if (n > 0) {
      attached += n;
      touched.add(key);
    }
  };

  if (opts.forAuthority) {
    const target = ledger.target(opts.forAuthority);
    if (!target) return { attached: 0, targets: [], unknown_target: opts.forAuthority };
    const ranked = concrete
      .map((r) => ({ r, match: resultMatchesTarget(r, target) }))
      .map((x, i) => ({ ...x, i }))
      .sort((a, b) => (a.match ? 0 : 1) - (b.match ? 0 : 1) || a.i - b.i)
      .map(({ r, match }) => ({ r, basis: match ? `for_authority+${match}` : "for_authority" }));
    link(opts.forAuthority, ranked);
  } else {
    for (const t of ledger.unresolvedTargets()) {
      const matched = concrete
        .map((r) => ({ r, match: resultMatchesTarget(r, t) }))
        .filter((x) => !!x.match)
        .map(({ r, match }) => ({ r, basis: match! }));
      if (matched.length) link(t.authority_key, matched);
    }
  }
  if (opts.stats) opts.stats.authority_candidates_attached += attached;
  return { attached, targets: [...touched] };
}

// ─── parent statute reuse ───────────────────────────────────────────────────

function parentStatuteKey(key: string): string | null {
  if (!key.startsWith("statute:")) return null;
  const i = key.indexOf("#");
  return i > 0 ? key.slice(0, i) : null;
}

/**
 * A section target can be satisfied from an already acquired parent statute
 * body — but only when the section is ACTUALLY found in that body. A missing
 * section stays unresolved; nothing is inferred and nothing is faked.
 */
function trySectionFromParent(
  key: string,
  deps: AcquireDeps,
): AcquireAuthorityOutput | null {
  const parentKey = parentStatuteKey(key);
  if (!parentKey) return null;
  const parentSourceId = deps.ledger.get(parentKey)?.acquired_source_id;
  if (!parentSourceId) return null;
  const src = deps.store.get(parentSourceId);
  if (!src || !src.is_actual_document || !src.extracted_text) return null;

  const section = deps.ledger.expectedIdentity(key)?.section ?? key.slice(key.indexOf("#") + 1);
  const token = normalizeSectionToken(section ?? "");
  if (deps.stats) deps.stats.authority_parent_statute_reuse += 1;
  if (!token) return null;

  const res = locateSection(src.extracted_text, token);
  if (!res.found || !res.windows.length) {
    deps.ledger.noteRead(parentSourceId, { yielded: false, locator: token });
    return null;
  }
  deps.ledger.noteRead(parentSourceId, { yielded: true });
  deps.ledger.note(
    key,
    {
      url: `source:${parentSourceId}`,
      outcome: "acquired",
      reason: "section_located_in_parent_statute_body",
      identity_corroborated: true,
      at: new Date().toISOString(),
    },
    parentSourceId,
  );
  if (deps.stats) {
    deps.stats.authority_section_from_parent += 1;
    deps.stats.authority_targets_acquired += 1;
  }
  const quotes = deps.store.serveQuotes(parentSourceId, res.windows, token);
  return {
    ok: true,
    authority_key: key,
    status: "acquired",
    source_id: parentSourceId,
    basis: "section_located_in_parent_statute_body",
    title: src.title,
    windows: res.windows,
    exact_source_text: quotes.map((q) => ({ quote_id: q.quote_id, text: q.text })),
    attempts_used: 0,
    attempts_remaining: deps.ledger.attemptsRemaining(key),
    discovery_refresh_available: deps.ledger.canRefreshDiscovery(key),
    tried: [],
    instruction: `הסעיף ${token} אותר בגוף חוק האם שכבר הושג (${parentSourceId}). צטט מתוך exact_source_text.`,
  };
}

// ─── the bounded acquisition loop ───────────────────────────────────────────

function candidateLabel(c: TargetCandidate): string {
  if (c.local_document_id) return `corpus:${c.local_document_id}`;
  try {
    return new URL(c.url!).hostname.replace(/^www\./, "");
  } catch {
    return c.url ?? c.result_id ?? "?";
  }
}

let syntheticId = 0;

/**
 * Try, in order, the concrete candidates known for one authority, until a body
 * is acquired and corroborated or the bounded budget runs out.
 */
export async function runAcquireAuthority(
  authority_key: string,
  deps: AcquireDeps,
): Promise<AcquireAuthorityOutput> {
  const key = String(authority_key ?? "").trim();
  const ledger = deps.ledger;
  const tried: AcquireAttemptRecord[] = [];

  const finish = (status: AcquireStatus, extra: Partial<AcquireAuthorityOutput> = {}): AcquireAuthorityOutput => ({
    ok: status === "acquired" || status === "already_acquired",
    authority_key: key,
    status,
    attempts_used: ledger.target(key)?.concrete_attempts ?? 0,
    attempts_remaining: ledger.attemptsRemaining(key),
    discovery_refresh_available: ledger.canRefreshDiscovery(key),
    tried,
    ...extra,
  });

  const target = ledger.target(key);
  if (!key || !target) {
    return finish("target_not_found", {
      instruction: "אין יעד השגה פתוח למפתח זה. פתח אותו קודם ב-lookup_authority.",
    });
  }
  if (ledger.acquired(key)) {
    const sid = ledger.get(key)!.acquired_source_id!;
    return finish("already_acquired", {
      source_id: sid,
      title: deps.store.get(sid)?.title,
      basis: ledger.get(key)?.binding_basis,
      instruction: `גוף האסמכתה כבר הושג (${sid}) — עבוד ממנו ב-fetch({source_id, query}).`,
    });
  }

  const reuse = trySectionFromParent(key, deps);
  if (reuse) return reuse;

  const perCall = Math.max(1, Math.min(deps.maxAttempts ?? MAX_CONCRETE_ATTEMPTS_PER_AUTHORITY, MAX_CONCRETE_ATTEMPTS_PER_AUTHORITY));
  const doFetch = deps.fetchImpl ?? runFetch;
  let usedThisCall = 0;

  // Search / portal entries are stored, but never consume an attempt.
  const skippedEntries = ledger.untriedCandidates(key).filter((c) => !isConcreteCandidate(c)).length;
  if (skippedEntries && deps.stats) {
    deps.stats.authority_candidates_skipped_discovery_entry += skippedEntries;
  }

  while (usedThisCall < perCall && ledger.attemptsRemaining(key) > 0) {
    const queue = ledger.concreteUntried(key);
    const c = queue[0];
    if (!c) break;

    if (c.url && !isSafeFetchUrl(c.url)) {
      // Not an acquisition attempt: nothing left the process.
      ledger.note(key, {
        url: c.url,
        outcome: "failed",
        reason: "unsafe_url",
        at: new Date().toISOString(),
      });
      tried.push({ candidate: candidateLabel(c), outcome: "skipped", reason: "unsafe_url" });
      continue;
    }
    if (!deps.canFetch()) {
      return finish("fetch_budget_exhausted", {
        instruction: "תקציב ההבאות של הריצה מוצה. הגש את התזכיר עם מה שכבר הושג.",
      });
    }

    // One synthetic discovery entry carrying the PERSISTED target identity.
    const base = c.result_id ? deps.discovered.get(c.result_id) : undefined;
    const expected = ledger.expectedIdentity(key);
    if (
      base?.expected_identity && expected &&
      ((base.expected_identity.docket && expected.docket && base.expected_identity.docket !== expected.docket) ||
        (base.expected_identity.statute && expected.statute && base.expected_identity.statute !== expected.statute))
    ) {
      if (deps.stats) deps.stats.authority_identity_conflicts += 1;
    }
    const rid = `ACQ-${++syntheticId}`;
    const candidate: SearchResult = {
      result_id: rid,
      title: base?.title ?? c.label ?? c.url ?? key,
      url: c.url ?? base?.url,
      snippet: base?.snippet,
      origin: base?.origin ?? `acquire:${c.origin ?? "candidate"}`,
      possible_docket: base?.possible_docket,
      local_document_id: c.local_document_id ?? base?.local_document_id,
      local_match_basis: base?.local_match_basis,
      candidate_kind: c.local_document_id ? "local_document" : "document",
      authority_key: key,
      expected_identity: expected ?? base?.expected_identity,
    };

    ledger.noteConcreteAttempt(key);
    usedThisCall += 1;
    if (deps.stats) deps.stats.authority_concrete_attempts += 1;
    deps.noteFetch();

    let out: FetchOutput;
    try {
      out = await doFetch(
        deps.store,
        new Map([[rid, candidate]]),
        { result_id: rid },
        ledger,
        { admin: deps.admin },
      );
    } catch (e) {
      tried.push({
        candidate: candidateLabel(c),
        outcome: "failed",
        reason: `fetch_error: ${e instanceof Error ? e.message : String(e)}`,
      });
      continue;
    }

    if (ledger.acquired(key)) {
      const sid = ledger.get(key)!.acquired_source_id!;
      tried.push({ candidate: candidateLabel(c), outcome: "acquired", reason: out.authority_binding_basis ?? "bound" });
      if (deps.stats) deps.stats.authority_targets_acquired += 1;
      return finish("acquired", {
        source_id: sid,
        basis: out.authority_binding_basis ?? ledger.get(key)?.binding_basis,
        title: out.title ?? deps.store.get(sid)?.title,
        summary: out.summary,
        windows: out.windows,
        exact_source_text: out.exact_source_text,
        instruction: out.instruction ??
          `גוף האסמכתה הושג (${sid}). קרא ממנו ממוקד ב-fetch({source_id, query}).`,
      });
    }

    tried.push({
      candidate: candidateLabel(c),
      outcome: "failed",
      reason: out.authority_binding_basis ?? out.not_document_reason ?? out.instruction?.slice(0, 80) ??
        (out.ok ? "identity_not_corroborated" : "fetch_failed"),
    });

    // Defensive: a candidate that produced no ledger attempt would otherwise
    // be offered again forever. `runFetch` records one for every path, but the
    // queue is re-derived each round so a no-op cannot loop unbounded either.
    if (ledger.concreteUntried(key)[0] === c) {
      ledger.note(key, {
        url: c.url ?? `local:legal_documents/${c.local_document_id}`,
        outcome: "failed",
        reason: "no_usable_body",
        at: new Date().toISOString(),
      });
    }
  }

  const remainingConcrete = ledger.concreteUntried(key).length;
  if (remainingConcrete === 0 && ledger.canRefreshDiscovery(key)) {
    ledger.noteDiscoveryRefresh(key);
    if (deps.stats) deps.stats.authority_discovery_refreshes += 1;
    return finish("needs_discovery", {
      instruction:
        `לא נותרו מועמדים קונקרטיים עבור ${key}. חפש נתיב אחר ל-אותו מסמך (search/raw_web_search עם for_authority:"${key}"), ואז קרא שוב ל-acquire_authority. זו הזדמנות הרענון היחידה ליעד זה.`,
    });
  }
  if (ledger.attemptsRemaining(key) === 0 || remainingConcrete === 0) {
    const reason = ledger.attemptsRemaining(key) === 0 ? "attempt_ceiling" : "no_candidates_left";
    ledger.markExhausted(key, reason);
    if (deps.stats) deps.stats.authority_targets_exhausted += 1;
    return finish("exhausted", {
      instruction:
        `לא ניתן היה להשיג גוף קריא עבור ${key} (${reason}). המשך בלעדיה, או בסס את הטענה על מקור אחר שכבר נקרא.`,
    });
  }
  return finish("exhausted", {
    instruction: `עצירה זמנית עבור ${key}. נותרו ${ledger.attemptsRemaining(key)} ניסיונות.`,
  });
}
