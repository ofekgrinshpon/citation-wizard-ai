// =========================================================================
// chapterWriter.ts — write_chapter / write_introduction / write_conclusion
// pipelines for academic writing mode.
//
// write_chapter:
//   1. Resolve flow tag + expansion from the outline.
//   2. Call legal-research-v1 in sources_only mode (service-role smoke)
//      with a chapter-tuned query → ranked source pool.
//   3. Compose the chapter system prompt (academic tone + flow-tag rules
//      + required citation pool + coherence ledger).
//   4. Stream the chapter via Lovable AI gateway, forwarding SSE events
//      to the caller (`stage`, `draft_delta`, `run_id`, `final`).
//
// write_introduction / write_conclusion:
//   No source search — synthesize from already-written body chapters.
// =========================================================================

import {
  profileForFlowTag,
  buildChapterQuery,
  parseOutlineChapters,
  extractThesis,
  findOutlineChapterByTitle,
  type ChapterSourceProfile,
} from "../_shared/chapterSourceProfile.ts";

interface SseSink {
  send: (event: string, data: unknown) => Promise<void>;
  close: () => Promise<void>;
}

interface SourceForPrompt {
  rank: number;
  title: string;
  url: string | null;
  source_type: string;
  display_citation: string | null;
  snippet?: string | null;
}

// ─── SSE writer helpers ──────────────────────────────────────────────────

export function createSseStream(): { response: Response; sink: SseSink } {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const encoder = new TextEncoder();
  let closed = false;
  const sink: SseSink = {
    send: async (event, data) => {
      if (closed) return;
      const lines = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      try {
        controller.enqueue(encoder.encode(lines));
      } catch {
        /* downstream closed */
      }
    },
    close: async () => {
      if (closed) return;
      closed = true;
      try {
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
      } catch { /* noop */ }
    },
  };
  const response = new Response(stream, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
  return { response, sink };
}

// ─── Call legal-research-v1 in sources_only mode (smoke / service-role) ──

async function fetchChapterSources(opts: {
  question: string;
  userId: string;
  profile: ChapterSourceProfile;
  projectId: string | null;
}): Promise<{ sources: SourceForPrompt[]; runId: string | null; errored: boolean }> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/legal-research-v1`;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
        "x-smoke-mode": "1",
      },
      body: JSON.stringify({
        question: opts.question,
        mode: "sources_only",
        smoke_user_id: opts.userId,
        project_id: opts.projectId,
      }),
    });
    if (!res.ok) {
      console.warn(`[chapterWriter] sources_only HTTP ${res.status}`);
      return { sources: [], runId: null, errored: true };
    }
    const payload = await res.json();
    const rawSources: any[] = Array.isArray(payload?.sources) ? payload.sources : [];

    // Profile-based filtering: caller chose what kinds to keep.
    const filtered = rawSources.filter((s) => {
      const t = String(s?.source_type || "").toLowerCase();
      const isLegislation = /legislation|statute|חקיקה|primary_statute/.test(t);
      const isCaseLaw = /case|פסיק|caselaw|binding|persuasive/.test(t);
      const isScholarship = /scholar|article|book|מאמר|ספר/.test(t);
      const isReport = /report|legislative_history|government/.test(t);
      if (isLegislation && !opts.profile.includeLegislation) return false;
      if (isCaseLaw && !opts.profile.includeCaseLaw) return false;
      if (isScholarship && !opts.profile.includeScholarship) return false;
      if (isReport && !opts.profile.includeReports) return false;
      return true;
    });

    // Foreign-language cap (titles outside Hebrew script).
    const isForeign = (s: any) => {
      const txt = `${s?.title || ""} ${s?.display_citation || ""}`;
      const hebrewChars = (txt.match(/[\u0590-\u05FF]/g) || []).length;
      return hebrewChars < 3;
    };
    if (!opts.profile.allowForeign) {
      for (let i = filtered.length - 1; i >= 0; i--) {
        if (isForeign(filtered[i])) filtered.splice(i, 1);
      }
    } else if (opts.profile.maxForeign > 0) {
      let foreignKept = 0;
      for (let i = 0; i < filtered.length; i++) {
        if (isForeign(filtered[i])) {
          foreignKept++;
          if (foreignKept > opts.profile.maxForeign) {
            filtered.splice(i, 1);
            i--;
          }
        }
      }
    }

    const trimmed = filtered.slice(0, opts.profile.maxSources).map((s, i) => ({
      rank: i + 1,
      title: String(s?.title || ""),
      url: typeof s?.url === "string" ? s.url : null,
      source_type: String(s?.source_type || ""),
      display_citation: typeof s?.display_citation === "string" ? s.display_citation : null,
      snippet: typeof s?.snippet === "string" ? s.snippet : null,
    }));

    return { sources: trimmed, runId: typeof payload?.run_id === "string" ? payload.run_id : null, errored: false };
  } catch (e) {
    console.error("[chapterWriter] sources_only call threw:", e instanceof Error ? e.message : e);
    return { sources: [], runId: null, errored: true };
  }
}

// ─── Prompt composers ───────────────────────────────────────────────────

const ACADEMIC_TONE_RULES = `כללי טון אקדמי (טיעוני):
- השתמש בפועלים טיעוניים: "פרק זה טוען", "ייטען כי", "המסקנה היא". אסור להשתמש בפועלים תיאוריים-פסיביים ("אסקור", "אבחן", "אציג").
- כל קביעה עובדתית/דוקטרינרית חייבת להיתמך במקור מתוך "מאגר המקורות לפרק זה" בלבד.
- ציין הפניות בגוף הטקסט כ-[S<rank>] (לדוגמה [S3]) ולא כהערות שוליים. אסור להמציא מקור שאינו ברשימה.
- שמור על עברית אקדמית, משפטים תחומים, פסקאות של 4-7 שורות.
- אין לכלול את כותרת הפרק בפסקה הראשונה — היא תוזרק על-ידי המערכת.`;

function flowTagGuidance(flowTag: string): string {
  if (/הדין\s+המצוי/.test(flowTag)) {
    return `מיקוד הפרק (הדין המצוי): פירוט החקיקה הרלוונטית, פסיקה מנחה ומחייבת, וההסדר הנורמטיבי הקיים. הצג את הדין כפי שהוא, לפני שתעבור לניתוח ביקורתי.`;
  }
  if (/ניתוח\s+ביקורתי|ביקורתי/.test(flowTag)) {
    return `מיקוד הפרק (ניתוח ביקורתי): בחן את הדין המצוי באמצעות עמדות מלומדים, סתירות פנימיות, וכשלים פרקטיים. הצג טיעון משלך ולא רק סקירה.`;
  }
  if (/משפט\s+משווה|השוואתי/.test(flowTag)) {
    return `מיקוד הפרק (משפט משווה): בחר 2-3 שיטות משפט זרות רלוונטיות, הצג כיצד הן מסדירות את הסוגיה, והסק לקח ישים לדין הישראלי.`;
  }
  if (/הדין\s+הראוי|נורמטיב/.test(flowTag)) {
    return `מיקוד הפרק (הדין הראוי): הצע מודל נורמטיבי חלופי, בסס אותו על דוחות ועדה וספרות מלומדים, והתמודד עם טיעוני נגד צפויים.`;
  }
  return `מיקוד הפרק: כתוב טיעון ממוקד שמשרת את שאלת המחקר ואת התזה.`;
}

function buildChapterSystemPrompt(opts: {
  researchQuestion: string;
  thesis: string;
  chapterTitle: string;
  flowTag: string;
  chapterExpansion: string;
  sources: SourceForPrompt[];
  previousChapters: Array<{ title: string; content: string }>;
  paperMemoryDeltas?: unknown[];
  footnoteOffset?: number;
}): string {
  const sourcesBlock = opts.sources.length === 0
    ? "(לא אותרו מקורות חיצוניים — כתוב את הפרק על-בסיס ידע משפטי כללי וסמן אזורים שדורשים אימות בתג ⚠️)"
    : opts.sources
        .map((s) => {
          const cit = s.display_citation || s.title || "(ללא ציטוט)";
          const url = s.url ? ` — ${s.url}` : "";
          return `[S${s.rank}] ${cit}${url}`;
        })
        .join("\n");

  const priorBlock = opts.previousChapters.length === 0
    ? "(זהו הפרק הראשון)"
    : opts.previousChapters
        .map((c) => `### ${c.title}\n${(c.content || "").slice(0, 1200)}`)
        .join("\n\n");

  const memoryBlock = Array.isArray(opts.paperMemoryDeltas) && opts.paperMemoryDeltas.length > 0
    ? `\n\n=== זיכרון מצטבר מפרקים קודמים (Paper Memory) ===\n${JSON.stringify(opts.paperMemoryDeltas).slice(0, 3000)}`
    : "";

  return `אתה חוקר משפטי אקדמי בכיר. אתה כותב פרק אחד בעבודה סמינריונית בעברית.

שאלת המחקר: ${opts.researchQuestion}
התזה: ${opts.thesis || "(לא צוינה)"}
כותרת הפרק: ${opts.chapterTitle}
תג זרימה: ${opts.flowTag || "(לא צוין)"}
הרחבה מהמתווה: ${opts.chapterExpansion || "(לא צוינה)"}

${ACADEMIC_TONE_RULES}

${flowTagGuidance(opts.flowTag)}

=== מאגר המקורות לפרק זה (השתמש רק במקורות מהרשימה הזו) ===
${sourcesBlock}

=== פרקים קודמים שכבר נכתבו (לקוהרנטיות) ===
${priorBlock}${memoryBlock}

הנחיות פלט:
- אורך מטרה: 800-1400 מילים.
- מבנה: 3-6 פסקאות גוף + פסקת סיכום קצרה שמובילה לפרק הבא.
- כל פסקה חייבת לכלול לפחות [S<rank>] אחד מהרשימה לעיל, אלא אם זו פסקת מעבר.
- אל תחזור על תוכן מפרקים קודמים — בנה עליהם.
- אל תכלול הערות שוליים, ביבליוגרפיה, או כותרת ראשית — רק את גוף הפרק.

כתוב את הפרק עכשיו.`;
}

function buildSimpleSynthesisPrompt(opts: {
  kind: "intro" | "conclusion";
  researchQuestion: string;
  previousChapters: Array<{ title: string; content: string }>;
  conclusionContent?: string;
}): string {
  if (opts.kind === "intro") {
    const conclusionBlock = opts.conclusionContent
      ? `\n\n=== הסיכום שכבר נכתב (למסגור התזה) ===\n${opts.conclusionContent.slice(0, 4000)}`
      : "";
    return `אתה חוקר משפטי אקדמי בכיר. כתוב **מבוא** לעבודה סמינריונית.

שאלת המחקר: ${opts.researchQuestion}

הנחיות:
- אורך: 500-900 מילים, 3-5 פסקאות.
- פתח בהקשר רחב, צמצם לסוגיה, נסח את שאלת המחקר ואת התזה, סקור בקצרה את מבנה העבודה.
- אל תוסיף הערות שוליים. ניתן לציין [S<rank>] רק אם המקור מופיע באחד הפרקים בהמשך.
- טון טיעוני: "במאמר ייטען כי…", "פרק 1 מבסס…", "פרק 3 מציע…".

=== פרקי הגוף שנכתבו ===
${opts.previousChapters.map((c) => `### ${c.title}\n${(c.content || "").slice(0, 1500)}`).join("\n\n")}${conclusionBlock}

כתוב את המבוא עכשיו.`;
  }
  return `אתה חוקר משפטי אקדמי בכיר. כתוב **סיכום ומסקנות** לעבודה סמינריונית.

שאלת המחקר: ${opts.researchQuestion}

הנחיות:
- אורך: 500-900 מילים, 3-4 פסקאות.
- סכם את ממצאי כל פרק בפסקה קצרה, ואז נסח את המסקנה הכוללת ואת התרומה לשיח המשפטי.
- טון טיעוני: "המאמר הראה כי…", "המסקנה היא ש…".
- אל תוסיף הערות שוליים חדשות.

=== פרקי הגוף שנכתבו ===
${opts.previousChapters.map((c) => `### ${c.title}\n${(c.content || "").slice(0, 1500)}`).join("\n\n")}

כתוב את הסיכום עכשיו.`;
}

// ─── Stream Lovable AI completion → SSE draft_delta events ──────────────

async function streamChapterToSse(opts: {
  systemPrompt: string;
  userPrompt: string;
  sink: SseSink;
  maxTokens: number;
}): Promise<{ text: string; ok: boolean; status: number }> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      stream: true,
      max_tokens: opts.maxTokens,
      messages: [
        { role: "system", content: opts.systemPrompt },
        { role: "user", content: opts.userPrompt },
      ],
    }),
  });
  if (!res.ok || !res.body) {
    return { text: "", ok: false, status: res.status };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let acc = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload);
        const delta = j.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          acc += delta;
          await opts.sink.send("draft_delta", { text: delta });
        }
      } catch { /* ignore partial */ }
    }
  }
  return { text: acc, ok: true, status: 200 };
}

// ─── Public entry point ─────────────────────────────────────────────────

export interface WriteChapterRequest {
  academicStep: "write_chapter" | "write_introduction" | "write_conclusion";
  researchQuestion: string;
  outline: string;
  chapterTitle: string;
  chapterIndex: number;
  previousChapters: Array<{ title: string; content: string }>;
  paperMemoryDeltas?: unknown[];
  footnoteOffset?: number;
  conclusionContent?: string;
  userId: string;
  projectId: string | null;
  runId: string;
}

export async function runChapterWrite(req: WriteChapterRequest): Promise<Response> {
  const { response, sink } = createSseStream();

  // Fire the pipeline asynchronously — the Response streams as events arrive.
  (async () => {
    try {
      await sink.send("run_id", { runId: req.runId });

      let sources: SourceForPrompt[] = [];
      let profile: ChapterSourceProfile | null = null;
      let outlineChapter: ReturnType<typeof findOutlineChapterByTitle> = null;
      let thesis = "";

      if (req.academicStep === "write_chapter") {
        outlineChapter = findOutlineChapterByTitle(req.outline, req.chapterTitle);
        thesis = extractThesis(req.outline);
        const flowTag = outlineChapter?.flowTag || "";
        profile = profileForFlowTag(flowTag);

        await sink.send("stage", {
          stage: "sources",
          status: "running",
          label: `מאתר מקורות לפרק (${profile.label})`,
        });

        const query = buildChapterQuery({
          researchQuestion: req.researchQuestion,
          thesis,
          chapterTitle: req.chapterTitle,
          flowTag,
          chapterExpansion: outlineChapter?.expansion || "",
        });

        const searchResult = await fetchChapterSources({
          question: query,
          userId: req.userId,
          profile,
          projectId: req.projectId,
        });
        sources = searchResult.sources;

        await sink.send("stage", {
          stage: "sources",
          status: searchResult.errored ? "warning" : "done",
          label: searchResult.errored
            ? "חיפוש המקורות נכשל — ממשיך עם בסיס ידע כללי"
            : `נמצאו ${sources.length} מקורות לפרק`,
          detail: { count: sources.length, profile: profile.kind },
        });
      }

      await sink.send("stage", {
        stage: "writing",
        status: "running",
        label:
          req.academicStep === "write_chapter"
            ? "כותב את הפרק"
            : req.academicStep === "write_introduction"
              ? "כותב את המבוא"
              : "כותב את הסיכום והמסקנות",
      });

      const systemPrompt = req.academicStep === "write_chapter"
        ? buildChapterSystemPrompt({
            researchQuestion: req.researchQuestion,
            thesis,
            chapterTitle: req.chapterTitle,
            flowTag: outlineChapter?.flowTag || "",
            chapterExpansion: outlineChapter?.expansion || "",
            sources,
            previousChapters: req.previousChapters,
            paperMemoryDeltas: req.paperMemoryDeltas,
            footnoteOffset: req.footnoteOffset,
          })
        : buildSimpleSynthesisPrompt({
            kind: req.academicStep === "write_introduction" ? "intro" : "conclusion",
            researchQuestion: req.researchQuestion,
            previousChapters: req.previousChapters,
            conclusionContent: req.conclusionContent,
          });

      const userPrompt = req.academicStep === "write_chapter"
        ? `כתוב את הפרק "${req.chapterTitle}" עכשיו.`
        : req.academicStep === "write_introduction"
          ? "כתוב את המבוא עכשיו."
          : "כתוב את הסיכום והמסקנות עכשיו.";

      const stream = await streamChapterToSse({
        systemPrompt,
        userPrompt,
        sink,
        maxTokens: req.academicStep === "write_chapter" ? 4096 : 3072,
      });

      if (!stream.ok || stream.text.trim().length < 50) {
        await sink.send("final", {
          status: 500,
          body: {
            error: stream.ok ? "התקבל פלט קצר מדי. נסו שוב." : `שגיאת AI (${stream.status}).`,
            sourcesUsed: sources,
          },
        });
        await sink.close();
        return;
      }

      await sink.send("stage", { stage: "writing", status: "done", label: "הפרק נכתב" });

      await sink.send("final", {
        status: 200,
        body: {
          answer: stream.text,
          footnotes: [],
          source_urls: sources.map((s) => s.url).filter(Boolean),
          sourcesUsed: sources,
          chapterMeta: {
            flowTag: outlineChapter?.flowTag || "",
            profile: profile?.kind || null,
            sourceCount: sources.length,
          },
        },
      });
      await sink.close();
    } catch (e) {
      console.error("[chapterWriter] pipeline threw:", e instanceof Error ? e.message : e);
      try {
        await sink.send("final", {
          status: 500,
          body: { error: "שגיאה בעיבוד הפרק. נסו שוב." },
        });
      } catch { /* noop */ }
      await sink.close();
    }
  })();

  return response;
}
