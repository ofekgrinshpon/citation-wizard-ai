/**
 * Stage 3 — record-bound foreign case choice on the ACTUAL chat page and in
 * the real message bubble. Only external boundaries are mocked; the lookup
 * response comes from the production lookup with mocked search.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runForeignLookup, type ForeignLookupInput } from "../../supabase/functions/citation-chat/foreignLookup";
import { citationTextOnly } from "@/lib/citationSegments";

const m = vi.hoisted(() => ({ invoke: vi.fn(), classify: vi.fn(), bubble: vi.fn(), searches: 0, checkoutReady: false, office: true, trial: null as { remaining: number; limit: number; loading?: boolean } | null }));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "acct-1" }, isAdmin: false, loading: false, signOut: vi.fn() }) }));
vi.mock("@/hooks/useOffice", () => ({ useOffice: () => ({ isOfficeAddin: m.office }) }));
vi.mock("@/hooks/useCitationSourceQuota", () => ({ useCitationSourceQuota: () => ({
  sourceQuota: m.trial ?? undefined, quotaError: false, referralPending: false, refreshQuota: vi.fn(),
}) }));
vi.mock("@/lib/citationPassClient", () => ({
  citationCheckoutReady: async () => m.checkoutReady, citationPassStatus: async () => [], startCitationPassCheckout: vi.fn(),
}));
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
  MessageBubble: ({ msg, onSelectForeignChoice, onEdit }: {
    msg: { role: string; content: string; foreignChoice?: { options: Array<{ id: string; label: string }> } };
    onSelectForeignChoice?: (id: string) => void; onEdit?: (v: string) => void;
  }) => (m.bubble(msg),
    <div data-testid={`bubble-${msg.role}`}>
      <span>{msg.content}</span>
      {onSelectForeignChoice && msg.foreignChoice?.options.map((o) => (
        <button key={o.id} type="button" onClick={() => onSelectForeignChoice(o.id)}>{`choose ${o.label}`}</button>
      ))}
      {onEdit && <button type="button" onClick={() => onEdit("Donoghue v Stevenson [1932] AC 562")}>edit-input</button>}
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

const DONOGHUE = { title: "Donoghue v Stevenson [1932] UKHL 100 (26 May 1932)", url: "https://www.bailii.org/uk/cases/UKHL/1932/100.html", snippet: "Donoghue v Stevenson [1932] UKHL 100, [1932] AC 562, 1932 SC (HL) 31." };

beforeEach(() => {
  vi.clearAllMocks();
  m.searches = 0;
  m.checkoutReady = false;
  m.office = true;
  m.trial = null;
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); }));
  m.classify.mockResolvedValue({ sourceType: "foreign_case_other", source: "regex" });
  m.invoke.mockImplementation(async (_name: string, body: { foreignLookup?: ForeignLookupInput }) => {
    const fetchImpl = (async (url: unknown) => {
      if (String(url).includes("perplexity.ai")) { m.searches++; return new Response(JSON.stringify({ results: [DONOGHUE] }), { status: 200 }); }
      return new Response("nf", { status: 404 });
    }) as unknown as typeof fetch;
    const foreignLookup = body.foreignLookup ? await runForeignLookup(body.foreignLookup, { fetchImpl, apiKey: "offline-only" }) : undefined;
    return { data: { foreignLookup, content: "UNSAFE" }, errorInfo: null };
  });
});

async function mountChat() {
  const { default: Index } = await import("@/pages/Index");
  const view = render(<MemoryRouter><Index /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: /אזכור מהיר/ }));
  return { ...view, Index };
}
async function send(text: string) {
  fireEvent.change(screen.getByLabelText("citation-input"), { target: { value: text } });
  await act(async () => { fireEvent.click(document.querySelector(".btn-send") as HTMLButtonElement); });
}
const latest = () => m.bubble.mock.calls.map(([msg]) => msg).filter((msg) => msg.role === "assistant").at(-1);

describe("chat page — tabs for a regular user", () => {
  it("hides the legal assistant tab from non-admins", async () => {
    const { default: Index } = await import("@/pages/Index");
    render(<MemoryRouter initialEntries={["/app?mode=legalqa"]}><Index /></MemoryRouter>);
    expect(screen.queryByRole("button", { name: /העוזר המשפטי/ })).toBeNull();
    expect(screen.getByRole("button", { name: /אזכור מהיר/ })).toBeInTheDocument();
  });
});

describe("chat page — choosing a parallel report", () => {
  it("formats from the chosen record without another request or search", async () => {
    await mountChat();
    await send("Donoghue v Stevenson");
    const sc = await screen.findByRole("button", { name: "choose 1932 SC (HL) 31" });
    expect(screen.getByRole("button", { name: "choose [1932] AC 562" })).toBeInTheDocument();
    const calls = m.invoke.mock.calls.length, searches = m.searches;
    await act(async () => { fireEvent.click(sc); });
    await waitFor(() => expect(latest().foreignChoice).toBeUndefined());
    const text = citationTextOnly(latest().content);
    expect(text).toContain("1932 SC (HL) 31");
    expect(text).not.toContain("AC 562");
    expect(text).not.toContain("UNSAFE");
    expect(latest().completion.provenance.firstPage.sourceUrl).toBe(DONOGHUE.url);
    expect(m.invoke.mock.calls.length).toBe(calls);
    expect(m.searches).toBe(searches);
    expect(screen.queryByRole("button", { name: /^choose / })).not.toBeInTheDocument();
  });

  it("a reply that only lists options is not verified or saved as a source, so the chat is free to choose", async () => {
    const { ensureVerifiedSources } = await import("@/lib/verifiedSources");
    await mountChat();
    await send("Donoghue v Stevenson");
    const sc = await screen.findByRole("button", { name: "choose 1932 SC (HL) 31" });
    expect(ensureVerifiedSources).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(sc); });
    await waitFor(() => expect(latest().foreignChoice).toBeUndefined());
    expect(citationTextOnly(latest().content)).toContain("1932 SC (HL) 31");
  });

  it("editing the input removes the old choice; it can no longer be used", async () => {
    await mountChat();
    await send("Donoghue v Stevenson");
    await screen.findByRole("button", { name: "choose 1932 SC (HL) 31" });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "edit-input" })); });
    // The edited input names one report, so it is formatted directly; the old options are gone.
    await waitFor(() => expect(citationTextOnly(latest().content)).toContain("AC 562"));
    expect(latest().foreignChoice).toBeUndefined();
    expect(screen.queryByRole("button", { name: /^choose / })).not.toBeInTheDocument();
    expect(m.bubble.mock.calls.map(([msg]) => msg).filter((msg) => msg.role === "assistant" && msg.foreignChoice).length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("bubble-assistant")).toHaveLength(1);
  });
});

describe("message bubble — record-bound options", () => {
  it("shows the options as buttons instead of numbered text and sends only the record id", async () => {
    vi.doUnmock("@/components/MessageBubble");
    vi.resetModules();
    const { MessageBubble } = await import("@/components/MessageBubble");
    const { TooltipProvider } = await import("@/components/ui/tooltip");
    const choice = {
      version: 1, stage: "location", jurisdiction: "UK", fingerprint: "x", decisions: [], plan: {}, response: {},
      options: [{ id: "UK|ac|1932||562", label: "[1932] AC 562", url: "https://www.bailii.org/a" }, { id: "UK|schl|1932||31", label: "1932 SC (HL) 31", url: "https://www.bailii.org/b" }],
    };
    const onSelect = vi.fn();
    render(<TooltipProvider><MessageBubble msg={{ role: "assistant", content: "בחרו:\n1. [1932] AC 562 — https://www.bailii.org/a\n2. 1932 SC (HL) 31 — https://www.bailii.org/b", foreignChoice: choice as never }}
      onSelectForeignChoice={onSelect} /></TooltipProvider>);
    expect(screen.queryByText(/— https:\/\/www\.bailii\.org\/a/)).not.toBeInTheDocument();
    const group = screen.getByRole("group", { name: "בחירת מראה המקום" });
    expect(group).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "2. 1932 SC (HL) 31" }));
    expect(onSelect).toHaveBeenCalledWith("UK|schl|1932||31");
    expect(screen.getByRole("button", { name: "1. [1932] AC 562" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "מקור לאפשרות 1" })).toHaveAttribute("href", "https://www.bailii.org/a");
  });
});

describe("chat page — in-app citation packages", () => {
  it("keeps purchase prompts hidden while checkout is closed", async () => {
    m.office = false;
    m.trial = { remaining: 0, limit: 5 };
    await mountChat();
    expect(screen.getByRole("button", { name: "לעמוד החשבון" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "חבילות אזכורים" })).toBeNull();
    expect(screen.queryByRole("button", { name: "לבחירת חבילה" })).toBeNull();
  });

  it("opens the actual package chooser from the main header before the free quota runs out", async () => {
    m.office = false;
    m.checkoutReady = true;
    m.trial = { remaining: 1, limit: 5 };
    await mountChat();
    fireEvent.click(await screen.findByRole("button", { name: "חבילות אזכורים" }));
    expect(await screen.findByRole("dialog", { name: "חבילות אזכורים" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^רכישת / })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "לבחירת חבילה" })).toBeNull();
  });

  it("offers packages when free quota reaches zero and does not send a blocked citation", async () => {
    m.office = false;
    m.checkoutReady = true;
    m.trial = { remaining: 1, limit: 5 };
    const { rerender, Index } = await mountChat();
    await screen.findByRole("button", { name: "חבילות אזכורים" });
    expect(screen.queryByRole("button", { name: "לבחירת חבילה" })).toBeNull();
    m.trial = { remaining: 0, limit: 5 };
    rerender(<MemoryRouter><Index /></MemoryRouter>);
    const choose = await screen.findByRole("button", { name: "לבחירת חבילה" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("ניצלת את כל האזכורים החינמיים. רוצה להמשיך?")).toBeInTheDocument();
    await send("Donoghue v Stevenson");
    expect(m.invoke).not.toHaveBeenCalled();
    expect((await import("sonner")).toast.error).not.toHaveBeenCalled();
    fireEvent.click(choose);
    expect(await screen.findByRole("dialog", { name: "חבילות אזכורים" })).toBeInTheDocument();
  });
});
