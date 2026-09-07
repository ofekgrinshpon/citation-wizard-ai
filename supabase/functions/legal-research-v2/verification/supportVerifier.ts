/**
 * legal-research-v2 — CHECK 4: does the verified span support the claim?
 *
 * ONE batched LLM call. The verifier sees only the proposition, the verified
 * span and a little surrounding context — never the search history, the agent
 * reasoning, rejected candidates, or any role/ranking information.
 */

import type { SupportVerdict } from "../types.ts";
import { chat, parseJsonLoose, type UsageLedger } from "../shared/model.ts";

export interface SupportInput {
  pair_id: string;
  proposition: string;
  span: string;
  context?: string;
}

export interface SupportOutput {
  pair_id: string;
  support: SupportVerdict;
  reason: string;
}

const SYSTEM =
  `אתה בודק תמיכה ראייתית. לכל זוג {טענה, ציטוט מאומת ממסמך משפטי} קבע האם הציטוט תומך בטענה.
"supports" — הציטוט מבסס את הטענה כפי שנוסחה.
"supports_partially" — הציטוט תומך בחלק מהטענה או בניסוח רחב/צר יותר.
"does_not_support" — הציטוט אינו מבסס את הטענה, גם אם הוא באותו נושא.
אל תשתמש בידע חיצוני. השווה טענה מול ציטוט בלבד. נמק בקצרה בעברית.`;

const TOOL = {
  name: "report_support",
  description: "דיווח פסיקת תמיכה לכל זוג.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            pair_id: { type: "string" },
            support: { type: "string", enum: ["supports", "supports_partially", "does_not_support"] },
            reason: { type: "string" },
          },
          required: ["pair_id", "support", "reason"],
        },
      },
    },
    required: ["verdicts"],
  },
};

export async function verifySupport(
  pairs: SupportInput[],
  opts: { model: string; usage: UsageLedger },
): Promise<{ verdicts: SupportOutput[]; error?: string }> {
  if (!pairs.length) return { verdicts: [] };
  const user = pairs
    .map((p) =>
      `pair_id: ${p.pair_id}\nטענה: ${p.proposition}\nציטוט מאומת: "${p.span}"${
        p.context ? `\nהקשר: ${p.context}` : ""
      }`
    )
    .join("\n\n---\n\n");

  const res = await chat({
    model: opts.model,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: user },
    ],
    tools: [TOOL],
    toolChoice: { name: TOOL.name },
    usage: opts.usage,
  });
  if (!res.ok) return { verdicts: [], error: `verifier_error_${res.http_status}` };

  const args = res.tool_calls[0]?.arguments ?? res.content;
  const parsed = parseJsonLoose<{ verdicts?: SupportOutput[] }>(args);
  const verdicts = Array.isArray(parsed?.verdicts) ? parsed!.verdicts! : [];
  if (!verdicts.length) return { verdicts: [], error: "verifier_no_verdicts" };
  return {
    verdicts: verdicts.map((v) => ({
      pair_id: String(v.pair_id ?? ""),
      support: v.support === "supports" || v.support === "supports_partially"
        ? v.support
        : "does_not_support",
      reason: String(v.reason ?? ""),
    })),
  };
}
