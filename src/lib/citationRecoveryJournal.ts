/** Durable, account-scoped identity metadata only. Never store citation text,
 * results, tokens or refund details here. Metadata has no content-retention TTL:
 * an old unknown operation must not silently become a fresh paid operation. */
export const CITATION_CLIENT_KEY_VERSION = 1;
export const CITATION_REQUEST_VERSION = 3;
export const CITATION_JOURNAL_UNAVAILABLE = "CITATION_RECOVERY_STORAGE_UNAVAILABLE";

export interface CitationJournalEntry {
  accountId: string;
  key: string;
  keyVersion: number;
  requestId: string;
  parentRequestId: string | null;
  projectId: string | null;
  createdAt: string;
}
export interface CitationJournalClaim extends CitationJournalEntry { capacity: number }
export interface CitationRecoveryJournal {
  /** Atomic slot allocation, including one child for each immediate parent. */
  claim(entry: CitationJournalClaim): Promise<CitationJournalEntry>;
  find(accountId: string, requestId: string): Promise<CitationJournalEntry | null>;
  /** Reconstitute a slot only from a server-confirmed failed, retained input. */
  restore(entry: CitationJournalEntry, capacity?: number): Promise<CitationJournalEntry>;
  adopt(entry: CitationJournalEntry, canonicalRequestId: string): Promise<CitationJournalEntry>;
  /** Retire a delivered success slot; keep request and ancestry metadata. */
  delivered(entry: CitationJournalEntry, canCommit?: () => boolean): Promise<void>;
}

const SLOT_STORE = "slots";
const REQUEST_STORE = "requests";
const CHILD_STORE = "children";
const stores = [SLOT_STORE, REQUEST_STORE, CHILD_STORE];
const slotId = (entry: Pick<CitationJournalEntry, "accountId" | "key" | "keyVersion">) => [entry.accountId, entry.keyVersion, entry.key];
const requestId = (accountId: string, id: string) => [accountId, id];
const storageError = () => new Error(CITATION_JOURNAL_UNAVAILABLE);
const stale = () => new Error("CITATION_RETRY_STALE");
const knownError = (error: unknown) => error instanceof Error &&
  [CITATION_JOURNAL_UNAVAILABLE, "CITATION_RETRY_STALE", "REQUEST_RECOVERY_LIMIT", "REQUEST_FINGERPRINT_MISMATCH"].includes(error.message)
  ? error : storageError();
function checked(value: unknown): CitationJournalEntry | null {
  if (value === undefined) return null;
  const e = value as CitationJournalEntry;
  if (!e || typeof e.accountId !== "string" || !e.accountId || !/^[a-f0-9]{64}$/.test(e.key) ||
      e.keyVersion !== CITATION_CLIENT_KEY_VERSION || typeof e.requestId !== "string" || e.requestId.length < 8 || e.requestId.length > 200 ||
      !(e.parentRequestId === null || typeof e.parentRequestId === "string" && e.parentRequestId.length >= 8 && e.parentRequestId.length <= 200) ||
      !(e.projectId === null || typeof e.projectId === "string") || !Number.isFinite(Date.parse(e.createdAt))) throw storageError();
  return e;
}
function metadata(entry: CitationJournalEntry): CitationJournalEntry {
  // Explicit projection prevents callers accidentally persisting legal content.
  return { accountId: entry.accountId, key: entry.key, keyVersion: entry.keyVersion,
    requestId: entry.requestId, parentRequestId: entry.parentRequestId,
    projectId: entry.projectId, createdAt: entry.createdAt };
}
function sameScope(a: CitationJournalEntry, b: CitationJournalEntry) {
  return a.accountId === b.accountId && a.key === b.key && a.keyVersion === b.keyVersion && a.projectId === b.projectId;
}

/** Each read/write decision happens in ONE IndexedDB readwrite transaction.
 * Browser transaction serialization, not a JS mutex, arbitrates distinct tabs. */
export class IndexedDbCitationRecoveryJournal implements CitationRecoveryJournal {
  constructor(private readonly databaseName = "relex-citation-recovery-v1", private readonly factory?: IDBFactory) {}

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      let factory: IDBFactory | undefined;
      try { factory = this.factory ?? globalThis.indexedDB; } catch { reject(storageError()); return; }
      if (!factory) { reject(storageError()); return; }
      let settled = false;
      const fail = () => { if (!settled) { settled = true; clearTimeout(timer); reject(storageError()); } };
      const timer = setTimeout(fail, 10_000);
      try {
        const request = factory.open(this.databaseName, 1);
        request.onupgradeneeded = () => {
          try {
            const db = request.result;
            const slots = db.createObjectStore(SLOT_STORE, { keyPath: ["accountId", "keyVersion", "key"] });
            slots.createIndex("accountId", "accountId", { unique: false });
            db.createObjectStore(REQUEST_STORE, { keyPath: ["accountId", "requestId"] });
            db.createObjectStore(CHILD_STORE, { keyPath: ["accountId", "parentRequestId"] });
          } catch { request.transaction?.abort(); fail(); }
        };
        request.onerror = fail;
        request.onblocked = fail;
        request.onsuccess = () => {
          if (settled) { request.result.close(); return; }
          settled = true; clearTimeout(timer);
          request.result.onversionchange = () => request.result.close();
          resolve(request.result);
        };
      } catch { fail(); }
    });
  }

  private async transaction<T>(run: (tx: IDBTransaction, read: <V>(r: IDBRequest<V>, next: (v: V) => void) => void, finish: (value: T) => void) => void): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      let result: T;
      let finished = false;
      let cause: unknown;
      try {
        const tx = db.transaction(stores, "readwrite", { durability: "strict" });
        // Commit acknowledgement must include a durable flush before dispatch.
        if (tx.durability !== "strict") { tx.abort(); db.close(); reject(storageError()); return; }
        const fail = (error: unknown) => { cause = knownError(error); try { tx.abort(); } catch { db.close(); reject(cause); } };
        const read = <V>(request: IDBRequest<V>, next: (value: V) => void) => {
          request.onsuccess = () => { try { next(request.result); } catch (error) { fail(error); } };
        };
        tx.oncomplete = () => { db.close(); if (finished) resolve(result); else reject(storageError()); };
        tx.onabort = tx.onerror = () => { db.close(); reject(knownError(cause)); };
        try { run(tx, read, (value) => { result = value; finished = true; }); } catch (error) { fail(error); }
      } catch { db.close(); reject(storageError()); }
    });
  }

  claim(proposed: CitationJournalClaim): Promise<CitationJournalEntry> {
    const entry = metadata(proposed);
    return this.transaction((tx, read, finish) => {
      checked(entry);
      const slots = tx.objectStore(SLOT_STORE), requests = tx.objectStore(REQUEST_STORE), children = tx.objectStore(CHILD_STORE);
      read(slots.get(slotId(entry)), (value) => {
        const active = checked(value);
        if (!entry.parentRequestId) {
          read(requests.get(requestId(entry.accountId, entry.requestId)), (usedValue) => {
            const used = checked(usedValue);
            if (used && !sameScope(used, entry)) throw new Error("REQUEST_FINGERPRINT_MISMATCH");
            if (active) { finish(active); return; }
            read(slots.index("accountId").count(entry.accountId), (count) => {
              if (count >= proposed.capacity) throw new Error("REQUEST_RECOVERY_LIMIT");
              // An explicit old ID is immutable even after delivery. Rebind the
              // same metadata and replay its guarded ID; never mint paid work.
              if (!used) requests.add(entry);
              slots.add(used ?? entry); finish(used ?? entry);
            });
          });
          return;
        }
        const parentId = entry.parentRequestId;
        read(requests.get(requestId(entry.accountId, parentId)), (parentValue) => {
          const parent = checked(parentValue);
          if (!parent || !sameScope(parent, entry)) throw stale();
          read(children.get(requestId(entry.accountId, parentId)), (childValue) => {
            const child = checked(childValue);
            if (child) {
              if (!active || active.requestId !== child.requestId || !sameScope(child, entry)) throw stale();
              finish(child); return;
            }
            if (!active || active.requestId !== parentId) throw stale();
            requests.add(entry); children.add(entry); slots.put(entry); finish(entry);
          });
        });
      });
    });
  }

  find(accountId: string, id: string): Promise<CitationJournalEntry | null> {
    return this.transaction((tx, read, finish) => read(tx.objectStore(REQUEST_STORE).get(requestId(accountId, id)), (value) => finish(checked(value))));
  }

  restore(proposed: CitationJournalEntry, capacity = 256): Promise<CitationJournalEntry> {
    const entry = metadata(proposed);
    return this.transaction((tx, read, finish) => {
      checked(entry);
      const requests = tx.objectStore(REQUEST_STORE), slots = tx.objectStore(SLOT_STORE);
      read(requests.get(requestId(entry.accountId, entry.requestId)), (value) => {
        const existing = checked(value);
        if (existing && (!sameScope(existing, entry) || existing.parentRequestId !== entry.parentRequestId)) throw stale();
        const retained = existing ?? entry;
        read(slots.get(slotId(entry)), (slotValue) => {
          const active = checked(slotValue);
          const canonicalSibling = !!entry.parentRequestId && active?.parentRequestId === entry.parentRequestId;
          if (active && active.requestId !== entry.requestId && active.parentRequestId !== entry.requestId && !canonicalSibling) throw stale();
          const save = () => {
            if (!existing) requests.add(retained);
            if (!active || canonicalSibling) slots.put(retained);
            if (entry.parentRequestId) tx.objectStore(CHILD_STORE).put(retained);
            finish(retained);
          };
          if (active) { save(); return; }
          read(slots.index("accountId").count(entry.accountId), (count) => {
            if (count >= capacity) throw new Error("REQUEST_RECOVERY_LIMIT");
            save();
          });
        });
      });
    });
  }

  adopt(proposed: CitationJournalEntry, canonicalRequestId: string): Promise<CitationJournalEntry> {
    const entry = metadata({ ...proposed, requestId: canonicalRequestId });
    return this.transaction((tx, read, finish) => {
      checked(entry);
      if (!entry.parentRequestId) throw stale();
      const slots = tx.objectStore(SLOT_STORE), requests = tx.objectStore(REQUEST_STORE), children = tx.objectStore(CHILD_STORE);
      read(slots.get(slotId(entry)), (value) => {
        const active = checked(value);
        if (!active || ![proposed.requestId, canonicalRequestId].includes(active.requestId) || active.parentRequestId !== entry.parentRequestId) throw stale();
        read(requests.get(requestId(entry.accountId, canonicalRequestId)), (value) => {
          const known = checked(value);
          if (known && (!sameScope(known, entry) || known.parentRequestId !== entry.parentRequestId)) throw stale();
          requests.put(known ?? entry); children.put(known ?? entry); slots.put(known ?? entry); finish(known ?? entry);
        });
      });
    });
  }

  delivered(entry: CitationJournalEntry, canCommit: () => boolean = () => true): Promise<void> {
    return this.transaction((tx, read, finish) => {
      const slots = tx.objectStore(SLOT_STORE);
      read(slots.get(slotId(entry)), (value) => {
        const active = checked(value);
        if (!canCommit()) throw stale();
        if (active?.requestId === entry.requestId) slots.delete(slotId(entry));
        finish(undefined);
      });
    });
  }
}
