import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryCitationJournal } from "./fixtures/memoryCitationJournal";
import { CitationRequestIdentity } from "@/lib/citationRequestIdentity";
import { invokeFunction, parseFunctionError, retryCitationFunction, citationRetryDisclosure } from "@/lib/functionError";
import { runCitation } from "@/lib/runCitation";
import { ManualEntry } from "@/components/ManualEntry";

const boundary = vi.hoisted(() => ({
  invoke: vi.fn(), getSession: vi.fn(), refreshSession: vi.fn(), getUser: vi.fn(),
  insert: vi.fn(), toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
  user: { id: "initial" } as { id: string } | null,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  functions: { invoke: boundary.invoke },
  auth: { getSession: boundary.getSession, refreshSession: boundary.refreshSession, getUser: boundary.getUser },
  from: () => ({ insert: boundary.insert }),
} }));
// Production remains IndexedDB-only; this suite explicitly injects a unit double.
vi.mock("@/lib/citationRequestIdentity", async (original) => {
  const actual = await original<typeof import("@/lib/citationRequestIdentity")>();
  const { MemoryCitationJournal } = await import("./fixtures/memoryCitationJournal");
  return { ...actual, citationRequests: new actual.CitationRequestIdentity(256, new MemoryCitationJournal()) };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: boundary.user }) }));
vi.mock("sonner", () => ({ toast: boundary.toast }));
vi.mock("@/components/FormattedCitation", () => ({ FormattedCitation: ({ text }: { text: string }) => <div>{text}</div> }));
vi.mock("@/components/LawAutocomplete", () => ({ LawAutocomplete: () => null }));

const success = { data: { content: "A completed citation returned by the engine" }, error: null };
const body = (text = "unchanged citation") => ({ messages: [{ role: "user", content: text }], requestId: crypto.randomUUID() });
const failure = (code: string, status = 409, extra = {}) => ({ data: null, error: { context: new Response(JSON.stringify({ error: code, ...extra }), { status }) } });
const session = (id = boundary.user!.id) => ({ user: { id }, access_token: `fixture-token-${id}`, expires_at: Date.now() / 1000 + 3600 });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden in lifecycle tests"); }));
  boundary.user = { id: crypto.randomUUID() };
  boundary.getSession.mockImplementation(async () => ({ data: { session: session() } }));
  boundary.refreshSession.mockImplementation(async () => ({ data: { session: session() } }));
  boundary.getUser.mockResolvedValue({ data: { user: null } });
  boundary.invoke.mockResolvedValue(success);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function renderBook() {
  const ui = render(<ManualEntry />);
  fillBook();
  return ui;
}
function fillBook(suffix = "") {
  fireEvent.click(screen.getByRole("button", { name: /ספר$/ }));
  const fields = screen.getAllByRole("textbox");
  ["מחבר הספר", `שם הספר${suffix}`, "2024"].forEach((value, index) => fireEvent.change(fields[index], { target: { value } }));
}
const generate = () => screen.getByRole("button", { name: /ייצר אזכור תקני|בדיקת מצב הבקשה/ });

// Exercises the real shared invocation boundary, not a duplicate billing mock.
describe("citation request identity and transport", () => {
  it("reuses the exact body through one 401 retry, including a second in-body error", async () => {
    boundary.invoke.mockResolvedValueOnce(failure("Unauthorized", 401))
      .mockResolvedValueOnce({ data: { error: "REQUEST_ALREADY_STARTED", status: "in_progress" }, error: null });
    const result = await invokeFunction("citation-chat", body());
    expect(boundary.invoke).toHaveBeenCalledTimes(2);
    expect(boundary.refreshSession).toHaveBeenCalledTimes(1);
    expect(boundary.invoke.mock.calls[0][1].body).toBe(boundary.invoke.mock.calls[1][1].body);
    expect(boundary.invoke.mock.calls[0][1].body.citationRequestVersion).toBe(3);
    expect(result.errorInfo?.code).toBe("REQUEST_ALREADY_STARTED");
  });

  it("does not retry a thrown transport error, then preserves the ID on a manual retry with new telemetry", async () => {
    boundary.invoke.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const first = await invokeFunction("citation-chat", { ...body(), telemetryRequestId: "first" });
    expect(first.errorInfo?.code).toBe("REQUEST_OUTCOME_UNKNOWN");
    expect(boundary.invoke).toHaveBeenCalledTimes(1);
    await invokeFunction("citation-chat", { ...body(), telemetryRequestId: "new-user-action" });
    expect(boundary.invoke.mock.calls[1][1].body.requestId).toBe(boundary.invoke.mock.calls[0][1].body.requestId);
    // A delivered result ends the operation: an intentional new operation is distinct.
    await invokeFunction("citation-chat", body());
    expect(boundary.invoke.mock.calls[2][1].body.requestId).not.toBe(boundary.invoke.mock.calls[0][1].body.requestId);
  });

  it("retains returned network errors and empty 200 responses as unknown outcomes", async () => {
    boundary.invoke.mockResolvedValueOnce({ data: null, error: new Error("FunctionsFetchError") })
      .mockResolvedValueOnce({ data: { content: " " }, error: null });
    const a = await invokeFunction("citation-chat", body());
    const b = await invokeFunction("citation-chat", body());
    expect(a.errorInfo?.code).toBe("REQUEST_OUTCOME_UNKNOWN");
    expect(b.errorInfo?.code).toBe("REQUEST_OUTCOME_UNKNOWN");
    expect(boundary.invoke.mock.calls[0][1].body.requestId).toBe(boundary.invoke.mock.calls[1][1].body.requestId);
  });

  it.each(["{}", "[]", '"proxy error"', "<html>Unavailable</html>", "unavailable"])("treats malformed 5xx body %s as unknown rather than a fresh retry", async (response) => {
    boundary.invoke.mockResolvedValue({ data: null, error: { context: new Response(response, { status: 503 }) } });
    const result = await invokeFunction("citation-chat", body());
    expect(result.errorInfo?.code).toBe("REQUEST_OUTCOME_UNKNOWN");
    expect(result.errorInfo?.message).not.toContain("נסו שוב");
  });

  it.each([{}, { unexpected: true }, { foreignLookup: {} }, { foreignLookup: [] },
    { foreignLookup: { fields: {} } }, { foreignLookup: { fields: { arbitrary: "data" } } },
    { foreignLookup: { disambiguation: [{}, {}] } },
  ])("does not retire an ID for malformed success %#", async (data) => {
    boundary.invoke.mockResolvedValueOnce({ data, error: null });
    expect((await invokeFunction("citation-chat", body())).errorInfo?.code).toBe("REQUEST_OUTCOME_UNKNOWN");
    await invokeFunction("citation-chat", body());
    expect(boundary.invoke.mock.calls[0][1].body.requestId).toBe(boundary.invoke.mock.calls[1][1].body.requestId);
  });

  it.each([
    { fields: {}, identity: { matched: false }, articleResolution: "incomplete" },
    { fields: { articleTitle: "A grounded title" }, identity: { matched: true } },
    { disambiguation: [
      { jurisdiction: "US", label: "Choice one", url: "https://example.com/one" },
      { jurisdiction: "UK", label: "Choice two", url: "https://example.com/two" },
    ] },
  ])("accepts a usable typed foreign response %# without requiring text content", async (foreignLookup) => {
    boundary.invoke.mockResolvedValueOnce({ data: { content: "", foreignLookup }, error: null });
    const result = await invokeFunction("citation-chat", { ...body(), foreignLookup: { kind: "journal_article" } });
    expect(result.errorInfo).toBeNull();
    expect(result.data).toMatchObject({ foreignLookup });
  });

  it.each(["in_progress", "unknown", "failed", "succeeded"])("retains an already-started ID for status %s without paid auto-retries", async (status) => {
    boundary.invoke.mockResolvedValue(failure("REQUEST_ALREADY_STARTED", 409, { status }));
    await invokeFunction("citation-chat", body());
    const second = await invokeFunction("citation-chat", body());
    expect(boundary.invoke).toHaveBeenCalledTimes(2);
    expect(boundary.invoke.mock.calls[0][1].body.requestId).toBe(boundary.invoke.mock.calls[1][1].body.requestId);
    expect(second.errorInfo?.isOperationInProgress).toBe(status === "in_progress");
    expect(second.errorInfo?.message).not.toContain("נסו שוב");
  });

  it("coalesces concurrent duplicate submissions, but gives changed inputs and accounts new IDs", async () => {
    const pending = deferred<typeof success>();
    boundary.invoke.mockReturnValueOnce(pending.promise);
    const a = invokeFunction("citation-chat", body());
    const b = invokeFunction("citation-chat", body());
    await waitFor(() => expect(boundary.invoke).toHaveBeenCalledTimes(1));
    pending.resolve(failure("REQUEST_OUTCOME_UNKNOWN", 503) as typeof success);
    await Promise.all([a, b]);
    await invokeFunction("citation-chat", body("changed citation"));
    boundary.user = { id: "other-account" };
    await invokeFunction("citation-chat", body());
    const ids = boundary.invoke.mock.calls.map(([, options]) => options.body.requestId);
    expect(new Set(ids).size).toBe(3);
    expect(boundary.invoke.mock.calls[2][1].headers.Authorization).toBe("Bearer fixture-token-other-account");
  });

  it("does not send the old request under a different account after an auth refresh", async () => {
    boundary.invoke.mockResolvedValueOnce(failure("Unauthorized", 401));
    boundary.refreshSession.mockResolvedValueOnce({ data: { session: session("other-account") } });
    const result = await invokeFunction("citation-chat", body());
    expect(result.errorInfo?.isAuthExpired).toBe(true);
    expect(boundary.invoke).toHaveBeenCalledTimes(1);
  });

  it("does not log an old request failure under a newly selected account", async () => {
    const pending = deferred<typeof success>();
    const originalAccount = boundary.user!.id;
    boundary.invoke.mockReturnValueOnce(pending.promise);
    boundary.getUser.mockImplementation(async () => ({ data: { user: boundary.user } }));
    const result = invokeFunction("citation-chat", body());
    await waitFor(() => expect(boundary.invoke).toHaveBeenCalledTimes(1));
    boundary.user = { id: "different-logging-account" };
    pending.resolve(failure("REQUEST_OUTCOME_UNKNOWN", 503) as typeof success);
    await result;
    expect(boundary.invoke.mock.calls[0][1].headers.Authorization).toBe(`Bearer fixture-token-${originalAccount}`);
    expect(boundary.insert).not.toHaveBeenCalled();
  });

  it("always sends the supported identity protocol and treats an old-client rejection as an update requirement", async () => {
    boundary.invoke.mockResolvedValueOnce(failure("CLIENT_UPDATE_REQUIRED", 426));
    const result = await invokeFunction("citation-chat", { ...body(), citationRequestVersion: 0 });
    expect(boundary.invoke).toHaveBeenCalledTimes(1);
    expect(boundary.invoke.mock.calls[0][1].body.citationRequestVersion).toBe(3);
    expect(result.errorInfo?.code).toBe("CLIENT_UPDATE_REQUIRED");
    expect(result.errorInfo?.message).toContain("רעננו");
    expect(result.errorInfo?.isInvalidInput).toBe(false);
    await invokeFunction("citation-chat", body());
    expect(boundary.invoke.mock.calls[1][1].body.citationRequestVersion).toBe(3);
    expect(boundary.invoke.mock.calls[1][1].body.requestId).toBe(boundary.invoke.mock.calls[0][1].body.requestId);
  });

  it.each(["INPUT_TOO_LARGE", "INVALID_RECOVERY_INPUT"])("explains pre-claim bounded-input rejection %s without suggesting unknown paid work", async (code) => {
    const info = await parseFunctionError(failure(code, code === "INPUT_TOO_LARGE" ? 413 : 400).error);
    expect(info.isInvalidInput).toBe(true);
    expect(info.message).toContain("128 KiB");
    expect(info.message).toContain("100");
    expect(info.message).toContain("לא נצרכו יחידות שימוש חדשות");
  });

  it("rechecks the account before first dispatch even without a UI lifecycle callback", async () => {
    boundary.getSession.mockResolvedValueOnce({ data: { session: session() } })
      .mockResolvedValue({ data: { session: session("switched-before-dispatch") } });
    const result = await invokeFunction("citation-chat", body());
    expect(result.errorInfo?.code).toBe("CITATION_RETRY_STALE");
    expect(boundary.invoke).not.toHaveBeenCalled();
  });

  it("does not deliver a completed old-account result even without a UI lifecycle callback", async () => {
    boundary.invoke.mockImplementationOnce(async () => { boundary.user = { id: "switched-before-delivery" }; return success; });
    const result = await invokeFunction("citation-chat", body());
    expect(result.data).toBeNull(); expect(result.errorInfo?.code).toBe("CITATION_RETRY_STALE");
  });

  it("requires a known account before dispatch and does not confuse ID/version errors with invalid input", async () => {
    boundary.getSession.mockResolvedValueOnce({ data: { session: null } });
    expect((await invokeFunction("citation-chat", body())).errorInfo?.isAuthExpired).toBe(true);
    expect(boundary.invoke).not.toHaveBeenCalled();
    const info = await parseFunctionError(failure("INVALID_REQUEST_ID", 400).error);
    expect(info.isInvalidInput).toBe(false);
    expect(info.message).toContain("עדכנו");
  });

  it("real runCitation retries keep identity while source-type/payload changes make a new operation", async () => {
    boundary.invoke.mockResolvedValue(failure("REQUEST_OUTCOME_UNKNOWN", 503));
    const options = { rawInput: 'ע"א 1234/22 פלוני נגד פלוני', overrideType: "case_law_database" as const, useVerifiedStore: false };
    await expect(runCitation(options)).rejects.toMatchObject({ code: "REQUEST_OUTCOME_UNKNOWN" });
    await expect(runCitation(options)).rejects.toMatchObject({ code: "REQUEST_OUTCOME_UNKNOWN" });
    await expect(runCitation({ ...options, overrideType: "case_law_published" })).rejects.toMatchObject({ code: "REQUEST_OUTCOME_UNKNOWN" });
    const ids = boundary.invoke.mock.calls.map(([, options]) => options.body.requestId);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it("unverified/refusal messages disclose an unconfirmed refund and retain the unresolved ID", async () => {
    boundary.invoke.mockResolvedValue(failure("AI_RESPONSE_UNVERIFIED", 502, { status: "unknown", refunded: false }));
    const first = await invokeFunction("citation-chat", body());
    await invokeFunction("citation-chat", body());
    expect(first.errorInfo?.message).toContain("החזר שימוש לא אושר");
    expect(boundary.invoke.mock.calls[0][1].body.requestId).toBe(boundary.invoke.mock.calls[1][1].body.requestId);
    expect((await parseFunctionError(failure("AI_REFUSED", 422, { refunded: false }).error)).message).toContain("טרם אושר");
    expect((await parseFunctionError(failure("AI_REFUSED", 422, { refunded: true, refund_receipt: { status: "refunded", refunded: true, units_refunded: 1, request_id: "billing-anchor" } }).error)).message).toContain("השימוש הוחזר");
  });
});

describe("ManualEntry actual UI interruption/retry flows", () => {
  it("blocks double clicks before a rerender, adds a valid ID, and recovers that ID on manual retry", async () => {
    const pending = deferred<typeof success>();
    boundary.invoke.mockReturnValueOnce(pending.promise);
    renderBook();
    const button = generate();
    act(() => { button.click(); button.click(); });
    await waitFor(() => expect(boundary.invoke).toHaveBeenCalledTimes(1));
    const id = boundary.invoke.mock.calls[0][1].body.requestId;
    expect(id.length).toBeGreaterThanOrEqual(8);
    await act(async () => { pending.resolve(failure("REQUEST_OUTCOME_UNKNOWN", 503) as typeof success); });
    await waitFor(() => expect(generate()).toBeEnabled());
    fireEvent.click(generate());
    await screen.findByText(success.data.content);
    expect(boundary.invoke.mock.calls[1][1].body.requestId).toBe(id);
  });

  it("Back and a changed form ignore the old response and keep the new loading state", async () => {
    const old = deferred<typeof success>();
    const next = deferred<typeof success>();
    boundary.invoke.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    renderBook();
    fireEvent.click(generate());
    await waitFor(() => expect(boundary.invoke).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /חזור/ }));
    fillBook(" חדש");
    fireEvent.click(generate());
    await waitFor(() => expect(boundary.invoke).toHaveBeenCalledTimes(2));
    await act(async () => { old.resolve(success); });
    expect(screen.queryByText(success.data.content)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /מייצר אזכור/ })).toBeDisabled();
    await act(async () => { next.resolve({ data: { content: "New form citation" }, error: null }); });
    await screen.findByText("New form citation");
    expect(boundary.invoke.mock.calls[0][1].body.requestId).not.toBe(boundary.invoke.mock.calls[1][1].body.requestId);
  });

  it("editing fields while pending prevents stale output, and restoring the same unresolved form keeps its ID", async () => {
    const pending = deferred<typeof success>();
    boundary.invoke.mockReturnValueOnce(pending.promise);
    renderBook();
    fireEvent.click(generate());
    await waitFor(() => expect(boundary.invoke).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getAllByRole("textbox")[1], { target: { value: "שינוי" } });
    await act(async () => { pending.resolve(failure("REQUEST_OUTCOME_UNKNOWN", 503) as typeof success); });
    expect(boundary.toast.error).not.toHaveBeenCalled();
    fireEvent.change(screen.getAllByRole("textbox")[1], { target: { value: "שם הספר" } });
    fireEvent.click(generate());
    await screen.findByText(success.data.content);
    expect(boundary.invoke.mock.calls[0][1].body.requestId).toBe(boundary.invoke.mock.calls[1][1].body.requestId);
  });

  it("unmount/remount keeps unresolved same-account identity without showing the unmounted result", async () => {
    const pending = deferred<typeof success>();
    boundary.invoke.mockReturnValueOnce(pending.promise);
    const ui = renderBook();
    fireEvent.click(generate());
    await waitFor(() => expect(boundary.invoke).toHaveBeenCalledTimes(1));
    ui.unmount();
    await act(async () => { pending.resolve(failure("REQUEST_OUTCOME_UNKNOWN", 503) as typeof success); });
    expect(boundary.toast.error).not.toHaveBeenCalled();
    renderBook();
    fireEvent.click(generate());
    await screen.findByText(success.data.content);
    expect(boundary.invoke.mock.calls[0][1].body.requestId).toBe(boundary.invoke.mock.calls[1][1].body.requestId);
  });

  it("recovers a successful response arriving after unmount without another paid invocation", async () => {
    const pending = deferred<typeof success>();
    boundary.invoke.mockReturnValueOnce(pending.promise);
    const ui = renderBook();
    fireEvent.click(generate());
    await waitFor(() => expect(boundary.invoke).toHaveBeenCalledTimes(1));
    ui.unmount();
    await act(async () => { pending.resolve(success); });
    renderBook();
    fireEvent.click(generate());
    await screen.findByText(success.data.content);
    expect(boundary.invoke).toHaveBeenCalledTimes(1);
  });

  it("account changes discard the previous form and its eventual response", async () => {
    const pending = deferred<typeof success>();
    boundary.invoke.mockReturnValueOnce(pending.promise);
    const ui = renderBook();
    fireEvent.click(generate());
    await waitFor(() => expect(boundary.invoke).toHaveBeenCalledTimes(1));
    boundary.user = { id: "new-ui-account" };
    ui.rerender(<ManualEntry />);
    expect(screen.getByText("בחר סוג מקור")).toBeInTheDocument();
    await act(async () => { pending.resolve(success); });
    expect(screen.queryByText(success.data.content)).not.toBeInTheDocument();
  });
});

describe("bounded in-memory identity registry", () => {
  it("does not evict unknown operations at capacity and restores identity with a shared injected journal", async () => {
    const journal = new MemoryCitationJournal();
    const registry = new CitationRequestIdentity(1, journal);
    const run = vi.fn(async () => ({ errorInfo: { code: "REQUEST_OUTCOME_UNKNOWN" } }));
    await registry.invoke("account", body(), null, run);
    await expect(registry.invoke("account", body("another"), null, run)).rejects.toThrow("REQUEST_RECOVERY_LIMIT");
    await registry.invoke("account", body(), null, run);
    const calls = run.mock.calls as unknown as Array<[Record<string, unknown>]>;
    expect(calls[0][0].requestId).toBe(calls[1][0].requestId);
    const reloaded = new CitationRequestIdentity(256, journal);
    await reloaded.invoke("account", body(), null, run);
    expect(calls[2][0].requestId).toBe(calls[0][0].requestId);
  });
});

const receiptFor = (requestId: string, status = "refunded") => ({
  status, refunded: status === "refunded", units_refunded: status === "refunded" ? 1 : 0, request_id: requestId,
});
const failedResponse = (requestId: string, receipt: Record<string, unknown> = receiptFor(requestId)) =>
  failure("AI_REFUSED", 422, { requestId, status: "failed", refunded: receipt.refunded, refund_receipt: receipt });
const failEveryRequest = () => boundary.invoke.mockImplementation(async (_name, options) => failedResponse(options.body.requestId));

async function firstFailedRequest() {
  failEveryRequest();
  const original = body();
  const result = await invokeFunction("citation-chat", original);
  expect(result.errorInfo?.citationRetry).toBeDefined();
  return { original, descriptor: result.errorInfo!.citationRetry! };
}

describe("explicit server-confirmed failed successors", () => {
  it("normal retry keeps the failed ID; explicit double clicks create at most one child, never a grandchild", async () => {
    const { original, descriptor } = await firstFailedRequest();
    await invokeFunction("citation-chat", body());
    expect(boundary.invoke.mock.calls[1][1].body.requestId).toBe(descriptor.failedRequestId);
    const [child] = await Promise.all([retryCitationFunction(descriptor), retryCitationFunction(descriptor)]);
    const childId = child.errorInfo!.requestId!;
    expect(childId).not.toBe(descriptor.failedRequestId);
    await retryCitationFunction(descriptor);
    expect(new Set(boundary.invoke.mock.calls.map(([, options]) => options.body.requestId)).size).toBe(2);
    expect(boundary.invoke.mock.calls.slice(2).every(([, options]) => options.body.retryOfRequestId === descriptor.failedRequestId)).toBe(true);
    expect(child.errorInfo?.citationRetry?.failedRequestId).toBe(childId);
    // A genuinely new click on the newly displayed child failure can advance.
    await retryCitationFunction(child.errorInfo!.citationRetry!);
    const calls = boundary.invoke.mock.calls.length;
    expect((await retryCitationFunction(descriptor)).errorInfo?.code).toBe("CITATION_RETRY_STALE");
    expect(boundary.invoke).toHaveBeenCalledTimes(calls);
    await invokeFunction("citation-chat", original);
    expect(new Set(boundary.invoke.mock.calls.map(([, options]) => options.body.requestId)).size).toBe(3);
  });

  it("adopts an existing canonical child, with its own failed descriptor, without creating a grandchild", async () => {
    const { original, descriptor } = await firstFailedRequest();
    const canonical = crypto.randomUUID();
    boundary.invoke.mockResolvedValueOnce(failure("REQUEST_ALREADY_STARTED", 409, {
      requestId: canonical, status: "failed", refund_receipt: receiptFor(canonical, "retained"),
    }));
    const adopted = await retryCitationFunction(descriptor);
    expect(adopted.errorInfo?.requestId).toBe(canonical);
    expect(adopted.errorInfo?.citationRetry?.failedRequestId).toBe(canonical);
    await invokeFunction("citation-chat", original);
    await retryCitationFunction(descriptor);
    expect(boundary.invoke.mock.calls.slice(2).every(([, options]) => options.body.requestId === canonical)).toBe(true);
    expect(boundary.invoke.mock.calls.slice(2).every(([, options]) => options.body.retryOfRequestId === descriptor.failedRequestId)).toBe(true);
  });

  it("a lost child acknowledgement retains that child for all normal/explicit retries", async () => {
    const { original, descriptor } = await firstFailedRequest();
    boundary.invoke.mockRejectedValueOnce(new TypeError("Lost child response"));
    const unknown = await retryCitationFunction(descriptor);
    expect(unknown.errorInfo?.code).toBe("REQUEST_OUTCOME_UNKNOWN");
    expect(unknown.errorInfo?.citationRetry).toBeUndefined();
    const childId = boundary.invoke.mock.calls[1][1].body.requestId;
    boundary.invoke.mockResolvedValue(failure("REQUEST_ALREADY_STARTED", 409, { requestId: childId, status: "unknown" }));
    await invokeFunction("citation-chat", original);
    await retryCitationFunction(descriptor);
    expect(boundary.invoke.mock.calls.slice(1).every(([, options]) => options.body.requestId === childId)).toBe(true);
  });

  it("rejects changed payload, project, or account instead of applying an old failed-action handle", async () => {
    const { descriptor } = await firstFailedRequest();
    expect((await invokeFunction("citation-chat", body("changed"), { citationRetry: descriptor })).errorInfo?.code).toBe("CITATION_RETRY_STALE");
    expect((await invokeFunction("citation-chat", body(), { projectId: "new-project", citationRetry: descriptor })).errorInfo?.code).toBe("CITATION_RETRY_STALE");
    boundary.user = { id: "another-account" };
    expect((await retryCitationFunction(descriptor)).errorInfo?.code).toBe("CITATION_RETRY_STALE");
    expect(boundary.invoke).toHaveBeenCalledTimes(1);
  });

  it.each(["unknown", "in_progress", "succeeded"])("does not grant a new-attempt capability for status %s", async (status) => {
    boundary.invoke.mockImplementation(async (_name, options) => failure("REQUEST_ALREADY_STARTED", 409, { requestId: options.body.requestId, status }));
    expect((await invokeFunction("citation-chat", body())).errorInfo?.citationRetry).toBeUndefined();
  });

  it("does not trust a failed boolean or client retryOf field without server ID/status evidence", async () => {
    boundary.invoke.mockResolvedValueOnce(failure("AI_REFUSED", 422, { status: "failed", refunded: true }));
    const result = await invokeFunction("citation-chat", { ...body(), retryOfRequestId: "forged-parent" });
    expect(result.errorInfo?.citationRetry).toBeUndefined();
    expect(boundary.invoke.mock.calls[0][1].body).not.toHaveProperty("retryOfRequestId");
  });

  it("explicit 401 auth retry preserves exact child and parent identity", async () => {
    const { descriptor } = await firstFailedRequest();
    boundary.invoke.mockResolvedValueOnce(failure("Unauthorized", 401));
    await retryCitationFunction(descriptor);
    const first = boundary.invoke.mock.calls[1][1].body;
    expect(first.retryOfRequestId).toBe(descriptor.failedRequestId);
    expect(boundary.invoke.mock.calls[2][1].body).toBe(first);
  });

  it("does not perform a child auth retry after its view becomes stale", async () => {
    const { descriptor } = await firstFailedRequest();
    const refresh = deferred<{ data: { session: ReturnType<typeof session> } }>();
    boundary.invoke.mockResolvedValueOnce(failure("Unauthorized", 401));
    boundary.refreshSession.mockReturnValueOnce(refresh.promise);
    let current = true;
    const result = retryCitationFunction(descriptor, { isCitationResultCurrent: () => current });
    await waitFor(() => expect(boundary.refreshSession).toHaveBeenCalledTimes(1));
    current = false;
    refresh.resolve({ data: { session: session() } });
    await result;
    expect(boundary.invoke).toHaveBeenCalledTimes(2);
  });

  it.each(["AI_REFUSED", "AI_RATE_LIMITED", "AI_UNAVAILABLE"])("unknown state overrides %s retry/refund wording", async (code) => {
    const info = await parseFunctionError(failure(code, 429, {
      requestId: "unknown-request-id", status: "unknown", refunded: true, message: "נסו שוב בעוד רגע",
    }).error);
    expect(info.message).toContain("תוצאת הבקשה עדיין אינה ידועה");
    expect(info.message).toContain("החזר שימוש לא אושר");
    expect(info.message).not.toContain("נסו שוב");
    expect(info.message).toContain("unknown-request-id");
  });

  it.each([
    undefined,
    { status: "retained", refunded: true, units_refunded: 0, request_id: "billing-anchor" },
    { status: "refunded", refunded: true, units_refunded: 0, request_id: "billing-anchor" },
    { status: "deferred", refunded: false, units_refunded: 1, request_id: "billing-anchor" },
    { status: "refunded", refunded: true, units_refunded: 1, request_id: "bad" },
  ])("keeps failed eligibility but never invents a refund from malformed receipt %#", async (refund_receipt) => {
    boundary.invoke.mockImplementation(async (_name, options) => failure("AI_REFUSED", 422, {
      requestId: options.body.requestId, status: "failed", refunded: true, refund_receipt,
    }));
    const info = (await invokeFunction("citation-chat", body())).errorInfo!;
    const retry = info.citationRetry!;
    expect(info.message).not.toContain("השימוש הוחזר");
    expect(retry).toBeDefined();
    expect(retry.refundConfirmed).toBe(false);
    expect(retry.refundReceipt.status).toBe("unconfirmed");
    expect(citationRetryDisclosure(retry)).toContain("טרם אושר");
  });

  it("updates a later authoritative refund receipt without changing its parent/handle", async () => {
    failEveryRequest();
    boundary.invoke.mockImplementationOnce(async (_name, options) => failedResponse(options.body.requestId, receiptFor(options.body.requestId, "deferred")));
    const before = (await invokeFunction("citation-chat", body())).errorInfo!.citationRetry!;
    const after = (await invokeFunction("citation-chat", body())).errorInfo!.citationRetry!;
    expect(before.refundConfirmed).toBe(false);
    expect(after.refundConfirmed).toBe(true);
    expect(after.failedRequestId).toBe(before.failedRequestId);
    expect(after.handle).toBe(before.handle);
    expect(after.refundReceipt.units_refunded).toBe(1);
  });
});

describe("per-account bounded successor storage", () => {
  it("lets B run when A has 256 unresolved inputs and replaces a failed A slot at full capacity", async () => {
    const registry = new CitationRequestIdentity(256, new MemoryCitationJournal());
    type Result = { errorInfo: { code: string; requestId: string; body: Record<string, unknown>; citationRetry?: import("@/lib/functionError").CitationRetryDescriptor } };
    const failed = vi.fn(async (request: Record<string, unknown>): Promise<Result> => ({ errorInfo: {
      code: "AI_REFUSED", requestId: String(request.requestId),
      body: { requestId: request.requestId, status: "failed", refund_receipt: receiptFor(String(request.requestId)) },
    } }));
    const first = await registry.invoke("A", body("A-0"), null, failed);
    for (let i = 1; i < 256; i++) await registry.invoke("A", body(`A-${i}`), null, failed);
    await expect(registry.invoke("A", body("A-257"), null, failed)).rejects.toThrow("REQUEST_RECOVERY_LIMIT");
    await registry.invoke("B", body("independent B"), null, failed);
    const oldId = first.errorInfo.requestId;
    await registry.invoke("A", body("A-0"), null, failed, () => true, first.errorInfo.citationRetry);
    expect(failed.mock.calls.at(-1)![0].requestId).not.toBe(oldId);
    expect(failed.mock.calls.at(-1)![0].retryOfRequestId).toBe(oldId);
    await expect(registry.invoke("A", body("A-258"), null, failed)).rejects.toThrow("REQUEST_RECOVERY_LIMIT");
  });

  it("snapshots before hashing and deep-copies each dispatch so mutations cannot change explicit retry input", async () => {
    const registry = new CitationRequestIdentity(256, new MemoryCitationJournal());
    const original = body("original immutable text");
    const seen: string[] = [];
    const execute = vi.fn(async (request: Record<string, unknown>) => {
      const messages = request.messages as Array<{ content: string }>;
      seen.push(messages[0].content);
      messages[0].content = "executor mutation";
      return { errorInfo: { code: "AI_REFUSED", requestId: String(request.requestId),
        body: { requestId: request.requestId, status: "failed" }, citationRetry: undefined as import("@/lib/functionError").CitationRetryDescriptor | undefined } };
    });
    const pending = registry.invoke("A", original, null, execute);
    original.messages[0].content = "caller mutation during digest";
    const parent = await pending;
    const retained = registry.retryInput(parent.errorInfo.citationRetry!);
    (retained.body.messages as Array<{ content: string }>)[0].content = "retained view mutation";
    await registry.invoke("A", body("original immutable text"), null, execute, () => true, parent.errorInfo.citationRetry);
    expect(seen).toEqual(["original immutable text", "original immutable text"]);
  });
});

describe("ManualEntry explicit retry UI", () => {
  it("shows bound failed ID/refund/usage disclosure and blocks explicit double clicks", async () => {
    failEveryRequest();
    renderBook();
    fireEvent.click(generate());
    const retryButton = await screen.findByRole("button", { name: "ניסיון חדש" });
    const parentId = boundary.invoke.mock.calls[0][1].body.requestId;
    expect(screen.getByRole("status")).toHaveTextContent(parentId);
    expect(screen.getByRole("status")).toHaveTextContent("עשוי לצרוך שימוש נוסף");
    expect(screen.getByRole("status")).toHaveTextContent("החזר השימוש הקודם אושר");
    act(() => { retryButton.click(); retryButton.click(); });
    await waitFor(() => expect(boundary.invoke).toHaveBeenCalledTimes(2));
    await screen.findByRole("button", { name: "ניסיון חדש" });
    expect(boundary.invoke.mock.calls[1][1].body.retryOfRequestId).toBe(parentId);
    expect(screen.getByRole("button", { name: "בדיקת מצב הבקשה" })).toBeEnabled();
  });

  it("field edits remove the failed action and a pending auth gap cannot dispatch it after Back", async () => {
    failEveryRequest();
    renderBook();
    fireEvent.click(generate());
    await screen.findByRole("button", { name: "ניסיון חדש" });
    fireEvent.change(screen.getAllByRole("textbox")[1], { target: { value: "Changed source" } });
    expect(screen.queryByRole("button", { name: "ניסיון חדש" })).not.toBeInTheDocument();
    fireEvent.click(generate());
    const button = await screen.findByRole("button", { name: "ניסיון חדש" });
    const gate = deferred<{ data: { session: ReturnType<typeof session> } }>();
    boundary.getSession.mockReturnValueOnce(gate.promise);
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: /חזור/ }));
    await act(async () => { gate.resolve({ data: { session: session() } }); });
    await waitFor(() => expect(console.error).toHaveBeenCalledWith("[edge-error]", expect.objectContaining({ code: "CITATION_RETRY_STALE" })));
    expect(boundary.invoke).toHaveBeenCalledTimes(2);
    expect(screen.getByText("בחר סוג מקור")).toBeInTheDocument();
  });
});
