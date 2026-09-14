/**
 * v2_local_corpus_body_acquisition_v1 + v2_per_run_egress_reset_v1
 *
 * Invariants under test:
 *  • a body the corpus already stores can be acquired with NO network call;
 *  • locality buys no trust — the stored body still has to pass the document
 *    check and positive authority corroboration before it may bind;
 *  • the model can never retarget a candidate's identity or name a row id;
 *  • egress caps are reset per run but never removed or widened.
 *
 * Nothing here hard-codes a real docket in runtime logic; the fixtures are
 * generic stand-ins.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  docketVariants,
  loadLocalDocument,
  localAttemptKey,
  textCarriesDocket,
} from "../../supabase/functions/legal-research-v2/tools/localCorpusBody";
import { runFetch } from "../../supabase/functions/legal-research-v2/tools/fetch";
import { EvidenceStore } from "../../supabase/functions/legal-research-v2/evidence/evidenceStore";
import {
  AcquisitionLedger,
  authorityKeyOf,
} from "../../supabase/functions/legal-research-v2/tools/acquisitionLedger";
import type { SearchResult } from "../../supabase/functions/legal-research-v2/types";
import {
  OFFICIAL_FETCH_LIMITS,
  officialFetchTelemetry,
} from "../../supabase/functions/legal-research-v2/vendor/officialFetch";
import { COURT_EGRESS_LIMITS } from "../../supabase/functions/legal-research-v2/vendor/courtEgress";
import {
  egressTelemetry,
  resetEgressStateForRun,
} from "../../supabase/functions/legal-research-v2/shared/egressTelemetry";

// The egress modules read configuration from the Edge runtime's env.
(globalThis as unknown as { Deno?: unknown }).Deno ??= {
  env: { get: (k: string) => process.env[k] },
};

const DOCKET = "4602/13";
const OTHER_DOCKET = "1234/99";

const JUDGMENT_BODY = [
  `בבית המשפט העליון — בג"ץ ${DOCKET}`,
  "לפני כבוד הנשיאה",
  "העותר: פלוני",
  "נגד",
  "המשיבה: הרשות",
  "פסק דין. העתירה נסבה על היקף חובתה של הרשות לנמק את החלטתה.",
  "בית המשפט עמד על כך שהחלטה מנהלית טעונה תשתית עובדתית ראויה. ".repeat(30),
  "סוף דבר: העתירה נדחית.",
].join("\n");

const OTHER_BODY = [
  `בבית המשפט העליון — ע"א ${OTHER_DOCKET}`,
  "פסק דין בעניין אחר לגמרי, שאין בינו לבין העתירה דבר. ".repeat(30),
].join("\n");

interface Row {
  id: string;
  title: string;
  content: string;
  source_url?: string | null;
  citation?: string | null;
  case_number?: string | null;
}

/** Minimal stand-in for the admin client: only `.eq(id).maybeSingle()`. */
function fakeAdmin(rows: Row[]) {
  return {
    from() {
      let wanted = "";
      const builder = {
        select: () => builder,
        eq: (_col: string, val: string) => {
          wanted = val;
          return builder;
        },
        maybeSingle: async () => ({ data: rows.find((r) => r.id === wanted) ?? null, error: null }),
      };
      return builder;
    },
  } as never;
}

function localCandidate(over: Partial<SearchResult> = {}): SearchResult {
  return {
    result_id: "R1",
    title: "פסק דין שמור במאגר",
    snippet: "local_match=case_number_exact",
    origin: "local_corpus",
    candidate_kind: "local_document",
    local_document_id: "doc-1",
    local_match_basis: "case_number_exact",
    authority_key: authorityKeyOf({ docket: DOCKET })!,
    expected_identity: { docket: DOCKET },
    ...over,
  } as SearchResult;
}

describe("A. docket normalization is generic", () => {
  it("treats slash and dash forms of the same docket as equivalent", () => {
    expect(docketVariants("4602/13").canonical).toBe("4602/13");
    expect(docketVariants("4602-13").canonical).toBe("4602/13");
    expect(docketVariants('בג"ץ 6929-10').canonical).toBe("6929/10");
    expect(docketVariants("04602/13").canonical).toBe("4602/13");
  });

  it("keeps three-part lower-court dockets in their dash form", () => {
    const v = docketVariants("50358-09-16");
    expect(v.canonical).toBe("50358-09-16");
    expect(v.variants).toContain("50358/09/16");
  });

  it("finds a docket inside a citation string carrying a Hebrew case type", () => {
    expect(textCarriesDocket('בג"ץ 4602-13 פלוני נ\' אלמוני', DOCKET)).toBe(true);
    expect(textCarriesDocket('ע"א 1234/99 אחר', DOCKET)).toBe(false);
    expect(textCarriesDocket(null, DOCKET)).toBe(false);
  });

  it("returns nothing for text with no docket at all", () => {
    expect(docketVariants("מאמר על חלוקת רכוש").canonical).toBeNull();
    expect(textCarriesDocket("ללא מספר", "ללא מספר")).toBe(false);
  });
});

describe("B. loading a stored row", () => {
  it("returns the row body by id", async () => {
    const row = await loadLocalDocument(
      fakeAdmin([{ id: "doc-1", title: "t", content: JUDGMENT_BODY }]),
      "doc-1",
    );
    expect(row?.content).toBe(JUDGMENT_BODY);
  });

  it("returns null without a client or for a missing row", async () => {
    expect(await loadLocalDocument(null, "doc-1")).toBeNull();
    expect(await loadLocalDocument(fakeAdmin([]), "doc-1")).toBeNull();
  });

  it("uses a dedicated, non-HTTP attempt key", () => {
    expect(localAttemptKey("doc-1")).toBe("local:legal_documents/doc-1");
    expect(localAttemptKey("doc-1").startsWith("http")).toBe(false);
  });
});

describe("C. acquiring a local body performs no network request", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("network access is not allowed for a local corpus acquisition");
    });
  });
  afterEach(() => fetchSpy.mockRestore());

  it("binds the authority when the stored body carries the requested docket", async () => {
    const store = new EvidenceStore();
    const ledger = new AcquisitionLedger();
    const discovered = new Map<string, SearchResult>([["R1", localCandidate()]]);

    const out = await runFetch(
      store,
      discovered,
      { result_id: "R1" },
      ledger,
      { admin: fakeAdmin([{ id: "doc-1", title: "פסק דין", content: JUDGMENT_BODY }]) },
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out.ok).toBe(true);
    expect(out.acquisition_transport).toBe("local_corpus");
    expect(out.local_match_basis).toBe("case_number_exact");
    expect(out.is_actual_document).toBe(true);
    expect(out.authority_identity_corroborated).toBe(true);
    expect(out.authority_binding_created).toBe(true);
    expect(store.readable().length).toBe(1);
  });

  it("rejects a title-matched row whose body is a different case", async () => {
    const store = new EvidenceStore();
    const ledger = new AcquisitionLedger();
    const discovered = new Map<string, SearchResult>([[
      "R1",
      localCandidate({ local_match_basis: "title_ilike", local_document_id: "doc-2" }),
    ]]);

    const out = await runFetch(
      store,
      discovered,
      { result_id: "R1" },
      ledger,
      { admin: fakeAdmin([{ id: "doc-2", title: "פסק דין אחר", content: OTHER_BODY }]) },
    );

    expect(out.ok).toBe(true);
    expect(out.authority_identity_corroborated).toBe(false);
    expect(out.authority_binding_created).toBeFalsy();
    expect(out.authority_binding_withheld).toBe(true);
    expect(out.authority_binding_basis).toBe("docket_absent_from_body");
  });

  it("fails honestly on an empty or too-short stored body", async () => {
    const store = new EvidenceStore();
    const ledger = new AcquisitionLedger();
    const discovered = new Map<string, SearchResult>([["R1", localCandidate()]]);

    const empty = await runFetch(store, discovered, { result_id: "R1" }, ledger, {
      admin: fakeAdmin([{ id: "doc-1", title: "t", content: "" }]),
    });
    expect(empty.ok).toBe(false);
    expect(empty.error).toBe("local_body_empty");

    const short = await runFetch(store, new Map([["R2", localCandidate({ result_id: "R2" })]]), {
      result_id: "R2",
    }, ledger, { admin: fakeAdmin([{ id: "doc-1", title: "t", content: "קצר מדי" }]) });
    expect(short.ok).toBe(false);
    expect(String(short.error)).toContain("local_body_");
    expect(store.readable().length).toBe(0);
  });

  it("fails honestly, without a fallback candidate, when the row is gone", async () => {
    const out = await runFetch(
      new EvidenceStore(),
      new Map([["R1", localCandidate()]]),
      { result_id: "R1" },
      new AcquisitionLedger(),
      { admin: fakeAdmin([]) },
    );
    expect(out.ok).toBe(false);
    expect(out.error).toBe("local_document_unavailable");
    expect(out.acquisition_transport).toBe("local_corpus");
  });

  it("keeps the candidate's identity when the model supplies a different one", async () => {
    const out = await runFetch(
      new EvidenceStore(),
      new Map([["R1", localCandidate()]]),
      { result_id: "R1", expected_identity: { docket: OTHER_DOCKET } },
      new AcquisitionLedger(),
      { admin: fakeAdmin([{ id: "doc-1", title: "פסק דין", content: JUDGMENT_BODY }]) },
    );
    // The durable candidate wins: the conflict is reported, and the body is
    // still corroborated against the authority the lookup was made for.
    expect(out.expected_identity_conflict).toBeTruthy();
    expect(out.expected_authority_key).toBe(authorityKeyOf({ docket: DOCKET }));
    expect(out.authority_identity_corroborated).toBe(true);
  });

  it("does not follow a local candidate when the model passes an explicit url", async () => {
    const out = await runFetch(
      new EvidenceStore(),
      new Map([["R1", localCandidate()]]),
      { result_id: "R1", url: "not-a-url" },
      new AcquisitionLedger(),
      { admin: fakeAdmin([{ id: "doc-1", title: "t", content: JUDGMENT_BODY }]) },
    );
    expect(out.ok).toBe(false);
    expect(out.error).toBe("no_usable_url");
  });
});

describe("D. per-run egress reset keeps every cap in place", () => {
  it("clears a stopped state from an earlier run", () => {
    resetEgressStateForRun();
    const before = egressTelemetry();
    expect(before.official_calls).toBe(0);
    expect(before.relay_calls).toBe(0);
    expect(before.official_stopped_reason).toBeNull();
    expect(before.relay_stopped_reason).toBeNull();
    expect(officialFetchTelemetry().stopped_reason).toBeNull();
  });

  it("does not remove, raise or disable any cap", () => {
    const officialCap = OFFICIAL_FETCH_LIMITS.MAX_PER_RUN;
    const relayCap = COURT_EGRESS_LIMITS.MAX_PER_RUN;
    resetEgressStateForRun();
    const t = egressTelemetry();
    expect(t.official_max_per_run).toBe(officialCap);
    expect(t.relay_max_per_run).toBe(relayCap);
    expect(officialCap).toBeGreaterThan(0);
    expect(relayCap).toBeGreaterThan(0);
  });
});
