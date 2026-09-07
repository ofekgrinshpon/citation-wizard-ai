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
- כל בלוק שאינו כותרת חייב לשאת לפחות source_id אחד מתוך הרשימה שסופקה, בדיוק כפי שהוא כתוב (למשל S1). בלוק ללא source_id ייפסל.
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

/** `s1`, " S1 ", "[S1]" and "S1." all denote the same source. */
function normalizeSourceId(id: string): string {
  return String(id ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function sanitizeBlocks(
  blocks: DraftBlock[],
  pack: VerifiedEvidencePack,
): { blocks: DraftBlock[]; dropped_source_ids: string[] } {
  const allowed = new Map<string, string>();
  for (const c of pack.claims) {
    for (const s of c.sources) allowed.set(normalizeSourceId(s.source_id), s.source_id);
  }
  const dropped = new Set<string>();
  const out = blocks
    .filter((b) => typeof b.text === "string" && b.text.trim())
    .map((b) => {
      const ids = (b.source_ids ?? [])
        .map((id) => {
          const canonical = allowed.get(normalizeSourceId(id));
          if (canonical) return canonical;
          dropped.add(id);
          return null;
        })
        .filter((id): id is string => id !== null);
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
  const first = sanitizeBlocks(parsed.blocks, opts.pack);

  // A draft that cites nothing while verified evidence exists is a drafting
  // failure, not an honest answer: ask once for the same text with its sources.
  const packHasSources = opts.pack.claims.some((c) => c.sources.length > 0);
  const cited = first.blocks.some((b) => b.source_ids.length > 0);
  if (!packHasSources || cited) return first;

  const repair = await chat({
    model: opts.model,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: buildDrafterInput(opts.question, opts.pack) },
      { role: "assistant", content: JSON.stringify({ blocks: parsed.blocks }) },
      {
        role: "user",
        content:
          "אף בלוק לא נשא source_id תקין. הגש שוב בדיוק את אותו טקסט, אך צרף לכל בלוק שאינו כותרת את מזהי המקורות (S1, S2 …) מתוך רשימת הטענות המאומתות שעליהם הוא נשען.",
      },
    ],
    tools: [TOOL],
    toolChoice: { name: TOOL.name },
    usage: opts.usage,
  });
  if (!repair.ok) return first;
  const reparsed = parseJsonLoose<{ blocks?: DraftBlock[] }>(
    repair.tool_calls[0]?.arguments ?? repair.content,
  );
  if (!reparsed?.blocks?.length) return first;
  const second = sanitizeBlocks(reparsed.blocks, opts.pack);
  return second.blocks.some((b) => b.source_ids.length > 0) ? second : first;
}
