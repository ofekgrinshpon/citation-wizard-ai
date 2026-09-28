/**
 * Conversation data layer for the chat-style legal assistant.
 *
 * A conversation owns messages; research jobs are an internal execution detail
 * linked to it. User messages are written here BEFORE the agent is started, so
 * a refresh mid-run never loses the thread. Assistant messages are written by
 * the backend only.
 */
import { supabase } from "@/integrations/supabase/client";
import { invokeFunction, type EdgeErrorInfo } from "@/lib/functionError";
import { RESEARCH_FUNCTIONS } from "@/config/researchPipeline";

export type ConversationRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string | null;
  created_at: string;
  last_message_at: string;
  archived_at: string | null;
};

export type ChatFootnote = {
  number: number;
  title: string;
  url?: string | null;
  sources?: { title: string; url?: string | null; source_type?: string }[];
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  kind: "text" | "clarification" | "research_answer";
  content: string;
  job_id: string | null;
  footnotes: ChatFootnote[] | null;
  used_sources: unknown;
  attachments: { file_name: string }[] | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type JobState = {
  id: string;
  status: string;
  progress_label_he: string | null;
  error: string | null;
  response_message_id: string | null;
  created_at: string;
};

export type Attachment = { storage_path: string; file_name: string; mime_type: string; size: number };

export const CONVERSATIONS_CHANGED = "relex:conversations-changed";
export const ACTIVE_JOB_STATUSES = ["queued", "running", "pending"];
export const AWAITING_USER = "awaiting_user";

export function notifyConversationsChanged() {
  try { window.dispatchEvent(new Event(CONVERSATIONS_CHANGED)); } catch { /* ignore */ }
}

/** Lightweight client telemetry (console + activity log best-effort). */
export function trackConversationEvent(event: string, details: Record<string, unknown> = {}) {
  try { console.info("[conversation]", event, details); } catch { /* ignore */ }
  void (async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from("activity_logs").insert({
        user_id: user.id,
        action: `conversation:${event}`,
        details: details as never,
        project_id: (details.project_id as string | null) ?? null,
      });
    } catch { /* telemetry never breaks the UI */ }
  })();
}

const LEADING_FILLERS = [
  /^(היי|שלום|הי)[,!\s]+/,
  /^(אתה|את)\s+(יכול|יכולה)\s+(ל)?/,
  /^(תוכל|תוכלי)\s+(ל)?/,
  /^(אפשר|אני\s+צריך|אני\s+צריכה|אני\s+רוצה)\s+(ש)?/,
  /^בבקשה[,\s]+/,
];

/** Deterministic title from the first user message (no AI call). */
export function deriveConversationTitle(text: string): string {
  let t = (text || "").replace(/\s+/g, " ").trim();
  for (const re of LEADING_FILLERS) t = t.replace(re, "");
  t = t.replace(/[?؟!.]+$/, "").trim();
  if (!t) t = (text || "").trim();
  if (t.length > 60) {
    const cut = t.slice(0, 60);
    const sp = cut.lastIndexOf(" ");
    t = (sp > 30 ? cut.slice(0, sp) : cut) + "…";
  }
  return t || "שיחה חדשה";
}

export async function createConversation(projectId: string | null): Promise<ConversationRow> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("יש להתחבר");
  const { data, error } = await supabase
    .from("research_conversations")
    .insert({ user_id: user.id, project_id: projectId })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message || "לא הצלחנו ליצור שיחה");
  trackConversationEvent("conversation_created", { conversation_id: data.id, project_id: projectId });
  notifyConversationsChanged();
  return data as ConversationRow;
}

export async function listConversations(projectId: string | null): Promise<ConversationRow[]> {
  let q = supabase
    .from("research_conversations")
    .select("*")
    .is("archived_at", null)
    .order("last_message_at", { ascending: false })
    .limit(200);
  q = projectId ? q.eq("project_id", projectId) : q.is("project_id", null);
  const { data } = await q;
  // An untitled conversation has no messages yet — keep it out of history.
  return ((data ?? []) as ConversationRow[]).filter((c) => !!c.title);
}

export async function loadConversation(id: string): Promise<{
  conversation: ConversationRow | null;
  messages: MessageRow[];
  latestJob: JobState | null;
}> {
  const [{ data: conv }, { data: msgs }, { data: jobs }] = await Promise.all([
    supabase.from("research_conversations").select("*").eq("id", id).maybeSingle(),
    supabase.from("research_messages").select("*").eq("conversation_id", id).order("created_at", { ascending: true }),
    supabase
      .from("legal_research_jobs")
      .select("id, status, progress_label_he, error, response_message_id, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  return {
    conversation: (conv as ConversationRow | null) ?? null,
    messages: (msgs ?? []) as unknown as MessageRow[],
    latestJob: ((jobs ?? [])[0] as JobState | undefined) ?? null,
  };
}

export async function fetchJobState(jobId: string): Promise<JobState | null> {
  const { data } = await supabase
    .from("legal_research_jobs")
    .select("id, status, progress_label_he, error, response_message_id, created_at")
    .eq("id", jobId)
    .maybeSingle();
  return (data as JobState | null) ?? null;
}

export async function sendUserMessage(
  conversation: ConversationRow,
  content: string,
  attachments: Attachment[] = [],
): Promise<MessageRow> {
  const { data, error } = await supabase
    .from("research_messages")
    .insert({
      conversation_id: conversation.id,
      role: "user",
      kind: "text",
      content,
      attachments: attachments.length ? (attachments.map((a) => ({ file_name: a.file_name })) as never) : null,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message || "לא הצלחנו לשמור את ההודעה");
  const patch: Record<string, unknown> = { last_message_at: new Date().toISOString() };
  if (!conversation.title) patch.title = deriveConversationTitle(content);
  await supabase.from("research_conversations").update(patch).eq("id", conversation.id);
  notifyConversationsChanged();
  return data as unknown as MessageRow;
}

export async function startResearchForMessage(args: {
  conversationId: string;
  message: MessageRow;
  projectId: string | null;
  attachments: Attachment[];
}): Promise<{ jobId: string | null; errorInfo: EdgeErrorInfo | null }> {
  const { data, errorInfo } = await invokeFunction<{ job_id: string }>(
    RESEARCH_FUNCTIONS.v2,
    {
      question: args.message.content,
      conversation_id: args.conversationId,
      trigger_message_id: args.message.id,
      project_id: args.projectId,
      attachments: args.attachments,
      use_as_source: true,
      client_request_id: crypto.randomUUID(),
    },
    { projectId: args.projectId },
  );
  return { jobId: data?.job_id ?? null, errorInfo: errorInfo ?? null };
}

export async function resumeClarification(jobId: string, reply: string) {
  return invokeFunction<{ ok: boolean }>(RESEARCH_FUNCTIONS.v2, {
    action: "answer_clarification",
    job_id: jobId,
    user_message: reply,
  });
}

export async function renameConversation(id: string, title: string) {
  await supabase.from("research_conversations").update({ title: title.trim().slice(0, 120) }).eq("id", id);
  notifyConversationsChanged();
}

export async function archiveConversation(id: string) {
  await supabase.from("research_conversations").update({ archived_at: new Date().toISOString() }).eq("id", id);
  notifyConversationsChanged();
}

const UPLOAD_ACCEPT_EXT = /\.(pdf|docx)$/i;
function sanitizeFileName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
}

export async function uploadChatFiles(files: File[]): Promise<Attachment[]> {
  if (!files.length) return [];
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("יש להתחבר כדי לצרף קבצים");
  const token = crypto.randomUUID();
  const out: Attachment[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const path = `${user.id}/research/${token}/${i}-${sanitizeFileName(f.name)}`;
    const { error } = await supabase.storage
      .from("user-documents")
      .upload(path, f, { contentType: f.type || "application/octet-stream", upsert: false });
    if (error) throw new Error(`שגיאה בהעלאת ${f.name}: ${error.message}`);
    out.push({
      storage_path: path,
      file_name: f.name,
      mime_type: f.type || (UPLOAD_ACCEPT_EXT.test(f.name) ? "application/pdf" : "application/octet-stream"),
      size: f.size,
    });
  }
  return out;
}
