import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildConversationContextBlock,
  CONVERSATION_CONTEXT_LIMITS,
} from "../../supabase/functions/legal-research-v2/beta/conversation.ts";
import { buildAgentUserMessage, DELIVERABLE_INFERENCE_GUIDE } from "../../supabase/functions/legal-research-v2/agent/prompt.ts";
import { buildIntake } from "../../supabase/functions/legal-research-v2/index.ts";
import { deriveConversationTitle } from "@/lib/researchConversation";
import { replyLanded } from "@/components/research-chat/ResearchConversationPanel";

const src = (p: string) => readFileSync(p, "utf8");

describe("conversation architecture", () => {
  it("T1/T9 new chat creates a conversation and never deletes the old one", () => {
    const lib = src("src/lib/researchConversation.ts");
    expect(lib).toMatch(/from\("research_conversations"\)\s*\.insert/);
    const sidebar = src("src/components/research-chat/ResearchConversationSidebar.tsx");
    expect(sidebar).not.toMatch(/\.delete\(/);
  });

  it("T2 user message is stored before the agent starts", () => {
    const panel = src("src/components/research-chat/ResearchConversationPanel.tsx");
    const send = panel.indexOf("await sendUserMessage(");
    expect(send).toBeGreaterThan(0);
    expect(panel.indexOf("startResearchForMessage({")).toBeGreaterThan(send);
    expect(panel.indexOf("resumeClarification(job.id")).toBeGreaterThan(send);
  });

  it("T3/T4/T14 backend writes final answer (with footnotes) and clarification as assistant messages", () => {
    const idx = src("supabase/functions/legal-research-v2/index.ts");
    expect(idx).toMatch(/kind: "clarification"/);
    expect(idx).toMatch(/kind: "research_answer"[\s\S]{0,200}footnotes: br\.footnotes/);
  });

  it("T5/T6 clarification reply resumes the same job; awaiting reply is the last message", () => {
    const job = { id: "j1", status: "awaiting_user", progress_label_he: null, error: null, response_message_id: null, created_at: "" };
    const msgs = [
      { id: "u", role: "user", kind: "text", content: "סמינריון על חוזים", job_id: null },
      { id: "a", role: "assistant", kind: "clarification", content: "במה להתמקד?", job_id: "j1" },
    ] as never;
    expect(replyLanded(msgs, job)).toBe(true);
    expect(replyLanded(msgs, { ...job, status: "done" })).toBe(false);
  });

  it("T7 active job is restored on load and polled", () => {
    const panel = src("src/components/research-chat/ResearchConversationPanel.tsx");
    expect(panel).toMatch(/ACTIVE_JOB_STATUSES\.includes\(latestJob\.status\)\) poll\(/);
  });

  it("T8/T10 sidebar lists conversations (not jobs), filtered by project", () => {
    const lib = src("src/lib/researchConversation.ts");
    const fn = lib.slice(lib.indexOf("export async function listConversations"), lib.indexOf("export async function loadConversation"));
    expect(fn).toMatch(/research_conversations/);
    expect(fn).not.toMatch(/legal_research_jobs/);
    expect(fn).toMatch(/eq\("project_id", projectId\)/);
  });

  it("T11/T12 agent infers the deliverable; no manual mode", () => {
    const intake = buildIntake({ run_id: "r", question: "תמצא לי מקורות על הרמת מסך" });
    const msg = buildAgentUserMessage(intake);
    expect(msg).toContain(DELIVERABLE_INFERENCE_GUIDE);
    expect(DELIVERABLE_INFERENCE_GUIDE).toMatch(/סכם לי את פסק הדין/);
    expect(intake.output_mode).toBe("answer");
    const chat = src("src/components/LegalQAChat.tsx");
    expect(chat).toMatch(/taskMode !== "research" && \(/);
  });

  it("T13 prior conversation is framing only, never evidence; normal verification path unchanged", () => {
    const block = buildConversationContextBlock([
      { role: "user", content: "שאלה" },
      { role: "assistant", content: "תשובה", footnotes: [{ title: "ע\"א 1/20" }] },
    ])!;
    expect(block).toMatch(/אינו ראיה/);
    expect(block).toContain("ע\"א 1/20");
    const intake = buildIntake({ run_id: "r", question: "תעמיק", conversation_context: block });
    expect(intake.conversation_context).toBe(block);
    expect(intake.agent_authored_answer).toBe(true);
  });

  it("context is bounded", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "x".repeat(3000) }));
    const b = buildConversationContextBlock(many)!;
    expect(b.length).toBeLessThan(CONVERSATION_CONTEXT_LIMITS.TOTAL_CHARS + 1000);
    expect(buildConversationContextBlock([])).toBeNull();
  });

  it("T15 legacy job without conversation still opens (?job= fallback)", () => {
    const r = src("src/pages/ResearchJobRedirect.tsx");
    expect(r).toMatch(/\/app\?job=/);
    expect(src("src/components/LegalQAChat.tsx")).toMatch(/has\("job"\)/);
  });

  it("T16 QAHistorySidebar is no longer the primary legalqa history", () => {
    const idx = src("src/pages/Index.tsx");
    const i = idx.indexOf('mode === "legalqa" ? (\n              <ResearchConversationSidebar');
    expect(i).toBeGreaterThan(0);
    expect(idx).toMatch(/legacyHistory=\{\s*<QAHistorySidebar/);
  });

  it("titles are deterministic", () => {
    expect(deriveConversationTitle("אתה יכול לכתוב לי סמינריון על חוזים?")).toBe("לכתוב לי סמינריון על חוזים");
    expect(deriveConversationTitle("x".repeat(100)).length).toBeLessThanOrEqual(61);
  });
});
