/**
 * legal-research-v2 — compact academic project context.
 *
 * FRAMING ONLY. Nothing in this block is evidence, and nothing in it may be
 * cited. A claim in the new chapter still has to survive the ordinary V2
 * verification pipeline (identity / span / support / temporal).
 *
 * The full paper is never shipped: the block is bounded by construction so the
 * Research Agent's turn context stays small no matter how long the paper gets.
 */

export interface AcademicOutlineEntry {
  index: number;
  title: string;
}

export interface AcademicChapterMemoryRef {
  title: string;
  summary: string;
  key_points: string[];
  definitions?: string[];
  cited_sources?: string[];
}

export interface AcademicKnownSource {
  source_id?: string | null;
  url?: string | null;
  authority_key?: string | null;
  citation: string;
  chapters_used_in?: string[];
}

export type AcademicChapterRoleValue = "body" | "introduction" | "conclusion" | "abstract";

export interface AcademicProjectContext {
  project_id: string | null;
  research_question: string;
  thesis?: string | null;
  outline: AcademicOutlineEntry[];
  chapter: {
    index: number;
    title: string;
    role: AcademicChapterRoleValue;
    instructions?: string | null;
    existing_text_excerpt?: string | null;
  };
  completed_chapters: AcademicChapterMemoryRef[];
  established_conclusions: string[];
  known_sources: AcademicKnownSource[];
}


/** Hard bounds — the block can never grow with the paper. */
export const CONTEXT_LIMITS = {
  outline_entries: 30,
  completed_chapters: 8,
  summary_chars: 600,
  key_points: 5,
  key_point_chars: 220,
  established_conclusions: 8,
  conclusion_chars: 220,
  known_sources: 25,
  citation_chars: 200,
  instructions_chars: 1_200,
  existing_text_chars: 1_500,
} as const;

function str(v: unknown, max: number): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function strList(v: unknown, count: number, max: number): string[] {
  return Array.isArray(v)
    ? v.map((x) => str(x, max)).filter(Boolean).slice(0, count)
    : [];
}

/** Parse + bound an untrusted client payload. Returns null when unusable. */
export function parseProjectContext(raw: unknown): AcademicProjectContext | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const chapterRaw = (r.chapter ?? {}) as Record<string, unknown>;
  const title = str(chapterRaw.title, 200);
  const research_question = str(r.research_question, 600);
  if (!title || !research_question) return null;

  const outline = Array.isArray(r.outline)
    ? r.outline
      .map((e, i) => {
        const o = (e ?? {}) as Record<string, unknown>;
        return {
          index: Number.isFinite(o.index) ? Number(o.index) : i,
          title: str(o.title, 200),
        };
      })
      .filter((e) => e.title)
      .slice(0, CONTEXT_LIMITS.outline_entries)
    : [];

  const completed_chapters = Array.isArray(r.completed_chapters)
    ? r.completed_chapters
      .map((e) => {
        const c = (e ?? {}) as Record<string, unknown>;
        return {
          title: str(c.title, 200),
          summary: str(c.summary, CONTEXT_LIMITS.summary_chars),
          key_points: strList(c.key_points, CONTEXT_LIMITS.key_points, CONTEXT_LIMITS.key_point_chars),
          definitions: strList(c.definitions, 5, 220),
          cited_sources: strList(c.cited_sources, 12, CONTEXT_LIMITS.citation_chars),
        };
      })
      .filter((c) => c.title && (c.summary || c.key_points.length))
      .slice(-CONTEXT_LIMITS.completed_chapters)
    : [];

  const known_sources = Array.isArray(r.known_sources)
    ? r.known_sources
      .map((e) => {
        const s = (e ?? {}) as Record<string, unknown>;
        return {
          source_id: str(s.source_id, 40) || null,
          url: str(s.url, 400) || null,
          authority_key: str(s.authority_key, 200) || null,
          citation: str(s.citation, CONTEXT_LIMITS.citation_chars),
          chapters_used_in: strList(s.chapters_used_in, 8, 200),
        };
      })
      .filter((s) => s.citation || s.url)
      .slice(0, CONTEXT_LIMITS.known_sources)
    : [];

  return {
    project_id: str(r.project_id, 80) || null,
    research_question,
    thesis: str(r.thesis, 600) || null,
    outline,
    chapter: {
      index: Number.isFinite(chapterRaw.index) ? Number(chapterRaw.index) : 0,
      title,
      role: chapterRaw.role === "introduction" || chapterRaw.role === "conclusion" ||
          chapterRaw.role === "abstract"
        ? chapterRaw.role
        : "body",
      instructions: str(chapterRaw.instructions, CONTEXT_LIMITS.instructions_chars) || null,
      existing_text_excerpt:
        str(chapterRaw.existing_text_excerpt, CONTEXT_LIMITS.existing_text_chars) || null,
    },

    completed_chapters,
    established_conclusions: strList(
      r.established_conclusions,
      CONTEXT_LIMITS.established_conclusions,
      CONTEXT_LIMITS.conclusion_chars,
    ),
    known_sources,
  };
}

/** The Hebrew framing block handed to the Research Agent and the drafter. */
export function buildProjectContextBlock(ctx: AcademicProjectContext): string {
  const parts: string[] = [
    "הקשר הפרויקט האקדמי — מסגרת בלבד. אין לצטט מבלוק זה, אינו ראיה, ואינו מבסס שום טענה. כל טענה בפרק חייבת להישען על מקור שהובא ונקרא בפועל ועמד באימות.",
    `שאלת המחקר של העבודה: ${ctx.research_question}`,
  ];
  if (ctx.thesis) parts.push(`טענה מרכזית של העבודה: ${ctx.thesis}`);
  if (ctx.outline.length) {
    parts.push(
      `מתווה העבודה (סדר הפרקים):\n${
        ctx.outline.map((o) => `${o.index + 1}. ${o.title}`).join("\n")
      }`,
    );
  }
  const roleHe = {
    body: "פרק גוף",
    introduction: "פרק מבוא",
    conclusion: "פרק סיכום",
    abstract: "תקציר",
  }[ctx.chapter.role];
  parts.push(
    `הפרק הנוכחי: פרק ${ctx.chapter.index + 1} — "${ctx.chapter.title}" (${roleHe}). תפקידו בעבודה נגזר ממקומו במתווה.`,
  );

  if (ctx.chapter.instructions) {
    parts.push(`הנחיות המשתמש לפרק זה: ${ctx.chapter.instructions}`);
  }
  if (ctx.completed_chapters.length) {
    parts.push(
      `פרקים שכבר נכתבו (תקצירים דחוסים בלבד — לא הטקסט המלא):\n${
        ctx.completed_chapters
          .map((c) =>
            `- ${c.title}: ${c.summary}${
              c.key_points.length ? `\n  טענות מרכזיות: ${c.key_points.join(" | ")}` : ""
            }`
          )
          .join("\n")
      }`,
    );
  }
  if (ctx.established_conclusions.length) {
    parts.push(
      `מסקנות והגדרות שכבר נקבעו בעבודה (אל תסתור אותן ואל תחזור עליהן בהרחבה):\n${
        ctx.established_conclusions.map((c) => `- ${c}`).join("\n")
      }`,
    );
  }
  if (ctx.known_sources.length) {
    parts.push(
      `מקורות שכבר שימשו בעבודה. אם מקור כזה רלוונטי לפרק הנוכחי — עדיף להשיג ולקרוא אותו שוב מאשר לחפש תחליף, אך היותו ברשימה אינו הופך אותו לראיה לטענה חדשה:\n${
        ctx.known_sources
          .map((s) => `- ${s.citation}${s.url ? ` ${s.url}` : ""}`)
          .join("\n")
      }`,
    );
  }
  if (ctx.chapter.existing_text_excerpt) {
    parts.push(
      `קטע מהנוסח הקיים של הפרק (לצורך המשכיות בלבד):\n${ctx.chapter.existing_text_excerpt}`,
    );
  }
  return parts.join("\n\n");
}
