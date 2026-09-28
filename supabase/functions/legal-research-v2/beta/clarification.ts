/**
 * legal-research-v2 — ask_user clarification pause/resume (pure helpers).
 *
 * ask_user never ends a run and never opens a new charge. The run is parked
 * in `awaiting_user` with the exact checkpoint a chunk handover already uses
 * (messages, EvidenceStore, ledger, budgets, quotes, trace, timing, intake,
 * job). The user's reply is appended to the SAME conversation and the SAME
 * run continues from that checkpoint.
 */

import type { ChatMessage } from "../shared/model.ts";

export const AWAITING_USER_STATUS = "awaiting_user";

export const ASK_USER_LIMITS = {
  QUESTION_CHARS: 600,
  CONTEXT_CHARS: 800,
  OPTIONS: 6,
  OPTION_CHARS: 120,
  REPLY_CHARS: 4000,
};

export interface AskUserRequest {
  question: string;
  context?: string;
  options?: string[];
}

/** Validate a model-issued ask_user call. Null = unusable (agent is told so). */
export function parseAskUserArgs(args: Record<string, unknown>): AskUserRequest | null {
  const question = typeof args.question === "string"
    ? args.question.trim().slice(0, ASK_USER_LIMITS.QUESTION_CHARS)
    : "";
  if (question.length < 3) return null;
  const context = typeof args.context === "string"
    ? args.context.trim().slice(0, ASK_USER_LIMITS.CONTEXT_CHARS)
    : "";
  const options = Array.isArray(args.options)
    ? [...new Set(
      args.options
        .filter((o): o is string => typeof o === "string" && o.trim().length > 0)
        .map((o) => o.trim().slice(0, ASK_USER_LIMITS.OPTION_CHARS)),
    )].slice(0, ASK_USER_LIMITS.OPTIONS)
    : [];
  return {
    question,
    ...(context ? { context } : {}),
    ...(options.length ? { options } : {}),
  };
}

/** The user's reply, as it enters the same agent conversation. */
export function clarificationReplyMessage(reply: string): ChatMessage {
  return {
    role: "user",
    content: `תשובת המשתמש לשאלת ההבהרה שלך:\n${reply}\n\nהמשך את אותו מחקר מהנקודה שבה עצרת, בהתאם לתשובה.`,
  };
}

export function normalizeReply(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim().slice(0, ASK_USER_LIMITS.REPLY_CHARS) : "";
  return s.length ? s : null;
}

// deno-lint-ignore no-explicit-any
type SavedState = { resume: any; intake: any; job?: any; stage?: any; awaiting_user?: AskUserRequest | null };

export type ReplyDecision =
  | { ok: true; agent_state: SavedState }
  | { ok: false; status: number; error: string };

/**
 * Decide whether a reply may resume a parked run and build the checkpoint the
 * worker will continue from. Everything already in the checkpoint is carried
 * over untouched; only the reply message is appended and the wait is stamped.
 */
export function applyUserReply(input: {
  row: { status?: string | null; agent_state?: unknown } | null;
  reply: string | null;
  /** Authenticated caller; null = internal/smoke (ownership not enforced). */
  userId: string | null;
  now: number;
}): ReplyDecision {
  const { row, reply, userId, now } = input;
  if (!reply) return { ok: false, status: 400, error: "user_message_required" };
  const saved = (row?.agent_state ?? null) as SavedState | null;
  if (!row || !saved?.resume?.agent_state) return { ok: false, status: 404, error: "run_not_found" };
  if (userId !== null && saved.job?.user_id !== userId) {
    return { ok: false, status: 404, error: "run_not_found" };
  }
  if (row.status !== AWAITING_USER_STATUS) {
    return { ok: false, status: 409, error: `not_awaiting_user:${row.status ?? "unknown"}` };
  }
  const messages: ChatMessage[] = [
    ...(saved.resume.agent_state.messages ?? []),
    clarificationReplyMessage(reply),
  ];
  return {
    ok: true,
    agent_state: {
      ...saved,
      awaiting_user: null,
      resume: {
        ...saved.resume,
        agent_state: { ...saved.resume.agent_state, messages },
        // The wait is user time, measured separately from orchestration gaps.
        awaiting_since: saved.resume.awaiting_since ?? now,
        paused_at: undefined,
      },
    },
  };
}
