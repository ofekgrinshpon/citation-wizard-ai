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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
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

// ─── In-process academic source search ──────────────────────────────────
// Hybrid: local legal-document corpus (text search) + Perplexity scholarship
// fallback. Mirrors the suggest_topics reality-check engine but tuned by
// the chapter profile (which source classes to include, foreign allowed,
// max sources / max foreign).



const CHAPTER_PPLX_DOMAINS_HE: string[] = [
  "nevo.co.il",
  "supreme.court.gov.il",
  "supremedecisions.court.gov.il",
  "takdin.co.il",
  "psakdin.co.il",
  "din.org.il",
  "idi.org.il",
  "law.tau.ac.il",
  "huji.ac.il",
  "biu.ac.il",
  "haifa.ac.il",
];

const CHAPTER_PPLX_DOMAINS_FOREIGN: string[] = [
  "ssrn.com",
  "papers.ssrn.com",
  "scholar.google.com",
  "jstor.org",
  "heinonline.org",
  "cambridge.org",
  "oxford.com",
  "oup.com",
  "harvardlawreview.org",
  "yalelawjournal.org",
  "law.cornell.edu",
];

async function fetchChapterSources(opts: {
  question: string;
  userId: string;
  profile: ChapterSourceProfile;
  projectId: string | null;
}): Promise<{ sources: SourceForPrompt[]; runId: string | null; errored: boolean }> {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const out: SourceForPrompt[] = [];
  let errored = false;

  // Stage 1 — local DB text search.
  try {
    // deno-lint-ignore no-explicit-any
    const { data } = await admin.rpc("search_legal_chunks_text", {
      search_query: opts.question.slice(0, 400),
      match_count: 12,
    }) as { data: any[] | null };
    if (Array.isArray(data)) {
      for (const row of data) {
        const sourceType = String(row?.source_type || "").toLowerCase();
        const isLegislation = /legislation|statute|חקיקה/.test(sourceType);
        const isCaseLaw = /case|caselaw|פסיק/.test(sourceType);
        const isScholarship = /scholar|article|book|מאמר|ספר/.test(sourceType);
        const isReport = /report|legislative_history|government/.test(sourceType);
        if (isLegislation && !opts.profile.includeLegislation) continue;
        if (isCaseLaw && !opts.profile.includeCaseLaw) continue;
        if (isScholarship && !opts.profile.includeScholarship) continue;
        if (isReport && !opts.profile.includeReports) continue;
        out.push({
          rank: out.length + 1,
          title: String(row?.document_title || ""),
          url: typeof row?.source_url === "string" ? row.source_url : null,
          source_type: String(row?.source_type || ""),
          display_citation: typeof row?.document_citation === "string" ? row.document_citation : null,
          snippet: typeof row?.chunk_content === "string" ? row.chunk_content.slice(0, 280) : null,
        });
        if (out.length >= opts.profile.maxSources) break;
      }
    }
  } catch (e) {
    console.warn("[chapterWriter] local search failed:", e instanceof Error ? e.message : e);
    errored = true;
  }

  // Stage 2 — Perplexity fallback. Triggered when local hits are sparse OR
  // the chapter explicitly asks for foreign scholarship.
  const PPLX_KEY = Deno.env.get("PERPLEXITY_API_KEY");
  const wantForeign = opts.profile.allowForeign && opts.profile.maxForeign > 0;
  const needMore = out.length < Math.max(4, Math.floor(opts.profile.maxSources / 2));
  if (PPLX_KEY && (wantForeign || needMore)) {
    try {
      const domainFilter = wantForeign
        ? [...CHAPTER_PPLX_DOMAINS_FOREIGN, ...CHAPTER_PPLX_DOMAINS_HE]
        : [...CHAPTER_PPLX_DOMAINS_HE];
      const langHint = wantForeign
        ? "Israeli + foreign academic sources (English and Hebrew)"
        : "Israeli legal sources (Hebrew)";
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 18000);
      const pRes = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${PPLX_KEY}`, "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: "sonar",
          messages: [
            {
              role: "system",
              content:
                "You find authoritative legal sources for an Israeli academic legal paper. Return STRICT JSON only.",
            },
            {
              role: "user",
              content: `Find up to 8 high-quality ${langHint} for the following chapter focus. Each source MUST be a real, citable work — statute, case, scholarly article, book, or government/committee report.\n\nFocus:\n${opts.question}\n\nReturn JSON with key "sources": array of {title, source_type (one of: legislation, caselaw, article, book, report), why_relevant}.`,
            },
          ],
          search_domain_filter: domainFilter,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "sources",
              schema: {
                type: "object",
                properties: {
                  sources: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string" },
                        source_type: { type: "string" },
                        why_relevant: { type: "string" },
                      },
                      required: ["title", "source_type"],
                    },
                  },
                },
                required: ["sources"],
              },
            },
          },
        }),
      });
      clearTimeout(timer);
      if (pRes.ok) {
        const pj = await pRes.json();
        const content = pj?.choices?.[0]?.message?.content || "";
        const citations: string[] = Array.isArray(pj?.citations) ? pj.citations : [];
        try {
          const parsed = JSON.parse(content);
          const rawSources: any[] = Array.isArray(parsed?.sources) ? parsed.sources : [];
          let added = 0;
          let foreignAdded = 0;
          for (let i = 0; i < rawSources.length; i++) {
            if (out.length >= opts.profile.maxSources) break;
            const s = rawSources[i];
            const t = String(s?.source_type || "").toLowerCase();
            const isLegislation = /legislation|statute|חקיקה/.test(t);
            const isCaseLaw = /case|caselaw|פסיק/.test(t);
            const isScholarship = /scholar|article|book|מאמר|ספר/.test(t);
            const isReport = /report|government/.test(t);
            if (isLegislation && !opts.profile.includeLegislation) continue;
            if (isCaseLaw && !opts.profile.includeCaseLaw) continue;
            if (isScholarship && !opts.profile.includeScholarship) continue;
            if (isReport && !opts.profile.includeReports) continue;
            const title = String(s?.title || "").trim();
            if (!title) continue;
            const url = citations[i] || null;
            const hebChars = (title.match(/[\u0590-\u05FF]/g) || []).length;
            const isForeign = hebChars < 3;
            if (isForeign) {
              if (!opts.profile.allowForeign) continue;
              if (foreignAdded >= opts.profile.maxForeign) continue;
              foreignAdded++;
            }
            out.push({
              rank: out.length + 1,
              title,
              url,
              source_type: String(s?.source_type || ""),
              display_citation: null,
              snippet: typeof s?.why_relevant === "string" ? s.why_relevant.slice(0, 280) : null,
            });
            added++;
          }
          if (added === 0) {
            console.log("[chapterWriter] perplexity returned 0 usable sources after profile filter");
          }
        } catch (parseErr) {
          console.warn("[chapterWriter] perplexity JSON parse failed:", parseErr instanceof Error ? parseErr.message : parseErr);
        }
      } else {
        console.warn("[chapterWriter] perplexity HTTP", pRes.status);
      }
    } catch (e) {
      console.warn("[chapterWriter] perplexity failed:", e instanceof Error ? e.message : e);
    }
  }

  return { sources: out.slice(0, opts.profile.maxSources), runId: null, errored };
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
