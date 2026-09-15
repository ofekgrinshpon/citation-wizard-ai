/**
 * legal-research-v2 — per-run acquisition attempt ledger.
 *
 * One job only: remember which URLs were already tried for a named authority
 * and whether a matching body was ever acquired, so the agent stops burning
 * steps on paths that already failed.
 *
 * NOT an acquisition orchestrator: it ranks nothing, chooses nothing and
 * fetches nothing. The research agent still decides what to try next.
 */

export interface AcquisitionAttempt {
  url: string;
  /**
   * `acquired` means: readable body whose OWN identity corroborated the
   * requested authority. `readable_unconfirmed_identity` means the body is
   * usable but may not stand in for this authority key.
   */
  outcome: "acquired" | "failed" | "not_the_document" | "readable_unconfirmed_identity";
  reason: string;
  at: string;
  /** Whether the fetched body positively corroborated the requested authority. */
  identity_corroborated?: boolean;
}

export interface AuthorityLedgerRow {
  authority_key: string;
  attempts: AcquisitionAttempt[];
  /** Set ONLY for a positively corroborated body. */
  acquired_source_id?: string;
  /** Why the binding above was accepted (deterministic basis string). */
  binding_basis?: string;
}

export interface SourceReadRow {
  source_id: string;
  no_yield: number;
  yielded: number;
  /** Section tokens already asked for on this source that were not present. */
  missing_locators: string[];
  exhausted: boolean;
  /**
   * Span-hunting discipline (v2_span_hunting_efficiency_v1). Counted on a
   * different axis than `no_yield`: a query can match somewhere in the body
   * (yield) and still return only text already served (no new quote).
   */
  consecutive_no_new_quotes?: number;
  span_hunting_exhausted?: boolean;
  /** Section tokens / locators already attempted here, present or not. */
  attempted_locators?: string[];
}

/**
 * A candidate the deterministic layer knows about for an authority the agent
 * AFFIRMATIVELY chose to pursue. Presence here obliges nothing.
 */
export interface TargetCandidate {
  result_id?: string;
  url?: string;
  label?: string;
  candidate_kind?: "document" | "local_document" | "discovery_entry";
  /** A stored corpus row is fetchable without a URL. */
  local_document_id?: string;
  /** Where the candidate came from. Ordering hint only — never a quality tier. */
  origin?: "local_corpus" | "official_search_entry" | "search" | "raw_web" | "derived";
  /** Why this candidate was linked to this authority (telemetry / tests). */
  attach_basis?: string;
}

export interface ExpectedTargetIdentity {
  docket?: string;
  statute?: string;
  section?: string;
}

export interface AcquisitionTargetRow {
  authority_key: string;
  label?: string;
  opened_at: string;
  candidates: TargetCandidate[];
  /**
   * The identity this target is for, persisted server-side. The model may
   * select a target, never redefine what it means.
   */
  expected_identity?: ExpectedTargetIdentity;
  /** Concrete acquisition attempts spent on this target across the whole run. */
  concrete_attempts?: number;
  /** Targeted discovery refreshes already spent on this target. */
  discovery_refreshes_used?: number;
  /** Final for this run: no candidate left, or the attempt ceiling was hit. */
  exhausted?: boolean;
  exhaust_reason?: string;
  /** The agent may deliberately drop a target; it then stops being surfaced. */
  abandoned?: boolean;
  abandon_reason?: string;
}

export interface AcquisitionLedgerJson {
  rows: AuthorityLedgerRow[];
  reads?: SourceReadRow[];
  targets?: AcquisitionTargetRow[];
  /** The one bounded pre-memo acquisition attempt already fired this run. */
  memo_gate_used?: boolean;
}

/** Total concrete acquisition attempts allowed per authority, for the whole run. */
export const MAX_CONCRETE_ATTEMPTS_PER_AUTHORITY = 4;
/** Targeted discovery refreshes allowed per authority, for the whole run. */
export const MAX_DISCOVERY_REFRESHES_PER_AUTHORITY = 1;


/** Compact, agent-facing state of one authority. Derived only, decides nothing. */
export interface AuthorityState {
  authority_key: string;
  usable_body_source_id?: string;
  attempted_hosts: Array<{ host: string; outcome: string; reason: string }>;
  unresolved: boolean;
}

/** Stable comparison form for "was this exact path already tried?". */
export function normalizeAttemptUrl(url: string): string {
  return (url ?? "").trim().replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 40);
  }
}

/** Normalize "בג\"ץ 1000/92" / "1000/92" to a stable key. */
export function authorityKeyOf(input: { docket?: string; statute?: string; section?: string }): string | null {
  const docket = input.docket?.match(/\d{1,6}\s*\/\s*\d{2,4}/)?.[0]?.replace(/\s+/g, "");
  if (docket) return `case:${docket}`;
  const statute = input.statute?.trim();
  if (statute) return `statute:${statute}${input.section ? `#${input.section.trim()}` : ""}`;
  return null;
}

/** Consecutive no-evidence targeted reads on one source before we call it exhausted. */
export const NO_YIELD_EXHAUSTION_THRESHOLD = 3;

/**
 * Consecutive targeted re-reads of the same source that produce NO new quote
 * before that source is treated as span-hunting exhausted for now
 * (v2_span_hunting_efficiency_v1).
 */
export const NO_NEW_QUOTE_THRESHOLD = 3;

export class AcquisitionLedger {
  private rows = new Map<string, AuthorityLedgerRow>();
  private reads = new Map<string, SourceReadRow>();
  private targets = new Map<string, AcquisitionTargetRow>();
  private memo_gate_used = false;


  /**
   * Record an attempt. A binding (`acquired_source_id`) is created only when
   * the caller passes a source whose body positively corroborated this
   * authority; unconfirmed bodies are remembered as attempts only.
   */
  note(key: string, attempt: AcquisitionAttempt, acquired_source_id?: string): AuthorityLedgerRow {
    const row = this.rows.get(key) ?? { authority_key: key, attempts: [] };
    row.attempts.push(attempt);
    if (acquired_source_id && attempt.identity_corroborated !== false) {
      row.acquired_source_id = acquired_source_id;
      row.binding_basis = attempt.reason;
    }
    this.rows.set(key, row);
    return row;
  }

  get(key: string): AuthorityLedgerRow | null {
    return this.rows.get(key) ?? null;
  }

  acquired(key: string): boolean {
    return !!this.rows.get(key)?.acquired_source_id;
  }

  /** URLs already attempted without success — do not repeat them. */
  failedUrls(key: string): string[] {
    return (this.rows.get(key)?.attempts ?? [])
      .filter((a) => a.outcome !== "acquired")
      .map((a) => a.url);
  }

  all(): AuthorityLedgerRow[] {
    return [...this.rows.values()];
  }

  /** A previous attempt on the very same URL, if any. */
  attemptOn(key: string, url: string): AcquisitionAttempt | null {
    const norm = (u: string) => u.trim().replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
    return (this.rows.get(key)?.attempts ?? []).find((a) => norm(a.url) === norm(url)) ?? null;
  }

  /** Compact state handed to the agent instead of another acquisition round. */
  state(key: string): AuthorityState | null {
    const row = this.rows.get(key);
    if (!row) return null;
    return {
      authority_key: key,
      usable_body_source_id: row.acquired_source_id,
      attempted_hosts: row.attempts.slice(-6).map((a) => ({
        host: hostOf(a.url),
        outcome: a.outcome,
        reason: a.reason.slice(0, 90),
      })),
      unresolved: !row.acquired_source_id,
    };
  }

  // ── Per-source targeted-read yield (same-source no-yield exhaustion) ────
  /** Record one targeted read against an already stored body. */
  noteRead(source_id: string, opts: { yielded: boolean; locator?: string | null }): SourceReadRow {
    const row = this.reads.get(source_id) ?? this.newReadRow(source_id);
    if (opts.yielded) {
      row.yielded += 1;
      row.no_yield = 0;
      row.exhausted = false;
    } else {
      row.no_yield += 1;
      const loc = opts.locator?.trim();
      if (loc && !row.missing_locators.includes(loc)) row.missing_locators.push(loc);
      if (row.no_yield >= NO_YIELD_EXHAUSTION_THRESHOLD) row.exhausted = true;
    }
    this.reads.set(source_id, row);
    return row;
  }

  readState(source_id: string): SourceReadRow | null {
    return this.reads.get(source_id) ?? null;
  }

  // ── Span-hunting discipline (v2_span_hunting_efficiency_v1) ─────────────
  /**
   * Record the QUOTE novelty of one targeted re-read. Productive means the
   * read caused at least one new quote to be added to the evidence store;
   * anything else is a paraphrase over text the run already holds.
   */
  noteQuoteYield(
    source_id: string,
    new_quotes: number,
  ): SourceReadRow & { newly_exhausted: boolean } {
    const row = this.reads.get(source_id) ?? this.newReadRow(source_id);
    const was = row.span_hunting_exhausted === true;
    if (new_quotes > 0) {
      row.consecutive_no_new_quotes = 0;
      row.span_hunting_exhausted = false;
    } else {
      row.consecutive_no_new_quotes = (row.consecutive_no_new_quotes ?? 0) + 1;
      if (row.consecutive_no_new_quotes >= NO_NEW_QUOTE_THRESHOLD) row.span_hunting_exhausted = true;
    }
    this.reads.set(source_id, row);
    return { ...row, newly_exhausted: !was && row.span_hunting_exhausted === true };
  }

  spanHuntingExhausted(source_id: string): boolean {
    return this.reads.get(source_id)?.span_hunting_exhausted === true;
  }

  /** True when this locator / section token was never asked for on this source. */
  isNewLocator(source_id: string, locator?: string | null): boolean {
    const loc = locator?.trim();
    if (!loc) return false;
    const row = this.reads.get(source_id);
    if (!row) return true;
    if (row.missing_locators.includes(loc)) return false;
    return !(row.attempted_locators ?? []).includes(loc);
  }

  /** Remember a locator / section token that was asked for on this source. */
  noteLocatorAttempt(source_id: string, locator?: string | null): void {
    const loc = locator?.trim();
    if (!loc) return;
    const row = this.reads.get(source_id) ?? this.newReadRow(source_id);
    row.attempted_locators = row.attempted_locators ?? [];
    if (!row.attempted_locators.includes(loc)) row.attempted_locators.push(loc);
    this.reads.set(source_id, row);
  }

  private newReadRow(source_id: string): SourceReadRow {
    return {
      source_id,
      no_yield: 0,
      yielded: 0,
      missing_locators: [],
      exhausted: false,
      consecutive_no_new_quotes: 0,
      span_hunting_exhausted: false,
      attempted_locators: [],
    };
  }

  /** True when the same locator was already established as missing here. */
  knownMissingLocator(source_id: string, locator?: string | null): boolean {
    const loc = locator?.trim();
    if (!loc) return false;
    return !!this.reads.get(source_id)?.missing_locators.includes(loc);
  }

  allReads(): SourceReadRow[] {
    return [...this.reads.values()];
  }

  // ── Acquisition targets (authorities the agent chose to pursue) ─────────
  /**
   * Remember that the agent asked for this authority by name, together with
   * the candidates deterministic code found for it. Idempotent: re-opening an
   * existing target merges candidates and never resurrects an abandoned one
   * unless the agent asks for it again explicitly.
   */
  openTarget(
    key: string,
    opts: {
      label?: string;
      candidates?: TargetCandidate[];
      reopen?: boolean;
      expected_identity?: ExpectedTargetIdentity;
    } = {},
  ): AcquisitionTargetRow {
    const row = this.targets.get(key) ??
      { authority_key: key, label: opts.label, opened_at: new Date().toISOString(), candidates: [] };
    if (opts.label && !row.label) row.label = opts.label;
    // The identity of a target is fixed the first time it is opened. Later
    // opens may only FILL missing fields, never redefine what the target is.
    if (opts.expected_identity) {
      const cur = row.expected_identity ?? {};
      row.expected_identity = {
        docket: cur.docket ?? opts.expected_identity.docket,
        statute: cur.statute ?? opts.expected_identity.statute,
        section: cur.section ?? opts.expected_identity.section,
      };
    }
    if (opts.reopen) {
      row.abandoned = false;
      row.abandon_reason = undefined;
    }
    this.targets.set(key, row);
    if (opts.candidates?.length) this.attachCandidates(key, opts.candidates);
    return row;
  }

  /**
   * Link candidates to an existing target. Deduplicated by result id and by
   * normalized URL / local document id. Returns how many were newly linked.
   */
  attachCandidates(key: string, candidates: TargetCandidate[]): number {
    const row = this.targets.get(key);
    if (!row) return 0;
    let attached = 0;
    for (const c of candidates) {
      if (!c.url && !c.result_id && !c.local_document_id) continue;
      const dup = row.candidates.some((x) =>
        (c.result_id && x.result_id === c.result_id) ||
        (c.local_document_id && x.local_document_id === c.local_document_id) ||
        (c.url && x.url && normalizeAttemptUrl(x.url) === normalizeAttemptUrl(c.url))
      );
      if (dup) continue;
      row.candidates.push(c);
      attached += 1;
    }
    // New candidates mean the target is workable again.
    if (attached > 0 && row.exhausted && (row.concrete_attempts ?? 0) < MAX_CONCRETE_ATTEMPTS_PER_AUTHORITY) {
      row.exhausted = false;
      row.exhaust_reason = undefined;
    }
    return attached;
  }

  target(key: string): AcquisitionTargetRow | null {
    return this.targets.get(key) ?? null;
  }

  /** The identity this target stands for. Server-side truth, never model input. */
  expectedIdentity(key: string): ExpectedTargetIdentity | undefined {
    return this.targets.get(key)?.expected_identity;
  }

  /** The agent decided this target is no longer worth pursuing. */
  abandonTarget(key: string, reason: string): void {
    const row = this.targets.get(key);
    if (!row) return;
    row.abandoned = true;
    row.abandon_reason = reason;
  }

  /** Stable "was this exact path already tried?" key for a candidate. */
  candidateAttemptKey(c: TargetCandidate): string | null {
    // Mirrors localAttemptKey() in localCorpusBody.ts for stored-corpus rows.
    if (c.local_document_id) return normalizeAttemptUrl(`local:legal_documents/${c.local_document_id}`);
    if (c.url) return normalizeAttemptUrl(c.url);
    return null;
  }

  private attemptedKeys(key: string): Set<string> {
    return new Set((this.rows.get(key)?.attempts ?? []).map((a) => normalizeAttemptUrl(a.url)));
  }

  /** Candidates for this target whose URL has not been attempted yet. */
  untriedCandidates(key: string): TargetCandidate[] {
    const row = this.targets.get(key);
    if (!row) return [];
    const tried = this.attemptedKeys(key);
    return row.candidates.filter((c) => {
      const k = this.candidateAttemptKey(c);
      return !k || !tried.has(k);
    });
  }

  /**
   * Untried candidates that are a concrete document, in deterministic
   * acquisition order: stored corpus first, then discovered documents in the
   * order they were linked, then derived/guessed URLs last. Search and portal
   * entries are excluded — they can never consume an acquisition attempt.
   */
  concreteUntried(key: string): TargetCandidate[] {
    const rank = (c: TargetCandidate): number => {
      if (c.local_document_id || c.candidate_kind === "local_document") return 0;
      if (c.origin === "derived") return 2;
      return 1;
    };
    return this.untriedCandidates(key)
      .filter((c) => c.candidate_kind !== "discovery_entry")
      .filter((c) => !!c.url || !!c.local_document_id)
      .map((c, i) => ({ c, i }))
      .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
      .map((x) => x.c);
  }

  /** Concrete acquisition attempts still allowed for this authority this run. */
  attemptsRemaining(key: string): number {
    const used = this.targets.get(key)?.concrete_attempts ?? 0;
    return Math.max(0, MAX_CONCRETE_ATTEMPTS_PER_AUTHORITY - used);
  }

  /** Count one concrete acquisition attempt against the per-authority ceiling. */
  noteConcreteAttempt(key: string): number {
    const row = this.targets.get(key);
    if (!row) return 0;
    row.concrete_attempts = (row.concrete_attempts ?? 0) + 1;
    return row.concrete_attempts;
  }

  canRefreshDiscovery(key: string): boolean {
    const row = this.targets.get(key);
    if (!row) return false;
    return (row.discovery_refreshes_used ?? 0) < MAX_DISCOVERY_REFRESHES_PER_AUTHORITY;
  }

  noteDiscoveryRefresh(key: string): number {
    const row = this.targets.get(key);
    if (!row) return 0;
    row.discovery_refreshes_used = (row.discovery_refreshes_used ?? 0) + 1;
    return row.discovery_refreshes_used;
  }

  markExhausted(key: string, reason: string): void {
    const row = this.targets.get(key);
    if (!row) return;
    row.exhausted = true;
    row.exhaust_reason = reason;
  }

  /** The one bounded pre-memo acquisition attempt this run is allowed. */
  memoGateUsed(): boolean {
    return this.memo_gate_used;
  }

  markMemoGateUsed(): void {
    this.memo_gate_used = true;
  }

  /**
   * Targets the agent opened that are still not backed by a corroborated body
   * and were not abandoned. Pure information for the next decision.
   */
  unresolvedTargets(): Array<AcquisitionTargetRow & { untried: TargetCandidate[] }> {
    return [...this.targets.values()]
      .filter((t) => !t.abandoned && !this.acquired(t.authority_key))
      .map((t) => ({ ...t, untried: this.untriedCandidates(t.authority_key) }));
  }

  /** Unresolved targets that still have a concrete path worth one attempt. */
  workableTargets(): AcquisitionTargetRow[] {
    return [...this.targets.values()].filter((t) =>
      !t.abandoned && !t.exhausted && !this.acquired(t.authority_key) &&
      this.attemptsRemaining(t.authority_key) > 0 &&
      this.concreteUntried(t.authority_key).length > 0
    );
  }

  allTargets(): AcquisitionTargetRow[] {
    return [...this.targets.values()];
  }


  toJSON(): AcquisitionLedgerJson {
    return {
      rows: this.all(),
      reads: this.allReads(),
      targets: this.allTargets(),
      memo_gate_used: this.memo_gate_used,
    };
  }

  static fromJSON(json: AcquisitionLedgerJson | null | undefined): AcquisitionLedger {
    const l = new AcquisitionLedger();
    for (const r of json?.rows ?? []) l.rows.set(r.authority_key, r);
    for (const r of json?.reads ?? []) l.reads.set(r.source_id, r);
    for (const t of json?.targets ?? []) l.targets.set(t.authority_key, t);
    l.memo_gate_used = json?.memo_gate_used === true;
    return l;
  }


  /**
   * Short guidance handed back to the agent with a fetch result. Purely
   * derived from the ledger; contains no ranking and no candidate list.
   */
  advice(key: string): string | undefined {
    const row = this.rows.get(key);
    if (!row) return undefined;
    if (row.acquired_source_id) {
      return `גוף האסמכתה ${key} כבר הושג ואומת זהותית (${row.acquired_source_id}). אין צורך בהבאות נוספות עבורה.`;
    }
    const failed = row.attempts.filter((a) => a.outcome !== "acquired");
    if (failed.length >= 2) {
      return `נכשלו ${failed.length} ניסיונות עבור ${key} (${
        failed.slice(-3).map((a) => `${a.url} → ${a.reason}`).join("; ")
      }). אל תחזור על נתיבים אלה; חפש עותק מראה (mirror) של אותו מסמך.`;
    }
    return undefined;
  }
}
