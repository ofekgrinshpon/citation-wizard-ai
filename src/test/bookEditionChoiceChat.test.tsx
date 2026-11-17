/** Book edition selection on the actual chat page, with offline lookup fixtures. */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runForeignLookup, type ForeignLookupInput } from "../../supabase/functions/citation-chat/foreignLookup";
import { citationTextOnly } from "@/lib/citationSegments";

const m = vi.hoisted(() => ({ invoke: vi.fn(), classify: vi.fn(), bubble: vi.fn(), searches: 0, accountId: "acct-1" }));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: m.accountId }, isAdmin: false, loading: false, signOut: vi.fn() }) }));
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
vi.mock("@/lib/foreignClassificationStore", () => ({ recordGeneration: vi.fn(), clearItemsWithPrefix: vi.fn(), loadRecord: vi.fn(() => undefined), saveRecord: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() }) }));
vi.mock("@/components/MessageBubble", () => ({
  MessageBubble: ({ msg, onSelectBookEditionChoice, onEdit }: {
    msg: { role: string; content: string; bookEditionChoice?: { options: Array<{ id: string; label: string }> } };
    onSelectBookEditionChoice?: (id: string) => void; onEdit?: (v: string) => void;
  }) => (m.bubble(msg),
    <div data-testid={`bubble-${msg.role}`}>
      <span>{msg.content}</span>
      {onSelectBookEditionChoice && msg.bookEditionChoice?.options.map((o) => (
        <button key={o.id} type="button" onClick={() => onSelectBookEditionChoice(o.id)}>{`choose ${o.label}`}</button>
      ))}
      {onSelectBookEditionChoice && msg.bookEditionChoice && <button onClick={() => onSelectBookEditionChoice("keep-missing")}>keep-missing</button>}
      {onEdit && <button type="button" onClick={() => onEdit("National Identity by Smith, Anthony D, 1991")}>edit-input</button>}
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
  "ReLexLogo", "LoadingDots", "VerifiedSuggestionCard", "PublicationIntegrityCard", "BillTypeSelector", "TreatyTypeSelector",
  "CitationRequestStatusLink"]) {
  vi.doMock(`@/components/${path}`, () => ({ [path]: Null }));
}
vi.mock("@/components/research-chat/ResearchConversationSidebar", () => ({ ResearchConversationSidebar: Null }));

const RAW = "National Identity by Smith, Anthony D";
const BOOKS = ["1991", "1993"].map(year => ({ title: `National Identity — Anthony D. Smith`, url: `https://press.example.edu/national-identity-${year}`, snippet: `Anthony D. Smith, National Identity (${year}).` }));

beforeEach(() => {
  vi.clearAllMocks();
  m.searches = 0; m.accountId = "acct-1";
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); }));
  m.classify.mockResolvedValue({ sourceType: "foreign_book", source: "regex" });
  m.invoke.mockImplementation(async (_name: string, body: { foreignLookup?: ForeignLookupInput }) => {
    const fetchImpl = (async (url: unknown) => {
      if (String(url).includes("perplexity.ai")) { m.searches++; return new Response(JSON.stringify({ results: BOOKS }), { status: 200 }); }
      return new Response("nf", { status: 404 });
    }) as unknown as typeof fetch;
    const foreignLookup = body.foreignLookup ? await runForeignLookup(body.foreignLookup, { fetchImpl, apiKey: "offline-only" }) : undefined;
    return { data: { foreignLookup, content: "UNSAFE" }, errorInfo: null };
  });
});

async function mountChat() {
  const { default: Index } = await import("@/pages/Index");
  render(<MemoryRouter><Index /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: /אזכור מהיר/ }));
}
async function send(text: string) {
  fireEvent.change(screen.getByLabelText("citation-input"), { target: { value: text } });
  await act(async () => { fireEvent.click(document.querySelector(".btn-send") as HTMLButtonElement); });
}
const latest = () => m.bubble.mock.calls.map(([msg]) => msg).filter((msg) => msg.role === "assistant").at(-1);

describe("book choices on chat page", () => {
  it("applies an observed year without another search or verified-source save", async () => {
    const { ensureVerifiedSources } = await import("@/lib/verifiedSources");
    await mountChat(); await send(RAW);
    const button = await screen.findByRole("button", { name: /choose .*1993/ });
    const calls = m.invoke.mock.calls.length, searches = m.searches;
    await act(async () => { fireEvent.click(button); });
    await waitFor(() => expect(latest().bookEditionChoice).toBeUndefined());
    expect(citationTextOnly(latest().content)).toContain("1993");
    expect(m.invoke).toHaveBeenCalledTimes(calls);
    expect(m.searches).toBe(searches);
    expect(ensureVerifiedSources).not.toHaveBeenCalled();
  });
  it("keeps year missing explicitly without another request", async () => {
    await mountChat(); await send(RAW);
    const button = await screen.findByRole("button", { name: "keep-missing" });
    const calls = m.invoke.mock.calls.length;
    await act(async () => { fireEvent.click(button); });
    await waitFor(() => expect(latest().bookEditionChoice).toBeUndefined());
    expect(latest().content).toContain("חסר");
    expect(m.invoke).toHaveBeenCalledTimes(calls);
  });
  it("keeps choices transient and clears them when account changes", async () => {
    await mountChat(); await send(RAW);
    await screen.findByRole("button", { name: "keep-missing" });
    expect(JSON.stringify(localStorage)).not.toContain("bookEditionChoice");
    m.accountId = "acct-2";
    fireEvent.change(screen.getByLabelText("citation-input"), { target: { value: "different" } });
    await waitFor(() => expect(latest().bookEditionChoice).toBeUndefined());
  });
  it("clears old choices after an input edit", async () => {
    await mountChat(); await send(RAW);
    await screen.findByRole("button", { name: "keep-missing" });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "edit-input" })); });
    await waitFor(() => expect(latest().bookEditionChoice).toBeUndefined());
  });
});
