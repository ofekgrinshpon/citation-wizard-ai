/**
 * legal-research-v2 — the drafter.
 *
 * The drafter sees ONLY the original question and the verified evidence pack.
 * It never sees discovery results, rejected evidence, the agent's reasoning or
 * any role/mode machinery. It never writes citation markup: it attaches
 * source_ids to blocks and the renderer does the rest.
 */

import type { DraftBlock, VerifiedEvidencePack } from "../types.ts";
import { chat, parseJsonLoose, type UsageLedger } from "../shared/model.ts";

const SYSTEM =
  `אתה עורך דין בכיר הכותב תשובה משפטית בעברית משפטית מדויקת.

חוקים מוחלטים:
- מותר לך להסתמך אך ורק על הטענות המאומתות שסופקו לך. אין להוסיף אסמכתאות, פסקי דין, סעיפי חוק, שמות או תאריכים שאינם מופיעים בחומר.
- אם חלק מהשאלה לא בוסס בראיות, אמור זאת במפורש בפסקה ייעודית. עדיף להודות בחוסר מאשר להשלים מהזיכרון.
- אל תכתוב הערות שוליים, מספרי הפניה, סוגריים מרובעים או קישורים. במקום זאת צרף לכל בלוק את source_ids של המקורות שעליהם הוא נשען. מנגנון נפרד יוסיף את האזכורים.
- טקסט הבלוק הוא פרוזה משפטית רציפה, ללא מטא-דיבור על תהליך המחקר.
- מבנה מומלץ: כותרת פתיחה קצרה, מסגרת נורמטיבית, יישום, ולבסוף מגבלות התשובה אם קיימות.`;

const TOOL = {
  name: "submit_draft",
  description: "הגשת טיוטת התשובה כבלוקים מובנים.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      blocks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: { type: "string", enum: ["heading", "paragraph", "list_item"] },
            text: { type: "string" },
            source_ids: { type: "array", items: { type: "string" } },
          },
          required: ["type", "text", "source_ids"],
        },
      },
    },
    required: ["blocks"],
  },
};

export function buildDrafterInput(question: string, pack: VerifiedEvidencePack): string {
  const claims = pack.claims
    .map((c) => {
      const srcs = c.sources
        .map((s) =>
          `    - ${s.source_id} | ${s.display_title}${s.locator ? ` | ${s.locator}` : ""} | תמיכה: ${s.support}\n      ציטוט מאומת: "${s.verified_span}"`
        )
        .join("\n");
      return `${c.claim_id} [${c.importance}, ${c.support_status}]: ${c.proposition}\n${srcs}`;
    })
    .join("\n\n");
  const gaps = pack.unsupported_claims.length
    ? pack.unsupported_claims.map((u) => `- ${u.proposition}`).join("\n")
    : "(אין)";
  return `השאלה:\n${question}\n\nטענות מאומתות ומקורותיהן:\n${claims || "(אין טענות מאומתות)"}\n\nנושאים שלא ניתן היה לבסס בראיות (יש להצהיר עליהם בגלוי, בלי לנחש):\n${gaps}`;
}

export function sanitizeBlocks(
  blocks: DraftBlock[],
  pack: VerifiedEvidencePack,
): { blocks: DraftBlock[]; dropped_source_ids: string[] } {
  const allowed = new Set<string>();
  for (const c of pack.claims) for (const s of c.sources) allowed.add(s.source_id);
  const dropped = new Set<string>();
  const out = blocks
    .filter((b) => typeof b.text === "string" && b.text.trim())
    .map((b) => {
      const ids = (b.source_ids ?? []).filter((id) => {
        if (allowed.has(id)) return true;
        dropped.add(id);
        return false;
      });
      return {
        type: b.type === "heading" || b.type === "list_item" ? b.type : "paragraph",
        // The drafter must not emit citation markup; strip it if it slips through.
        text: b.text
          .replace(/\[\^?\d+\]/g, "")
          .replace(/https?:\/\/\S+/g, "")
          .replace(/[ \t]{2,}/g, " ")
          .trim(),
        source_ids: [...new Set(ids)],
      } as DraftBlock;
    })
    .filter((b) => b.text.length > 0);
  return { blocks: out, dropped_source_ids: [...dropped] };
}

export async function runDrafter(opts: {
  question: string;
  pack: VerifiedEvidencePack;
  model: string;
  usage: UsageLedger;
}): Promise<{ blocks: DraftBlock[]; error?: string; dropped_source_ids: string[] }> {
  const res = await chat({
    model: opts.model,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: buildDrafterInput(opts.question, opts.pack) },
    ],
    tools: [TOOL],
    toolChoice: { name: TOOL.name },
    usage: opts.usage,
  });
  if (!res.ok) return { blocks: [], error: `drafter_error_${res.http_status}`, dropped_source_ids: [] };
  const parsed = parseJsonLoose<{ blocks?: DraftBlock[] }>(res.tool_calls[0]?.arguments ?? res.content);
  if (!parsed?.blocks?.length) return { blocks: [], error: "drafter_no_blocks", dropped_source_ids: [] };
  return sanitizeBlocks(parsed.blocks, opts.pack);
}
