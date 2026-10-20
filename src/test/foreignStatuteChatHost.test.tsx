/**
 * Stage 4 correction — the ACTUAL chat page (Index.tsx) statute path:
 * initial send and explicit regeneration. Only external boundaries are mocked
 * (auth/hooks, classifier, verified store, function transport); the typed
 * request is answered by the production server route with mocked search.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runForeignLookup } from "../../supabase/functions/citation-chat/foreignLookup";
import { resolveStatuteLookup } from "../../supabase/functions/citation-chat/statuteRoute";

const m = vi.hoisted(() => ({
  invoke: vi.fn(), classify: vi.fn(), recordGeneration: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "acct-1" }, isAdmin: false, loading: false, signOut: vi.fn() }) }));
vi.mock("@/hooks/useOffice", () => ({ useOffice: () => ({ isOfficeAddin: true }) }));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ loading: false, isLimitReached: false, isSubscribed: true, remaining: 1, limit: 1, incrementCount: vi.fn() }) }));
vi.mock("@/hooks/useCredits", () => ({ useCredits: () => ({ billingPeriodEndsAt: null, planMeta: { label: "x" } }) }));
vi.mock("@/hooks/useProjects", () => ({ useProjects: () => ({ currentProject: null }) }));
vi.mock("@/hooks/useActivityLog", () => ({ useActivityLog: () => ({ log: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  const fn = () => chain;
  for (const k of ["from", "select", "or", "limit", "insert", "eq", "maybeSingle"]) chain[k] = fn;
  chain.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
  return { supabase: chain };
});
vi.mock("@/lib/sourceTypeClassifier", () => ({ resolveSourceType: m.classify }));
vi.mock("@/lib/verifiedSources", () => ({
  findVerifiedSourceMatch: vi.fn().mockResolvedValue(null), findSimilarVerifiedSource: vi.fn().mockResolvedValue(null),
  ensureVerifiedSources: vi.fn().mockResolvedValue({ invalid: 0, skipped: 0, added: 0 }),
  classifyVerifiedSource: vi.fn(), getVerifiedCategoryLabel: vi.fn(),
}));
vi.mock("@/lib/functionError", () => ({ invokeFunction: m.invoke, retryCitationFunction: vi.fn(), citationRetryDisclosure: vi.fn() }));
vi.mock("@/lib/citationHistorySave", () => ({ saveCitationHistoryRecord: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/foreignClassificationStore", () => ({ recordGeneration: m.recordGeneration, clearItemsWithPrefix: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() }) }));
vi.mock("@/components/MessageBubble", () => ({
  MessageBubble: ({ msg, onChangeSourceType }: { msg: { role: string; content: string }; onChangeSourceType?: (t: string, p: unknown) => void }) => (
    <div data-testid={`bubble-${msg.role}`}>
      <span>{msg.content}</span>
      {onChangeSourceType && (
        <button type="button" onClick={() => onChangeSourceType("case_law_database", {
          itemKey: "chat:0", sourceType: "case_law_database", supported: true, effectiveKey: "il-eff", inputFingerprint: "il-fp",
          manualChoice: { jurisdiction: "IL", sourceType: "case_law_database" },
        })}>regen-israel</button>
      )}
      {onChangeSourceType && (
        <button type="button" onClick={() => onChangeSourceType("foreign_statute_uk", {
          itemKey: "chat:0", sourceType: "foreign_statute_uk", supported: true, effectiveKey: "eff", inputFingerprint: "fp",
        })}>regen-uk</button>
      )}
      {onChangeSourceType && (
        <button type="button" onClick={() => onChangeSourceType("foreign_case_us", {
          itemKey: "chat:0", sourceType: "foreign_case_us", supported: true, effectiveKey: "us-case-eff", inputFingerprint: "us-case-fp",
        })}>regen-us-case</button>
      )}
      {onChangeSourceType && (["foreign_unpublished_manuscript", "foreign_thesis", "foreign", "foreign_newspaper", "foreign_journal_article", "foreign_book", "foreign_book_chapter"] as const).map((t) => (
        <button key={t} type="button" onClick={() => onChangeSourceType(t, {
          itemKey: "chat:0", sourceType: t, supported: t !== "foreign", effectiveKey: `eff-${t}`, inputFingerprint: `fp-${t}`,
        })}>{`regen-${t}`}</button>
      ))}
    </div>
  ),
}));
vi.mock("@/components/VerifiedAutocomplete", () => ({
  VerifiedAutocomplete: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="citation-input" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
const Null = () => null;
for (const path of ["LegalQAChat", "AppSidebar", "CitationHistorySidebar", "QAHistorySidebar", "FootnotesSection", "BibliographyGenerator",
  "BatchFootnoteBuilder", "ReLexLogo", "LoadingDots", "VerifiedSuggestionCard", "PublicationIntegrityCard", "BillTypeSelector", "TreatyTypeSelector",
  "CitationRequestStatusLink"]) {
  vi.doMock(`@/components/${path}`, () => ({ [path]: Null }));
}
vi.mock("@/components/research-chat/ResearchConversationSidebar", () => ({ ResearchConversationSidebar: Null }));

type Source = { title?: string; url?: string; snippet?: string };
function serverWith(results: Source[]) {
  const fetchImpl = (async () => new Response(JSON.stringify({ results }), { status: 200 })) as unknown as typeof fetch;
  return (request: unknown) => resolveStatuteLookup(request, { apiKey: "offline-only", fetchImpl, runLookup: runForeignLookup });
}

async function mountChat() {
  const { default: Index } = await import("@/pages/Index");
  render(<MemoryRouter><Index /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: /אזכור אחיד/ }));
}

async function send(text: string) {
  fireEvent.change(screen.getByLabelText("citation-input"), { target: { value: text } });
  await act(async () => { fireEvent.click(document.querySelector(".btn-send") as HTMLButtonElement); });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); }));
});

const CORNELL_1983 = { title: "42 U.S.C. § 1983 - Civil action for deprivation of rights", url: "https://www.law.cornell.edu/uscode/text/42/1983", snippet: "Civil Rights Act — 42 U.S.C. § 1983 (2018)." };

describe("chat page — typed statute request through initial send and regeneration", () => {
  it("batch A Brown initial then manual book regeneration is terminal local conflict", async () => {
    const input = "Brown v. Board of Education";
    m.invoke.mockResolvedValue({ data: { content: "UNSAFE MODEL OUTPUT" }, errorInfo: null });
    await mountChat(); await send(input);
    await waitFor(() => expect(screen.getByTestId("bubble-assistant")).toHaveTextContent(input));
    expect(m.invoke).toHaveBeenCalledTimes(1); expect(m.invoke.mock.calls[0][1].foreignLookup.kind).toBe("case");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "regen-foreign_book" })); });
    expect(m.invoke).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("bubble-assistant")).toHaveTextContent(input);
    expect(screen.getByTestId("bubble-assistant")).toHaveTextContent("סותרים");
    expect(screen.getByTestId("bubble-assistant")).not.toHaveTextContent("UNSAFE MODEL OUTPUT");
  });
  it("batch A German input and conflicting Israel regeneration stay local", async () => {
    await mountChat(); await send("BVerfG 1 BvR 400/51");
    await waitFor(() => expect(screen.getByTestId("bubble-assistant")).toHaveTextContent("אינו נתמך"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "regen-israel" })); });
    expect(screen.getByTestId("bubble-assistant")).toHaveTextContent("סותרים");
    expect(m.invoke).not.toHaveBeenCalled();
  });
  it("batch A incomplete US-shaped case uses typed request in initial/manual chat and ignores generic output", async () => {
    const input = "Brown v. Board of Education";
    m.invoke.mockResolvedValue({ data: { content: "UNSAFE MODEL OUTPUT" }, errorInfo: null });
    await mountChat(); await send(input);
    await waitFor(() => expect(screen.getByTestId("bubble-assistant")).toHaveTextContent(input));
    expect(m.invoke.mock.calls[0][1].foreignLookup).toMatchObject({ kind: "case", jurisdiction: "UNKNOWN", rawInput: input });
    expect(m.invoke.mock.calls[0][1].pastedCitation).toMatchObject({ version: 1, rawInput: input, jurisdiction: "UNKNOWN" });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "regen-us-case" })); });
    expect(m.invoke.mock.calls[1][1].pastedCitation.manualChoice.jurisdiction).toBe("US");
    expect(screen.getByTestId("bubble-assistant")).not.toHaveTextContent("UNSAFE MODEL OUTPUT");
  });
  it.each(['ע"א 1234/20 כהן נ׳ לוי (נבו 2.3.2021)', 'ע"א 1234/20'])("batch A Israeli control retains original request flow: %s", async input => {
    m.classify.mockResolvedValue({ sourceType: "case_law_database", source: "regex" });
    m.invoke.mockResolvedValue({ data: { content: 'ע"א 1234/20 כהן נ׳ לוי (נבו 2.3.2021)' }, errorInfo: null });
    await mountChat(); await send(input);
    await waitFor(() => expect(m.invoke).toHaveBeenCalledTimes(1));
    expect(m.invoke.mock.calls[0][1].pastedCitation).toMatchObject({ route: "israeli", jurisdiction: "IL", rawInput: input });
  });
  it.each([
    "BVerfG, Urteil vom 15. Januar 1958, 1 BvR 400/51, BVerfGE 7, 198",
    "BVerfG 1 BvR 400/51",
    "400/51",
  ])("batch A initial and foreign manual regeneration preserve unsafe docket locally: %s", async (input) => {
    m.classify.mockResolvedValue({ sourceType: "unknown", source: "regex" });
    m.invoke.mockResolvedValue({ data: { content: "UNSAFE MODEL OUTPUT" }, errorInfo: null });
    await mountChat();
    await send(input);
    await waitFor(() => expect(screen.getByTestId("bubble-assistant")).toHaveTextContent(input));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "regen-foreign" })); });
    expect(screen.getByTestId("bubble-assistant")).toHaveTextContent(input);
    expect(m.invoke).not.toHaveBeenCalled();
    expect(m.classify).not.toHaveBeenCalled();
  });
  it("batch A complete US case initial and manual regeneration use the shared local route", async () => {
    const input = "Brown v. Board of Education, 347 U.S. 483 (1954)";
    m.classify.mockResolvedValue({ sourceType: "foreign_case_us", source: "regex" });
    m.invoke.mockResolvedValue({ data: { content: "UNSAFE MODEL OUTPUT" }, errorInfo: null });
    await mountChat();
    await send(input);
    await waitFor(() => expect(screen.getByTestId("bubble-assistant")).toHaveTextContent("347 U.S. 483 (1954)"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "regen-us-case" })); });
    expect(m.invoke).not.toHaveBeenCalled();
  });
  const MS = "Maya Cohen, Courts and Memory 12–15 (Mar. 2, 2024) (unpublished manuscript) (on file with author)";
  const TH = "Maya Cohen, Courts and Memory 12, 15 (2024) (Ph.D. dissertation, Example University) (on file with Example Library)";
  it.each([[MS, "foreign_unpublished_manuscript"], [TH, "foreign_thesis"]] as const)("R17.2 actual chat initial+same-type regeneration stays local: %s", async (input, type) => {
    m.classify.mockResolvedValue({ sourceType: type, source: "regex" });
    m.invoke.mockResolvedValue({ data: { content: "MODEL TEXT" }, errorInfo: null });
    await mountChat();
    await send(input);
    await waitFor(() => expect(screen.getByTestId("bubble-assistant")).toHaveTextContent(`${input}.`));
    expect(screen.getByTestId("bubble-assistant")).toHaveTextContent("לא אומתו");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: `regen-${type}` })); });
    await waitFor(() => expect(m.recordGeneration).toHaveBeenCalledWith("acct-1", expect.objectContaining({ effectiveKey: `eff-${type}` })));
    expect(m.invoke).not.toHaveBeenCalled();
  });
  it("R17.2 manual thesis on a manuscript label is preserved locally with a mismatch warning", async () => {
    m.classify.mockResolvedValue({ sourceType: "foreign_unpublished_manuscript", source: "regex" });
    await mountChat();
    await send(MS);
    await waitFor(() => expect(screen.getByTestId("bubble-assistant")).toHaveTextContent(`${MS}.`));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "regen-foreign_thesis" })); });
    await waitFor(() => expect(screen.getByTestId("bubble-assistant")).toHaveTextContent("אינו תואם"));
    expect(m.invoke).not.toHaveBeenCalled();
  });
  it("R17.2 unsupported sibling selection (letter → generic foreign) never uses the manuscript renderer", async () => {
    m.classify.mockResolvedValue({ sourceType: "foreign_unpublished_manuscript", source: "regex" });
    m.invoke.mockResolvedValue({ data: { content: "GENERIC MODEL OUTPUT" }, errorInfo: null });
    await mountChat();
    await send(MS);
    await waitFor(() => expect(screen.getByTestId("bubble-assistant")).toHaveTextContent(`${MS}.`));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "regen-foreign" })); });
    await waitFor(() => expect(m.invoke).toHaveBeenCalledTimes(1));
  });

  // Stage 5 batch 3 — synthetic periodical fixtures.
  const NEWS = "Author: Ari Doe, Title: Local Vote Delayed, Daily Synthetic (Springfield), June 25, 1990, at A1";
  const MAG = "Author: Alpha Gamma, Title: Quiet Fields, Synthetic Mag., Sept.–Oct. 1979, at 89, 90";
  const out = (s: string) => `${s.replace(/^Author: /, "").replace(", Title: ", ", ")}.`;
  const AMBIG = "Local Vote Delayed, Daily Synthetic, June 25, 1990, at A1";
  it.each([["foreign_newspaper", NEWS], ["foreign_journal_article", MAG]] as const)("R16 %s actual initial+regeneration chat is local", async (type, input) => {
    m.classify.mockResolvedValue({ sourceType: type, source: "regex" });
    await mountChat();
    await send(input);
    await waitFor(() => expect(screen.getByTestId("bubble-assistant").textContent?.replace(/##|\^\^/g, "")).toContain(out(input)));
    expect(screen.getByTestId("bubble-assistant")).toHaveTextContent("לא אומתו");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: `regen-${type}` })); });
    await waitFor(() => expect(m.recordGeneration).toHaveBeenCalledWith("acct-1", expect.objectContaining({ effectiveKey: `eff-${type}` })));
    expect(m.invoke).not.toHaveBeenCalled();
  });
  it("R16 ambiguous article/newspaper is preserved with a warning; manual newspaper correction formats it", async () => {
    m.classify.mockResolvedValue({ sourceType: "foreign", source: "regex" });
    await mountChat();
    await send(AMBIG);
    await waitFor(() => expect(screen.getByTestId("bubble-assistant")).toHaveTextContent("לא ניתן לקבוע בבטחה"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "regen-foreign_newspaper" })); });
    await waitFor(() => expect(screen.getByTestId("bubble-assistant").textContent?.replace(/##|\^\^/g, "")).toContain(`${AMBIG}.`));
    expect(m.invoke).not.toHaveBeenCalled();
  });
  it("R16 manual article on a newspaper-structured input is a preserved mismatch, not formatted", async () => {
    m.classify.mockResolvedValue({ sourceType: "foreign_newspaper", source: "regex" });
    await mountChat();
    await send(NEWS);
    await waitFor(() => expect(screen.getByTestId("bubble-assistant").textContent?.replace(/##|\^\^/g, "")).toContain(out(NEWS)));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "regen-foreign_journal_article" })); });
    await waitFor(() => expect(screen.getByTestId("bubble-assistant")).toHaveTextContent("אינו תואם"));
    expect(m.invoke).not.toHaveBeenCalled();
  });
  it.each([
    "Hidden Costs, Courts and Memory, Synthetic Mag., Mar. 2020, at 12",
    "New Horizons, Courts and Memory, Synthetic Mag., Mar. 2020, at 12",
  ])("R16 unlabelled author/title heading is preserved on actual initial + manual regeneration chat: %s", async (input) => {
    m.classify.mockResolvedValue({ sourceType: "foreign_journal_article", source: "regex" });
    await mountChat();
    await send(input);
    await waitFor(() => expect(screen.getByTestId("bubble-assistant")).toHaveTextContent("שם מחבר"));
    expect(screen.getByTestId("bubble-assistant").textContent).toContain(input);
    expect(screen.getByTestId("bubble-assistant").textContent).not.toContain(`${input}.`);
    for (const t of ["foreign_newspaper", "foreign_journal_article"]) {
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: `regen-${t}` })); });
      await waitFor(() => expect(screen.getByTestId("bubble-assistant")).toHaveTextContent("שם מחבר"));
      expect(screen.getByTestId("bubble-assistant").textContent).toContain(input);
    }
    expect(m.invoke).not.toHaveBeenCalled();
  });

  // Stage 5 batch 4 — synthetic book/chapter fixtures.
  it.each([
    ["Hidden Costs, Courts and Memory, in Synthetic Collection 12 (Jane Doe ed., 2020)", "foreign_book_chapter", "המחבר"],
    ["Catch 22 (Jane Doe ed., 2021)", "foreign_book", "הכותרת"],
    ["Title 2020 (Jane Doe ed., 2021)", "foreign_book", "הכותרת"],
    ["Courts and Memory, in Synthetic Collection 2020 (Jane Doe ed., 2020)", "foreign_book_chapter", "הכותרת"],
  ] as const)("R15 ambiguous boundary initial and explicit regeneration stay preserved and local: %s", async (input, type, diagnostic) => {
    m.classify.mockResolvedValue({ sourceType: type, source: "regex" });
    await mountChat();
    await send(input);
    await waitFor(() => expect(screen.getByTestId("bubble-assistant")).toHaveTextContent(diagnostic));
    expect(screen.getByTestId("bubble-assistant").textContent).toContain(input);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: `regen-${type}` })); });
    await waitFor(() => expect(m.recordGeneration).toHaveBeenCalledWith("acct-1", expect.objectContaining({ effectiveKey: `eff-${type}` })));
    expect(screen.getByTestId("bubble-assistant")).toHaveTextContent(diagnostic);
    expect(screen.getByTestId("bubble-assistant").textContent).toContain(input);
    expect(m.invoke).not.toHaveBeenCalled();
  });
  const EDBOOK = "2 The Synthetic Handbook, at xii (Ana Roe & Ben Poe eds., Cy Lu trans., 3d ed. 2010)";
  const CHAP = "Author: Ana Roe; Chapter: Quiet Rules; Collection: The Synthetic Collection; Volume: 3; First page: 210; Pinpoint: 214; Editor: Ben Poe; Edition: 2d; Year: 2015";
  it.each([["foreign_book", EDBOOK, "2 The Synthetic Handbook xii (Ana Roe & Ben Poe eds., Cy Lu trans., 3d ed. 2010)."], ["foreign_book_chapter", CHAP, "Ana Roe, Quiet Rules, in 3 The Synthetic Collection 210, 214 (Ben Poe ed., 2d ed. 2015)."]] as const)("R15 %s actual initial+regeneration chat is local", async (type, input, expected) => {
    m.classify.mockResolvedValue({ sourceType: type, source: "regex" });
    await mountChat();
    await send(input);
    await waitFor(() => expect(screen.getByTestId("bubble-assistant").textContent?.replace(/##|\^\^/g, "")).toContain(expected));
    expect(screen.getByTestId("bubble-assistant")).toHaveTextContent("לא אומתו");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: `regen-${type}` })); });
    await waitFor(() => expect(m.recordGeneration).toHaveBeenCalledWith("acct-1", expect.objectContaining({ effectiveKey: `eff-${type}` })));
    expect(m.invoke).not.toHaveBeenCalled();
  });
  it("R15 manual book choice on a chapter and unsupported sibling are preserved, not formatted", async () => {
    m.classify.mockResolvedValue({ sourceType: "foreign_book_chapter", source: "regex" });
    await mountChat();
    await send(CHAP);
    await waitFor(() => expect(screen.getByTestId("bubble-assistant")).toHaveTextContent("לא אומתו"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "regen-foreign_book" })); });
    await waitFor(() => expect(screen.getByTestId("bubble-assistant")).toHaveTextContent("אינו תואם"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "regen-foreign" })); });
    await waitFor(() => expect(screen.getByTestId("bubble-assistant")).toHaveTextContent("אינו נתמך"));
    expect(screen.getByTestId("bubble-assistant").textContent).toContain(CHAP);
    expect(m.invoke).not.toHaveBeenCalled();
  });

  it.each([
    "Alpha v. Beta, No. 24-CV-017-A, slip op. at 6, 9–11 (D. Mass. Mar. 2, 2024)",
    "Alpha v. Beta, No. 24-CV-017-A (D. Mass. filed Mar. 2, 2024)",
    "Alpha v. Beta, No. 24-CV-017-A, 2024 WL 123456, at *3, *7–9 (D. Mass. Mar. 2, 2024)",
  ])("D1a actual initial+regeneration chat remains local: %s", async (input) => {
    m.classify.mockResolvedValue({ sourceType: "foreign_case_us", source: "regex" });
    m.invoke.mockResolvedValue({ data: { content: "MODEL TEXT" }, errorInfo: null });
    await mountChat();
    await send(input);
    await waitFor(() => expect(screen.getByTestId("bubble-assistant")).toHaveTextContent(`${input}.`));
    expect(screen.getByTestId("bubble-assistant")).not.toHaveTextContent("[חסר:");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "regen-us-case" })); });
    await waitFor(() => expect(m.recordGeneration).toHaveBeenCalledWith("acct-1", expect.objectContaining({ effectiveKey: "us-case-eff", inputFingerprint: "us-case-fp" })));
    expect(screen.getByTestId("bubble-assistant")).toHaveTextContent(`${input}.`);
    expect(m.invoke).not.toHaveBeenCalled();
  });

  it("initial send dispatches the typed request and renders the grounded response", async () => {
    m.classify.mockResolvedValue({ sourceType: "foreign_statute_us", source: "regex" });
    const server = serverWith([CORNELL_1983]);
    m.invoke.mockImplementation(async (_n: string, body: { foreignLookup: unknown }) => ({
      data: { content: "MODEL TEXT", foreignLookup: await server(body.foreignLookup), requestId: "r1", recoveryAvailability: "available" }, errorInfo: null,
    }));
    await mountChat();
    await send("Civil Rights Act § 1983");
    await waitFor(() => expect(screen.getByTestId("bubble-assistant")).toHaveTextContent("Civil Rights Act, 42 U.S.C. § 1983 (2018)."));
    const body = m.invoke.mock.calls[0][1];
    expect(body.foreignLookup).toMatchObject({ kind: "statute", jurisdiction: "US", statuteResponseVersion: 1, parsedFields: { statuteName: "Civil Rights Act", section: "1983" } });
    expect(body.foreignLookup.parsedFields.year).toBeUndefined();
    expect(screen.getByTestId("bubble-assistant")).not.toHaveTextContent("MODEL TEXT");
  });

  it("server failure is a terminal warning in chat; model content is never shown", async () => {
    m.classify.mockResolvedValue({ sourceType: "foreign_statute_us", source: "regex" });
    m.invoke.mockResolvedValue({ data: { content: "Fabricated Act, 99 U.S.C. § 1 (1999).", foreignLookup: await resolveStatuteLookup(
      { enabled: true, statuteResponseVersion: 1, kind: "statute", jurisdiction: "US", rawInput: "x Act § 1", parsedFields: {} },
      { apiKey: undefined, runLookup: runForeignLookup }) }, errorInfo: null });
    await mountChat();
    await send("Civil Rights Act § 1983");
    await waitFor(() => expect(screen.getByTestId("bubble-assistant")).toHaveTextContent("⚠️"));
    expect(screen.getByTestId("bubble-assistant")).not.toHaveTextContent("Fabricated");
    expect(screen.getByTestId("bubble-assistant")).toHaveTextContent("Civil Rights Act");
  });

  it("regeneration uses the manual effective choice, never merges an unmatched response, records provenance", async () => {
    m.classify.mockResolvedValue({ sourceType: "foreign_statute_us", source: "regex" });
    const server = serverWith([CORNELL_1983]);
    m.invoke.mockImplementationOnce(async (_n: string, body: { foreignLookup: unknown }) => ({
      data: { content: "", foreignLookup: await server(body.foreignLookup) }, errorInfo: null,
    }));
    await mountChat();
    await send("Civil Rights Act § 1983");
    await waitFor(() => expect(screen.getByTestId("bubble-assistant")).toHaveTextContent("42 U.S.C."));

    m.invoke.mockResolvedValueOnce({ data: { content: "", foreignLookup: {
      statuteResponseVersion: 1, kind: "statute", jurisdiction: "UK", fields: { year: "1999", chapter: "77" },
      identity: { matched: false, jurisdiction: "UK", conflicts: ["wrong_record"] },
    } }, errorInfo: null });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "regen-uk" })); });
    await waitFor(() => expect(m.invoke).toHaveBeenCalledTimes(2));
    const regenBody = m.invoke.mock.calls[1][1];
    expect(regenBody.foreignLookup).toMatchObject({ kind: "statute", jurisdiction: "UK" });
    await waitFor(() => expect(screen.getByTestId("bubble-assistant")).toHaveTextContent("Civil Rights Act, § 1983."));
    expect(screen.getByTestId("bubble-assistant")).not.toHaveTextContent(/1999|c\. 77/);
    expect(m.recordGeneration).toHaveBeenCalledWith("acct-1", expect.objectContaining({ effectiveKey: "eff", inputFingerprint: "fp" }));
  });

  it("complete US initial send is rendered locally; manual UK regeneration is an honest local mismatch (zero requests)", async () => {
    m.classify.mockResolvedValue({ sourceType: "foreign_statute_us", source: "regex" });
    m.invoke.mockResolvedValue({ data: { content: "MODEL TEXT" }, errorInfo: null });
    await mountChat();
    await send("17 U.S.C. § 512 (2018)");
    await waitFor(() => expect(screen.getByTestId("bubble-assistant")).toHaveTextContent("17 U.S.C. § 512 (2018)."));
    expect(screen.getByTestId("bubble-assistant")).not.toHaveTextContent("MODEL TEXT");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "regen-uk" })); });
    await waitFor(() => expect(screen.getByTestId("bubble-assistant")).toHaveTextContent("סותר"));
    expect(m.invoke).toHaveBeenCalledTimes(0);
  });

  it("complete UK initial send and same-jurisdiction regeneration make zero transport calls, with provenance", async () => {
    m.classify.mockResolvedValue({ sourceType: "foreign_statute_uk", source: "regex" });
    m.invoke.mockResolvedValue({ data: { content: "MODEL TEXT" }, errorInfo: null });
    await mountChat();
    await send("Human Rights Act 1998, c. 42");
    await waitFor(() => expect(screen.getByTestId("bubble-assistant")).toHaveTextContent("Human Rights Act 1998, c. 42."));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "regen-uk" })); });
    await waitFor(() => expect(m.recordGeneration).toHaveBeenCalledWith("acct-1", expect.objectContaining({ effectiveKey: "eff", inputFingerprint: "fp" })));
    expect(screen.getByTestId("bubble-assistant")).toHaveTextContent("Human Rights Act 1998, c. 42.");
    expect(screen.getByTestId("bubble-assistant")).not.toHaveTextContent("MODEL TEXT");
    expect(m.invoke).toHaveBeenCalledTimes(0);
  });

  it("a delayed response after leaving the chat scope cannot write a reply", async () => {
    m.classify.mockResolvedValue({ sourceType: "foreign_statute_us", source: "regex" });
    let release!: (v: unknown) => void;
    m.invoke.mockImplementation(() => new Promise((r) => { release = r; }));
    await mountChat();
    await send("Civil Rights Act § 1983");
    await waitFor(() => expect(m.invoke).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /הערות שוליים/ }));
    await act(async () => { release({ data: { content: "", foreignLookup: await serverWith([CORNELL_1983])(m.invoke.mock.calls[0][1].foreignLookup) }, errorInfo: null }); });
    fireEvent.click(screen.getByRole("button", { name: /אזכור אחיד/ }));
    expect(screen.queryByTestId("bubble-assistant")).toBeNull();
  });
});
