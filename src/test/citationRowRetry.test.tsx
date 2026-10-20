import { MemoryRouter } from "react-router-dom";
import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: MemoryRouter });
import { BibliographyGenerator } from "@/components/BibliographyGenerator";
import { BatchFootnoteBuilder } from "@/components/BatchFootnoteBuilder";
import { UniformCitationPanel } from "@/components/legal-research/UniformCitationPanel";
import { FootnoteReviewCard } from "@/components/FootnoteReviewCard";
import { CitationRunError, runCitation } from "@/lib/runCitation";

const boundary = vi.hoisted(() => ({
  invoke: vi.fn(), getSession: vi.fn(), getUser: vi.fn(), refreshSession: vi.fn(),
  classify: vi.fn(), verified: vi.fn(), insert: vi.fn(),
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), message: vi.fn(), info: vi.fn() }),
  user: { id: "initial" } as { id: string } | null,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  functions: { invoke: boundary.invoke },
  auth: { getSession: boundary.getSession, getUser: boundary.getUser, refreshSession: boundary.refreshSession },
  from: () => ({ insert: boundary.insert }),
} }));
// This caller/UI suite deliberately injects a test-only journal. Production
// remains strict IndexedDB-only; browser durability requires separate validation.
vi.mock("@/lib/citationRequestIdentity", async (original) => {
  const actual = await original<typeof import("@/lib/citationRequestIdentity")>();
  const { MemoryCitationJournal } = await import("./fixtures/memoryCitationJournal");
  return { ...actual, citationRequests: new actual.CitationRequestIdentity(256, new MemoryCitationJournal()) };
});
vi.mock("@/lib/sourceTypeClassifier", () => ({ resolveSourceType: boundary.classify }));
vi.mock("@/lib/verifiedSources", () => ({
  findVerifiedSourceMatch: boundary.verified, classifyVerifiedSource: vi.fn(),
  getVerifiedCategoryLabel: vi.fn(), ensureVerifiedSources: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: boundary.user, isAdmin: false, isAdminResolved: true }) }));
vi.mock("@/hooks/useProjects", () => ({ useProjects: () => ({ currentProject: { id: "row-project" } }) }));
vi.mock("@/hooks/useOffice", () => ({ useOffice: () => ({ isOfficeAddin: false, hasDocumentAccess: false }) }));
vi.mock("@/hooks/useBibliography", () => ({
  useBibliography: () => ({ sortedEntries: [], addEntries: vi.fn(), removeEntry: vi.fn(), clearAll: vi.fn(), syncFootnoteEntries: vi.fn() }),
  CATEGORY_LABELS: {}, classifyCitation: () => ({ sourceType: "unknown", language: "hebrew" }),
}));
vi.mock("sonner", () => ({ toast: boundary.toast }));
vi.mock("@/components/VerifiedAutocomplete", () => ({ VerifiedAutocomplete: ({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled: boolean }) =>
  <input aria-label="מקור" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} /> }));
vi.mock("@/components/FormattedCitation", () => ({ FormattedCitation: ({ text }: { text: string }) => <span>{text}</span> }));

const rawA = 'ע"א 1234/22 פלוני נגד אלמוני';
const rawB = 'ע"א 4567/23 לוי נגד כהן';
const citation = 'ע"א 1234/22 פלוני נ\' אלמוני (1.1.2024).';
const success = { data: { content: citation }, error: null };
type RequestOptions = { body: Record<string, unknown> };
const responseError = (body: Record<string, unknown>, status = 503) => ({ data: null,
  error: { context: new Response(JSON.stringify(body), { status }) } });
const confirmedFailure = (request: Record<string, unknown>, refundStatus = "refunded") => responseError({
  error: "AI_UNAVAILABLE", requestId: request.requestId, status: "failed", refunded: refundStatus === "refunded",
  refund_receipt: { status: refundStatus, refunded: refundStatus === "refunded", units_refunded: refundStatus === "refunded" ? 1 : 0, request_id: request.requestId },
});
const session = () => ({ user: boundary.user, access_token: "offline-fixture", expires_at: Date.now() / 1000 + 3600 });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
const requestAt = (index: number) => boundary.invoke.mock.calls[index][1].body as Record<string, unknown>;
const initialRequestFor = (caseNumber: string) => boundary.invoke.mock.calls.map(([, options]) => options.body as Record<string, unknown>)
  .find((body) => JSON.stringify(body.messages).includes(caseNumber))!;
const executionBody = ({ requestId: _id, retryOfRequestId: _parent, ...body }: Record<string, unknown>) => body;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden in row retry tests"); }));
  localStorage.clear();
  boundary.user = { id: crypto.randomUUID() };
  boundary.getSession.mockImplementation(async () => ({ data: { session: session() } }));
  boundary.getUser.mockResolvedValue({ data: { user: null } });
  boundary.classify.mockResolvedValue({ sourceType: "case_law_database" });
  boundary.verified.mockResolvedValue(null);
  boundary.invoke.mockImplementation(async (_name, { body }: RequestOptions) => confirmedFailure(body));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function bibliographyInput(raw = rawA) {
  const ui = render(<BibliographyGenerator />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: raw } });
  fireEvent.click(screen.getByRole("button", { name: /שלח לבדיקה/ }));
  return ui;
}
function footnoteInput(raw = [rawA]) {
  const ui = render(<BatchFootnoteBuilder />);
  raw.forEach((value, index) => fireEvent.change(screen.getAllByRole("textbox", { name: "מקור" })[index], { target: { value } }));
  fireEvent.click(screen.getByRole("button", { name: /בנה טיוטות לבדיקה/ }));
  return ui;
}

// These tests use the real runCitation, functionError and identity registry.
// Service/auth/search boundaries and the explicit test journal are stubbed; no provider/network calls.
describe("prepared runCitation failure context", () => {
  it("a canceled queued row cannot begin classification or engine work", async () => {
    await expect(runCitation({ rawInput: rawA, isResultCurrent: () => false }))
      .rejects.toMatchObject({ code: "CITATION_INPUT_CHANGED" });
    expect(boundary.classify).not.toHaveBeenCalled();
    expect(boundary.verified).not.toHaveBeenCalled();
    expect(boundary.invoke).not.toHaveBeenCalled();
  });

  it("retains a typed failure and exact payload/render context while skipping prework on explicit retry", async () => {
    const error = await runCitation({ rawInput: rawA }).catch((e) => e as CitationRunError);
    expect(error).toBeInstanceOf(CitationRunError);
    const failed = error as CitationRunError;
    expect(failed.citationRetry?.descriptor.failedRequestId).toBe(requestAt(0).requestId);
    expect(failed.citationRetry?.descriptor.refundConfirmed).toBe(true);
    boundary.classify.mockResolvedValue({ sourceType: "foreign_journal_article" });
    boundary.verified.mockResolvedValue({ source_name: rawA, full_citation: "A changed store result" });
    boundary.invoke.mockResolvedValueOnce(success);
    const result = await failed.citationRetry!.retry();
    expect(result.citation).toBe(citation);
    expect(result.sourceType).toBe("case_law_database");
    expect(boundary.classify).toHaveBeenCalledTimes(1);
    expect(boundary.verified).toHaveBeenCalledTimes(1);
    expect(executionBody(requestAt(1))).toEqual(executionBody(requestAt(0)));
    expect(requestAt(1).retryOfRequestId).toBe(requestAt(0).requestId);
    expect(requestAt(1).requestId).not.toBe(requestAt(0).requestId);
  });

  it("keeps a manual source type override in its prepared retry context", async () => {
    const options = { rawInput: rawA, overrideType: "case_law_database" as "case_law_database" | "article" };
    const error = await runCitation(options).catch((e) => e as CitationRunError) as CitationRunError;
    options.overrideType = "article";
    boundary.invoke.mockResolvedValueOnce(success);
    expect((await error.citationRetry!.retry()).sourceType).toBe("case_law_database");
    expect(boundary.classify).not.toHaveBeenCalled();
    expect(executionBody(requestAt(1))).toEqual(executionBody(requestAt(0)));
  });

  it("ordinary unknown-outcome recovery reuses prepared body and identity without successor or new prework", async () => {
    boundary.invoke.mockRejectedValueOnce(new TypeError("Lost response"));
    const error = await runCitation({ rawInput: rawA }).catch((e) => e as CitationRunError) as CitationRunError;
    expect(error.citationRetry).toBeUndefined();
    boundary.invoke.mockResolvedValueOnce(success);
    const result = await error.recovery!.retry();
    expect(result.citation).toBe(citation);
    expect(requestAt(1)).toEqual(requestAt(0));
    expect(requestAt(1).retryOfRequestId).toBeUndefined();
    expect(boundary.classify).toHaveBeenCalledTimes(1);
  });

  it("passes an English article retry through unchanged article rendering", async () => {
    boundary.classify.mockResolvedValue({ sourceType: "foreign_journal_article" });
    const rawInput = "Samuel D. Warren and Louis D. Brandeis, The Right to Privacy, pp. 213-214";
    const error = await runCitation({ rawInput }).catch((e) => e as CitationRunError) as CitationRunError;
    expect(requestAt(0).foreignLookup).toMatchObject({ kind: "journal_article" });
    boundary.invoke.mockResolvedValueOnce({ data: { content: "", foreignLookup: {
      identity: { matched: true }, articleResolution: "resolved", fields: {
        authors: "Samuel D. Warren and Louis D. Brandeis", articleTitle: "The Right to Privacy",
        journal: "Harvard Law Review", volume: "4", firstPage: "193", year: "1890",
      },
    } }, error: null });
    const result = await error.citationRetry!.retry();
    expect(result.citation).toBe("Samuel D. Warren and Louis D. Brandeis, ##The Right to Privacy##, 4 ^^Harv. L. Rev.^^ 193, 213–214 (1890).");
    expect(result.status).toBe("valid");
    expect(boundary.classify).toHaveBeenCalledTimes(1);
  });

  it("preserves foreign disambiguation and rejects an invalidated action before transport", async () => {
    boundary.classify.mockResolvedValue({ sourceType: "foreign_case_us" });
    const error = await runCitation({ rawInput: "Jones v. Smith and Sons" }).catch((e) => e as CitationRunError) as CitationRunError;
    await expect(error.citationRetry!.retry(() => false)).rejects.toMatchObject({ code: "CITATION_INPUT_CHANGED" });
    expect(boundary.invoke).toHaveBeenCalledTimes(1);
    boundary.invoke.mockResolvedValueOnce({ data: { content: "", foreignLookup: { disambiguation: [
      { jurisdiction: "US", label: "First Jones case", url: "https://example.test/one" },
      { jurisdiction: "UK", label: "Second Jones case", url: "https://example.test/two" },
    ] } }, error: null });
    const result = await error.citationRetry!.retry();
    expect(result.citation).toBe("");
    expect(result.reply).toContain("First Jones case");
    expect(result.reply).toContain("Second Jones case");
    expect(result.warningMsg).toBe("נדרשת בחירה בין כמה פסקי דין");
  });
  it("a stale explicit gesture after a fast child failure remains bound to one child", async () => {
    const error = await runCitation({ rawInput: rawA }).catch((e) => e as CitationRunError) as CitationRunError;
    const parentAction = error.citationRetry!;
    await expect(parentAction.retry()).rejects.toBeInstanceOf(CitationRunError);
    const child = requestAt(1).requestId;
    await expect(parentAction.retry()).rejects.toBeInstanceOf(CitationRunError);
    expect(requestAt(2).requestId).toBe(child);
    expect(requestAt(2).retryOfRequestId).toBe(requestAt(0).requestId);
    expect(boundary.classify).toHaveBeenCalledTimes(1);
  });

  it("lost child acknowledgment recovers the same child with the retained payload", async () => {
    const parent = await runCitation({ rawInput: rawA }).catch((e) => e as CitationRunError) as CitationRunError;
    boundary.invoke.mockRejectedValueOnce(new TypeError("Child response lost"));
    const child = await parent.citationRetry!.retry().catch((e) => e as CitationRunError) as CitationRunError;
    expect(child.code).toBe("REQUEST_OUTCOME_UNKNOWN");
    expect(child.citationRetry).toBeUndefined();
    boundary.invoke.mockResolvedValueOnce(success);
    await child.recovery!.retry();
    expect(requestAt(2)).toEqual(requestAt(1));
    expect(boundary.classify).toHaveBeenCalledTimes(1);
  });

  it.each(["FRAGMENT_RESPONSE", "EMPTY_RESPONSE"])("%s keeps only local recovery after an unusable transport success", async (code) => {
    if (code === "EMPTY_RESPONSE") boundary.classify.mockResolvedValue({ sourceType: "foreign_case_us" });
    boundary.invoke.mockResolvedValueOnce({ data: code === "FRAGMENT_RESPONSE" ? { content: "123" } : {
      content: "", foreignLookup: { identity: { matched: true }, fields: { arbitrary: "unrenderable metadata" } },
    }, error: null });
    const error = await runCitation({ rawInput: code === "EMPTY_RESPONSE" ? "Jones v. Smith and Sons" : rawA })
      .catch((e) => e as CitationRunError) as CitationRunError;
    expect(error.code).toBe(code);
    expect(error.citationRetry).toBeUndefined();
    expect(error.userMessage).toContain("החזר שימוש לא אושר");
    await expect(error.recovery!.retry()).rejects.toMatchObject({ code });
    await expect(error.recovery!.retry()).rejects.toMatchObject({ code });
    expect(boundary.invoke).toHaveBeenCalledTimes(1);
    expect(boundary.classify).toHaveBeenCalledTimes(code === "EMPTY_RESPONSE" ? 0 : 1);
  });

});

describe("bibliography mounted per-row retry", () => {
  it("shows confirmed refund/new-usage disclosure and blocks double-click without rerunning other rows", async () => {
    bibliographyInput(`${rawA}\n${rawB}`);
    const buttons = await screen.findAllByRole("button", { name: "ניסיון חדש" });
    expect(boundary.invoke).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText(/החזר השימוש הקודם אושר/)).toHaveLength(2);
    expect(screen.getAllByText(/עשוי לצרוך שימוש נוסף/)).toHaveLength(2);
    const parent = initialRequestFor("1234/22").requestId;
    const pending = deferred<typeof success>();
    boundary.invoke.mockReturnValueOnce(pending.promise);
    act(() => { buttons[0].click(); buttons[0].click(); });
    await waitFor(() => expect(boundary.invoke).toHaveBeenCalledTimes(3));
    expect(requestAt(2).retryOfRequestId).toBe(parent);
    await act(async () => { pending.resolve(success); });
    await screen.findByText(citation);
    expect(screen.getAllByRole("button", { name: "ניסיון חדש" })).toHaveLength(1);
    expect(boundary.classify).toHaveBeenCalledTimes(2);
    expect(boundary.verified).toHaveBeenCalledTimes(2);
  });

  it.each(["in_progress", "unknown", "succeeded"])("never offers a new attempt for %s", async (status) => {
    boundary.invoke.mockImplementation(async (_name, { body }: RequestOptions) => responseError({
      error: "REQUEST_ALREADY_STARTED", status, requestId: body.requestId,
    }, 409));
    bibliographyInput();
    await screen.findByText(/מזהה בקשה:/);
    expect(screen.queryByRole("button", { name: "ניסיון חדש" })).not.toBeInTheDocument();
    expect(boundary.invoke).toHaveBeenCalledTimes(1);
  });

  it("discloses an unconfirmed refund, and generic row retry stays on the parent", async () => {
    boundary.invoke.mockImplementation(async (_name, { body }: RequestOptions) => confirmedFailure(body, "deferred"));
    bibliographyInput();
    await screen.findByRole("button", { name: "ניסיון חדש" });
    expect(screen.getByText(/החזר השימוש הקודם טרם אושר/)).toBeInTheDocument();
    const parent = requestAt(0).requestId;
    fireEvent.click(screen.getByRole("button", { name: /חפש שוב/ }));
    await screen.findByRole("button", { name: "ניסיון חדש" });
    expect(boundary.invoke).toHaveBeenCalledTimes(2);
    expect(requestAt(1).requestId).toBe(parent);
    expect(requestAt(1).retryOfRequestId).toBeUndefined();
    expect(boundary.classify).toHaveBeenCalledTimes(1);
  });

  it("revokes the offer after edits and account changes", async () => {
    const ui = bibliographyInput();
    const oldButton = await screen.findByRole("button", { name: "ניסיון חדש" });
    fireEvent.click(screen.getByRole("button", { name: /ערוך$/ }));
    fireEvent.change(screen.getAllByRole("textbox")[1], { target: { value: rawB } });
    act(() => oldButton.click());
    expect(boundary.invoke).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "ניסיון חדש" })).not.toBeInTheDocument();
    boundary.user = { id: "other-bibliography-account" };
    ui.rerender(<BibliographyGenerator />);
    expect(screen.queryByText(/מזהה בקשה:/)).not.toBeInTheDocument();
  });
  it("editing a row during its pending retry ignores the old result", async () => {
    bibliographyInput();
    const pending = deferred<typeof success>();
    const button = await screen.findByRole("button", { name: "ניסיון חדש" });
    boundary.invoke.mockReturnValueOnce(pending.promise);
    fireEvent.click(button);
    await waitFor(() => expect(boundary.invoke).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: /ערוך$/ }));
    fireEvent.change(screen.getAllByRole("textbox")[1], { target: { value: "אזכור נערך ידנית ושמור" } });
    fireEvent.click(screen.getByRole("button", { name: "שמור" }));
    await act(async () => { pending.resolve(success); });
    expect(screen.getByText("אזכור נערך ידנית ושמור")).toBeInTheDocument();
    expect(screen.queryByText(citation)).not.toBeInTheDocument();
  });

  it("unmount and account change suppress a pending retry result", async () => {
    const ui = bibliographyInput();
    const pending = deferred<typeof success>();
    const button = await screen.findByRole("button", { name: "ניסיון חדש" });
    boundary.invoke.mockReturnValueOnce(pending.promise);
    fireEvent.click(button);
    await waitFor(() => expect(boundary.invoke).toHaveBeenCalledTimes(2));
    boundary.user = { id: "changed-bibliography-account" };
    ui.rerender(<BibliographyGenerator />);
    ui.unmount();
    await act(async () => { pending.resolve(success); });
    render(<BibliographyGenerator />);
    expect(screen.queryByText(citation)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניסיון חדש" })).not.toBeInTheDocument();
  });

  it("a changed category on a failed row builds a new payload instead of reusing its old recovery", async () => {
    bibliographyInput();
    const oldAction = await screen.findByRole("button", { name: "ניסיון חדש" });
    fireEvent.click(screen.getByRole("button", { name: /אחר ▾/ }));
    fireEvent.click(await screen.findByRole("button", { name: "פסיקה – עליון" }));
    await waitFor(() => expect(boundary.invoke).toHaveBeenCalledTimes(2));
    await screen.findByRole("button", { name: "ניסיון חדש" });
    expect(requestAt(1).requestId).not.toBe(requestAt(0).requestId);
    expect(requestAt(1).retryOfRequestId).toBeUndefined();
    expect(requestAt(1).messages).not.toEqual(requestAt(0).messages);
    expect(JSON.stringify(requestAt(1).messages)).toContain("פסיקה");
    act(() => oldAction.click());
    expect(boundary.invoke).toHaveBeenCalledTimes(2);
  });

  it("locally unusable output cannot be silently re-billed by generic retry", async () => {
    boundary.invoke.mockResolvedValueOnce({ data: { content: "123" }, error: null });
    bibliographyInput();
    await screen.findByText(/התוצאה שהתקבלה אינה אזכור שלם/);
    expect(screen.queryByRole("button", { name: "ניסיון חדש" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /חפש שוב/ }));
    await screen.findByText(/התוצאה שהתקבלה אינה אזכור שלם/);
    expect(boundary.invoke).toHaveBeenCalledTimes(1);
  });

  it("opening and canceling edit keeps local-only recovery for unchanged unusable output", async () => {
    boundary.invoke.mockResolvedValueOnce({ data: { content: "123" }, error: null });
    bibliographyInput();
    await screen.findByText(/התוצאה שהתקבלה אינה אזכור שלם/);
    fireEvent.click(screen.getByRole("button", { name: /ערוך$/ }));
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    fireEvent.click(screen.getByRole("button", { name: /חפש שוב/ }));
    await screen.findByText(/התוצאה שהתקבלה אינה אזכור שלם/);
    expect(boundary.invoke).toHaveBeenCalledTimes(1);
  });

  it("foreign choices remain visible and generic retry only reuses the delivered choices", async () => {
    boundary.classify.mockResolvedValue({ sourceType: "foreign_case_us" });
    boundary.invoke.mockResolvedValueOnce({ data: { content: "", foreignLookup: { disambiguation: [
      { jurisdiction: "US", label: "First Jones case", url: "https://example.test/one" },
      { jurisdiction: "UK", label: "Second Jones case", url: "https://example.test/two" },
    ] } }, error: null });
    bibliographyInput("Jones v. Smith and Sons");
    await screen.findByText(/First Jones case/);
    expect(screen.queryByRole("button", { name: "ניסיון חדש" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /חפש שוב/ }));
    await screen.findByText(/First Jones case/);
    expect(boundary.invoke).toHaveBeenCalledTimes(1);
    expect(boundary.classify).not.toHaveBeenCalled();
  });

  it("runPool does not automatically repeat a normally transient failure", async () => {
    boundary.invoke.mockImplementation(async (_name, { body }: RequestOptions) => responseError({
      error: "AI_RATE_LIMITED", status: "failed", requestId: body.requestId,
    }, 429));
    bibliographyInput();
    await screen.findByRole("button", { name: "ניסיון חדש" });
    expect(boundary.invoke).toHaveBeenCalledTimes(1);
  });

});

describe("footnotes mounted per-cell retry", () => {
  it("has independent cell actions, blocks double click and never persists descriptors or prepared context", async () => {
    footnoteInput([rawA, rawB]);
    const buttons = await screen.findAllByRole("button", { name: "ניסיון חדש" });
    expect(boundary.invoke).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem("footnote_cells_row-project")).not.toMatch(/citationRetry|recovery|refundReceipt|handle|messages/);
    const pending = deferred<typeof success>();
    boundary.invoke.mockReturnValueOnce(pending.promise);
    act(() => { buttons[0].click(); buttons[0].click(); });
    await waitFor(() => expect(boundary.invoke).toHaveBeenCalledTimes(3));
    expect(requestAt(2).retryOfRequestId).toBe(initialRequestFor("1234/22").requestId);
    await act(async () => { pending.resolve(success); });
    await screen.findByDisplayValue((value) => value.startsWith(citation));
    expect(screen.getAllByRole("button", { name: "ניסיון חדש" })).toHaveLength(1);
    expect(boundary.classify).toHaveBeenCalledTimes(2);
  });

  it("does not turn a batch re-run into a successor", async () => {
    footnoteInput([rawA, rawB]);
    await screen.findAllByRole("button", { name: "ניסיון חדש" });
    const ids = [requestAt(0).requestId, requestAt(1).requestId];
    fireEvent.click(screen.getByRole("button", { name: /חזור לעריכה$/ }));
    fireEvent.click(screen.getByRole("button", { name: /בנה טיוטות לבדיקה/ }));
    await screen.findAllByRole("button", { name: "ניסיון חדש" });
    expect(boundary.invoke).toHaveBeenCalledTimes(4);
    expect([requestAt(2).requestId, requestAt(3).requestId].sort()).toEqual(ids.sort());
    expect([requestAt(2).retryOfRequestId, requestAt(3).retryOfRequestId]).toEqual([undefined, undefined]);
    expect(boundary.classify).toHaveBeenCalledTimes(2);
  });

  it("Back invalidates a pending retry, then unchanged batch recovery consumes retained success without another invocation", async () => {
    footnoteInput();
    fireEvent.click(await screen.findByRole("button", { name: "ניסיון חדש" }));
    // The default fixture makes a quick child failure; the newly offered action
    // is independently bound to that child. Start it with a delayed response.
    await waitFor(() => expect(boundary.invoke).toHaveBeenCalledTimes(2));
    const nextButton = await screen.findByRole("button", { name: "ניסיון חדש" });
    const pending = deferred<typeof success>();
    boundary.invoke.mockReturnValueOnce(pending.promise);
    fireEvent.click(nextButton);
    await waitFor(() => expect(boundary.invoke).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getByRole("button", { name: /חזור לעריכה$/ }));
    await act(async () => { pending.resolve(success); });
    expect(screen.queryByDisplayValue((value) => value.startsWith(citation))).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /בנה טיוטות לבדיקה/ }));
    await screen.findByDisplayValue((value) => value.startsWith(citation));
    expect(boundary.invoke).toHaveBeenCalledTimes(3);
    expect(boundary.classify).toHaveBeenCalledTimes(1);
  });

  it("editing one cell invalidates only its failure action and account changes discard every offer", async () => {
    const ui = footnoteInput([rawA, rawB]);
    const old = (await screen.findAllByRole("button", { name: "ניסיון חדש" }))[0];
    fireEvent.click(screen.getAllByRole("button", { name: /ערוך קלט/ })[0]);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: rawA + " מתוקן" } });
    act(() => old.click());
    expect(boundary.invoke).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole("button", { name: "ניסיון חדש" })).toHaveLength(1);
    boundary.user = { id: "other-footnotes-account" };
    ui.rerender(<BatchFootnoteBuilder />);
    expect(screen.queryByRole("button", { name: "ניסיון חדש" })).not.toBeInTheDocument();
  });

  it("changing a cell source type revokes its prepared failed-parent action", async () => {
    footnoteInput();
    const oldButton = await screen.findByRole("button", { name: "ניסיון חדש" });
    const originalScroll = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = vi.fn();
    try {
      fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
      fireEvent.click((await screen.findAllByRole("option", { name: "ספר" }))[0]);
      act(() => oldButton.click());
      expect(screen.queryByRole("button", { name: "ניסיון חדש" })).not.toBeInTheDocument();
      expect(boundary.invoke).toHaveBeenCalledTimes(1);
    } finally { HTMLElement.prototype.scrollIntoView = originalScroll; }
  });

  it("a removed cell cannot receive a pending result and the next cell keeps its own retry identity", async () => {
    footnoteInput([rawA, rawB]);
    const initial = await screen.findAllByRole("button", { name: "ניסיון חדש" });
    const pending = deferred<typeof success>();
    boundary.invoke.mockReturnValueOnce(pending.promise);
    fireEvent.click(initial[0]);
    await waitFor(() => expect(boundary.invoke).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getAllByRole("button", { name: "✕" })[0]);
    await act(async () => { pending.resolve(success); });
    expect(screen.queryByDisplayValue((value) => value.startsWith(citation))).not.toBeInTheDocument();
    const remainingParent = initialRequestFor("4567/23").requestId;
    fireEvent.click(screen.getByRole("button", { name: "ניסיון חדש" }));
    await waitFor(() => expect(boundary.invoke).toHaveBeenCalledTimes(4));
    expect(requestAt(3).retryOfRequestId).toBe(remainingParent);
  });

  it("unmount retains a pending child's successful response and reload never restores a saved action", async () => {
    const ui = footnoteInput();
    const button = await screen.findByRole("button", { name: "ניסיון חדש" });
    const pending = deferred<typeof success>();
    boundary.invoke.mockReturnValueOnce(pending.promise);
    fireEvent.click(button);
    await waitFor(() => expect(boundary.invoke).toHaveBeenCalledTimes(2));
    ui.unmount();
    await act(async () => { pending.resolve(success); });
    render(<BatchFootnoteBuilder />);
    expect(screen.queryByRole("button", { name: "ניסיון חדש" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /הפק מחדש/ }));
    await screen.findByDisplayValue((value) => value.startsWith(citation));
    expect(boundary.invoke).toHaveBeenCalledTimes(2);
  });

  it.each(["in_progress", "unknown", "succeeded"])("does not offer an explicit cell action for %s", async (status) => {
    boundary.invoke.mockImplementation(async (_name, { body }: RequestOptions) => responseError({
      error: "REQUEST_ALREADY_STARTED", status, requestId: body.requestId,
    }, 409));
    footnoteInput();
    await screen.findByText(/מזהה בקשה:/);
    expect(screen.queryByRole("button", { name: "ניסיון חדש" })).not.toBeInTheDocument();
    expect(boundary.invoke).toHaveBeenCalledTimes(1);
  });

  it("runPool does not automatically repeat a normally transient cell failure", async () => {
    boundary.invoke.mockImplementation(async (_name, { body }: RequestOptions) => responseError({
      error: "AI_RATE_LIMITED", status: "failed", requestId: body.requestId,
    }, 429));
    footnoteInput();
    await screen.findByRole("button", { name: "ניסיון חדש" });
    expect(boundary.invoke).toHaveBeenCalledTimes(1);
  });

  it("locally unusable output remains a nonbillable local recheck in a cell", async () => {
    boundary.invoke.mockResolvedValueOnce({ data: { content: "123" }, error: null });
    footnoteInput();
    await screen.findByText(/התוצאה שהתקבלה אינה אזכור שלם/);
    expect(screen.queryByRole("button", { name: "ניסיון חדש" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /נסה שוב/ }));
    await screen.findByText(/התוצאה שהתקבלה אינה אזכור שלם/);
    expect(boundary.invoke).toHaveBeenCalledTimes(1);
  });

  it("keeps an unmodified FootnoteReviewCard consumer's existing regenerate behavior", () => {
    const regenerate = vi.fn();
    render(<FootnoteReviewCard cell={{ id: 1, input: rawA, output: null, status: "error" }}
      onInputChange={vi.fn()} onOutputChange={vi.fn()} onSourceTypeChange={vi.fn()} onApproveToggle={vi.fn()}
      onRegenerate={regenerate} onRemove={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "ניסיון חדש" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /נסה שוב/ }));
    expect(regenerate).toHaveBeenCalledWith(1);
  });
});


describe("research uniform citation mounted rows", () => {
  const footnotes = [{ number: 1, title: rawA }, { number: 2, title: rawB }];
  const startUniform = (items = footnotes) => {
    const ui = render(<UniformCitationPanel footnotes={items} />);
    fireEvent.click(screen.getByRole("button", { name: "יצירת הערות שוליים לפי כללי האזכור האחיד" }));
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    return ui;
  };

  it("uses explicit row-only retry with duplicate-click protection and unchanged preparation", async () => {
    startUniform();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "ניסיון חדש" })).toHaveLength(2));
    const buttons = screen.getAllByRole("button", { name: "ניסיון חדש" });
    expect(boundary.invoke).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText(/עשוי לצרוך שימוש נוסף/)).toHaveLength(2);
    const pending = deferred<typeof success>();
    boundary.invoke.mockReturnValueOnce(pending.promise);
    act(() => { buttons[0].click(); buttons[0].click(); });
    await waitFor(() => expect(boundary.invoke).toHaveBeenCalledTimes(3));
    expect(requestAt(2).retryOfRequestId).toBe(initialRequestFor("1234/22").requestId);
    expect(executionBody(requestAt(2))).toEqual(executionBody(initialRequestFor("1234/22")));
    await act(async () => { pending.resolve(success); });
    await screen.findByDisplayValue((value) => value.startsWith(citation));
    expect(screen.getAllByRole("button", { name: "ניסיון חדש" })).toHaveLength(1);
    expect(boundary.classify).toHaveBeenCalledTimes(2);
  });

  it("retains same-ID normal recovery and never lets runPool retry a transient failure automatically", async () => {
    boundary.invoke.mockImplementation(async (_name, { body }: RequestOptions) => responseError({
      error: "AI_RATE_LIMITED", status: "failed", requestId: body.requestId,
    }, 429));
    startUniform(footnotes.slice(0, 1));
    await screen.findByRole("button", { name: "ניסיון חדש" });
    expect(boundary.invoke).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /נסה שוב/ }));
    await screen.findByRole("button", { name: "ניסיון חדש" });
    expect(requestAt(1).requestId).toBe(requestAt(0).requestId);
    expect(requestAt(1).retryOfRequestId).toBeUndefined();
    expect(boundary.classify).toHaveBeenCalledTimes(1);
  });

  it("keeps unusable success recovery local with no explicit paid retry", async () => {
    boundary.invoke.mockResolvedValueOnce({ data: { content: "123" }, error: null });
    startUniform(footnotes.slice(0, 1));
    await screen.findByText(/התוצאה שהתקבלה אינה אזכור שלם/);
    expect(screen.queryByRole("button", { name: "ניסיון חדש" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /נסה שוב/ }));
    await screen.findByText(/התוצאה שהתקבלה אינה אזכור שלם/);
    expect(boundary.invoke).toHaveBeenCalledTimes(1);
  });

  it("input edits invalidate only the edited row, and source revision drops every old offer", async () => {
    const ui = startUniform();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "ניסיון חדש" })).toHaveLength(2));
    const buttons = screen.getAllByRole("button", { name: "ניסיון חדש" });
    fireEvent.click(screen.getAllByRole("button", { name: /ערוך קלט/ })[0]);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: rawA + " מתוקן" } });
    act(() => buttons[0].click());
    expect(boundary.invoke).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole("button", { name: "ניסיון חדש" })).toHaveLength(1);
    ui.rerender(<UniformCitationPanel footnotes={[{ number: 1, title: rawA + " מקור מחקר חדש" }]} />);
    expect(screen.queryByRole("button", { name: "ניסיון חדש" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "יצירת הערות שוליים לפי כללי האזכור האחיד" })).toBeInTheDocument();
  });

  it("account changes and unmount suppress pending child output", async () => {
    const ui = startUniform(footnotes.slice(0, 1));
    const button = await screen.findByRole("button", { name: "ניסיון חדש" });
    const pending = deferred<typeof success>();
    boundary.invoke.mockReturnValueOnce(pending.promise);
    fireEvent.click(button);
    await waitFor(() => expect(boundary.invoke).toHaveBeenCalledTimes(2));
    boundary.user = { id: "other-uniform-account" };
    ui.rerender(<UniformCitationPanel footnotes={footnotes.slice(0, 1)} />);
    ui.unmount();
    await act(async () => { pending.resolve(success); });
    render(<UniformCitationPanel footnotes={footnotes.slice(0, 1)} />);
    expect(screen.queryByDisplayValue((value) => value.startsWith(citation))).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניסיון חדש" })).not.toBeInTheDocument();
  });

  it.each(["in_progress", "unknown", "succeeded"])("never offers a new uniform attempt for %s", async (status) => {
    boundary.invoke.mockImplementation(async (_name, { body }: RequestOptions) => responseError({
      error: "REQUEST_ALREADY_STARTED", status, requestId: body.requestId,
    }, 409));
    startUniform(footnotes.slice(0, 1));
    await screen.findByText(/מזהה בקשה:/);
    expect(screen.queryByRole("button", { name: "ניסיון חדש" })).not.toBeInTheDocument();
    expect(boundary.invoke).toHaveBeenCalledTimes(1);
  });
});


describe("exact-request status links beside citation failures", () => {
  it.each(["bibliography", "footnote", "uniform"])("links the %s failure to its existing request and adds no invocation", async (mode) => {
    if (mode === "bibliography") bibliographyInput();
    else if (mode === "footnote") footnoteInput();
    else {
      render(<UniformCitationPanel footnotes={[{ number: 1, title: rawA }]} />);
      fireEvent.click(screen.getByRole("button", { name: "יצירת הערות שוליים לפי כללי האזכור האחיד" }));
      fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    }
    const link = await screen.findByRole("link", { name: "בדיקת מצב הבקשה" });
    expect(link).toHaveAttribute("href", `/citation-recovery?requestId=${requestAt(0).requestId}`);
    expect(boundary.invoke).toHaveBeenCalledTimes(1);
    expect(boundary.insert).not.toHaveBeenCalled();
    if (mode === "footnote") {
      const saved = Object.values(localStorage).join(" ");
      expect(saved).not.toContain(String(requestAt(0).requestId));
    }
  });
});


it("does not keep the old failed request link after a new attempt returns a choice", async () => {
  boundary.classify.mockResolvedValue({ sourceType: "foreign_case_us" });
  bibliographyInput("Jones v. Smith and Sons");
  const parentLink = await screen.findByRole("link", { name: "בדיקת מצב הבקשה" });
  expect(parentLink).toHaveAttribute("href", `/citation-recovery?requestId=${requestAt(0).requestId}`);
  boundary.invoke.mockResolvedValueOnce({ data: { content: "", foreignLookup: { disambiguation: [
    { jurisdiction: "US", label: "First Jones case", url: "https://example.test/one" },
    { jurisdiction: "UK", label: "Second Jones case", url: "https://example.test/two" },
  ] } }, error: null });
  fireEvent.click(screen.getByRole("button", { name: "ניסיון חדש" }));
  await waitFor(() => expect(boundary.invoke).toHaveBeenCalledTimes(2));
  await screen.findByText(/First Jones case/);
  expect(screen.queryByRole("link", { name: "בדיקת מצב הבקשה" })).not.toBeInTheDocument();
  expect(requestAt(1).retryOfRequestId).toBe(requestAt(0).requestId);
  expect(requestAt(1).requestId).not.toBe(requestAt(0).requestId);
});
