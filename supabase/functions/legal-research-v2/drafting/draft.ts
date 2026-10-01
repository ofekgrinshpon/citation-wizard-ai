/**
 * legal-research-v2 — the drafter.
 *
 * The drafter sees ONLY the original question and the verified evidence pack.
 * It never sees discovery results, rejected evidence, the agent's reasoning or
 * any role/mode machinery. It never writes citation markup: it attaches
 * source_ids to blocks and the renderer does the rest.
 */

import type {
  DraftBlock,
  DraftingBrief,
  VerifiedEvidencePack,
  VerifiedResearchSynthesis,
} from "../types.ts";
import type {
  AgentAnswerBlock,
  RejectedPair as AgentAnswerRejectedPair,
  VerifiedEvidencePack as AgentAnswerPack,
} from "../types.ts";
import { chat, parseJsonLoose, type UsageLedger } from "../shared/model.ts";
import { renderDraftingBrief } from "./draftingBrief.ts";
import { renderSynthesisForDrafter } from "./synthesis.ts";


const SYSTEM =
  `אתה עורך דין בכיר הכותב תשובה משפטית בעברית משפטית מדויקת.

חוקים מוחלטים:
- מותר לך להסתמך אך ורק על הטענות המאומתות שסופקו לך. אין להוסיף אסמכתאות, פסקי דין, סעיפי חוק, שמות או תאריכים שאינם מופיעים בחומר.
- אם חלק מהשאלה לא בוסס בראיות, אמור זאת במפורש בפסקה ייעודית — ברמה כללית בלבד: מה לא ניתן היה לאמת ואיזה מקור לא הושג. אין לנסח, לפרט, לצטט או לשלול טענות משפטיות שלא אומתו, גם לא בצורה שלילית ("לא אומת כי..."). עדיף להודות בחוסר מאשר להשלים מהזיכרון.
- אל תכתוב הערות שוליים, מספרי הפניה, סוגריים מרובעים או קישורים. במקום זאת צרף לכל בלוק את source_ids של המקורות שעליהם הוא נשען. מנגנון נפרד יוסיף את האזכורים.
- טקסט הבלוק הוא פרוזה משפטית רציפה, ללא מטא-דיבור על תהליך המחקר.
- כל בלוק שאינו כותרת חייב לשאת לפחות source_id אחד מתוך הרשימה שסופקה, בדיוק כפי שהוא כתוב (למשל S1). בלוק ללא source_id ייפסל.
- התאם את מבנה התשובה ואת מידת פיתוחה לתוצר שהמשתמש ביקש: פרק, פרק מבוא, סקירת ספרות, ניתוח השוואתי או סינתזה מחייבים כתיבה מפותחת ורציפה המנצלת את מלוא החומר המאומת, בעוד ששאלה ממוקדת מחייבת תשובה קצרה וישירה. אין יעד אורך קבוע.
- מבנה מומלץ: כותרת פתיחה קצרה, מסגרת נורמטיבית, יישום, ולבסוף מגבלות התשובה אם קיימות.

שימוש במבנה המחקר המאומת (אם סופק):
- השתמש בו כדי להבין את המבנה הרעיוני של המחקר: אילו ממדים נבחנו, מהו אופיו של כל מקור, ואילו יחסים (הסכמה, מחלוקת, התפתחות, ניגוד, סיוג, יישום) בוססו בין טענות מאומתות.
- זו הנחיה ארגונית בלבד. כל משפט מהותי חייב להישאר מעוגן בטענות המאומתות. אתה רשאי לארגן מחדש, לאחד או לוותר על חלוקות אם מבנה אחר עונה למשתמש טוב יותר.
- אל תשכפל מכנית כל סעיף מהמבנה, ואל תייצר כותרות מיותרות בשאלה צרה — שם עדיפה תשובה ישירה וקצרה.
- אל תשטח מחלוקת, התפתחות או השוואה מאומתות לפסקאות מנותקות; הסבר את היחס עצמו.
- כשהבקשה נוגעת לספרות מחקרית: ייחס עמדות למחברים מזוהים כשהייחוס מופיע בטענות המאומתות, סנתז עמדות במקום למנות מאמרים, הבחן בין כתיבה אקדמית לדין מחייב, והימנע מ"בספרות נטען" כשקיים ייחוס שמי מאומת ורלוונטי.
- בבקשה השוואתית: ארגן סביב ממדי ההשוואה ולא סביב שתי סקירות נפרדות, אלא אם כך נכון מהותית.
- בהתפתחות היסטורית: שמור על סדר כרונולוגי. אל תסיק כרונולוגיה, מחלוקת או ניגוד שאינם עולים מהטענות המאומתות.
- דיוק ייחוס: כשטענות עצמאיות מהותית נשענות על מקורות שונים, העדף בלוקים נפרדים על פני בלוק אחד גדול. אין להפוך כל משפט לפסקה.`;

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

export function buildDrafterInput(
  question: string,
  pack: VerifiedEvidencePack,
  advisories: string[] = [],
  gapNotices: string[] = [],
  synthesis: VerifiedResearchSynthesis | null = null,
): string {
  const claims = pack.claims
    .map((c) => {
      const srcs = c.sources
        .map((s) =>
          `    - ${s.source_id} | ${s.display_title}${s.locator ? ` | ${s.locator}` : ""} | תמיכה: ${s.support}${
            s.support_provenance === "authoritative_derivative"
              ? " | מקור נגזר סמכותי (ההלכה כפי שהוצגה בפסיקה מאוחרת)"
              : ""
          }\n      ציטוט מאומת: "${s.verified_span}"`
        )
        .join("\n");
      return `${c.claim_id} [${c.importance}, ${c.support_status}]: ${c.proposition}\n${srcs}`;
    })
    .join("\n\n");
  // Rejected propositions stay in telemetry only: repeating them here made
  // refusals recite unverified law in negated form.
  const core = pack.unsupported_claims.filter((u) => u.importance === "core").length;
  const gaps = pack.unsupported_claims.length
    ? [
      `${pack.unsupported_claims.length} נושאים (מתוכם ${core} מרכזיים) לא עמדו באימות הראיות ולכן אינם זמינים לך.`,
      ...(gapNotices.length ? gapNotices.map((g) => `- ${g}`) : []),
      "התייחס אליהם ברמה כללית בלבד: ציין שלא ניתן היה לאמת את החלק הרלוונטי בשאלה ואילו מקורות לא הושגו. אל תנסח את תוכן הטענות שלא אומתו.",
    ].join("\n")
    : "(אין)";
  const notes = advisories.length
    ? `\n\nהנחיות מחייבות לניסוח:\n${advisories.map((a) => `- ${a}`).join("\n")}`
    : "";
  const structure = renderSynthesisForDrafter(synthesis);
  return `השאלה:\n${question}\n\nטענות מאומתות ומקורותיהן:\n${claims || "(אין טענות מאומתות)"}${
    structure ? `\n\n${structure}` : ""
  }\n\nנושאים שלא ניתן היה לבסס בראיות (יש להצהיר עליהם בגלוי, בלי לנחש):\n${gaps}${notes}`;
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
  /** Deterministic drafting obligations (temporal gaps, derivative provenance). */
  advisories?: string[];
  /** High-level, source-level description of what could not be acquired/verified. */
  gapNotices?: string[];
  /**
   * Academic writing guide + the paper's framing block. Normal legal research
   * without an academic deliverable never sets this.
   */
  academic?: { guide: string; contextBlock?: string } | null;
  /** Verified projection of the accepted memo's research synthesis. */
  synthesis?: VerifiedResearchSynthesis | null;
  /**
   * Agent-owned description of the deliverable the user asked for. Writing
   * guidance only: it can never add a claim or authority, and its length
   * target is soft.
   */
  brief?: DraftingBrief | null;
}): Promise<
  {
    blocks: DraftBlock[];
    error?: string;
    dropped_source_ids: string[];
    finish_reason?: string | null;
  }
> {
  const system = opts.academic
    ? `${SYSTEM}\n\n${opts.academic.guide}`
    : SYSTEM;
  const userInput = [
    buildDrafterInput(
      opts.question,
      opts.pack,
      opts.advisories ?? [],
      opts.gapNotices ?? [],
      opts.synthesis ?? null,
    ),
    renderDraftingBrief(opts.brief ?? null),
    opts.academic?.contextBlock ?? "",
  ].filter(Boolean).join("\n\n");
  const res = await chat({
    model: opts.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userInput },
    ],
    tools: [TOOL],
    toolChoice: { name: TOOL.name },
    usage: opts.usage,
    costStage: "v2_drafter",
  });
  if (!res.ok) return { blocks: [], error: `drafter_error_${res.http_status}`, dropped_source_ids: [] };
  const parsed = parseJsonLoose<{ blocks?: DraftBlock[] }>(res.tool_calls[0]?.arguments ?? res.content);
  if (!parsed?.blocks?.length) {
    return {
      blocks: [],
      error: "drafter_no_blocks",
      dropped_source_ids: [],
      finish_reason: res.finish_reason,
    };
  }
  const first = { ...sanitizeBlocks(parsed.blocks, opts.pack), finish_reason: res.finish_reason };


  // A draft that cites nothing while verified evidence exists is a drafting
  // failure, not an honest answer: ask once for the same text with its sources.
  const packHasSources = opts.pack.claims.some((c) => c.sources.length > 0);
  const cited = first.blocks.some((b) => b.source_ids.length > 0);
  if (!packHasSources || cited) return first;

  const repair = await chat({
    model: opts.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userInput },
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
    costStage: "v2_drafter_repair",
  });
  if (!repair.ok) return first;
  const reparsed = parseJsonLoose<{ blocks?: DraftBlock[] }>(
    repair.tool_calls[0]?.arguments ?? repair.content,
  );
  if (!reparsed?.blocks?.length) return first;
  const second = { ...sanitizeBlocks(reparsed.blocks, opts.pack), finish_reason: repair.finish_reason };
  return second.blocks.some((b) => b.source_ids.length > 0) ? second : first;

}


// ═══════════════════════════════════════════════════════════════════════
/*
 * legal-research-v2 — agent-authored answer (EVALUATION ONLY).
 *
 * Experiment flag `agent_authored_answer`: the SAME Research Agent that did the
 * research writes the final answer inside its memo submission. Nothing here is
 * evidence and nothing here verifies anything — verification stays the single
 * source of truth. This module only:
 *
 *   • normalizes the agent's answer blocks;
 *   • gates each block against the claims that SURVIVED verification;
 *   • derives each block's citations from verified claims only (model-supplied
 *     source_ids are never trusted);
 *   • builds the one bounded repair message for the same agent.
 *
 * A block that references a failed or unknown claim never reaches the renderer
 * unchanged: it is either repaired by the agent (and re-verified) or dropped.
 */

export const AGENT_ANSWER_LIMITS = {
  MAX_BLOCKS: 80,
  MAX_BLOCK_CHARS: 6000,
  MAX_CLAIM_REFS: 16,
};

export function normalizeAnswerBlocks(raw: unknown): AgentAnswerBlock[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: AgentAnswerBlock[] = [];
  for (const b of raw.slice(0, AGENT_ANSWER_LIMITS.MAX_BLOCKS)) {
    if (!b || typeof b !== "object") continue;
    const r = b as Record<string, unknown>;
    const type = r.type === "heading" || r.type === "list_item" ? r.type : "paragraph";
    const text = typeof r.text === "string"
      ? r.text.replace(/\[\^?\d+\]/g, "").trim().slice(0, AGENT_ANSWER_LIMITS.MAX_BLOCK_CHARS)
      : "";
    if (!text) continue;
    const ids = (v: unknown) =>
      Array.isArray(v)
        ? [...new Set(v.filter((x) => typeof x === "string" && x.trim()).map((x) => String(x).trim()))]
          .slice(0, AGENT_ANSWER_LIMITS.MAX_CLAIM_REFS)
        : [];
    out.push({
      type,
      text,
      claim_ids: ids(r.claim_ids),
      ...(Array.isArray(r.source_ids) ? { source_ids: ids(r.source_ids) } : {}),
    });
  }
  return out;
}

export type BlockStatus = "accepted" | "framing" | "requires_repair";

export interface GatedBlock {
  index: number;
  block: AgentAnswerBlock;
  status: BlockStatus;
  verified_claim_ids: string[];
  failed_claim_ids: string[];
  unknown_claim_ids: string[];
  /** Model-supplied source ids that do not match any verified claim of the block. */
  untrusted_source_ids: string[];
  /** Derived from verified claims only — the only citations ever rendered. */
  derived_source_ids: string[];
  /** Claim-specific locator per derived source (from the block's verified claims). */
  source_locators: Record<string, string>;
  /** Set by the coverage safeguard when the text says more than its claims. */
  coverage_issue?: string;
}

export interface GateResult {
  blocks: GatedBlock[];
  accepted: DraftBlock[];
  requires_repair: GatedBlock[];
  claims_referenced_but_unverified: string[];
}

/**
 * `memoClaimIds` = every claim the agent submitted; `pack` = what survived
 * verification + temporal gate. A claim id outside the memo is "unknown".
 */
export function gateAnswerBlocks(
  blocks: AgentAnswerBlock[],
  pack: AgentAnswerPack,
  memoClaimIds: Iterable<string>,
): GateResult {
  const memoIds = new Set(memoClaimIds);
  const verified = new Map(pack.claims.map((c) => [c.claim_id, c]));
  const gated: GatedBlock[] = blocks.map((block, index) => {
    const verified_claim_ids: string[] = [];
    const failed_claim_ids: string[] = [];
    const unknown_claim_ids: string[] = [];
    for (const id of block.claim_ids) {
      if (verified.has(id)) verified_claim_ids.push(id);
      else if (memoIds.has(id)) failed_claim_ids.push(id);
      else unknown_claim_ids.push(id);
    }
    const derived = new Set<string>();
    const locs = new Map<string, string[]>();
    for (const id of verified_claim_ids) {
      for (const s of verified.get(id)!.sources) {
        derived.add(s.source_id);
        const loc = (s.locator ?? "").trim();
        if (!loc) continue;
        const arr = locs.get(s.source_id) ?? [];
        if (!arr.includes(loc)) arr.push(loc);
        locs.set(s.source_id, arr);
      }
    }
    const source_locators: Record<string, string> = {};
    for (const [sid, arr] of locs) source_locators[sid] = arr.join(", ");
    const untrusted_source_ids = (block.source_ids ?? []).filter((s) => !derived.has(s));
    const status: BlockStatus = failed_claim_ids.length || unknown_claim_ids.length
      ? "requires_repair"
      : verified_claim_ids.length
      ? "accepted"
      : "framing";
    return {
      index,
      block,
      status,
      verified_claim_ids,
      failed_claim_ids,
      unknown_claim_ids,
      untrusted_source_ids,
      derived_source_ids: [...derived],
      source_locators,
    };
  });
  return finalizeGate(gated);
}

function finalizeGate(gated: GatedBlock[]): GateResult {
  const unverified = new Set<string>();
  for (const g of gated) for (const id of [...g.failed_claim_ids, ...g.unknown_claim_ids]) unverified.add(id);
  return {
    blocks: gated,
    // Headings never carry citations; framing blocks carry none either.
    accepted: gated
      .filter((g) => g.status !== "requires_repair")
      .map((g) => ({
        type: g.block.type,
        text: g.block.text,
        source_ids: g.block.type === "heading" ? [] : g.derived_source_ids,
        ...(g.block.type !== "heading" && Object.keys(g.source_locators).length
          ? { source_locators: g.source_locators }
          : {}),
      })),
    requires_repair: gated.filter((g) => g.status === "requires_repair"),
    claims_referenced_but_unverified: [...unverified],
  };
}

// ─── Answer-block coverage safeguard ────────────────────────────────────
/*
 * After ordinary verification, one batched call (same verifier model) asks
 * whether each substantive block's legal/factual content is covered by the
 * verified propositions it cites, and whether each claimless non-heading
 * block is pure framing. It never rewrites and never adds claims. Failing
 * blocks go to the same agent's single repair; unrepaired ones never publish.
 */

export interface BlockCoverageVerdict {
  block_index: number;
  coverage: "covered" | "overclaims" | "framing" | "substantive";
  reason?: string;
}

const COVERAGE_TOOL = {
  name: "report_block_coverage",
  description: "Report coverage for each listed answer block.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            block_index: { type: "number" },
            coverage: { type: "string", enum: ["covered", "overclaims", "framing", "substantive"] },
            reason: { type: "string" },
          },
          required: ["block_index", "coverage"],
        },
      },
    },
    required: ["results"],
  },
};

const COVERAGE_SYSTEM = `אתה בודק כיסוי בלבד. אינך כותב מחדש ואינך מוסיף טענות.
לכל בלוק עם טענות מאומתות: קבע "covered" אם התוכן המשפטי/העובדתי המהותי של הבלוק מכוסה על ידי הטענות המאומתות שאליהן הוא מפנה (ניסוח, מעבר, סיכום והסבר מותרים), או "overclaims" אם הבלוק קובע תוכן משפטי/עובדתי מהותי שאינו מופיע בטענות אלה (סעיף, הלכה, תאריך, שם, מסקנה או קביעה נוספת).
לכל בלוק בלי טענות: "framing" אם הוא רק מסגור/מעבר/הצגת שאלת המשתמש/מבנה הפרק, או "substantive" אם הוא כולל קביעה משפטית או עובדתית מהותית.
הסבר קצר ב-reason כשאינו covered/framing.`;

/** Blocks that need a coverage verdict (headings never do). */
export function coverageTargets(gate: GateResult): GatedBlock[] {
  return gate.blocks.filter((g) =>
    g.block.type !== "heading" && (g.status === "accepted" || g.status === "framing")
  );
}

export async function checkAnswerBlockCoverage(opts: {
  gate: GateResult;
  pack: AgentAnswerPack;
  model: string;
  usage: UsageLedger;
}): Promise<{ verdicts: BlockCoverageVerdict[]; error?: string; checked: number }> {
  const targets = coverageTargets(opts.gate);
  if (!targets.length) return { verdicts: [], checked: 0 };
  const byId = new Map(opts.pack.claims.map((c) => [c.claim_id, c]));
  const lines = targets.map((g) => {
    const props = g.verified_claim_ids
      .map((id) => `   - ${id}: ${byId.get(id)?.proposition ?? ""}`)
      .join("\n");
    return `[${g.index}] ${g.block.text}\n${props ? `  טענות מאומתות:\n${props}` : "  (ללא טענות)"}`;
  }).join("\n\n");
  const res = await chat({
    model: opts.model,
    messages: [
      { role: "system", content: COVERAGE_SYSTEM },
      { role: "user", content: `בלוקים לבדיקה:\n\n${lines}` },
    ],
    tools: [COVERAGE_TOOL],
    toolChoice: { name: COVERAGE_TOOL.name },
    usage: opts.usage,
    costStage: "v2_coverage_check",
  });
  if (!res.ok) return { verdicts: [], error: `coverage_error_${res.http_status}`, checked: targets.length };
  const parsed = parseJsonLoose<{ results?: BlockCoverageVerdict[] }>(
    res.tool_calls[0]?.arguments ?? res.content,
  );
  const allowed = new Set(targets.map((g) => g.index));
  const verdicts = (parsed?.results ?? []).filter((v) =>
    v && allowed.has(Number(v.block_index)) &&
    ["covered", "overclaims", "framing", "substantive"].includes(String(v.coverage))
  ).map((v) => ({ ...v, block_index: Number(v.block_index) }));
  return { verdicts, checked: targets.length, ...(parsed ? {} : { error: "coverage_unparsed" }) };
}

/**
 * Pure: move blocks the coverage check flagged into requires_repair. A claim-
 * backed block flagged "overclaims" and a claimless block flagged
 * "substantive" can no longer publish as-is.
 */
export function applyBlockCoverage(gate: GateResult, verdicts: BlockCoverageVerdict[]): GateResult {
  const v = new Map(verdicts.map((x) => [x.block_index, x]));
  const blocks = gate.blocks.map((g) => {
    const verdict = v.get(g.index);
    if (!verdict || g.block.type === "heading") return g;
    if (g.status === "accepted" && verdict.coverage === "overclaims") {
      return { ...g, status: "requires_repair" as const, coverage_issue: `overclaims: ${verdict.reason ?? ""}`.trim() };
    }
    if (g.status === "framing" && verdict.coverage === "substantive") {
      return { ...g, status: "requires_repair" as const, coverage_issue: `substantive_without_claims: ${verdict.reason ?? ""}`.trim() };
    }
    return g;
  });
  const out = finalizeGate(blocks);
  // Coverage issues are not unverified claims — keep that list as it was.
  return { ...out, claims_referenced_but_unverified: gate.claims_referenced_but_unverified };
}

export function wordCount(blocks: Array<{ text: string }>): number {
  return blocks.map((b) => b.text).join(" ").split(/\s+/).filter(Boolean).length;
}

export function buildAgentAnswerRepairMessage(input: {
  blocks: AgentAnswerBlock[];
  gate: GateResult;
  pack: AgentAnswerPack;
  rejected: AgentAnswerRejectedPair[];
  unsupported: Array<{ claim_id: string; proposition: string }>;
}): string {
  const answer = input.blocks
    .map((b, i) => `[${i + 1}] (${b.type}; claims: ${b.claim_ids.join(", ") || "—"}) ${b.text}`)
    .join("\n");
  const verified = input.pack.claims
    .map((c) => `- ${c.claim_id}: ${c.proposition} (מקורות: ${c.sources.map((s) => s.source_id).join(", ")})`)
    .join("\n");
  const failedIds = new Set(input.gate.claims_referenced_but_unverified);
  const reasons: string[] = [];
  for (const id of failedIds) {
    const u = input.unsupported.find((c) => c.claim_id === id);
    const rej = input.rejected.filter((r) => r.claim_id === id);
    if (!u && !rej.length) {
      reasons.push(`- ${id}: אינו קיים בתזכיר שהגשת (claim_id לא מוכר)`);
      continue;
    }
    const why = rej.length
      ? rej.map((r) => `${r.source_id}: ${r.reason}${r.detail ? ` (${r.detail})` : ""}`).join("; ")
      : "נפלה באימות (ללא ראיה מאומתת או בשל בדיקת תוקף עדכני)";
    reasons.push(`- ${id}${u ? ` — ${u.proposition}` : ""}: ${why}`);
  }
  const coverageIssues = input.gate.requires_repair
    .filter((g) => g.coverage_issue)
    .map((g) => `- בלוק ${g.index + 1}: ${
      g.coverage_issue!.startsWith("overclaims")
        ? "הטקסט אומר יותר ממה שה-claims המאומתים שלו תומכים"
        : "בלוק ללא claim_ids הכולל קביעה משפטית/עובדתית מהותית"
    }${g.coverage_issue!.includes(":") ? ` — ${g.coverage_issue!.split(":").slice(1).join(":").trim()}` : ""}`);
  const affected = input.gate.requires_repair.map((g) => g.index + 1).join(", ");
  return `האימות הסתיים. חלק מהטענות שעליהן נשענת התשובה שכתבת לא עברו אימות. סבב תיקון אחד בלבד.

התשובה שכתבת (בלוקים ממוספרים):
${answer}

בלוקים הדורשים תיקון: ${affected || "(אין)"}

טענות שנכשלו והסיבה המדויקת:
${reasons.join("\n") || "(אין)"}

בלוקים שתוכנם חורג מהטענות המאומתות:
${coverageIssues.join("\n") || "(אין)"}

טענות מאומתות שנותרו (מותר להסתמך עליהן):
${verified || "(אין)"}

הנחיה:
- תקן את התשובה כך שכל טענה מהותית תישען רק על claims מאומתים.
- שמור ככל האפשר על איכות, מבנה ורצף התשובה המקורית. אל תכתוב מחדש בלוקים שאינם דורשים שינוי.
- אם ניתן לבסס טענה באמצעות חומר שכבר נקרא (quote_id שמור או ציטוט מילולי) — הוסף claim מתאים עם ראיה, והוא יעבור אימות מלא לפני פרסום.
- מחקר נוסף מותר רק אם הוא באמת נחוץ ונותר תקציב.
- אם לא ניתן לבסס — הסר, סייג או נסח מחדש. אל תמציא authority או תוכן שאינו בראיות.
- הגש שוב submit_research_memo מלא: claims (כולל המאומתים שבהם אתה ממשיך להשתמש) ו-answer_blocks המתוקנים.`;
}
