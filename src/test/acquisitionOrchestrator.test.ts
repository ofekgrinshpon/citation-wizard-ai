import { describe, expect, it } from "vitest";
import {
  AcquisitionLedger,
  MAX_CONCRETE_ATTEMPTS_PER_AUTHORITY,
  MAX_DISCOVERY_REFRESHES_PER_AUTHORITY,
} from "../../supabase/functions/legal-research-v2/tools/acquisitionLedger";
import {
  attachDiscoveryResults,
  emptyAcquisitionStats,
  isConcreteCandidate,
  pickMemoAcquisitionTarget,
  runAcquireAuthority,
  type AcquireDeps,
} from "../../supabase/functions/legal-research-v2/tools/acquisitionOrchestrator";
import { classifyCandidateUrlShape } from "../../supabase/functions/legal-research-v2/shared/urlShape";
import { EvidenceStore } from "../../supabase/functions/legal-research-v2/evidence/evidenceStore";
import { localAttemptKey } from "../../supabase/functions/legal-research-v2/tools/localCorpusBody";
import type { SearchResult } from "../../supabase/functions/legal-research-v2/types";
import type { FetchOutput } from "../../supabase/functions/legal-research-v2/tools/fetch";

const KEY = "case:8638/03";

function result(id: string, over: Partial<SearchResult> = {}): SearchResult {
  return {
    result_id: id,
    title: over.title ?? `מועמד ${id}`,
    origin: over.origin ?? "perplexity:web",
    ...over,
  } as SearchResult;
}

/**
 * Stand-in for `runFetch`: records a ledger attempt exactly like the real tool
 * and binds the authority only for URLs declared "good". No network, no gates
 * bypassed — the real gates are covered by the fetch/identity suites.
 */
function fakeFetch(opts: {
  good?: string[];
  store: EvidenceStore;
  seen: string[];
  throwOn?: string[];
}) {
  return (async (
    _store: EvidenceStore,
    discovered: Map<string, SearchResult>,
    input: { result_id?: string },
    ledger?: AcquisitionLedger,
  ): Promise<FetchOutput> => {
    const c = discovered.get(input.result_id ?? "")!;
    const attemptUrl = c.url ?? localAttemptKey(c.local_document_id ?? "x");
    opts.seen.push(attemptUrl);
    if (opts.throwOn?.includes(attemptUrl)) throw new Error("boom");
    const ok = opts.good?.includes(attemptUrl) ?? false;
    const src = await opts.store.append({
      url: c.url,
      title: c.title,
      origin: c.origin,
      fetch_status: "ok",
      extracted_text: ok ? "פסק דין מלא" : "דף שאינו המסמך",
      is_actual_document: true,
    });
    ledger?.note(
      c.authority_key ?? KEY,
      {
        url: attemptUrl,
        outcome: ok ? "acquired" : "not_the_document",
        reason: ok ? "body_self_identifies" : "docket_absent_from_body",
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
      authority_binding_basis: ok ? "body_self_identifies" : "docket_absent_from_body",
    };
  }) as unknown as AcquireDeps["fetchImpl"];
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

function openWithUrls(urls: string[]): AcquisitionLedger {
  const l = new AcquisitionLedger();
  l.openTarget(KEY, {
    label: 'בג"ץ 8638/03',
    expected_identity: { docket: "8638/03" },
    candidates: urls.map((u, i) => ({ result_id: `R${i}`, url: u, candidate_kind: "document" as const })),
  });
  return l;
}

// ─── URL shape ──────────────────────────────────────────────────────────────

describe("candidate URL shape", () => {
  it("treats real document endpoints as concrete", () => {
    for (
      const u of [
        "https://supremedecisions.court.gov.il/Home/Download?fileName=03086380_A11.txt&path=HebrewVerdicts/03/380/086/A11&type=2",
        "https://www.judgments.org.il/judgment/12345",
        "https://www.nevo.co.il/law_html/law01/999_001.htm",
        "https://example.ac.il/papers/article.pdf",
      ]
    ) {
      expect(classifyCandidateUrlShape(u)).toBe("concrete_document");
    }
  });

  it("treats search and portal entry points as discovery entries", () => {
    for (
      const u of [
        "https://supremedecisions.court.gov.il/Home/Search?query=8638/03",
        "https://www.gov.il/he/departments/legalInfo/search?freeText=%D7%A1%D7%99%D7%9E%D7%94",
        "https://main.knesset.gov.il/Activity/Legislation/Laws/Pages/LawPrimary.aspx?lawitemid=%D7%97%D7%95%D7%A7%20%D7%94%D7%97%D7%95%D7%96%D7%99%D7%9D",
        "https://www.nevo.co.il/#/search/query=x",
        "https://www.gov.il",
        "not a url",
      ]
    ) {
      expect(classifyCandidateUrlShape(u)).toBe("discovery_entry");
    }
  });

  it("never lets a declared discovery entry count as concrete", () => {
    expect(isConcreteCandidate({ url: "https://x.co.il/doc/1", candidate_kind: "discovery_entry" })).toBe(false);
    expect(isConcreteCandidate({ local_document_id: "abc" })).toBe(true);
  });
});

// ─── bounded acquisition loop ───────────────────────────────────────────────

describe("bounded authority acquisition", () => {
  it("stops at the first candidate that yields a corroborated body", async () => {
    const store = new EvidenceStore();
    const seen: string[] = [];
    const ledger = openWithUrls(["https://a.co.il/1", "https://b.co.il/2"]);
    const out = await runAcquireAuthority(
      KEY,
      deps({ ledger, store, fetchImpl: fakeFetch({ good: ["https://a.co.il/1"], store, seen }) }),
    );
    expect(out.status).toBe("acquired");
    expect(seen).toEqual(["https://a.co.il/1"]);
    expect(ledger.target(KEY)?.concrete_attempts).toBe(1);
  });

  it("falls through to the second, third and fourth candidate", async () => {
    const store = new EvidenceStore();
    const seen: string[] = [];
    const urls = ["https://a.co.il/1", "https://b.co.il/2", "https://c.co.il/3", "https://d.co.il/4"];
    const ledger = openWithUrls(urls);
    const out = await runAcquireAuthority(
      KEY,
      deps({ ledger, store, fetchImpl: fakeFetch({ good: ["https://d.co.il/4"], store, seen }) }),
    );
    expect(out.status).toBe("acquired");
    expect(seen).toEqual(urls);
  });

  it("never exceeds the per-authority attempt ceiling, across calls", async () => {
    const store = new EvidenceStore();
    const seen: string[] = [];
    const ledger = openWithUrls(["1", "2", "3", "4", "5", "6"].map((n) => `https://x.co.il/${n}`));
    const d = deps({ ledger, store, fetchImpl: fakeFetch({ good: [], store, seen }) });
    await runAcquireAuthority(KEY, d);
    const second = await runAcquireAuthority(KEY, d);
    expect(seen.length).toBe(MAX_CONCRETE_ATTEMPTS_PER_AUTHORITY);
    expect(second.status).toBe("exhausted");
    expect(ledger.target(KEY)?.exhaust_reason).toBe("attempt_ceiling");
  });

  it("asks for exactly one discovery refresh when the queue empties", async () => {
    const store = new EvidenceStore();
    const seen: string[] = [];
    const ledger = openWithUrls(["https://a.co.il/1"]);
    const d = deps({ ledger, store, fetchImpl: fakeFetch({ good: [], store, seen }) });
    const first = await runAcquireAuthority(KEY, d);
    expect(first.status).toBe("needs_discovery");
    expect(ledger.canRefreshDiscovery(KEY)).toBe(false);
    expect(MAX_DISCOVERY_REFRESHES_PER_AUTHORITY).toBe(1);

    // Nothing new was found: the second call must close the target, not loop.
    const second = await runAcquireAuthority(KEY, d);
    expect(second.status).toBe("exhausted");
  });

  it("continues with candidates attached during the refresh", async () => {
    const store = new EvidenceStore();
    const seen: string[] = [];
    const ledger = openWithUrls(["https://a.co.il/1"]);
    const d = deps({ ledger, store, fetchImpl: fakeFetch({ good: ["https://new.co.il/9"], store, seen }) });
    expect((await runAcquireAuthority(KEY, d)).status).toBe("needs_discovery");
    attachDiscoveryResults(ledger, [result("N1", { url: "https://new.co.il/9", possible_docket: "8638/03" })], {
      forAuthority: KEY,
    });
    const out = await runAcquireAuthority(KEY, d);
    expect(out.status).toBe("acquired");
    expect(seen).toEqual(["https://a.co.il/1", "https://new.co.il/9"]);
  });

  it("never retries a URL or a local row that already failed", async () => {
    const store = new EvidenceStore();
    const seen: string[] = [];
    const ledger = new AcquisitionLedger();
    ledger.openTarget(KEY, {
      expected_identity: { docket: "8638/03" },
      candidates: [
        { result_id: "L1", local_document_id: "doc-1", candidate_kind: "local_document" },
        { result_id: "R1", url: "https://a.co.il/1" },
      ],
    });
    const d = deps({ ledger, store, fetchImpl: fakeFetch({ good: [], store, seen }) });
    await runAcquireAuthority(KEY, d);
    expect(seen[0]).toBe(localAttemptKey("doc-1"));
    expect(new Set(seen).size).toBe(seen.length);
    expect(ledger.concreteUntried(KEY)).toHaveLength(0);
  });

  it("puts the stored corpus first and derived URLs last", () => {
    const ledger = new AcquisitionLedger();
    ledger.openTarget(KEY, {
      candidates: [
        { result_id: "D1", url: "https://guess.co.il/x", origin: "derived" },
        { result_id: "W1", url: "https://found.co.il/x", origin: "raw_web" },
        { result_id: "L1", local_document_id: "doc-1", candidate_kind: "local_document" },
      ],
    });
    expect(ledger.concreteUntried(KEY).map((c) => c.result_id)).toEqual(["L1", "W1", "D1"]);
  });

  it("stores search / portal entries but never spends an attempt on them", async () => {
    const store = new EvidenceStore();
    const seen: string[] = [];
    const ledger = new AcquisitionLedger();
    ledger.openTarget(KEY, {
      expected_identity: { docket: "8638/03" },
      candidates: [
        { result_id: "P1", url: "https://court.gov.il/Home/Search?q=8638", candidate_kind: "discovery_entry" },
        { result_id: "R1", url: "https://a.co.il/1" },
      ],
    });
    const d = deps({ ledger, store, fetchImpl: fakeFetch({ good: ["https://a.co.il/1"], store, seen }) });
    const out = await runAcquireAuthority(KEY, d);
    expect(out.status).toBe("acquired");
    expect(seen).toEqual(["https://a.co.il/1"]);
    expect(ledger.target(KEY)?.candidates).toHaveLength(2);
  });

  it("refuses an unsafe URL without spending an attempt", async () => {
    const store = new EvidenceStore();
    const seen: string[] = [];
    const ledger = openWithUrls(["http://127.0.0.1/secret", "https://a.co.il/1"]);
    const d = deps({ ledger, store, fetchImpl: fakeFetch({ good: ["https://a.co.il/1"], store, seen }) });
    const out = await runAcquireAuthority(KEY, d);
    expect(out.status).toBe("acquired");
    expect(seen).toEqual(["https://a.co.il/1"]);
    expect(ledger.target(KEY)?.concrete_attempts).toBe(1);
    expect(out.tried[0]).toMatchObject({ outcome: "skipped", reason: "unsafe_url" });
  });

  it("consumes the ordinary run-wide fetch budget and stops when it is gone", async () => {
    const store = new EvidenceStore();
    const seen: string[] = [];
    const ledger = openWithUrls(["https://a.co.il/1", "https://b.co.il/2", "https://c.co.il/3"]);
    let budget = 2;
    const out = await runAcquireAuthority(
      KEY,
      deps({
        ledger,
        store,
        canFetch: () => budget > 0,
        noteFetch: () => {
          budget -= 1;
        },
        fetchImpl: fakeFetch({ good: [], store, seen }),
      }),
    );
    expect(seen).toHaveLength(2);
    expect(budget).toBe(0);
    expect(out.status).toBe("fetch_budget_exhausted");
  });

  it("keeps the persisted target identity even when a candidate claims another", async () => {
    const store = new EvidenceStore();
    const seen: string[] = [];
    const ledger = openWithUrls(["https://a.co.il/1"]);
    const stats = emptyAcquisitionStats();
    const discovered = new Map<string, SearchResult>([
      ["R0", result("R0", { url: "https://a.co.il/1", expected_identity: { docket: "1111/11" } })],
    ]);
    let sawIdentity: unknown;
    const spy = (async (
      _s: EvidenceStore,
      d: Map<string, SearchResult>,
      input: { result_id?: string },
    ): Promise<FetchOutput> => {
      sawIdentity = d.get(input.result_id!)!.expected_identity;
      seen.push("x");
      return { ok: false };
    }) as unknown as AcquireDeps["fetchImpl"];
    await runAcquireAuthority(KEY, deps({ ledger, store, discovered, stats, fetchImpl: spy }));
    expect(sawIdentity).toEqual({ docket: "8638/03" });
    expect(stats.authority_identity_conflicts).toBe(1);
  });

  it("survives serialization and resume with its counters intact", async () => {
    const store = new EvidenceStore();
    const seen: string[] = [];
    const ledger = openWithUrls(["https://a.co.il/1", "https://b.co.il/2", "https://c.co.il/3"]);
    await runAcquireAuthority(
      KEY,
      deps({ ledger, store, maxAttempts: 2, fetchImpl: fakeFetch({ good: [], store, seen }) }),
    );
    const back = AcquisitionLedger.fromJSON(JSON.parse(JSON.stringify(ledger.toJSON())));
    expect(back.target(KEY)?.concrete_attempts).toBe(2);
    expect(back.attemptsRemaining(KEY)).toBe(MAX_CONCRETE_ATTEMPTS_PER_AUTHORITY - 2);
    expect(back.concreteUntried(KEY).map((c) => c.url)).toEqual(["https://c.co.il/3"]);
  });

  it("reports target_not_found instead of inventing a target", async () => {
    const out = await runAcquireAuthority(
      "case:1/11",
      deps({ ledger: new AcquisitionLedger(), store: new EvidenceStore() }),
    );
    expect(out.status).toBe("target_not_found");
  });

  it("answers already_acquired without another attempt", async () => {
    const store = new EvidenceStore();
    const seen: string[] = [];
    const ledger = openWithUrls(["https://a.co.il/1", "https://b.co.il/2"]);
    const d = deps({ ledger, store, fetchImpl: fakeFetch({ good: ["https://a.co.il/1"], store, seen }) });
    await runAcquireAuthority(KEY, d);
    const again = await runAcquireAuthority(KEY, d);
    expect(again.status).toBe("already_acquired");
    expect(seen).toHaveLength(1);
  });

  it("keeps going when one candidate throws", async () => {
    const store = new EvidenceStore();
    const seen: string[] = [];
    const ledger = openWithUrls(["https://a.co.il/1", "https://b.co.il/2"]);
    const out = await runAcquireAuthority(
      KEY,
      deps({
        ledger,
        store,
        fetchImpl: fakeFetch({ good: ["https://b.co.il/2"], store, seen, throwOn: ["https://a.co.il/1"] }),
      }),
    );
    expect(out.status).toBe("acquired");
    expect(seen).toEqual(["https://a.co.il/1", "https://b.co.il/2"]);
  });
});

// ─── discovery attachment ───────────────────────────────────────────────────

describe("discovery → target attachment", () => {
  const STATUTE_KEY = 'statute:חוק החוזים (חלק כללי), התשל"ג-1973';

  function ledgerWithBoth(): AcquisitionLedger {
    const l = new AcquisitionLedger();
    l.openTarget(KEY, { expected_identity: { docket: "8638/03" } });
    l.openTarget(STATUTE_KEY, { expected_identity: { statute: 'חוק החוזים (חלק כללי), התשל"ג-1973' } });
    return l;
  }

  it("attaches a raw result that carries the target docket", () => {
    const l = ledgerWithBoth();
    const n = attachDiscoveryResults(l, [
      result("A", { url: "https://x.co.il/a", title: 'בג"ץ 8638/03 סימה אמיר' }),
      result("B", { url: "https://x.co.il/b", title: "מאמר על חלוקת רכוש" }),
    ]);
    expect(n.attached).toBe(1);
    expect(l.concreteUntried(KEY).map((c) => c.result_id)).toEqual(["A"]);
  });

  it("does not attach an unrelated result to any target", () => {
    const l = ledgerWithBoth();
    const n = attachDiscoveryResults(l, [result("Z", { url: "https://x.co.il/z", title: "חדשות היום" })]);
    expect(n.attached).toBe(0);
    expect(l.concreteUntried(KEY)).toHaveLength(0);
  });

  it("attaches by statute name for a statute target", () => {
    const l = ledgerWithBoth();
    attachDiscoveryResults(l, [
      result("S", { url: "https://x.co.il/s", title: 'חוק החוזים (חלק כללי), התשל"ג-1973 — נוסח מלא' }),
    ]);
    expect(l.concreteUntried(STATUTE_KEY).map((c) => c.result_id)).toEqual(["S"]);
  });

  it("honours an explicit for_authority, identity matches first", () => {
    const l = ledgerWithBoth();
    const out = attachDiscoveryResults(l, [
      result("P", { url: "https://x.co.il/p", title: "עמוד כללי" }),
      result("Q", { url: "https://x.co.il/q", title: 'בג"ץ 8638/03' }),
    ], { forAuthority: KEY });
    expect(out.attached).toBe(2);
    expect(l.concreteUntried(KEY).map((c) => c.result_id)).toEqual(["Q", "P"]);
  });

  it("reports an unknown for_authority instead of opening a target", () => {
    const l = ledgerWithBoth();
    const out = attachDiscoveryResults(l, [result("P", { url: "https://x.co.il/p" })], {
      forAuthority: "case:9999/99",
    });
    expect(out.unknown_target).toBe("case:9999/99");
    expect(l.target("case:9999/99")).toBeNull();
  });

  it("never attaches a search page as a concrete candidate", () => {
    const l = ledgerWithBoth();
    attachDiscoveryResults(l, [
      result("E", { url: "https://court.gov.il/Home/Search?q=8638/03", title: 'בג"ץ 8638/03' }),
    ], { forAuthority: KEY });
    expect(l.concreteUntried(KEY)).toHaveLength(0);
  });

  it("does not link the same candidate twice", () => {
    const l = ledgerWithBoth();
    const r = result("A", { url: "https://x.co.il/a", title: 'בג"ץ 8638/03' });
    attachDiscoveryResults(l, [r]);
    attachDiscoveryResults(l, [r]);
    expect(l.target(KEY)?.candidates).toHaveLength(1);
  });
});

// ─── statute section reuse ──────────────────────────────────────────────────

describe("section from an already acquired parent statute", () => {
  const PARENT = "statute:חוק רישוי עסקים";
  const CHILD = "statute:חוק רישוי עסקים#7";
  const BODY = [
    "חוק רישוי עסקים, התשכ\"ח-1968",
    "1. שר הפנים רשאי לקבוע עסקים טעוני רישוי.",
    "7. רשות הרישוי רשאית לבטל רישיון לאחר שניתנה לבעל הרישיון הזדמנות להשמיע טענותיו.",
  ].join("\n");

  async function setup() {
    const store = new EvidenceStore();
    const src = await store.append({
      url: "https://x.co.il/law",
      title: "חוק רישוי עסקים",
      origin: "test",
      fetch_status: "ok",
      extracted_text: BODY,
      is_actual_document: true,
    });
    const ledger = new AcquisitionLedger();
    ledger.note(
      PARENT,
      { url: "https://x.co.il/law", outcome: "acquired", reason: "statute_name_match", at: "now", identity_corroborated: true },
      src.source_id,
    );
    return { store, ledger, source_id: src.source_id };
  }

  it("satisfies a section target from the parent body when the section is there", async () => {
    const { store, ledger, source_id } = await setup();
    ledger.openTarget(CHILD, { expected_identity: { statute: "חוק רישוי עסקים", section: "7" } });
    const out = await runAcquireAuthority(CHILD, deps({ ledger, store }));
    expect(out.status).toBe("acquired");
    expect(out.source_id).toBe(source_id);
    expect(out.basis).toBe("section_located_in_parent_statute_body");
    expect(out.windows?.join("")).toContain("הזדמנות להשמיע");
    expect(ledger.acquired(CHILD)).toBe(true);
  });

  it("leaves the target unresolved when the section is absent from the parent", async () => {
    const { store, ledger } = await setup();
    const missing = "statute:חוק רישוי עסקים#31";
    ledger.openTarget(missing, { expected_identity: { statute: "חוק רישוי עסקים", section: "31" } });
    const out = await runAcquireAuthority(missing, deps({ ledger, store }));
    expect(ledger.acquired(missing)).toBe(false);
    expect(out.status).not.toBe("acquired");
  });
});

// ─── pre-memo gate ──────────────────────────────────────────────────────────

describe("pre-memo acquisition gate", () => {
  it("selects a workable target named by a core claim", () => {
    const l = openWithUrls(["https://a.co.il/1"]);
    expect(
      pickMemoAcquisitionTarget(l, [{ proposition: 'בבג"ץ 8638/03 נקבע כי...', importance: "core" }]),
    ).toBe(KEY);
  });

  it("ignores supporting claims and unrelated propositions", () => {
    const l = openWithUrls(["https://a.co.il/1"]);
    expect(pickMemoAcquisitionTarget(l, [{ proposition: 'בבג"ץ 8638/03', importance: "supporting" }])).toBeNull();
    expect(pickMemoAcquisitionTarget(l, [{ proposition: "כלל אחר לגמרי", importance: "core" }])).toBeNull();
  });

  it("ignores a target with no untried concrete path", () => {
    const l = new AcquisitionLedger();
    l.openTarget(KEY, {
      expected_identity: { docket: "8638/03" },
      candidates: [{ result_id: "P", url: "https://c.gov.il/Home/Search?q=1", candidate_kind: "discovery_entry" }],
    });
    expect(pickMemoAcquisitionTarget(l, [{ proposition: 'בג"ץ 8638/03', importance: "core" }])).toBeNull();
  });

  it("fires at most once per run", () => {
    const l = openWithUrls(["https://a.co.il/1"]);
    expect(l.memoGateUsed()).toBe(false);
    l.markMemoGateUsed();
    expect(AcquisitionLedger.fromJSON(JSON.parse(JSON.stringify(l.toJSON()))).memoGateUsed()).toBe(true);
  });
});
