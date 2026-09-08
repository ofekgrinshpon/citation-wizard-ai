/**
 * legal-research-v2 — agent context discipline.
 *
 * The research agent must reason from a compact rolling research state, not
 * from a verbatim transcript of everything it has ever done. Full evidence
 * always stays server-side in the evidence store; this module only decides
 * what the MODEL sees on the next turn.
 *
 * Nothing legal is dropped: every source read, its identity state, every
 * failed acquisition path and every recorded finding remain present in the
 * rolling state message. What gets summarized away are stale, repetitive tool
 * payloads that the state message already represents.
 */

import type { ChatMessage } from "../shared/model.ts";
import type { EvidenceStore } from "../evidence/evidenceStore.ts";
import type { AcquisitionLedger } from "../tools/acquisitionLedger.ts";
import type { Intake } from "../types.ts";
import { QUOTE_LIMITS } from "../evidence/quotable.ts";
import type { StopPolicy } from "./stopPolicy.ts";

export const CONTEXT = {
  /** Most recent tool payloads kept verbatim. */
  KEEP_RECENT_TOOL_MESSAGES: 4,
  DIGEST_CHARS: 240,
  ASSISTANT_TEXT_CHARS: 400,
  STATE_MARKER: "‏[מצב מחקר מרוכז]",
};

export interface CompactionResult {
  messages: ChatMessage[];
  compacted: number;
  chars_saved: number;
}

/**
 * Replace stale tool payloads with their one-line digest and trim long
 * assistant monologues. Message structure (assistant tool_calls ↔ tool
 * results) is preserved so the transport stays valid.
 */
export function compactAgentMessages(messages: ChatMessage[]): CompactionResult {
  const toolPositions = messages
    .map((m, i) => (m.role === "tool" ? i : -1))
    .filter((i) => i >= 0);
  const keep = new Set(toolPositions.slice(-CONTEXT.KEEP_RECENT_TOOL_MESSAGES));

  let compacted = 0;
  let chars_saved = 0;
  const out = messages.map((m, i) => {
    if (m.role === "tool" && !keep.has(i) && (m.content?.length ?? 0) > CONTEXT.DIGEST_CHARS) {
      const digest = (m.digest ?? m.content).slice(0, CONTEXT.DIGEST_CHARS);
      compacted += 1;
      chars_saved += m.content.length - digest.length;
      return { ...m, content: digest };
    }
    if (
      m.role === "assistant" && !keep.has(i + 1) &&
      (m.content?.length ?? 0) > CONTEXT.ASSISTANT_TEXT_CHARS
    ) {
      chars_saved += m.content.length - CONTEXT.ASSISTANT_TEXT_CHARS;
      return { ...m, content: `${m.content.slice(0, CONTEXT.ASSISTANT_TEXT_CHARS)} …` };
    }
    return m;
  });
  return { messages: out, compacted, chars_saved };
}

/** Keep at most one rolling-state message in the conversation. */
export function dropPriorStateMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => !(m.role === "user" && m.content?.startsWith(CONTEXT.STATE_MARKER)));
}

/**
 * The single message that carries everything the agent needs for its next
 * decision: what was read, what failed, what is left, and what it was asked
 * to produce.
 */
export function buildResearchStateMessage(input: {
  intake: Intake;
  store: EvidenceStore;
  ledger: AcquisitionLedger;
  policy: StopPolicy;
  directive?: string;
}): string {
  const { intake, store, ledger, policy } = input;
  const sources = store.all().map((s) => {
    const state = s.fetch_status === "ok" && s.is_actual_document
      ? "נקרא"
      : `לא שמיש (${s.not_document_reason ?? s.fetch_error ?? "?"})`;
    const ids = [
      s.identity_fields.dockets.slice(0, 2).join(","),
      s.identity_fields.statutes.slice(0, 2).join(","),
    ].filter(Boolean).join(" | ");
    return `${s.source_id} | ${state} | ${s.title.slice(0, 90)}${ids ? ` | זיהוי: ${ids}` : ""} | ${s.text_length} תווים`;
  });

  const authorities = ledger.all().map((row) => {
    if (row.acquired_source_id) {
      return `${row.authority_key}: גוף קריא כבר קיים (${row.acquired_source_id}) — עבוד ממנו.`;
    }
    const failures = row.attempts.slice(-3).map((a) => `${hostOfUrl(a.url)} → ${a.reason}`).join("; ");
    return `${row.authority_key}: טרם הושג. נתיבים שנכשלו: ${failures || "(אין)"}`;
  });

  const budgets = `תקציב שנותר: צעדי מחקר ${policy.researchStepsLeft}, search ${
    Math.max(0, intake.budgets.max_search_calls - policy.totalSearchCalls)
  }, fetch ${Math.max(0, intake.budgets.max_fetch_calls - policy.fetch_calls)}, lookup ${
    Math.max(0, intake.budgets.max_lookup_calls - policy.lookup_calls)
  }.`;

  const parts = [
    CONTEXT.STATE_MARKER,
    `שאלה: ${intake.normalized_question.slice(0, 400)}`,
    `תוצר מבוקש: ${intake.deliverable === "developed" ? "תוצר מחקרי מפותח" : "תשובה ממוקדת"}`,
    `מקורות שנקראו בריצה זו (הגוף המלא שמור בצד השרת; קריאה ממוקדת: fetch({source_id, query})):\n${
      sources.join("\n") || "(טרם נקראו מסמכים)"
    }`,
  ];
  // Literal excerpts already served this run. Old tool payloads are compacted
  // away, so without this block the agent would have no verbatim text left to
  // quote from and would reconstruct spans from memory — which the verifier
  // rejects. Full bodies still never enter the conversation.
  const quotes = store.servedQuotes().slice(-QUOTE_LIMITS.STATE_QUOTES);
  if (quotes.length) {
    parts.push(
      `קטעים מילוליים שכבר הוגשו לך (העתק מהם מילה במילה ב-quoted_span; אין לנסח מחדש):\n${
        quotes
          .map((q) => `[${q.quote_id}] ${q.source_id}${q.issue ? ` — ${q.issue}` : ""}:\n${q.text.slice(0, QUOTE_LIMITS.STATE_CHARS)}`)
          .join("\n\n")
      }`,
    );
  }
  if (authorities.length) parts.push(`מצב הבאת אסמכתאות:\n${authorities.join("\n")}`);
  // Advisory only: same-source questions that keep coming back empty. The
  // agent decides whether to change source, issue or acquisition path.
  const stale = ledger.allReads().filter((r) => r.no_yield >= 2);
  if (stale.length) {
    parts.push(
      `המלצה (אינה איסור): קריאות חוזרות שלא הניבו ראיה חדשה — ${
        stale.map((r) =>
          `${r.source_id} (${r.no_yield} ברצף${
            r.missing_locators.length ? `, לא נמצאו: ${r.missing_locators.slice(0, 3).join(", ")}` : ""
          })`
        ).join("; ")
      }. שקול ממד מחקר חדש: סוגיה אחרת, ערכאה אחרת, ספרות אקדמית או נתיב השגה אחר.`,
    );
  }

  parts.push(budgets);
  if (input.directive) parts.push(input.directive);
  return parts.join("\n\n");
}

function hostOfUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 40);
  }
}
