/** Explicit dependency-injected unit-test double; not browser durability proof. */
import type { CitationJournalEntry, CitationJournalClaim, CitationRecoveryJournal } from "@/lib/citationRecoveryJournal";
export class MemoryCitationJournal implements CitationRecoveryJournal {
  readonly slots = new Map<string, CitationJournalEntry>();
  readonly requests = new Map<string, CitationJournalEntry>();
  readonly children = new Map<string, CitationJournalEntry>();
  fail = false;
  private queue: Promise<unknown> = Promise.resolve();
  private slot(e: CitationJournalEntry) { return JSON.stringify([e.accountId, e.keyVersion, e.key]); }
  private id(account: string, id: string) { return JSON.stringify([account, id]); }
  private atomic<T>(fn: () => T): Promise<T> {
    const pending = this.queue.then(() => { if (this.fail) throw new Error("CITATION_RECOVERY_STORAGE_UNAVAILABLE"); return fn(); });
    this.queue = pending.catch(() => {}); return pending;
  }
  private metadata(e: CitationJournalEntry): CitationJournalEntry {
    return { accountId: e.accountId, key: e.key, keyVersion: e.keyVersion, requestId: e.requestId,
      parentRequestId: e.parentRequestId, projectId: e.projectId, createdAt: e.createdAt };
  }
  claim(proposed: CitationJournalClaim): Promise<CitationJournalEntry> { return this.atomic(() => {
    const e = this.metadata(proposed), active = this.slots.get(this.slot(e));
    if (!e.parentRequestId) {
      const used = this.requests.get(this.id(e.accountId, e.requestId));
      if (used && (used.key !== e.key || used.projectId !== e.projectId)) throw new Error("REQUEST_FINGERPRINT_MISMATCH");
      if (active) return active;
      if ([...this.slots.values()].filter((v) => v.accountId === e.accountId).length >= proposed.capacity) throw new Error("REQUEST_RECOVERY_LIMIT");
      if (used) { this.slots.set(this.slot(used), used); return used; }
    } else {
      const parent = this.requests.get(this.id(e.accountId, e.parentRequestId));
      if (!parent || parent.key !== e.key || parent.projectId !== e.projectId) throw new Error("CITATION_RETRY_STALE");
      const child = this.children.get(this.id(e.accountId, e.parentRequestId));
      if (child) { if (active?.requestId !== child.requestId) throw new Error("CITATION_RETRY_STALE"); return child; }
      if (active?.requestId !== e.parentRequestId) throw new Error("CITATION_RETRY_STALE");
      this.children.set(this.id(e.accountId, e.parentRequestId), e);
    }
    this.requests.set(this.id(e.accountId, e.requestId), e); this.slots.set(this.slot(e), e); return e;
  }); }
  find(accountId: string, requestId: string) { return this.atomic(() => this.requests.get(this.id(accountId, requestId)) ?? null); }
  restore(proposed: CitationJournalEntry, capacity = 256) { return this.atomic(() => {
    const e = this.metadata(proposed), existing = this.requests.get(this.id(e.accountId, e.requestId)), active = this.slots.get(this.slot(e));
    const canonicalSibling = !!e.parentRequestId && active?.parentRequestId === e.parentRequestId;
    if (existing && (existing.key !== e.key || existing.parentRequestId !== e.parentRequestId || existing.projectId !== e.projectId) ||
        active && active.requestId !== e.requestId && active.parentRequestId !== e.requestId && !canonicalSibling) throw new Error("CITATION_RETRY_STALE");
    if (!active && [...this.slots.values()].filter((v) => v.accountId === e.accountId).length >= capacity) throw new Error("REQUEST_RECOVERY_LIMIT");
    if (!existing) this.requests.set(this.id(e.accountId, e.requestId), e);
    if (!active || canonicalSibling) this.slots.set(this.slot(e), e);
    if (e.parentRequestId) this.children.set(this.id(e.accountId, e.parentRequestId), e);
    return existing ?? e;
  }); }
  adopt(proposed: CitationJournalEntry, canonical: string) { return this.atomic(() => {
    const active = this.slots.get(this.slot(proposed));
    if (!proposed.parentRequestId || !active || ![proposed.requestId, canonical].includes(active.requestId)) throw new Error("CITATION_RETRY_STALE");
    const e = this.metadata({ ...proposed, requestId: canonical });
    this.requests.set(this.id(e.accountId, canonical), e); this.children.set(this.id(e.accountId, e.parentRequestId!), e); this.slots.set(this.slot(e), e); return e;
  }); }
  delivered(e: CitationJournalEntry, canCommit: () => boolean = () => true) { return this.atomic(() => { if (!canCommit()) throw new Error("CITATION_RETRY_STALE"); if (this.slots.get(this.slot(e))?.requestId === e.requestId) this.slots.delete(this.slot(e)); }); }
}
