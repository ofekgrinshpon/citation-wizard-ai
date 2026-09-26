/**
 * Academic Writing — body-chapter generation through legal-research-v2.
 *
 * Thin client layer only: it assembles the bounded project context, starts the
 * ordinary V2 beta job (same table, same credits path, same refunds) and polls
 * the same job row the research panel already polls. No research logic here.
 */

import { supabase } from "@/integrations/supabase/client";

export interface ChapterMemory {
  title: string;
  summary: string;
  key_points: string[];
  cited_sources: string[];
  footnotes_count: number;
  version: string;
}

export interface SourceRegistryEntry {
  citation: string;
  url?: string | null;
  authority_key?: string | null;
  chapters_used_in: string[];
}

/** The role a chapter plays in the paper — detected in the editor, not here. */
export type AcademicChapterRole = "body" | "introduction" | "conclusion" | "abstract";

export interface ChapterContextInput {
  projectId?: string | null;
  researchQuestion: string;
  outlineTitles: string[];
  chapterIndex: number;
  chapterTitle: string;
  chapterRole?: AcademicChapterRole;
  instructions?: string | null;
  existingText?: string | null;
  completedChapters: Array<{ title: string; memory?: ChapterMemory | null; content?: string | null }>;
  sourceRegistry: SourceRegistryEntry[];
}

const EXISTING_TEXT_CHARS = 1_500;
const FALLBACK_SUMMARY_CHARS = 600;

/** Bounded framing payload. Never the whole paper. */
export function buildProjectContext(input: ChapterContextInput) {
  return {
    project_id: input.projectId ?? null,
    research_question: input.researchQuestion,
    outline: input.outlineTitles.map((title, index) => ({ index, title })),
    chapter: {
      index: input.chapterIndex,
      title: input.chapterTitle,
      role: input.chapterRole ?? "body",
      instructions: input.instructions?.trim() || null,
      existing_text_excerpt: input.existingText?.slice(0, EXISTING_TEXT_CHARS) || null,
    },

    completed_chapters: input.completedChapters
      .filter((c) => c.memory || c.content)
      .slice(-8)
      .map((c) => ({
        title: c.title,
        summary: c.memory?.summary ??
          (c.content ?? "").replace(/\s+/g, " ").slice(0, FALLBACK_SUMMARY_CHARS),
        key_points: c.memory?.key_points ?? [],
        cited_sources: c.memory?.cited_sources ?? [],
      })),
    established_conclusions: input.completedChapters
      .flatMap((c) => c.memory?.key_points ?? [])
      .slice(0, 8),
    known_sources: input.sourceRegistry.slice(-25).map((s) => ({
      citation: s.citation,
      url: s.url ?? null,
      authority_key: s.authority_key ?? null,
      chapters_used_in: s.chapters_used_in ?? [],
    })),
  };
}

/** The chapter brief the research agent receives as the "question". */
export function buildChapterQuestion(input: {
  researchQuestion: string;
  chapterTitle: string;
  instructions?: string | null;
}): string {
  return [
    `כתוב פרק גוף בעבודה אקדמית משפטית בשם "${input.chapterTitle}".`,
    `שאלת המחקר של העבודה: ${input.researchQuestion}`,
    input.instructions?.trim()
      ? `הנחיות נוספות לפרק: ${input.instructions.trim()}`
      : "",
    "חקור את הסוגיות שהפרק נדרש להן ובסס אותן במקורות שנקראו בפועל.",
  ].filter(Boolean).join("\n");
}

export interface StartChapterJobResult {
  jobId?: string;
  error?: string;
  insufficientCredits?: boolean;
  required?: number;
}

export async function startChapterJob(input: {
  question: string;
  projectId?: string | null;
  projectContext: ReturnType<typeof buildProjectContext>;
  footnoteOffset: number;
  clientRequestId: string;
}): Promise<StartChapterJobResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return { error: "unauthenticated" };
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/legal-research-v2`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({
      mode: "academic_chapter",
      question: input.question,
      project_id: input.projectId ?? null,
      project_context: input.projectContext,
      footnote_offset: input.footnoteOffset,
      client_request_id: input.clientRequestId,
    }),
  });
  let payload: Record<string, unknown> = {};
  try { payload = await res.json(); } catch { /* ignore */ }
  if (res.status === 402) {
    return {
      insufficientCredits: true,
      required: typeof payload.required === "number" ? payload.required : undefined,
    };
  }
  if (!res.ok || typeof payload.job_id !== "string") {
    return { error: String(payload.error ?? `HTTP ${res.status}`) };
  }
  return { jobId: payload.job_id };
}

export interface ChapterJobRow {
  status: string;
  result: Record<string, unknown> | null;
  error: string | null;
  current_stage: string | null;
  progress_label_he: string | null;
  completed_stages: string[] | null;
}

export const CHAPTER_JOB_SELECT =
  "status, result, error, current_stage, progress_label_he, completed_stages";

export const CHAPTER_ACTIVE_STATUSES = ["queued", "running"];

/** Merge a finished chapter's footnotes into the project source registry. */
export function mergeRegistry(
  existing: SourceRegistryEntry[],
  chapterTitle: string,
  footnotes: Array<{ title?: string; citation?: string; url?: string | null }>,
): SourceRegistryEntry[] {
  const keyOf = (e: { url?: string | null; citation: string }) =>
    (e.url ?? "").trim().toLowerCase().replace(/[#?].*$/, "").replace(/\/+$/, "") ||
    e.citation.trim().toLowerCase();
  const byKey = new Map<string, SourceRegistryEntry>();
  for (const e of existing ?? []) {
    if (!e?.citation && !e?.url) continue;
    byKey.set(keyOf(e), { ...e, chapters_used_in: e.chapters_used_in ?? [] });
  }
  for (const f of footnotes) {
    const citation = (f.citation ?? f.title ?? "").trim();
    if (!citation && !f.url) continue;
    const entry: SourceRegistryEntry = {
      citation,
      url: f.url ?? null,
      authority_key: null,
      chapters_used_in: [],
    };
    const key = keyOf(entry);
    const prev = byKey.get(key);
    byKey.set(key, {
      ...(prev ?? entry),
      citation: prev?.citation || citation,
      url: prev?.url ?? entry.url,
      chapters_used_in: [...new Set([...(prev?.chapters_used_in ?? []), chapterTitle])].slice(0, 20),
    });
  }
  return [...byKey.values()].slice(-200);
}
