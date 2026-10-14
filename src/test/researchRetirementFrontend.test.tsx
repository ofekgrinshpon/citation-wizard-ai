import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RESEARCH_FUNCTIONS, RESEARCH_PIPELINE, researchFunctionFor, V1_STAGES, V2_STAGES } from "@/config/researchPipeline";
import { invokeFunction, parseFunctionError } from "@/lib/functionError";
import { LegalResearchV1Panel } from "@/components/LegalResearchV1Panel";
import { startResearchForMessage, resumeClarification, type MessageRow } from "@/lib/researchConversation";
import { buildProjectContext, startChapterJob } from "@/lib/academic/chapterJob";

const boundary = vi.hoisted(() => ({
  invoke: vi.fn(), getSession: vi.fn(), refreshSession: vi.fn(), getUser: vi.fn(),
  from: vi.fn(), select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), insert: vi.fn(),
  storageFrom: vi.fn(), upload: vi.fn(), refreshCredits: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  functions: { invoke: boundary.invoke },
  auth: { getSession: boundary.getSession, refreshSession: boundary.refreshSession, getUser: boundary.getUser },
  from: boundary.from,
  storage: { from: boundary.storageFrom },
} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: false }) }));
// Skip the unrelated automatic project lookup; explicit history jobs still read.
vi.mock("@/hooks/useProjects", () => ({ useProjects: () => ({ currentProject: null, loading: true }) }));
vi.mock("@/hooks/useCredits", () => ({ useCredits: () => ({ hasEnough: () => true, totalCreditsAvailable: 50, refresh: boundary.refreshCredits }) }));
vi.mock("@/components/InsufficientCreditsDialog", () => ({ InsufficientCreditsDialog: () => null }));
vi.mock("@/components/guide/ResearchEmptyState", () => ({ ResearchEmptyState: () => null }));
vi.mock("@/components/guide/SourcesEmptyState", () => ({ SourcesEmptyState: () => null }));
vi.mock("@/components/legal-research/UniformCitationPanel", () => ({ UniformCitationPanel: () => null }));

const RETIRED = "RESEARCH_VERSION_RETIRED";
const RETIRED_MESSAGE = "גרסת המחקר הישנה הוצאה משימוש. יש לרענן את העמוד כדי להשתמש בגרסה העדכנית. הבקשה הזו לא התחילה מחקר ולא צרכה יחידות שימוש.";
const success = { data: { job_id: "fixture-v2-job", run_id: "fixture-v2-run", status: "queued" }, error: null };
const retiredError = (body: Record<string, unknown> = { error: RETIRED }) => ({
  data: null,
  error: { context: new Response(JSON.stringify(body), { status: 410 }) },
});

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden in retirement tests"); }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  const session = { user: { id: "fixture-user" }, access_token: "fixture-token", expires_at: Date.now() / 1000 + 3600 };
  boundary.getSession.mockResolvedValue({ data: { session } });
  boundary.refreshSession.mockResolvedValue({ data: { session } });
  boundary.getUser.mockResolvedValue({ data: { user: null } });
  boundary.invoke.mockResolvedValue(success);
  const query = { select: boundary.select, eq: boundary.eq, maybeSingle: boundary.maybeSingle, insert: boundary.insert };
  boundary.from.mockReturnValue(query);
  boundary.select.mockReturnValue(query);
  boundary.eq.mockReturnValue(query);
  boundary.maybeSingle.mockResolvedValue({ data: null, error: null });
  boundary.storageFrom.mockReturnValue({ upload: boundary.upload });
  boundary.upload.mockResolvedValue({ error: null });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("retired research execution is not a routing option", () => {
  it("exposes only V2 while preserving the routing helper's caller signature", () => {
    expect(RESEARCH_PIPELINE).toBe("v2");
    expect(RESEARCH_FUNCTIONS).toEqual({ v2: "legal-research-v2" });
    expect(researchFunctionFor()).toBe("legal-research-v2");
    expect(researchFunctionFor({ hasAttachments: false })).toBe("legal-research-v2");
    expect(researchFunctionFor({ hasAttachments: true })).toBe("legal-research-v2");
    expect(readFileSync("src/config/researchPipeline.ts", "utf8")).not.toMatch(/Rollback|legal-research-v1|RESEARCH_FUNCTIONS\.v1/);
  });

  it("retains historical and current progress stage presentations", () => {
    expect(V1_STAGES.map((stage) => stage.key)).toEqual(["analyzer", "planner", "retrieval", "verifier", "drafter", "finalize"]);
    expect(V2_STAGES.map((stage) => stage.key)).toEqual(["searching", "reading", "verifying", "writing"]);
  });
});

describe("retirement error handling is terminal for this submission", () => {
  it.each(["message", "messageHe"])("preserves the server's Hebrew %s and retirement code", async (field) => {
    const messageHe = "גרסת המחקר הישנה הוצאה משימוש. רעננו את היישום. הבקשה הזו לא הופעלה ולא חויבה.";
    const info = await parseFunctionError(retiredError({ error: RETIRED, [field]: messageHe }).error);
    expect(info).toMatchObject({ status: 410, code: RETIRED, message: messageHe,
      isAuthExpired: false, isInsufficientCredits: false, isInvalidInput: false, isOperationInProgress: false });
  });

  it("provides a refresh/no-execution/no-charge explanation when the message is absent", async () => {
    const info = await parseFunctionError(retiredError().error);
    expect(info.message).toBe(RETIRED_MESSAGE);
    expect(info.message).not.toContain("נסו שוב");
  });

  it.each(["http", "in-body"])("does not retry, redirect, or dispatch V2 after a %s retirement response", async (transport) => {
    boundary.invoke.mockResolvedValue(transport === "http" ? retiredError() : { data: { error: RETIRED }, error: null });
    const request = { question: "שאלה משפטית קיימת", client_request_id: "retained-old-request", attachments: [] };
    const before = structuredClone(request);
    const location = window.location.href;
    const result = await invokeFunction("legal-research-v1", request);
    expect(result).toMatchObject({ data: null, errorInfo: { code: RETIRED, message: RETIRED_MESSAGE } });
    expect(result.errorInfo?.citationRetry).toBeUndefined();
    expect(boundary.invoke).toHaveBeenCalledTimes(1);
    expect(boundary.invoke).toHaveBeenCalledWith("legal-research-v1", { body: request });
    expect(boundary.invoke.mock.calls[0][1].body).toBe(request);
    expect(request).toEqual(before);
    expect(boundary.refreshSession).not.toHaveBeenCalled();
    expect(boundary.from).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(window.location.href).toBe(location);
  });

  it("retains existing preflight auth refresh and failure telemetry without retrying execution", async () => {
    boundary.getSession.mockResolvedValueOnce({ data: { session: { user: { id: "fixture-user" },
      access_token: "fixture-expired-token", expires_at: Date.now() / 1000 - 60 } } });
    boundary.getUser.mockResolvedValue({ data: { user: { id: "fixture-user" } } });
    boundary.invoke.mockResolvedValue(retiredError());
    const result = await invokeFunction("legal-research-v1", { question: "שאלה משפטית ישנה" });
    expect(result.errorInfo?.code).toBe(RETIRED);
    expect(boundary.refreshSession).toHaveBeenCalledTimes(1);
    expect(boundary.invoke).toHaveBeenCalledTimes(1);
    expect(boundary.invoke.mock.calls[0][0]).toBe("legal-research-v1");
    expect(boundary.from).toHaveBeenCalledTimes(1);
    expect(boundary.from).toHaveBeenCalledWith("activity_logs");
    expect(boundary.insert).toHaveBeenCalledWith(expect.objectContaining({ action: "request_failed",
      details: expect.objectContaining({ fn: "legal-research-v1", status: 410, code: RETIRED }) }));
  });

  it("renders the retirement explanation in the existing panel and never starts a job", async () => {
    boundary.invoke.mockResolvedValue(retiredError());
    render(<LegalResearchV1Panel />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "שאלה משפטית קיימת" } });
    fireEvent.click(screen.getByRole("button", { name: "שלח" }));
    await screen.findByText(RETIRED_MESSAGE);
    expect(boundary.invoke).toHaveBeenCalledTimes(1);
    expect(boundary.maybeSingle).not.toHaveBeenCalled();
    expect(boundary.refreshSession).not.toHaveBeenCalled();
    expect(localStorage.getItem("lrv1:active_job")).toBeNull();
    expect(new URL(window.location.href).searchParams.has("job")).toBe(false);
  });
});

describe("current V2 routes remain available", () => {
  it.each(["answer", "sources"] as const)("submits the existing %s panel to V2", async (mode) => {
    render(<LegalResearchV1Panel mode={mode} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "שאלה משפטית חדשה" } });
    fireEvent.click(screen.getByRole("button", { name: "שלח" }));
    await waitFor(() => expect(boundary.invoke).toHaveBeenCalledTimes(1));
    expect(boundary.invoke).toHaveBeenCalledWith("legal-research-v2", { body: expect.objectContaining({
      question: "שאלה משפטית חדשה", project_id: null, attachments: [], use_as_source: true,
      client_request_id: expect.any(String), ...(mode === "sources" ? { mode: "source_search" } : {}),
    }) });
    if (mode === "answer") expect(boundary.invoke.mock.calls[0][1].body).not.toHaveProperty("mode");
    await waitFor(() => expect(new URL(window.location.href).searchParams.get("job")).toBe("fixture-v2-job"));
  });

  it("keeps uploaded documents on V2 with the same attachment envelope", async () => {
    boundary.getUser.mockResolvedValue({ data: { user: { id: "fixture-user" } } });
    const { container } = render(<LegalResearchV1Panel />);
    const file = new File(["synthetic fixture"], "fixture.pdf", { type: "application/pdf" });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "נתחו את המסמך המצורף" } });
    fireEvent.click(screen.getByRole("button", { name: "שלח" }));
    await waitFor(() => expect(boundary.invoke).toHaveBeenCalledTimes(1));
    expect(boundary.storageFrom).toHaveBeenCalledWith("user-documents");
    expect(boundary.upload).toHaveBeenCalledTimes(1);
    expect(boundary.invoke).toHaveBeenCalledWith("legal-research-v2", { body: expect.objectContaining({
      attachments: [{ storage_path: expect.stringMatching(/^fixture-user\/research\/.+\/0-fixture\.pdf$/),
        file_name: "fixture.pdf", mime_type: "application/pdf", size: file.size }],
      use_as_source: true,
    }) });
  });

  it("starts conversation research and resumes clarification through V2", async () => {
    const message: MessageRow = { id: "message", conversation_id: "conversation", role: "user", kind: "text",
      content: "שאלת המשך משפטית", job_id: null, footnotes: null, used_sources: null,
      attachments: null, metadata: null, created_at: "2026-10-13T12:00:00Z" };
    const attachments = [{ storage_path: "fixture/document.pdf", file_name: "document.pdf", mime_type: "application/pdf", size: 1 }];
    expect(await startResearchForMessage({ conversationId: "conversation", message, projectId: "project", attachments }))
      .toEqual({ jobId: "fixture-v2-job", errorInfo: null });
    expect(boundary.invoke).toHaveBeenNthCalledWith(1, "legal-research-v2", { body: expect.objectContaining({
      question: message.content, conversation_id: "conversation", trigger_message_id: "message", project_id: "project",
      attachments, use_as_source: true, client_request_id: expect.any(String),
    }) });
    boundary.invoke.mockResolvedValueOnce({ data: { ok: true }, error: null });
    await resumeClarification("fixture-v2-job", "הבהרה חדשה");
    expect(boundary.invoke).toHaveBeenNthCalledWith(2, "legal-research-v2", {
      body: { action: "answer_clarification", job_id: "fixture-v2-job", user_message: "הבהרה חדשה" },
    });
  });

  it("keeps the academic chapter endpoint, mode, and request identity unchanged", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ job_id: "chapter-job" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const projectContext = buildProjectContext({ researchQuestion: "שאלת מחקר", outlineTitles: ["פרק"],
      chapterIndex: 0, chapterTitle: "פרק", completedChapters: [], sourceRegistry: [] });
    expect(await startChapterJob({ question: "כתיבת פרק", projectId: "project", projectContext,
      footnoteOffset: 3, clientRequestId: "chapter-request" })).toEqual({ jobId: "chapter-job" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/functions\/v1\/legal-research-v2$/);
    expect(JSON.parse(options.body)).toEqual({ mode: "academic_chapter", question: "כתיבת פרק", project_id: "project",
      project_context: projectContext, footnote_offset: 3, client_request_id: "chapter-request" });
  });

  it("retains the standalone source-search V2 route", () => {
    const source = readFileSync("src/components/LegalSourceSearchPanel.tsx", "utf8");
    expect(source).toMatch(/>\(RESEARCH_FUNCTIONS\.v2,\s*\{/);
    expect(source).not.toMatch(/RESEARCH_FUNCTIONS\.v1|["']legal-research-v1["']/);
  });
});

describe("retirement preserves history reads and presentation", () => {
  it("replays a cached V1 answer and footnotes without executing any research", async () => {
    const consumed = vi.fn();
    render(<LegalResearchV1Panel onConsumeExternalResult={consumed} externalResult={{
      question: "שאלה היסטורית", payload: { answer: "תשובה היסטורית שנשמרה", footnotes: [{ number: 1, title: "מקור היסטורי" }] },
    }} />);
    await screen.findByText("תשובה היסטורית שנשמרה");
    expect(screen.getByText("מקור היסטורי")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("שאלה היסטורית");
    expect(consumed).toHaveBeenCalledTimes(1);
    expect(boundary.invoke).not.toHaveBeenCalled();
    expect(boundary.from).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads a completed historical job without invoking either execution endpoint", async () => {
    boundary.maybeSingle.mockResolvedValue({ data: { id: "old-job", question: "מחקר קודם", status: "done",
      completed_stages: V1_STAGES.map((stage) => stage.key), result: { answer: "תוצאת העבודה הישנה", footnotes: [] } }, error: null });
    render(<LegalResearchV1Panel openJob={{ id: "old-job", at: 1 }} />);
    await screen.findByText("תוצאת העבודה הישנה");
    expect(boundary.from).toHaveBeenCalledWith("legal_research_jobs");
    expect(boundary.eq).toHaveBeenCalledWith("id", "old-job");
    expect(boundary.invoke).not.toHaveBeenCalled();
    expect(boundary.insert).not.toHaveBeenCalled();
  });

  it("keeps persisted V1 stages visible when reading an unfinished historical job", async () => {
    boundary.maybeSingle.mockResolvedValue({ data: { id: "old-job", question: "מחקר קודם", status: "running",
      current_stage: "retrieval", completed_stages: ["analyzer", "planner"], result: null,
      started_at: new Date().toISOString() }, error: null });
    render(<LegalResearchV1Panel openJob={{ id: "old-job", at: 1 }} />);
    await screen.findByText("מנתח את השאלה");
    for (const stage of V1_STAGES) expect(screen.getByText(stage.label)).toBeInTheDocument();
    expect(boundary.invoke).not.toHaveBeenCalled();
    expect(boundary.insert).not.toHaveBeenCalled();
  });

  it("retains old history and usage labels without adding execution choices", () => {
    const sidebar = readFileSync("src/components/QAHistorySidebar.tsx", "utf8");
    expect(sidebar).toContain('log.task_mode === "legal_research_v1"');
    expect(sidebar).toContain("__legal_research_v1: true");
    expect(readFileSync("src/hooks/useUsageStats.tsx", "utf8")).toContain('r.startsWith("legal-research-v1")');
    expect(readFileSync("src/hooks/useUserUsage.tsx", "utf8")).toContain('reason.startsWith("legal-research-v1")');
  });
});
