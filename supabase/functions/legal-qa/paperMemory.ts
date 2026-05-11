// Global Paper Coherence — Paper Memory module.
//
// Maintains a compact, structured ledger of what each chapter has *claimed,
// *defined, *cited, and *left open*, so that every new chapter is primed with
// argumentative state rather than raw prose snippets. Three responsibilities:
//
//   1. `extractPaperMemoryDelta`  — after a chapter is finalized, distil it
//      into a small JSON delta (claims, definitions, citations, open questions).
//      One Gemini Flash / OpenAI nano call, ~600 output tokens, tool-call JSON.
//
//   2. `mergePaperMemoryDeltas`   — fold a list of per-chapter deltas into a
//      single cumulative PaperMemory view that the next prompt can render.
//
//   3. `runCoherenceCritic`       — audit a draft chapter against the
//      cumulative PaperMemory for contradictions, repetitions, terminology
//      drift, and unresolved counter-arguments. Returns a critic-shaped list
//      so we can reuse runChapterRevision's revision brief pipeline.
//
// All entry points are best-effort: any error returns null / empty so the
// caller can ship the original draft unchanged. Behind PAPER_COHERENCE_ENABLED
// in index.ts.

import { callPlannerJSON, type StageRun } from "./aiProvider.ts";

// ─────────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────────

export interface PaperMemoryClaim {
  chapter: number;            // 0-based chapter index
  chapterTitle: string;
  claim: string;              // ≤ 240 chars
  stance: "supports_thesis" | "qualifies_thesis" | "opposes_thesis" | "neutral";
  citationKeys: string[];     // short-form identifiers (e.g. "פס"ד פלוני", "כהן 2019")
}

export interface PaperMemoryDefinition {
  chapter: number;
  term: string;
  gloss: string;              // ≤ 160 chars — the locked meaning
}

export interface PaperMemoryCounter {
  chapter: number;
  counter: string;            // ≤ 200 chars — the counter-argument addressed
  resolution: string;         // ≤ 200 chars — how the chapter responded
}

export interface PaperMemoryCitedSource {
  key: string;                // normalized identifier
  shortForm: string;          // display form for Rule 37.7 hint
  chapter: number;
  footnoteNumber?: number;    // optional, only when known
}

export interface PaperMemoryOpenQuestion {
  chapter: number;
  question: string;           // ≤ 200 chars
}

/**
 * Per-chapter delta. Persisted on each ChapterData entry on the frontend so
 * subsequent calls can ship the full list back as `paperMemoryDeltas[]`. We
 * deliberately do NOT ship the full text of prior chapters in this path —
 * that's what made the prompt brittle when chapters got long.
 */
export interface PaperMemoryDelta {
  chapter: number;
  chapterTitle: string;
  claims: PaperMemoryClaim[];
  definitions: PaperMemoryDefinition[];
  counterAddressed: PaperMemoryCounter[];
  citedSources: PaperMemoryCitedSource[];
  openQuestions: PaperMemoryOpenQuestion[];
  /** Free-form 1-paragraph plain-text summary, ≤ 600 chars. Used by the
   *  coherence critic when it needs more context than the structured fields. */
  summary: string;
}

/** Cumulative view derived from a list of deltas. */
export interface PaperMemory {
  claims: PaperMemoryClaim[];
  definitions: PaperMemoryDefinition[];
  counterAddressed: PaperMemoryCounter[];
  citedSources: PaperMemoryCitedSource[];
  openQuestions: PaperMemoryOpenQuestion[];
  chapterSummaries: Array<{ chapter: number; chapterTitle: string; summary: string }>;
}

// ─────────────────────────────────────────────────────────────────────
//  Merge
// ─────────────────────────────────────────────────────────────────────

export function mergePaperMemoryDeltas(
  deltas: PaperMemoryDelta[] | null | undefined,
): PaperMemory {
  const empty: PaperMemory = {
    claims: [],
    definitions: [],
    counterAddressed: [],
    citedSources: [],
    openQuestions: [],
    chapterSummaries: [],
  };
  if (!Array.isArray(deltas) || deltas.length === 0) return empty;

  // Sort by chapter index — input order is not guaranteed.
  const sorted = [...deltas].sort((a, b) => (a.chapter ?? 0) - (b.chapter ?? 0));

  for (const d of sorted) {
    if (!d || typeof d !== "object") continue;
    if (Array.isArray(d.claims)) empty.claims.push(...d.claims);
    if (Array.isArray(d.definitions)) {
      // Locked terminology: first definition wins. Subsequent chapters
      // re-defining the same term are dropped silently — the coherence
      // critic flags drift separately.
      for (const def of d.definitions) {
        if (!def?.term) continue;
        const dupe = empty.definitions.find((x) => x.term.trim() === def.term.trim());
        if (!dupe) empty.definitions.push(def);
      }
    }
    if (Array.isArray(d.counterAddressed)) empty.counterAddressed.push(...d.counterAddressed);
    if (Array.isArray(d.citedSources)) {
      // Citation reuse map: first-occurrence wins so Rule 37.7 (לעיל ה"ש X)
      // points to the original footnote.
      for (const cs of d.citedSources) {
        if (!cs?.key) continue;
        const dupe = empty.citedSources.find((x) => x.key === cs.key);
        if (!dupe) empty.citedSources.push(cs);
      }
    }
    if (Array.isArray(d.openQuestions)) empty.openQuestions.push(...d.openQuestions);
    if (typeof d.summary === "string" && d.summary.trim()) {
      empty.chapterSummaries.push({
        chapter: d.chapter,
        chapterTitle: d.chapterTitle,
        summary: d.summary.slice(0, 600),
      });
    }
  }
  return empty;
}

// ─────────────────────────────────────────────────────────────────────
//  Prompt rendering — injected into write_chapter system/user prompts.
// ─────────────────────────────────────────────────────────────────────

export function renderPaperMemoryBlock(mem: PaperMemory): string {
  const hasAny =
    mem.claims.length +
      mem.definitions.length +
      mem.counterAddressed.length +
      mem.citedSources.length +
      mem.openQuestions.length +
      mem.chapterSummaries.length >
    0;
  if (!hasAny) return "";

  const lines: string[] = [];
  lines.push("\n\n=== זיכרון העבודה עד כה (Paper Memory) ===");
  if (mem.chapterSummaries.length > 0) {
    lines.push("\nתקצירי הפרקים הקודמים:");
    for (const s of mem.chapterSummaries) {
      lines.push(`  פרק ${s.chapter + 1} — ${s.chapterTitle}: ${s.summary}`);
    }
  }
  if (mem.claims.length > 0) {
    lines.push("\nטענות שכבר נטענו (אל תחזור עליהן ואל תסתור בלי הצדקה מפורשת):");
    for (const c of mem.claims) {
      const stanceTag =
        c.stance === "supports_thesis" ? "תומך" :
        c.stance === "qualifies_thesis" ? "מסייג" :
        c.stance === "opposes_thesis" ? "מסתייג" : "ניטרלי";
      lines.push(`  פרק ${c.chapter + 1} — [${stanceTag}] ${c.claim}`);
    }
  }
  if (mem.definitions.length > 0) {
    lines.push("\nמונחים נעולים (השתמש בהגדרה הקיימת — אל תגדיר מחדש):");
    for (const d of mem.definitions) {
      lines.push(`  "${d.term}" = ${d.gloss}  [הוגדר בפרק ${d.chapter + 1}]`);
    }
  }
  if (mem.counterAddressed.length > 0) {
    lines.push("\nטיעוני נגד שכבר טופלו (אל תפתח אותם מחדש):");
    for (const k of mem.counterAddressed) {
      lines.push(`  פרק ${k.chapter + 1}: ${k.counter} → ${k.resolution}`);
    }
  }
  if (mem.citedSources.length > 0) {
    const cap = 25;
    lines.push("\nמקורות שכבר צוטטו (העדף \"שם\" / \"לעיל ה\"ש X\" לפי כלל 37.7):");
    for (const cs of mem.citedSources.slice(0, cap)) {
      const fn = cs.footnoteNumber ? ` (ה\"ש ${cs.footnoteNumber})` : "";
      lines.push(`  ${cs.shortForm}${fn} — פרק ${cs.chapter + 1}`);
    }
    if (mem.citedSources.length > cap) {
      lines.push(`  …ועוד ${mem.citedSources.length - cap} מקורות`);
    }
  }
  if (mem.openQuestions.length > 0) {
    lines.push("\nשאלות פתוחות שייתכן שהפרק הנוכחי סוגר:");
    for (const q of mem.openQuestions) {
      lines.push(`  פרק ${q.chapter + 1}: ${q.question}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────
//  Extractor — runs after a chapter finalizes.
// ─────────────────────────────────────────────────────────────────────

const EXTRACT_TOOL = {
  name: "report_paper_memory_delta",
  description:
    "Extract the structured argumentative state contributed by this chapter.",
  parameters: {
    type: "object",
    properties: {
      summary: { type: "string", maxLength: 600 },
      claims: {
        type: "array",
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            claim: { type: "string", maxLength: 240 },
            stance: {
              type: "string",
              enum: ["supports_thesis", "qualifies_thesis", "opposes_thesis", "neutral"],
            },
            citationKeys: {
              type: "array",
              maxItems: 8,
              items: { type: "string", maxLength: 80 },
            },
          },
          required: ["claim", "stance"],
          additionalProperties: false,
        },
      },
      definitions: {
        type: "array",
        maxItems: 6,
        items: {
          type: "object",
          properties: {
            term: { type: "string", maxLength: 80 },
            gloss: { type: "string", maxLength: 160 },
          },
          required: ["term", "gloss"],
          additionalProperties: false,
        },
      },
      counterAddressed: {
        type: "array",
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            counter: { type: "string", maxLength: 200 },
            resolution: { type: "string", maxLength: 200 },
          },
          required: ["counter", "resolution"],
          additionalProperties: false,
        },
      },
      citedSources: {
        type: "array",
        maxItems: 20,
        items: {
          type: "object",
          properties: {
            key: { type: "string", maxLength: 120 },
            shortForm: { type: "string", maxLength: 120 },
            footnoteNumber: { type: "integer", minimum: 1 },
          },
          required: ["key", "shortForm"],
          additionalProperties: false,
        },
      },
      openQuestions: {
        type: "array",
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            question: { type: "string", maxLength: 200 },
          },
          required: ["question"],
          additionalProperties: false,
        },
      },
    },
    required: ["summary", "claims", "definitions", "counterAddressed", "citedSources", "openQuestions"],
    additionalProperties: false,
  },
} as const;

function buildExtractorSystemPrompt(): string {
  return [
    "אתה עורך אקדמי משפטי. תפקידך לדלות מתוך פרק שזה עתה נכתב מצב טיעוני מובנה,",
    "כך שפרקים עתידיים בעבודה יידעו במה לא לחזור, מה לא לסתור, ובאילו מונחים להשתמש.",
    "",
    "החזר אך ורק קריאה לכלי report_paper_memory_delta.",
    "כללים:",
    "  • claims — עד 4 טענות מרכזיות מהפרק, כל אחת ≤ 240 תווים. ציין stance ביחס לתזה.",
    "  • definitions — רק מונחים שהפרק הגדיר במפורש לראשונה. אל תכלול מונחים שגרתיים.",
    "  • counterAddressed — רק טיעוני נגד שטופלו בפועל בפרק (לא רעיונות שנזכרו בחטף).",
    "  • citedSources — מקורות שהופיעו בהערות שוליים. ה-key חייב להיות יציב (שם פס\"ד מקוצר או מחבר+שנה).",
    "  • openQuestions — שאלות שהפרק העלה אך לא סגר. אל תמציא.",
    "  • summary — פסקה אחת ≤ 600 תווים שמתארת את התרומה הטיעונית של הפרק.",
    "אם הפרק קצר או ריק — החזר מערכים ריקים ו-summary קצר. אסור להמציא תוכן שלא קיים.",
  ].join("\n");
}

export interface ExtractPaperMemoryArgs {
  chapterIndex: number;
  chapterTitle: string;
  chapterContent: string;
  thesis?: string;
  timeoutMs?: number;
}

export interface ExtractPaperMemoryOutput {
  delta: PaperMemoryDelta | null;
  run: StageRun;
}

interface ExtractorRaw {
  summary: string;
  claims: Array<{ claim: string; stance: PaperMemoryClaim["stance"]; citationKeys?: string[] }>;
  definitions: Array<{ term: string; gloss: string }>;
  counterAddressed: Array<{ counter: string; resolution: string }>;
  citedSources: Array<{ key: string; shortForm: string; footnoteNumber?: number }>;
  openQuestions: Array<{ question: string }>;
}

export async function extractPaperMemoryDelta(
  args: ExtractPaperMemoryArgs,
): Promise<ExtractPaperMemoryOutput> {
  const { chapterIndex, chapterTitle, chapterContent } = args;
  const timeoutMs = args.timeoutMs ?? 20_000;

  // Trim to keep the extractor cheap. 14k chars is enough for any realistic
  // chapter; longer text gets the first 7k + last 7k so we don't drop the
  // chapter's conclusion (where the argumentative payoff usually lives).
  let body = chapterContent || "";
  if (body.length > 14_000) {
    body = body.slice(0, 7_000) + "\n\n[...]\n\n" + body.slice(-7_000);
  }

  const userPrompt = [
    args.thesis ? `=== תזה מרכזית של העבודה ===\n${args.thesis}` : "",
    `=== פרק ${chapterIndex + 1} — ${chapterTitle} ===\n${body}`,
  ].filter(Boolean).join("\n\n");

  const res = await callPlannerJSON<ExtractorRaw>(
    buildExtractorSystemPrompt(),
    userPrompt,
    EXTRACT_TOOL,
    { stage: "paper_memory_extract", timeoutMs, reasoningEffort: "minimal" },
  );

  if (!res.data) return { delta: null, run: res.run };

  const r = res.data;
  const delta: PaperMemoryDelta = {
    chapter: chapterIndex,
    chapterTitle,
    summary: (r.summary || "").slice(0, 600),
    claims: (r.claims || []).map((c) => ({
      chapter: chapterIndex,
      chapterTitle,
      claim: c.claim,
      stance: c.stance,
      citationKeys: Array.isArray(c.citationKeys) ? c.citationKeys : [],
    })),
    definitions: (r.definitions || []).map((d) => ({
      chapter: chapterIndex,
      term: d.term,
      gloss: d.gloss,
    })),
    counterAddressed: (r.counterAddressed || []).map((k) => ({
      chapter: chapterIndex,
      counter: k.counter,
      resolution: k.resolution,
    })),
    citedSources: (r.citedSources || []).map((s) => ({
      chapter: chapterIndex,
      key: s.key,
      shortForm: s.shortForm,
      ...(s.footnoteNumber ? { footnoteNumber: s.footnoteNumber } : {}),
    })),
    openQuestions: (r.openQuestions || []).map((q) => ({
      chapter: chapterIndex,
      question: q.question,
    })),
  };

  return { delta, run: res.run };
}

// ─────────────────────────────────────────────────────────────────────
//  Coherence Critic — audit current draft against PaperMemory.
// ─────────────────────────────────────────────────────────────────────

export type CoherenceIssueKind =
  | "contradiction"
  | "repetition"
  | "terminology_drift"
  | "unresolved_counter";

export interface CoherenceIssue {
  kind: CoherenceIssueKind;
  severity: "low" | "medium" | "high";
  evidence: string;       // ≤ 240 chars — quote from current draft
  refersTo: string;       // ≤ 240 chars — which prior claim/term/counter
  fix_hint: string;       // ≤ 240 chars — actionable revision instruction
  chapterRef?: number;    // 0-based prior chapter index when known
}

export interface CoherenceCriticResult {
  verdict: "pass" | "revise";
  issues: CoherenceIssue[];
}

const COHERENCE_TOOL = {
  name: "report_coherence_audit",
  description:
    "Audit the new chapter draft against the paper memory for contradictions, repetitions, terminology drift, and unresolved counter-arguments.",
  parameters: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["pass", "revise"] },
      issues: {
        type: "array",
        maxItems: 12,
        items: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: ["contradiction", "repetition", "terminology_drift", "unresolved_counter"],
            },
            severity: { type: "string", enum: ["low", "medium", "high"] },
            evidence: { type: "string", maxLength: 240 },
            refersTo: { type: "string", maxLength: 240 },
            fix_hint: { type: "string", maxLength: 240 },
            chapterRef: { type: "integer", minimum: 0 },
          },
          required: ["kind", "severity", "evidence", "refersTo", "fix_hint"],
          additionalProperties: false,
        },
      },
    },
    required: ["verdict", "issues"],
    additionalProperties: false,
  },
} as const;

function buildCoherenceSystemPrompt(): string {
  return [
    "אתה עורך אקדמי משפטי. תפקידך לבדוק טיוטת פרק חדש מול זיכרון העבודה (Paper Memory)",
    "של כל הפרקים שכבר נכתבו, ולסמן אך ורק בעיות לכידות גלובלית.",
    "",
    "ארבעה סוגי בעיות בלבד:",
    "  1) contradiction — טענה בטיוטה סותרת טענה מפורשת מפרק קודם, ללא הצדקה מפורשת.",
    "  2) repetition — הטיוטה חוזרת על טענה/דיון שכבר הופיע ולא מוסיפה אליו.",
    "  3) terminology_drift — מונח שהוגדר בפרק קודם משמש כעת במשמעות שונה.",
    "  4) unresolved_counter — הטיוטה מעלה טיעון נגד שכבר טופל בפרק אחר, ולא מפנה אליו.",
    "",
    "כל ממצא חייב:",
    "  • evidence — ציטוט מילולי קצר מהטיוטה הנוכחית.",
    "  • refersTo — הציטוט/המונח/הטענה המקבילים מהזיכרון.",
    "  • fix_hint — הוראה פעולתית: \"מחק את X\", \"הפנה ל'לעיל בפרק 2'\", \"הסבר מדוע אתה סוטה מההגדרה\".",
    "",
    "כללים:",
    "  • אם אין בעיה אמיתית — verdict=\"pass\" עם issues=[]. אל תמציא קונפליקטים.",
    "  • repetition מקלה כאשר הפרק מסכם בקצרה לפני שמוסיף — סמן רק חזרה ארוכה ללא ערך מוסף.",
    "  • החזר אך ורק קריאה לכלי report_coherence_audit.",
  ].join("\n");
}

export interface RunCoherenceCriticArgs {
  draft: string;
  paperMemory: PaperMemory;
  chapterIndex: number;
  chapterTitle: string;
  timeoutMs?: number;
}

export interface RunCoherenceCriticOutput {
  result: CoherenceCriticResult | null;
  run: StageRun;
}

export async function runCoherenceCritic(
  args: RunCoherenceCriticArgs,
): Promise<RunCoherenceCriticOutput> {
  const { draft, paperMemory, chapterIndex, chapterTitle } = args;
  const timeoutMs = args.timeoutMs ?? 25_000;

  const fnSplitIdx = draft.search(/---\s*הערות שוליים\s*---|\*\*\s*הערות שוליים\s*\*\*/);
  const body = fnSplitIdx === -1 ? draft : draft.slice(0, fnSplitIdx);

  const memoryPayload = {
    claims: paperMemory.claims.map((c) => ({
      chapter: c.chapter,
      claim: c.claim,
      stance: c.stance,
    })),
    definitions: paperMemory.definitions.map((d) => ({
      chapter: d.chapter,
      term: d.term,
      gloss: d.gloss,
    })),
    counterAddressed: paperMemory.counterAddressed.map((k) => ({
      chapter: k.chapter,
      counter: k.counter,
      resolution: k.resolution,
    })),
    chapterSummaries: paperMemory.chapterSummaries,
  };

  const userPrompt = [
    `=== פרק חדש (${chapterIndex + 1}) — ${chapterTitle} ===\n${body.trim().slice(0, 14_000)}`,
    `\n=== זיכרון העבודה ===\n${JSON.stringify(memoryPayload, null, 0)}`,
  ].join("\n");

  const res = await callPlannerJSON<CoherenceCriticResult>(
    buildCoherenceSystemPrompt(),
    userPrompt,
    COHERENCE_TOOL,
    { stage: "coherence_critic", timeoutMs, reasoningEffort: "low" },
  );

  if (res.data) {
    res.data.issues = Array.isArray(res.data.issues) ? res.data.issues : [];
  }
  return { result: res.data, run: res.run };
}

/**
 * Decision rule: revise only on high-confidence findings. Borderline issues
 * are logged for telemetry but don't trigger another revision pass — chapters
 * already get a regular critic+revision earlier in the pipeline.
 */
export function shouldReviseForCoherence(
  result: CoherenceCriticResult | null,
): boolean {
  if (!result || result.verdict !== "revise") return false;
  const high = result.issues.filter((i) => i.severity === "high").length;
  const medium = result.issues.filter((i) => i.severity === "medium").length;
  // Contradictions are the worst class — any high-severity one triggers.
  const highContradiction = result.issues.some(
    (i) => i.kind === "contradiction" && i.severity === "high",
  );
  return highContradiction || high >= 1 || medium >= 2;
}

/**
 * Translate coherence issues into the CriticIssue shape consumed by
 * runChapterRevision, so we can reuse the existing revision pipeline.
 */
export function coherenceIssuesAsRevisionBrief(
  result: CoherenceCriticResult,
): Array<{
  kind: string;
  severity: "low" | "medium" | "high";
  evidence: string;
  fix_hint: string;
}> {
  return result.issues.map((i) => ({
    kind: `coherence_${i.kind}`,
    severity: i.severity,
    evidence: i.evidence,
    fix_hint: `${i.fix_hint}${i.refersTo ? ` (התייחס ל: ${i.refersTo})` : ""}${
      typeof i.chapterRef === "number" ? ` [פרק ${i.chapterRef + 1}]` : ""
    }`,
  }));
}
