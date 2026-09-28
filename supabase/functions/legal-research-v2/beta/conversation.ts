/**
 * legal-research-v2 — conversation layer (chat UI).
 *
 * A research job may belong to a conversation. Previous turns are handed to
 * the agent as FRAMING CONTEXT ONLY — never evidence. Any substantive legal
 * claim in a new answer still has to pass the unchanged verifier.
 *
 * Assistant messages are written only here, with the service-role client, so
 * a user can never forge an assistant reply.
 */

import type { SupabaseClient } from "../shared/primitives.ts";

export const CONVERSATION_CONTEXT_LIMITS = {
  MAX_MESSAGES: 12,
  MESSAGE_CHARS: 1500,
  TOTAL_CHARS: 9000,
};

export interface ContextMessage {
  role: string;
  kind?: string | null;
  content: string;
  footnotes?: unknown;
}

function sourceTitles(footnotes: unknown): string[] {
  if (!Array.isArray(footnotes)) return [];
  const out: string[] = [];
  for (const f of footnotes) {
    const t = f && typeof f === "object" ? (f as { title?: unknown }).title : null;
    if (typeof t === "string" && t.trim()) out.push(t.trim().slice(0, 200));
  }
  return [...new Set(out)].slice(0, 12);
}

/**
 * Deterministic, bounded context block from prior messages (oldest first).
 * Returns null when there is no prior turn. Future extension point for a
 * summary/memory of long conversations.
 */
export function buildConversationContextBlock(messages: ContextMessage[]): string | null {
  const L = CONVERSATION_CONTEXT_LIMITS;
  const recent = messages.filter((m) => m && typeof m.content === "string" && m.content.trim())
    .slice(-L.MAX_MESSAGES);
  if (!recent.length) return null;
  const lines: string[] = [];
  let total = 0;
  // Walk newest→oldest so the latest turns survive the total cap.
  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i];
    const who = m.role === "user" ? "המשתמש" : "ReLex";
    let text = m.content.trim();
    if (text.length > L.MESSAGE_CHARS) text = text.slice(0, L.MESSAGE_CHARS) + "…";
    const titles = m.role === "assistant" ? sourceTitles(m.footnotes) : [];
    const entry = `${who}: ${text}${titles.length ? `\n(מקורות ששימשו בתשובה זו: ${titles.join("; ")})` : ""}`;
    if (total + entry.length > L.TOTAL_CHARS) break;
    lines.unshift(entry);
    total += entry.length;
  }
  if (!lines.length) return null;
  return [
    "הקשר השיחה עד כה (לצורך הבנת הבקשה בלבד — אינו ראיה ואינו מקור לציטוט; כל טענה משפטית מהותית בתשובה החדשה חייבת להתבסס על מקורות שתקרא ותאמת עכשיו):",
    ...lines,
  ].join("\n\n");
}

/** Load prior messages of a conversation the caller owns (user-scoped client). */
export async function loadOwnedConversationContext(
  // deno-lint-ignore no-explicit-any
  userClient: any,
  conversationId: unknown,
): Promise<{ conversationId: string | null; context: string | null; turnIndex: number }> {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof conversationId !== "string" || !UUID.test(conversationId)) {
    return { conversationId: null, context: null, turnIndex: 0 };
  }
  try {
    const { data: conv } = await userClient.from("research_conversations")
      .select("id").eq("id", conversationId).maybeSingle();
    if (!conv?.id) return { conversationId: null, context: null, turnIndex: 0 };
    const { data: msgs } = await userClient.from("research_messages")
      .select("role, kind, content, footnotes, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(200);
    const all = (msgs ?? []) as ContextMessage[];
    // The newest user message is the question itself; exclude it from context.
    const prior = all.length && all[all.length - 1].role === "user" ? all.slice(0, -1) : all;
    const turnIndex = all.filter((m) => m.role === "user").length;
    return { conversationId, context: buildConversationContextBlock(prior), turnIndex };
  } catch {
    return { conversationId: null, context: null, turnIndex: 0 };
  }
}

export interface AssistantMessageInput {
  kind: "text" | "clarification" | "research_answer";
  content: string;
  footnotes?: unknown;
  used_sources?: unknown;
  metadata?: Record<string, unknown>;
}

/** Best-effort: never fails the run. No-op for jobs without a conversation. */
export async function postAssistantMessage(
  admin: SupabaseClient,
  jobId: string,
  input: AssistantMessageInput,
): Promise<string | null> {
  try {
    // deno-lint-ignore no-explicit-any
    const a = admin as any;
    const { data: job } = await a.from("legal_research_jobs")
      .select("conversation_id, trigger_message_id").eq("id", jobId).maybeSingle();
    const conversationId = job?.conversation_id as string | null;
    if (!conversationId || !input.content?.trim()) return null;
    const { data: msg, error } = await a.from("research_messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      kind: input.kind,
      content: input.content,
      job_id: jobId,
      footnotes: input.footnotes ?? null,
      used_sources: input.used_sources ?? null,
      metadata: { ...(input.metadata ?? {}), trigger_message_id: job?.trigger_message_id ?? null },
    }).select("id").maybeSingle();
    if (error || !msg?.id) return null;
    const now = new Date().toISOString();
    await a.from("research_conversations").update({ last_message_at: now }).eq("id", conversationId);
    if (input.kind !== "clarification") {
      await a.from("legal_research_jobs").update({ response_message_id: msg.id }).eq("id", jobId);
    }
    return msg.id as string;
  } catch {
    return null;
  }
}

export function clarificationMessageText(c: { question: string; context?: string }): string {
  return c.context ? `${c.context}\n\n${c.question}` : c.question;
}
