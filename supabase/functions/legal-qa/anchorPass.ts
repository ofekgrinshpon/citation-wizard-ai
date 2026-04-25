// Pilot v7 (Fast-mode): post-draft anchor pass.
//
// Runs AFTER the structured drafter and BEFORE footnote parsing. Single job:
// scan the drafted body for substantive sentences that the drafter forgot
// to anchor, and emit {sentenceFragment, sourceCardId} patches that the
// caller applies in TS by appending the next sequential [N] marker and
// inserting a matching numbered footnote line into (or just after) the
// existing --- הערות שוליים --- block.
//
// Hard rules enforced here:
//   1. Patches MUST reference a sourceCardId that exists in the supplied
//      sourcePack (validated TS-side; LLM hallucinations are dropped).
//   2. The sentenceFragment MUST be a verbatim substring of the drafted
//      body (validated TS-side).
//   3. Sentences that already carry any [N] marker are NEVER patched.
//   4. Max 4 patches per call. Empty/timeout output → caller ships the
//      draft unchanged.
//
// Model: Gemini 2.5 Flash, 15s timeout, forceProvider="gemini".

import { callPlannerJSON, type PlannerToolDef, type StageRun } from "./aiProvider.ts";

export interface AnchorPassSourcePackItem {
  /** Numeric source card id, e.g. 7 — matches sourceCards[].id. */
  id: number;
  citation: string;
  source_type: string;
  url?: string;
  /** Authority weight for ordering hints in the prompt. */
  authority_class?: string;
  /** Whether this source has a real anchor (URL / local DB / verified). */
  anchor_present: boolean;
}

export interface AnchorPassClaim {
  claim: string;
  sourceIds: number[];
  authorityLevel?: "high" | "medium" | "low";
}

export interface AnchorPatch {
  sentenceFragment: string;
  sourceCardId: number;
}

export interface AnchorPassInput {
  body: string;
  sourcePack: AnchorPassSourcePackItem[];
  claims: AnchorPassClaim[];
  /**
   * Caller-provided cap on the number of patches to apply. Defaults to 4
   * for back-compat. Fast mode passes 2; Deep passes 4. The LLM tool
   * schema permits up to 6 candidates, but we hard-cap on the TS side so
   * profile changes never require re-deploying the prompt.
   */
  maxPatches?: number;
}

const ANCHOR_PASS_TOOL: PlannerToolDef = {
  name: "submit_anchor_patches",
  description:
    "Return up to 4 anchor patches for substantive legal sentences in the body that lack a footnote marker but are supported by an existing source card.",
  parameters: {
    type: "object",
    properties: {
      patches: {
        type: "array",
        maxItems: 6,
        items: {
          type: "object",
          properties: {
            sentenceFragment: {
              type: "string",
              description:
                "A verbatim substring (40-160 Hebrew chars) from the body that uniquely identifies the unanchored sentence. Must be copy-pasted exactly, including punctuation. The marker [N] will be appended at this fragment's end.",
            },
            sourceCardId: {
              type: "integer",
              description:
                "The numeric id of the source card (from the supplied source pack) that supports this sentence. MUST match one of the listed ids exactly.",
            },
          },
          required: ["sentenceFragment", "sourceCardId"],
          additionalProperties: false,
        },
      },
    },
    required: ["patches"],
    additionalProperties: false,
  },
};

const ANCHOR_PASS_SYSTEM_PROMPT = `אתה עוזר משפטי אנליסט. תפקידך לבדוק טיוטת חוות דעת משפטית **שכבר נכתבה** ולאתר משפטים מהותיים שחסר להם סימן הפניה [N], אך **קיים מקור תומך אמיתי** ברשימת המקורות שניתנה לך.

חוקים מחייבים — קרא בעיון:

1. **רק משפטים מהותיים**: משפט שמגדיר נורמה משפטית, מתאר הלכה, מפנה לחוק/פסיקה ספציפיים, או קובע מסקנה משפטית קונקרטית. אל תבקש לעגן הקדמות, גשרים נרטיביים, או משפטים עיתונאיים.

2. **רק משפטים ללא [N]**: אם המשפט (או הפסקה הקרובה) כבר מסתיים ב-[N] כלשהו — דלג. אסור להוסיף סימן הפניה כפול.

3. **רק מקורות אמיתיים**: השדה sourceCardId חייב להיות **מספר id מדויק** ממקור ברשימה למטה. אם אין מקור שתומך ישירות במשפט — דלג. אסור להמציא id, ואסור לעגן משפט במקור שאינו רלוונטי לו.

4. **קטע מילולי**: השדה sentenceFragment חייב להיות **העתקה מילולית מדויקת** מתוך הגוף, באורך של 40-160 תווים, שמזהה את המשפט בצורה ייחודית. השמר על פיסוק וגרשיים בדיוק כמו במקור. הסמן [N] יתווסף בסוף הקטע הזה על ידי המערכת.

5. **מקסימום 4 תיקונים**. אם אין מועמדים ברורים — החזר רשימה ריקה. עדיף 0 תיקונים מאשר תיקון על מקור לא מתאים.

6. **לא לעגן טענות חלשות**: אם הקשר בין המשפט למקור עקיף או דורש פרשנות — דלג.

החזר JSON בלבד דרך הכלי submit_anchor_patches.`;

/**
 * Runs the anchor pass. Returns { patches, run }. patches is an empty
 * array on any failure (caller treats as "ship draft as-is"). All patches
 * are validated:
 *   - sentenceFragment must be a substring of input.body
 *   - sourceCardId must exist in input.sourcePack and have anchor_present=true
 * Invalid patches are silently dropped.
 */
export async function runAnchorPass(
  input: AnchorPassInput,
): Promise<{ patches: AnchorPatch[]; run: StageRun }> {
  const sourcesText = input.sourcePack
    .filter((s) => s.anchor_present)
    .slice(0, 16)
    .map(
      (s) =>
        `[${s.id}] (${s.source_type}${s.authority_class ? `, ${s.authority_class}` : ""}) ${s.citation.slice(0, 180)}${s.url ? ` — ${s.url}` : ""}`,
    )
    .join("\n");

  const claimsText = input.claims
    .slice(0, 12)
    .map((c, i) => `${i + 1}. "${c.claim.slice(0, 180)}" → src=[${c.sourceIds.join(",")}]`)
    .join("\n");

  // Cap body input to keep latency predictable; anchor pass works on the first
  // ~6k chars which covers the typical 800-1500 word memo well within Flash.
  const bodyTrimmed = input.body.length > 6500 ? input.body.slice(0, 6500) + "\n[... קוצץ ...]" : input.body;

  const userPrompt = `## טיוטת חוות הדעת (גוף)
${bodyTrimmed}

## רשימת מקורות זמינים (sourcePack — ${input.sourcePack.filter((s) => s.anchor_present).length} פריטים מעוגנים)
${sourcesText}

## מפת טענות מאושרת (לעיון בלבד — אל תייצר טענה חדשה)
${claimsText}

זהה עד 4 משפטים מהותיים בגוף **שאין להם [N] בקרבת מקום** אבל **יש להם מקור תומך ברור** ברשימה. החזר עבור כל אחד את sentenceFragment המילולי + sourceCardId המתאים. דלג על כל מה שלא ברור.`;

  const { data, run } = await callPlannerJSON<{ patches: AnchorPatch[] }>(
    ANCHOR_PASS_SYSTEM_PROMPT,
    userPrompt,
    ANCHOR_PASS_TOOL,
    {
      stage: "anchor_pass",
      timeoutMs: 15000,
      forceProvider: "gemini",
    },
  );

  if (!data || !Array.isArray(data.patches)) {
    return { patches: [], run };
  }

  // Validate every patch TS-side. Drop anything we can't verify.
  const validIds = new Set(
    input.sourcePack.filter((s) => s.anchor_present).map((s) => s.id),
  );
  const cleaned: AnchorPatch[] = [];
  const seenFragments = new Set<string>();
  // Caller-provided cap; default 4 for back-compat (matches the previous
  // hardcoded ceiling). Fast passes 2; Deep passes 4.
  const cap = Math.max(0, input.maxPatches ?? 4);
  for (const p of data.patches) {
    if (!p || typeof p.sentenceFragment !== "string" || typeof p.sourceCardId !== "number") continue;
    if (!validIds.has(p.sourceCardId)) continue;
    const frag = p.sentenceFragment.trim();
    if (frag.length < 20 || frag.length > 200) continue;
    if (!input.body.includes(frag)) continue;
    if (seenFragments.has(frag)) continue;
    seenFragments.add(frag);
    cleaned.push({ sentenceFragment: frag, sourceCardId: p.sourceCardId });
    if (cleaned.length >= cap) break;
  }

  return { patches: cleaned, run };
}

/**
 * Applies validated anchor patches to the raw drafter answerText. Strategy:
 *   1. For each patch, find the next available footnote number (max existing
 *      [N] in body + 1, incrementing per patch).
 *   2. Append [N] immediately after the sentenceFragment in the body half
 *      (text before the --- הערות שוליים --- separator if present).
 *   3. Append a numbered footnote line N. <citation> to the end of the
 *      footnotes block (or create one if absent).
 *
 * Returns the modified answerText (or the original if no patches applied).
 */
export function applyAnchorPatches(
  answerText: string,
  patches: AnchorPatch[],
  sourcePack: AnchorPassSourcePackItem[],
): { text: string; appliedCount: number } {
  if (patches.length === 0) return { text: answerText, appliedCount: 0 };

  // Locate the footnote separator (matches the same patterns the parser uses).
  const separatorPatterns = [
    /---\s*הערות שוליים\s*---/,
    /\*\*\s*הערות שוליים\s*\*\*/,
    /^#{1,3}\s*הערות שוליים/m,
    /^הערות שוליים\s*:?\s*$/m,
  ];
  let sepMatch: RegExpMatchArray | null = null;
  for (const p of separatorPatterns) {
    sepMatch = answerText.match(p);
    if (sepMatch && sepMatch.index !== undefined) break;
  }

  let body = sepMatch && sepMatch.index !== undefined ? answerText.slice(0, sepMatch.index) : answerText;
  const sepText = sepMatch && sepMatch.index !== undefined ? sepMatch[0] : "\n\n--- הערות שוליים ---\n";
  let footnotesSection = sepMatch && sepMatch.index !== undefined
    ? answerText.slice(sepMatch.index + sepMatch[0].length)
    : "";

  // Find the highest existing [N] across the whole document.
  const allNums = Array.from(answerText.matchAll(/\[(\d{1,2})\]/g)).map((m) => parseInt(m[1], 10));
  let nextNum = allNums.length > 0 ? Math.max(...allNums) + 1 : 1;

  let applied = 0;
  const cardById = new Map(sourcePack.map((s) => [s.id, s]));

  for (const patch of patches) {
    const card = cardById.get(patch.sourceCardId);
    if (!card) continue;
    // Anchor must still appear in the body half (not already in the footnote
    // section). If the drafter's body doesn't contain it anymore (rare —
    // could happen if a previous patch's marker shifted things), skip.
    const idx = body.indexOf(patch.sentenceFragment);
    if (idx === -1) continue;
    const insertAt = idx + patch.sentenceFragment.length;
    const marker = `[${nextNum}]`;
    body = body.slice(0, insertAt) + marker + body.slice(insertAt);
    // Build the footnote line. Use the card citation as-is; downstream
    // matchFootnoteToCard will re-attach provenance/url.
    const citation = card.citation.trim();
    if (footnotesSection.length > 0 && !footnotesSection.endsWith("\n")) footnotesSection += "\n";
    footnotesSection += `${nextNum}. ${citation}\n`;
    nextNum++;
    applied++;
  }

  if (applied === 0) return { text: answerText, appliedCount: 0 };

  // Reassemble. Preserve a leading newline before the separator for clean parsing.
  const trimmedBody = body.replace(/\s+$/, "");
  const reassembled = `${trimmedBody}\n\n${sepText.trim()}\n${footnotesSection.replace(/^\n+/, "")}`;
  return { text: reassembled, appliedCount: applied };
}
