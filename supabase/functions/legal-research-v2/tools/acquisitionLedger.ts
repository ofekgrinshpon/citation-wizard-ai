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
  outcome: "acquired" | "failed" | "not_the_document";
  reason: string;
  at: string;
}

export interface AuthorityLedgerRow {
  authority_key: string;
  attempts: AcquisitionAttempt[];
  acquired_source_id?: string;
}

export interface AcquisitionLedgerJson {
  rows: AuthorityLedgerRow[];
}

/** Normalize "בג\"ץ 1000/92" / "1000/92" to a stable key. */
export function authorityKeyOf(input: { docket?: string; statute?: string; section?: string }): string | null {
  const docket = input.docket?.match(/\d{1,6}\s*\/\s*\d{2,4}/)?.[0]?.replace(/\s+/g, "");
  if (docket) return `case:${docket}`;
  const statute = input.statute?.trim();
  if (statute) return `statute:${statute}${input.section ? `#${input.section.trim()}` : ""}`;
  return null;
}

export class AcquisitionLedger {
  private rows = new Map<string, AuthorityLedgerRow>();

  note(key: string, attempt: AcquisitionAttempt, acquired_source_id?: string): AuthorityLedgerRow {
    const row = this.rows.get(key) ?? { authority_key: key, attempts: [] };
    row.attempts.push(attempt);
    if (acquired_source_id) row.acquired_source_id = acquired_source_id;
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

  toJSON(): AcquisitionLedgerJson {
    return { rows: this.all() };
  }

  static fromJSON(json: AcquisitionLedgerJson | null | undefined): AcquisitionLedger {
    const l = new AcquisitionLedger();
    for (const r of json?.rows ?? []) l.rows.set(r.authority_key, r);
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
