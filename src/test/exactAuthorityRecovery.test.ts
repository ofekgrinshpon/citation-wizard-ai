import { describe, expect, it } from "vitest";
import {
  AcquisitionLedger,
  MAX_CONCRETE_ATTEMPTS_PER_AUTHORITY,
} from "../../supabase/functions/legal-research-v2/tools/acquisitionLedger";
import {
  emptyAcquisitionStats,
  runAcquireAuthority,
  type AcquireDeps,
} from "../../supabase/functions/legal-research-v2/tools/acquisitionOrchestrator";
import {
  buildRecoveryQuery,
  recoveryOriginLabel,
  type RecoverySearchFn,
} from "../../supabase/functions/legal-research-v2/tools/exactAuthorityRecovery";
import { EvidenceStore } from "../../supabase/functions/legal-research-v2/evidence/evidenceStore";
import { localAttemptKey } from "../../supabase/functions/legal-research-v2/tools/localCorpusBody";
import type { SearchResult } from "../../supabase/functions/legal-research-v2/types";
import type { FetchOutput } from "../../supabase/functions/legal-research-v2/tools/fetch";

const CASE_KEY = "case:7829/03";
const STATUTE_KEY = "statute:חוק זכויות הסטודנט";

function result(id: string, over: Partial<SearchResult> = {}): SearchResult {
  return {
    result_id: id,
    title: over.title ?? `מועמד ${id}`,
    origin: over.origin ?? "perplexity:raw_web",
    ...over,
  } as SearchResult;
}

/**
 * Stand-in for `runFetch`. A body binds ONLY when its URL is declared "good",
 * i.e. when the real identity gates would have corroborated it. Articles,
 * wrong-proceeding pages and stubs are simply not in that list — no gate is
 * bypassed here; the real gates have their own suites.
 */
function fakeFetch(opts: { good?: string[]; store: EvidenceStore; seen: string[] }) {
  return (async (
    _store: EvidenceStore,
    discovered: Map<string, SearchResult>,
    input: { result_id?: string },
    ledger?: AcquisitionLedger,
  ): Promise<FetchOutput> => {
    const c = discovered.get(input.result_id ?? "")!;
    const attemptUrl = c.url ?? localAttemptKey(c.local_document_id ?? "x");
    opts.seen.push(attemptUrl);
    const ok = opts.good?.includes(attemptUrl) ?? false;
    const src = await opts.store.append({
      url: c.url,
      title: c.title,
      origin: c.origin,
      fetch_status: "ok",
      extracted_text: ok ? "גוף מלא" : "טקסט שאינו המסמך",
      is_actual_document: true,
    });
    ledger?.note(
      c.authority_key ?? CASE_KEY,
      {
        url: attemptUrl,
        outcome: ok ? "acquired" : "not_the_document",
        reason: ok ? "body_self_identifies" : "identity_not_corroborated",
        at: new Date().toISOString(),
        identity_corroborated: ok,
      },
      ok ? src.source_id : undefined,
    );
    return {
      ok: true,
      source_id: src.source_id,
      title: c.title,
      authority_binding_created: ok,
      authority_binding_withheld: !ok,
      authority_binding_basis: ok ? "body_self_identifies" : "identity_not_corroborated",
    };
  }) as unknown as AcquireDeps["fetchImpl"];
}

function searchReturning(results: SearchResult[], log: Array<{ query: string; scope: string }>): RecoverySearchFn {
  return async ({ query, scope }) => {
    log.push({ query, scope });
    return results;
  };
}

function caseLedger(urls: string[] = []): AcquisitionLedger {
  const l = new AcquisitionLedger();
  l.openTarget(CASE_KEY, {
    label: "מדינת ישראל נ' פלוני",
    expected_identity: { docket: 'ע"פ 7829/03' },
    candidates: urls.map((u, i) => ({ result_id: `R${i}`, url: u, candidate_kind: "document" as const })),
  });
  return l;
}

function deps(over: Partial<AcquireDeps> & { ledger: AcquisitionLedger; store: EvidenceStore }): AcquireDeps {
  return {
    discovered: new Map(),
    canFetch: () => true,
    noteFetch: () => {},
    stats: emptyAcquisitionStats(),
    ...over,
  } as AcquireDeps;
}

// ─── query construction ─────────────────────────────────────────────────────

describe("buildRecoveryQuery", () => {
  it("uses the full preserved proceeding identity plus a title hint", () => {
    const q = buildRecoveryQuery(CASE_KEY, { docket: 'ע"פ 7829/03' }, "מדינת ישראל נ' פלוני");
    expect(q?.basis).toBe("case_identity_with_hint");
    expect(q?.query).toContain('ע"פ 7829/03');
    expect(q?.query).toContain("מדינת ישראל");
    expect(q?.scope).toBe("web");
  });

  it("falls back to the bare docket when no proceeding type is known", () => {
    const q = buildRecoveryQuery(CASE_KEY, { docket: "7829/03" });
    expect(q?.basis).toBe("case_bare_docket");
    expect(q?.query).toContain("7829/03");
  });

  it("builds an official-biased statute query, with the section when requested", () => {
    const plain = buildRecoveryQuery(STATUTE_KEY, { statute: "חוק זכויות הסטודנט" });
    expect(plain?.scope).toBe("official");
    expect(plain?.basis).toBe("statute_name");
    const sectioned = buildRecoveryQuery(`${STATUTE_KEY}#4`, { statute: "חוק זכויות הסטודנט", section: "4" });
    expect(sectioned?.basis).toBe("statute_name_section");
    expect(sectioned?.query).toContain("סעיף 4");
  });

  it("returns null when the identity is not concrete enough to search", () => {
    expect(buildRecoveryQuery("case:", {})).toBeNull();
    expect(buildRecoveryQuery("statute:ח", {})).toBeNull();
    expect(buildRecoveryQuery("", {})).toBeNull();
  });
});

describe("recoveryOriginLabel (telemetry only)", () => {
  it("labels corpus, official and public reproductions", () => {
    expect(recoveryOriginLabel({ local_document_id: "abc" })).toBe("local_corpus");
    expect(recoveryOriginLabel({ url: "https://main.knesset.gov.il/x/y.aspx" })).toBe("official_source");
    expect(recoveryOriginLabel({ url: "https://www.psakdin.co.il/judgment/1" })).toBe("mirror_reproduction");
    expect(recoveryOriginLabel({})).toBe("other");
  });
});

// ─── recovery behaviour ─────────────────────────────────────────────────────

describe("exact-authority recovery", () => {
  it("recovers a concrete judgment copy after the known candidates fail", async () => {
    const store = new EvidenceStore();
    const seen: string[] = [];
    const log: Array<{ query: string; scope: string }> = [];
    const ledger = caseLedger(["https://court.gov.il/dead/1"]);
    const mirror = "https://www.psakdin.co.il/judgment/7829-03";
    const d = deps({
      ledger,
      store,
      fetchImpl: fakeFetch({ store, seen, good: [mirror] }),
      recoverySearch: searchReturning(
        [result("N1", { url: mirror, title: 'ע"פ 7829/03 — פסק דין מלא', possible_docket: "7829/03" })],
        log,
      ),
    });
    const out = await runAcquireAuthority(CASE_KEY, d);

    expect(out.status).toBe("acquired");
    expect(log).toHaveLength(1);
    expect(log[0].query).toContain('ע"פ 7829/03');
    expect(out.recovery?.recovery_triggered).toBe(true);
    expect(out.recovery?.concrete_candidates_attached).toBe(1);
    expect(out.recovery?.recovery_success).toBe(true);
    expect(out.recovery?.recovery_source_origin).toBe("mirror_reproduction");
    expect(out.recovery?.recovery_acquisition_attempts).toBe(1);
    expect(d.stats!.authority_recovery_triggered).toBe(1);
    expect(d.stats!.authority_recovery_success).toBe(1);
    expect(d.stats!.authority_recovery_records).toHaveLength(1);
  });

  it("rejects an article that merely mentions the docket", async () => {
    const store = new EvidenceStore();
    const seen: string[] = [];
    const ledger = caseLedger(["https://court.gov.il/dead/1"]);
    const article = "https://www.lawfirm.co.il/blog/7829-03-what-it-means";
    const out = await runAcquireAuthority(
      CASE_KEY,
      deps({
        ledger,
        store,
        fetchImpl: fakeFetch({ store, seen, good: [] }),
        recoverySearch: searchReturning(
          [result("N1", { url: article, title: 'סקירה על ע"פ 7829/03', possible_docket: "7829/03" })],
          [],
        ),
      }),
    );
    expect(out.status).not.toBe("acquired");
    expect(ledger.acquired(CASE_KEY)).toBe(false);
    expect(seen).toContain(article);
    expect(out.recovery?.recovery_success).toBe(false);
    expect(out.recovery?.recovery_failure_reason).toBeTruthy();
  });

  it("does not bind a judgment with a different proceeding type but the same number", async () => {
    const store = new EvidenceStore();
    const seen: string[] = [];
    const ledger = caseLedger(["https://court.gov.il/dead/1"]);
    const wrong = "https://mirror.example.com/civil/7829-03";
    const out = await runAcquireAuthority(
      CASE_KEY,
      deps({
        ledger,
        store,
        // The identity gate refuses it → never in `good`.
        fetchImpl: fakeFetch({ store, seen, good: [] }),
        recoverySearch: searchReturning(
          [result("N1", { url: wrong, title: 'ע"א 7829/03', possible_docket: "7829/03" })],
          [],
        ),
      }),
    );
    expect(out.status).not.toBe("acquired");
    expect(ledger.get(CASE_KEY)?.acquired_source_id).toBeUndefined();
  });

  it("never spends an acquisition attempt on a recovered search page", async () => {
    const store = new EvidenceStore();
    const seen: string[] = [];
    const ledger = caseLedger(["https://court.gov.il/dead/1"]);
    const out = await runAcquireAuthority(
      CASE_KEY,
      deps({
        ledger,
        store,
        fetchImpl: fakeFetch({ store, seen, good: [] }),
        recoverySearch: searchReturning(
          [result("N1", { url: "https://www.psakdin.co.il/search?query=7829/03", title: "תוצאות חיפוש" })],
          [],
        ),
      }),
    );
    expect(seen).toEqual(["https://court.gov.il/dead/1"]);
    expect(out.recovery?.concrete_candidates_attached).toBe(0);
    expect(out.recovery?.recovery_failure_reason).toBe("no_concrete_candidates");
  });

  it("binds a statute only after the recovered official page corroborates it", async () => {
    const store = new EvidenceStore();
    const seen: string[] = [];
    const log: Array<{ query: string; scope: string }> = [];
    const ledger = new AcquisitionLedger();
    ledger.openTarget(STATUTE_KEY, {
      label: "חוק זכויות הסטודנט",
      expected_identity: { statute: "חוק זכויות הסטודנט" },
      candidates: [{ result_id: "R0", url: "https://www.nevo.co.il/dead", candidate_kind: "document" }],
    });
    const official = "https://main.knesset.gov.il/Activity/Legislation/Laws/Pages/LawPrimary.aspx?lawitemid=2000123";
    const out = await runAcquireAuthority(
      STATUTE_KEY,
      deps({
        ledger,
        store,
        fetchImpl: fakeFetch({ store, seen, good: [official] }),
        recoverySearch: searchReturning(
          [result("N1", { url: official, title: "חוק זכויות הסטודנט, התשס\"ז-2007" })],
          log,
        ),
      }),
    );
    expect(log[0].scope).toBe("official");
    expect(out.status).toBe("acquired");
    expect(out.recovery?.recovery_source_origin).toBe("official_source");
  });

  it("leaves a section target unresolved when the recovered page lacks the section", async () => {
    const store = new EvidenceStore();
    const seen: string[] = [];
    const key = `${STATUTE_KEY}#12`;
    const ledger = new AcquisitionLedger();
    ledger.openTarget(key, {
      expected_identity: { statute: "חוק זכויות הסטודנט", section: "12" },
      candidates: [{ result_id: "R0", url: "https://www.nevo.co.il/dead", candidate_kind: "document" }],
    });
    const page = "https://main.knesset.gov.il/law/2000123";
    const out = await runAcquireAuthority(
      key,
      deps({
        ledger,
        store,
        // Section absent → the section gate refuses the binding.
        fetchImpl: fakeFetch({ store, seen, good: [] }),
        recoverySearch: searchReturning([result("N1", { url: page, title: "חוק זכויות הסטודנט" })], []),
      }),
    );
    expect(out.status).not.toBe("acquired");
    expect(ledger.acquired(key)).toBe(false);
  });

  it("does not run recovery discovery while a local corpus candidate is untried", async () => {
    const store = new EvidenceStore();
    const seen: string[] = [];
    const log: Array<{ query: string; scope: string }> = [];
    const ledger = new AcquisitionLedger();
    ledger.openTarget(CASE_KEY, {
      expected_identity: { docket: 'ע"פ 7829/03' },
      candidates: [{ result_id: "L0", local_document_id: "doc-1", candidate_kind: "local_document" }],
    });
    const out = await runAcquireAuthority(
      CASE_KEY,
      deps({
        ledger,
        store,
        fetchImpl: fakeFetch({ store, seen, good: [localAttemptKey("doc-1")] }),
        recoverySearch: searchReturning([], log),
      }),
    );
    expect(out.status).toBe("acquired");
    expect(log).toHaveLength(0);
    expect(out.recovery).toBeUndefined();
  });

  // ── bounding ──────────────────────────────────────────────────────────────

  it("runs recovery at most once per authority and never repeats it after failure", async () => {
    const store = new EvidenceStore();
    const seen: string[] = [];
    const log: Array<{ query: string; scope: string }> = [];
    const ledger = caseLedger(["https://court.gov.il/dead/1"]);
    const bad = "https://mirror.example.com/a";
    const d = deps({
      ledger,
      store,
      fetchImpl: fakeFetch({ store, seen, good: [] }),
      recoverySearch: searchReturning([result("N1", { url: bad, possible_docket: "7829/03" })], log),
    });
    await runAcquireAuthority(CASE_KEY, d);
    await runAcquireAuthority(CASE_KEY, d);
    await runAcquireAuthority(CASE_KEY, d);
    expect(log).toHaveLength(1);
    expect(ledger.canRefreshDiscovery(CASE_KEY)).toBe(false);
    expect(d.stats!.authority_recovery_triggered).toBe(1);
  });

  it("does not raise the concrete attempt ceiling", async () => {
    const store = new EvidenceStore();
    const seen: string[] = [];
    const ledger = caseLedger(["https://a.example.com/1", "https://a.example.com/2"]);
    const d = deps({
      ledger,
      store,
      fetchImpl: fakeFetch({ store, seen, good: [] }),
      recoverySearch: searchReturning(
        [
          result("N1", { url: "https://b.example.com/1", possible_docket: "7829/03" }),
          result("N2", { url: "https://b.example.com/2", possible_docket: "7829/03" }),
          result("N3", { url: "https://b.example.com/3", possible_docket: "7829/03" }),
        ],
        [],
      ),
    });
    await runAcquireAuthority(CASE_KEY, d);
    await runAcquireAuthority(CASE_KEY, d);
    expect(seen.length).toBeLessThanOrEqual(MAX_CONCRETE_ATTEMPTS_PER_AUTHORITY);
    expect(ledger.attemptsRemaining(CASE_KEY)).toBe(0);
  });

  it("never runs recovery for an abandoned or already acquired target", async () => {
    const store = new EvidenceStore();
    const seen: string[] = [];
    const log: Array<{ query: string; scope: string }> = [];

    const abandoned = caseLedger(["https://court.gov.il/dead/1"]);
    abandoned.abandonTarget(CASE_KEY, "not needed");
    await runAcquireAuthority(
      CASE_KEY,
      deps({
        ledger: abandoned,
        store,
        fetchImpl: fakeFetch({ store, seen, good: [] }),
        recoverySearch: searchReturning([result("N1", { url: "https://m.example.com/a" })], log),
      }),
    );
    expect(log).toHaveLength(0);

    const acquired = caseLedger([]);
    acquired.note(
      CASE_KEY,
      { url: "https://x", outcome: "acquired", reason: "body_self_identifies", at: new Date().toISOString() },
      "S1",
    );
    const out = await runAcquireAuthority(
      CASE_KEY,
      deps({
        ledger: acquired,
        store,
        fetchImpl: fakeFetch({ store, seen, good: [] }),
        recoverySearch: searchReturning([result("N2", { url: "https://m.example.com/b" })], log),
      }),
    );
    expect(out.status).toBe("already_acquired");
    expect(log).toHaveLength(0);
  });
});
