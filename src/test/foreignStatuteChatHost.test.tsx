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
        <button type="button" onClick={() => onChangeSourceType("foreign_statute_uk", {
          itemKey: "chat:0", sourceType: "foreign_statute_uk", supported: true, effectiveKey: "eff", inputFingerprint: "fp",
        })}>regen-uk</button>
      )}
      {onChangeSourceType && (
        <button type="button" onClick={() => onChangeSourceType("foreign_case_us", {
          itemKey: "chat:0", sourceType: "foreign_case_us", supported: true, effectiveKey: "us-case-eff", inputFingerprint: "us-case-fp",
        })}>regen-us-case</button>
      )}
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
