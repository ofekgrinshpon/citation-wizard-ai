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
}

export interface AcquisitionTargetRow {
  authority_key: string;
  label?: string;
  opened_at: string;
  candidates: TargetCandidate[];
  /** The agent may deliberately drop a target; it then stops being surfaced. */
  abandoned?: boolean;
  abandon_reason?: string;
}

export interface AcquisitionLedgerJson {
  rows: AuthorityLedgerRow[];
  reads?: SourceReadRow[];
  targets?: AcquisitionTargetRow[];
}

/** Compact, agent-facing state of one authority. Derived only, decides nothing. */
export interface AuthorityState {
  authority_key: string;
  usable_body_source_id?: string;
  attempted_hosts: Array<{ host: string; outcome: string; reason: string }>;
  unresolved: boolean;
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

export class AcquisitionLedger {
  private rows = new Map<string, AuthorityLedgerRow>();
  private reads = new Map<string, SourceReadRow>();

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
    const row = this.reads.get(source_id) ??
      { source_id, no_yield: 0, yielded: 0, missing_locators: [], exhausted: false };
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
    opts: { label?: string; candidates?: TargetCandidate[]; reopen?: boolean } = {},
  ): AcquisitionTargetRow {
    const row = this.targets.get(key) ??
      { authority_key: key, label: opts.label, opened_at: new Date().toISOString(), candidates: [] };
    if (opts.label && !row.label) row.label = opts.label;
    if (opts.reopen) {
      row.abandoned = false;
      row.abandon_reason = undefined;
    }
    for (const c of opts.candidates ?? []) {
      if (!c.url && !c.result_id) continue;
      const dup = row.candidates.some((x) =>
        (c.result_id && x.result_id === c.result_id) ||
        (c.url && x.url && normalizeAttemptUrl(x.url) === normalizeAttemptUrl(c.url))
      );
      if (!dup) row.candidates.push(c);
    }
    this.targets.set(key, row);
    return row;
  }

  target(key: string): AcquisitionTargetRow | null {
    return this.targets.get(key) ?? null;
  }

  /** The agent decided this target is no longer worth pursuing. */
  abandonTarget(key: string, reason: string): void {
    const row = this.targets.get(key);
    if (!row) return;
    row.abandoned = true;
    row.abandon_reason = reason;
  }

  /** Candidates for this target whose URL has not been attempted yet. */
  untriedCandidates(key: string): TargetCandidate[] {
    const row = this.targets.get(key);
    if (!row) return [];
    const tried = new Set(
      (this.rows.get(key)?.attempts ?? []).map((a) => normalizeAttemptUrl(a.url)),
    );
    return row.candidates.filter((c) => !c.url || !tried.has(normalizeAttemptUrl(c.url)));
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

  allTargets(): AcquisitionTargetRow[] {
    return [...this.targets.values()];
  }

  toJSON(): AcquisitionLedgerJson {
    return { rows: this.all(), reads: this.allReads(), targets: this.allTargets() };
  }

  static fromJSON(json: AcquisitionLedgerJson | null | undefined): AcquisitionLedger {
    const l = new AcquisitionLedger();
    for (const r of json?.rows ?? []) l.rows.set(r.authority_key, r);
    for (const r of json?.reads ?? []) l.reads.set(r.source_id, r);
    for (const t of json?.targets ?? []) l.targets.set(t.authority_key, t);
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
