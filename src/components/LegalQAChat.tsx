import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useProjects } from "@/hooks/useProjects";
import {
  buildChapterQuestion,
  buildProjectContext,
  CHAPTER_ACTIVE_STATUSES,
  CHAPTER_JOB_SELECT,
  mergeRegistry,
  startChapterJob,
  type ChapterMemory,
  type SourceRegistryEntry,
} from "@/lib/academic/chapterJob";
import { CREDIT_COSTS } from "@/lib/creditCosts";
import { safeStorage } from "@/lib/safeStorage";

import { toast } from "sonner";
import { copyRichText } from "@/lib/clipboard";
import { Send, Copy, AlertTriangle, ExternalLink, Upload, X, FileText, Search, BookOpen, GraduationCap, BookMarked, StopCircle, Plus, Trash2, ChevronRight, ChevronLeft, Check, Lock, Wand2, Zap, Brain, type LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CaseSummaryReport } from "@/components/CaseSummaryReport";

// D3.1: ResearchProgress / StageProgressList removed (Research + chapter
// streaming engine is offline). Keep a minimal StageEvent type so the
// (now-dead) SSE consumer keeps compiling.
type StageEvent = {
  stage: string;
  status: "running" | "complete";
  label: string;
  detail?: string;
};
import { CitationReviewPanel } from "@/components/legal-qa/CitationReviewPanel";
import { MaintenanceCard } from "@/components/MaintenanceCard";
import { LegalResearchV1Panel } from "@/components/LegalResearchV1Panel";
import { LegalSourceSearchPanel } from "@/components/LegalSourceSearchPanel";
import { ReLexLogo } from "@/components/ReLexLogo";


// ─── Offline-engine guard (D1 reset) ──────────────────────────────
// Research mode and academic chapter generation (body/introduction/
// conclusion) are temporarily offline while the search engine is rebuilt.
// Short academic steps (suggest_topics / validate_question / propose_outline /
// abstract synthesis) and all other modes (case_summary,
// citation/bibliography) remain fully available.
const RESEARCH_OFFLINE_TITLE = "מצב מחקר משפטי בשדרוג";
const RESEARCH_OFFLINE_MESSAGE =
  "אנו בונים מחדש את מנוע המחקר. בינתיים ניתן להמשיך להשתמש בסיכום פסיקה, בקרת מסמכים, אזכור אחיד, ביבליוגרפיה ובשלבים המקדימים של הכתיבה האקדמית.";
const CHAPTER_OFFLINE_TITLE = "כתיבת פרקים בשדרוג";
const CHAPTER_OFFLINE_MESSAGE =
  "כתיבת פרקי גוף, מבוא וסיכום מושבתת זמנית. אישור שאלת מחקר, הצעת נושאים, בניית מתווה וייצור התקציר זמינים כרגיל.";


// ─── Chapter role helpers ──────────────────────────────────────────
// Three special chapters in addition to body: abstract, introduction, conclusion.
// They are GENERATED LATE (after body chapters) but DISPLAYED in this fixed
// order: תקציר → מבוא → bodies → סיכום ומסקנות.
//   - conclusion unlocks once every body chapter has content
//   - introduction unlocks once the conclusion has content
//   - abstract unlocks once intro + conclusion + every body chapter has content
const ABSTRACT_LOCKED_TOOLTIP = "ניתן לייצר תקציר רק לאחר השלמת כל פרקי העבודה (כולל מבוא וסיכום), כדי שהוא ישקף את המחקר במלואו";
const CONCLUSION_LOCKED_TOOLTIP = "ניתן לכתוב את הסיכום רק לאחר השלמת פרקי הגוף, כך שהוא מבוסס על הניתוח בפועל ולא על המתווה בלבד";
const INTRODUCTION_LOCKED_TOOLTIP = "ניתן לכתוב את המבוא רק לאחר כתיבת פרקי הגוף והסיכום, כדי שהמבוא ימסגר את התזה כפי שהיא עולה מהעבודה בפועל";

function isAbstractChapter(title: string): boolean {
  if (!title) return false;
  const t = title.trim().toLowerCase();
  return t === "תקציר" || t === "abstract" || t.startsWith("תקציר") || t.startsWith("abstract");
}
function isIntroductionChapter(title: string): boolean {
  if (!title) return false;
  const t = title.trim().toLowerCase();
  return t === "מבוא" || t === "introduction" || t.startsWith("מבוא") || t.startsWith("introduction");
}
function isConclusionChapter(title: string): boolean {
  if (!title) return false;
  const t = title.trim();
  // Hebrew: סיכום / מסקנות / סיכום ומסקנות; English: conclusion.
  // Note: JS regex \b does not work with Hebrew letters (treated as non-word),
  // so we match by prefix/equality instead of using a word boundary.
  if (
    t === "סיכום" ||
    t === "מסקנות" ||
    t === "סיכום ומסקנות" ||
    t.startsWith("סיכום ומסקנות") ||
    t.startsWith("סיכום ") ||
    t.startsWith("מסקנות ")
  ) {
    return true;
  }
  const lower = t.toLowerCase();
  return lower === "conclusion" || lower.startsWith("conclusion");
}
type ChapterRole = "abstract" | "introduction" | "conclusion" | "body";
function chapterRole(title: string): ChapterRole {
  if (isAbstractChapter(title)) return "abstract";
  if (isIntroductionChapter(title)) return "introduction";
  if (isConclusionChapter(title)) return "conclusion";
  return "body";
}
import * as pdfjsLib from "pdfjs-dist";

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

// ─── Types ───────────────────────────────────────────────────────────

interface Footnote {
  number: number;
  citation: string;
  source_type: string;
  url?: string;
  source?: "local" | "perplexity" | "document";
}

interface QAResult {
  answer: string;
  footnotes: Footnote[];
  source_urls: string[];
  refusal?: boolean;
  message?: string;
  case_summary?: boolean;
  verified_source?: "user" | "local" | "external" | "none";
  dropped_footnotes_count?: number;
  paper_memory_delta?: unknown;
  footnotes_count?: number;
  footnote_offset_applied?: number;
  coherence_audit?: {
    verdict: "pass" | "revise";
    issues_count: number;
    revised: boolean;
  } | null;
  case_metadata?: {
    title?: string | null;
    citation?: string | null;
    court?: string | null;
    decision_date?: string | null;
    case_number?: string | null;
    parties?: string | null;
    year?: string | null;
    source_url?: string | null;
  };
  topicCoverage?: {
    queries: string[];
    localHits: number;
    externalHits: number;
    sources: Array<{ title: string; source_type: string; origin: "local" | "external"; url?: string }>;
    minCoverageReached: boolean;
    pplxCalled?: boolean;
    pplxDurationMs?: number;
    totalDurationMs?: number;
  };
  noCoverage?: boolean;
}

type TaskMode = "research" | "legal_source_search" | "case_summary" | "academic_writing";

const FILE_RELEVANT_MODES: TaskMode[] = ["case_summary", "academic_writing"];

const TASK_MODES: { id: TaskMode; label: string; description: string; placeholder: string; icon: LucideIcon }[] = [
  { id: "research", label: "מחקר משפטי", description: "סריקה מקיפה עם מסגרת נורמטיבית מלאה", placeholder: "תארו שאלה משפטית לסקירה מקיפה...", icon: Search },
  { id: "legal_source_search", label: "חיפוש מקורות", description: "חיפוש מקורות אקדמיים למחקר משפטי", placeholder: "הזן שאלה משפטית או נושא למחקר…", icon: BookMarked },
  { id: "case_summary", label: "סיכום פסיקה", description: "תמצית: עובדות, שאלה משפטית, הכרעה ורציו", placeholder: "הזינו שם פסק דין או הדביקו טקסט לסיכום...", icon: BookOpen },
  { id: "academic_writing", label: "כתיבה אקדמית", description: "ליווי בכתיבת סמינריונים ומאמרים אקדמיים בשלבים", placeholder: "תארו נושא מחקר או שאלת מחקר...", icon: GraduationCap },
];

const DAVID_FONT = "David, 'David Libre', serif";
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_DOC_TEXT = 30000;

// ─── Academic wizard types ──────────────────────────────────────────

type WizardStep = "init" | "topic_or_question" | "outline" | "writing" | "checkpoint" | "done";

interface ChapterData {
  title: string;
  content: string | null;
  /** Global Paper Coherence: compact ledger extracted from this chapter
   *  after it was finalized. Re-shipped on subsequent write_chapter calls
   *  so the model is primed with prior claims/definitions/citations. */
  paperMemoryDelta?: unknown;
  /** Continuous footnote numbering: number of footnotes emitted by this
   *  chapter. Summed across earlier chapters (display order) to compute
   *  the next chapter's footnoteOffset. */
  footnotesCount?: number;
  /** Saved per chapter so the full-paper copy can re-emit the
   *  combined "הערות שוליים" section. Backend already uses continuous
   *  global numbering across chapters. */
  footnotes?: Footnote[];
  /** Compact, deterministic memory of this chapter (V2 body-chapter writes). */
  chapterMemory?: ChapterMemory | null;
}

interface AcademicSession {
  wizardStep: WizardStep;
  maxReachedStep: WizardStep;
  currentChapter: number;
  chapters: ChapterData[];
  researchQuestion: string;
  outline: string;
  proposedQuestions?: string[];
  lastAcademicAction?: string | null;
  /** Minimal project-level registry of sources already used in the paper. */
  sourceRegistry?: SourceRegistryEntry[];
}

/** Parse 3 proposed research questions from AI text.
 * Primary format: lines starting with "**שאלה N:** <question>" (sub-bullets ignored).
 * Fallback: legacy numbered list "1. ... 2. ... 3. ...".
 */
function parseProposedQuestions(text: string): string[] {
  if (!text) return [];
  const lines = text.split("\n");

  // Primary: look for "שאלה N:" markers (with optional ** bold)
  const questionRegex = /^\*{0,2}\s*שאלה\s+(\d+)\s*[:.\-–]\s*\*{0,2}\s*(.*)$/;
  const primary: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    const m = line.match(questionRegex);
    if (m) {
      const q = m[2].replace(/\*\*/g, "").replace(/__/g, "").trim();
      if (q.length > 0) primary.push(q);
    }
  }
  if (primary.length >= 2) {
    return primary
      .map(s => s.replace(/\*\*/g, "").trim())
      .filter(s => s.length > 5)
      .slice(0, 3);
  }

  // Fallback: legacy numbered list (1. ... 2. ... 3. ...)
  const items: string[] = [];
  let current = "";
  for (const raw of lines) {
    const line = raw.trim();
    const m = line.match(/^(\d+)[.)]\s*(.+)$/);
    if (m) {
      if (current) items.push(current.trim());
      current = m[2];
    } else if (current && line) {
      current += " " + line;
    } else if (!line && current) {
      items.push(current.trim());
      current = "";
    }
  }
  if (current) items.push(current.trim());
  return items
    .map(s => s.replace(/\*\*/g, "").replace(/__/g, "").trim())
    .filter(s => s.length > 5)
    .slice(0, 3);
}

const WIZARD_STEP_ORDER: WizardStep[] = ["init", "topic_or_question", "outline", "writing", "checkpoint", "done"];

function stepIndex(step: WizardStep): number {
  return WIZARD_STEP_ORDER.indexOf(step);
}

function isStepAfter(a: WizardStep, b: WizardStep): boolean {
  return stepIndex(a) > stepIndex(b);
}

const ACADEMIC_SESSION_KEY = (projectId?: string) => 
  projectId ? `relex_academic_session_${projectId}` : "relex_academic_session";

function loadAcademicSession(projectId?: string): AcademicSession | null {
  try {
    const raw = safeStorage.getItem(ACADEMIC_SESSION_KEY(projectId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveAcademicSession(session: AcademicSession, projectId?: string) {
  try {
    safeStorage.setItem(ACADEMIC_SESSION_KEY(projectId), JSON.stringify(session));
  } catch { /* silent */ }
}

function clearAcademicSession(projectId?: string) {
  try {
    safeStorage.removeItem(ACADEMIC_SESSION_KEY(projectId));
  } catch { /* silent */ }
}

// D3.1: Deep research marker helpers removed. Research is offline; the
// async polling path against legal-qa-status no longer exists. We still
// proactively wipe any stale `relex_research_run_*` key from older sessions
// on mount (see clearStaleResearchMarkers below) so users do not poll a
// deleted endpoint.
const RESEARCH_RUN_KEY_PREFIX = "relex_research_run";

function clearStaleResearchMarkers() {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(RESEARCH_RUN_KEY_PREFIX)) keysToRemove.push(k);
    }
    keysToRemove.forEach((k) => safeStorage.removeItem(k));
  } catch { /* silent */ }
}

// ─── DB-backed academic session sync ───────────────────────────────
// Persists wizard state to academic_sessions table so users can resume
// from any browser/device, not just the one that wrote localStorage.

async function loadAcademicSessionFromDB(projectId?: string): Promise<AcademicSession | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    let q = supabase
      .from("academic_sessions")
      .select("*")
      .eq("user_id", user.id);
    q = projectId ? q.eq("project_id", projectId) : q.is("project_id", null);
    const { data, error } = await q.maybeSingle();
    if (error || !data) return null;
    return {
      wizardStep: data.wizard_step as WizardStep,
      maxReachedStep: data.max_reached_step as WizardStep,
      currentChapter: data.current_chapter ?? 0,
      chapters: (data.chapters as unknown as ChapterData[]) || [],
      researchQuestion: data.research_question || "",
      outline: data.outline || "",
      proposedQuestions: (data.proposed_questions as unknown as string[]) || [],
      lastAcademicAction: data.last_academic_action || null,
      sourceRegistry: ((data as Record<string, unknown>).source_registry as SourceRegistryEntry[]) || [],
    };
  } catch { return null; }
}

async function saveAcademicSessionToDB(session: AcademicSession, projectId?: string): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const payload = {
      user_id: user.id,
      project_id: projectId ?? null,
      wizard_step: session.wizardStep,
      max_reached_step: session.maxReachedStep,
      current_chapter: session.currentChapter,
      chapters: session.chapters as unknown as any,
      research_question: session.researchQuestion,
      outline: session.outline,
      proposed_questions: (session.proposedQuestions || []) as unknown as any,
      last_academic_action: session.lastAcademicAction ?? null,
      source_registry: (session.sourceRegistry || []) as unknown as any,
    };
    // Upsert by (user_id, project_id) — matches the unique index that treats NULL project as a single slot.
    let q = supabase.from("academic_sessions").select("id").eq("user_id", user.id);
    q = projectId ? q.eq("project_id", projectId) : q.is("project_id", null);
    const { data: existing } = await q.maybeSingle();
    if (existing?.id) {
      await supabase.from("academic_sessions").update(payload).eq("id", existing.id);
    } else {
      await supabase.from("academic_sessions").insert(payload);
    }
  } catch { /* silent */ }
}

// ─── In-progress academic run markers ──────────────────────────────
// These three columns on academic_sessions let the client recover the result
// of a chapter generation that finished while the user was on another page
// (or even on a different device). See plan: Option 2 — server-side
// completion + resume on remount.

async function setAcademicRunMarker(
  projectId: string | undefined,
  marker: { runId: string; step: string; chapterIdx: number } | null,
): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const payload = {
      current_run_id: marker?.runId ?? null,
      current_run_step: marker?.step ?? null,
      current_run_chapter_idx: marker?.chapterIdx ?? null,
    };
    let q = supabase.from("academic_sessions").update(payload).eq("user_id", user.id);
    q = projectId ? q.eq("project_id", projectId) : q.is("project_id", null);
    await q;
  } catch { /* silent */ }
}

async function loadAcademicRunMarker(
  projectId: string | undefined,
): Promise<{ runId: string; step: string; chapterIdx: number } | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    let q = supabase
      .from("academic_sessions")
      .select("current_run_id, current_run_step, current_run_chapter_idx")
      .eq("user_id", user.id);
    q = projectId ? q.eq("project_id", projectId) : q.is("project_id", null);
    const { data } = await q.maybeSingle();
    if (!data?.current_run_id) return null;
    return {
      runId: data.current_run_id as string,
      step: (data.current_run_step as string) ?? "write_chapter",
      chapterIdx: (data.current_run_chapter_idx as number) ?? 0,
    };
  } catch { return null; }
}




// ─── Utility components ──────────────────────────────────────────────

function superscriptToNumber(s: string): number | null {
  const map: Record<string, string> = {
    "\u2070": "0", "\u00B9": "1", "\u00B2": "2", "\u00B3": "3",
    "\u2074": "4", "\u2075": "5", "\u2076": "6",
    "\u2077": "7", "\u2078": "8", "\u2079": "9",
  };
  let num = "";
  for (const c of s) {
    if (map[c]) num += map[c];
    else return null;
  }
  return num ? parseInt(num, 10) : null;
}

function AnswerWithFootnotes({ text, onFootnoteClick }: { text: string; onFootnoteClick: (n: number) => void }) {
  const parts = text.split(/([\u2070\u00B9\u00B2\u00B3\u2074-\u2079]+|\[\d{1,2}\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const bracketMatch = part.match(/^\[(\d{1,2})\]$/);
        const num = superscriptToNumber(part) ?? (bracketMatch ? parseInt(bracketMatch[1], 10) : null);
        if (num !== null) {
          return (
            <sup
              key={i}
              className="text-primary cursor-pointer hover:underline font-bold"
              style={{ fontSize: "10px" }}
              onClick={() => onFootnoteClick(num)}
            >
              {bracketMatch ? num : part}
            </sup>
          );
        }
        return <RenderMarkdown key={i} text={part} />;
      })}
    </>
  );
}

function RenderMarkdownLine({ line }: { line?: string | null }) {
  const safe = typeof line === "string" ? line : "";
  const headingMatch = safe.match(/^(#{1,4})\s+(.*)/);
  if (headingMatch) {
    const level = headingMatch[1].length;
    const content = headingMatch[2];
    const className = level <= 2 ? "text-base font-bold" : "text-sm font-semibold";
    return <div className={className}><RenderBold text={content} /></div>;
  }
  return <RenderBold text={safe} />;
}

function RenderBold({ text }: { text?: string | null }) {
  const safe = typeof text === "string" ? text : "";
  const parts = safe.split(/\*\*(.*?)\*\*/g);
  return (
    <>
      {parts.map((segment, i) =>
        i % 2 === 1 ? <strong key={i}>{segment}</strong> : <span key={i}>{segment}</span>
      )}
    </>
  );
}

function RenderMarkdown({ text }: { text?: string | null }) {
  const safe = typeof text === "string" ? text : "";
  const lines = safe.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <span key={i}>
          {i > 0 && <br />}
          <RenderMarkdownLine line={line} />
        </span>
      ))}
    </>
  );
}

// ─── Outline parsing & report rendering ───────────────────────────────

interface ParsedOutline {
  intro: Record<string, string>;
  chapters: Array<{ title: string; flowTag: string; expansion: string; counter: string }>;
  conclusion: Record<string, string>;
}

function parseOutline(text: string): ParsedOutline | null {
  if (!text) return null;
  if (!/\*\*מבוא\*\*/.test(text) || !/\*\*רשימת הפרקים\*\*/.test(text) || !/\*\*סיכום ומסקנות/.test(text)) {
    return null;
  }
  const introMatch = text.match(/\*\*מבוא\*\*([\s\S]*?)\*\*רשימת הפרקים\*\*/);
  const chaptersMatch = text.match(/\*\*רשימת הפרקים\*\*([\s\S]*?)\*\*סיכום ומסקנות/);
  const conclusionMatch = text.match(/\*\*סיכום ומסקנות[^\*]*\*\*([\s\S]*)$/);
  if (!introMatch || !chaptersMatch || !conclusionMatch) return null;

  const parseLabelled = (block: string): Record<string, string> => {
    const out: Record<string, string> = {};
    const lines = block.split("\n");
    let currentLabel: string | null = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(/^[-•]\s*([^:]+?):\s*(.*)$/);
      if (m) {
        currentLabel = m[1].trim();
        out[currentLabel] = m[2].trim();
      } else if (currentLabel) {
        out[currentLabel] += " " + line.replace(/^[-•]\s*/, "");
      }
    }
    return out;
  };

  const chaptersBlock = chaptersMatch[1];
  const chapterLines = chaptersBlock.split("\n");
  const chapters: ParsedOutline["chapters"] = [];
  let cur: { title: string; flowTag: string; expansion: string; counter: string } | null = null;
  for (const raw of chapterLines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    const headerMatch = line.match(/^\d+\.\s+\*\*(.+?)\*\*(?:\s*[–\-—]\s*(.+))?$/);
    if (headerMatch) {
      if (cur) chapters.push(cur);
      cur = { title: headerMatch[1].trim(), flowTag: (headerMatch[2] || "").trim(), expansion: "", counter: "" };
      continue;
    }
    if (!cur) continue;
    const expMatch = line.match(/^\s*[-•]\s*הרחבה\s*:\s*(.*)$/);
    if (expMatch) { cur.expansion = expMatch[1].trim(); continue; }
    const counterMatch = line.match(/^\s*[-•]\s*טיעוני נגד[^:]*:\s*(.*)$/);
    if (counterMatch) { cur.counter = counterMatch[1].trim(); continue; }
    if (/^\s+/.test(raw) && cur) {
      if (cur.counter) cur.counter += " " + line.trim();
      else if (cur.expansion) cur.expansion += " " + line.trim();
    }
  }
  if (cur) chapters.push(cur);
  if (chapters.length === 0) return null;

  return {
    intro: parseLabelled(introMatch[1]),
    chapters,
    conclusion: parseLabelled(conclusionMatch[1]),
  };
}

function FlowTagPill({ tag }: { tag: string }) {
  if (!tag) return null;
  let cls = "bg-muted text-muted-foreground border-border";
  if (/מצוי/.test(tag)) cls = "bg-primary/10 text-primary border-primary/30";
  else if (/ביקורתי|השוואתי|משווה/.test(tag)) cls = "bg-accent/10 text-accent-foreground border-accent/30";
  else if (/ראוי/.test(tag)) cls = "bg-secondary/40 text-secondary-foreground border-secondary";
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium border ${cls}`}>
      {tag}
    </span>
  );
}

// ─── Inline editor for the body-chapter list (rename / reorder / add / delete)
// Special chapters (תקציר, מבוא, סיכום) are not editable: they are always
// force-injected by approveOutline() in the canonical display order.
function OutlineChapterEditor({
  initialTitles,
  onConfirm,
  onCancel,
}: {
  initialTitles: string[];
  onConfirm: (titles: string[]) => void;
  onCancel: () => void;
}) {
  const [titles, setTitles] = useState<string[]>(initialTitles.length > 0 ? initialTitles : [""]);

  const move = (idx: number, delta: -1 | 1) => {
    const j = idx + delta;
    if (j < 0 || j >= titles.length) return;
    const next = [...titles];
    [next[idx], next[j]] = [next[j], next[idx]];
    setTitles(next);
  };
  const rename = (idx: number, value: string) => {
    const next = [...titles];
    next[idx] = value;
    setTitles(next);
  };
  const remove = (idx: number) => {
    if (titles.length <= 1) {
      toast.info("חייב להישאר לפחות פרק גוף אחד");
      return;
    }
    setTitles(titles.filter((_, i) => i !== idx));
  };
  const add = () => setTitles([...titles, ""]);

  const handleConfirm = () => {
    const cleaned = titles.map(t => t.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      toast.error("הוסיפו לפחות פרק גוף אחד");
      return;
    }
    // Strip any user-typed special chapter names — those are auto-injected.
    const bodyOnly = cleaned.filter(t => chapterRole(t) === "body");
    if (bodyOnly.length === 0) {
      toast.error("שמות הפרקים שהוזנו זוהו כפרקים מיוחדים (מבוא/סיכום/תקציר). הוסיפו פרקי גוף.");
      return;
    }
    onConfirm(bodyOnly);
  };

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardContent className="p-4 space-y-3">
        <div>
          <h3 className="font-bold text-foreground text-sm">עריכת רשימת הפרקים</h3>
          <p className="text-xs text-muted-foreground mt-1">
            ניתן לשנות שמות, לסדר מחדש, להוסיף או למחוק פרקי גוף. פרקי "תקציר", "מבוא" ו"סיכום ומסקנות" יתווספו אוטומטית בסדר הקנוני.
          </p>
        </div>
        <ol className="space-y-2">
          {titles.map((title, idx) => (
            <li key={idx} className="flex items-center gap-1.5 rounded-lg border border-border bg-background p-2">
              <span className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                {idx + 1}
              </span>
              <input
                type="text"
                value={title}
                onChange={(e) => rename(idx, e.target.value)}
                placeholder="שם הפרק"
                className="flex-1 min-w-0 rounded border border-border bg-background px-2 py-1 text-sm"
                dir="rtl"
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => move(idx, -1)}
                disabled={idx === 0}
                aria-label="העבר למעלה"
              >
                <ChevronRight className="w-4 h-4 rotate-90" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => move(idx, 1)}
                disabled={idx === titles.length - 1}
                aria-label="העבר למטה"
              >
                <ChevronLeft className="w-4 h-4 rotate-90" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                onClick={() => remove(idx)}
                aria-label="מחק פרק"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </li>
          ))}
        </ol>
        <Button variant="outline" size="sm" onClick={add} className="gap-1">
          <Plus className="w-3.5 h-3.5" />
          הוסף פרק
        </Button>
        <div className="flex gap-2 pt-2 border-t border-border">
          <Button size="sm" onClick={handleConfirm}>אשר ועבור לכתיבה</Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>ביטול</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function OutlineReport({
  answer,
  researchQuestion,
  onApprove,
  onApproveEdited,
  onBack,
}: {
  answer: string;
  researchQuestion: string;
  onApprove: () => void;
  onApproveEdited: (editedBodyTitles: string[]) => void;
  onBack: () => void;
}) {
  const parsed = parseOutline(answer);
  const [isEditing, setIsEditing] = useState(false);

  if (!parsed) {
    return (
      <Card className="border-border">
        <CardContent className="p-4 space-y-3">
          <h3 className="font-bold text-foreground">מתווה מוצע</h3>
          <div className="text-foreground text-sm leading-relaxed whitespace-pre-wrap" style={{ lineHeight: 1.8 }}>
            <RenderMarkdown text={answer} />
          </div>
          <div className="flex gap-2 pt-2">
            <Button size="sm" onClick={onApprove}>אשר מתווה והתחל כתיבה</Button>
            <Button variant="ghost" size="sm" onClick={onBack}>חזרה לעריכה</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Extract body chapter titles from the parsed outline for the editor.
  const parsedBodyTitles = parsed.chapters
    .map(c => c.title.trim())
    .filter(t => t && chapterRole(t) === "body");

  const introOrder = ["שאלת המחקר", "התזה המרכזית (Thesis)", "חשיבות ותרומה לשיח המשפטי", "קו הטיעון (Line of Argument)", "מבנה העבודה"];
  const conclusionOrder = ["מסקנה משוערת", "תרומה משפטית"];

  return (
    <div className="space-y-3">
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-primary uppercase tracking-wide">הצעת מחקר אקדמית</span>
          </div>
          <h2 className="text-base font-bold text-foreground">מתווה לעבודה סמינריונית</h2>
          {researchQuestion && (
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
              <span className="font-semibold text-foreground">שאלת המחקר: </span>
              {researchQuestion}
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardContent className="p-4 space-y-2">
          <h3 className="font-bold text-foreground text-sm border-b border-border pb-1.5 mb-2">מבוא</h3>
          {introOrder.map(label => {
            // Deterministically lock "שאלת המחקר" inside the intro card to the
            // canonical research question prop, regardless of what the model
            // wrote in the outline (it sometimes shortens it to just the topic).
            const value = label === "שאלת המחקר" && researchQuestion
              ? researchQuestion
              : parsed.intro[label];
            if (!value) return null;
            return (
              <div key={label} className="text-sm leading-relaxed">
                <span className="font-semibold text-foreground">{label}: </span>
                <span className="text-foreground/90">{value}</span>
              </div>
            );
          })}
          {Object.entries(parsed.intro)
            .filter(([k]) => !introOrder.includes(k))
            .map(([k, v]) => (
              <div key={k} className="text-sm leading-relaxed">
                <span className="font-semibold text-foreground">{k}: </span>
                <span className="text-foreground/90">{v}</span>
              </div>
            ))}
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardContent className="p-4 space-y-2">
          <h3 className="font-bold text-foreground text-sm border-b border-border pb-1.5 mb-2">רשימת הפרקים</h3>
          <ol className="space-y-2.5">
            {parsed.chapters.map((ch, idx) => (
              <li key={idx} className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-start gap-2 mb-1.5 flex-wrap">
                  <span className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                    {idx + 1}
                  </span>
                  <span className="font-semibold text-foreground text-sm flex-1 min-w-0">{ch.title}</span>
                  <FlowTagPill tag={ch.flowTag} />
                </div>
                {ch.expansion && (
                  <div className="text-sm leading-relaxed mt-1.5 pr-8">
                    <span className="font-semibold text-foreground">הרחבה: </span>
                    <span className="text-foreground/90">{ch.expansion}</span>
                  </div>
                )}
                {ch.counter && (
                  <div className="text-sm leading-relaxed mt-1 pr-8">
                    <span className="font-semibold text-foreground">טיעוני נגד אפשריים: </span>
                    <span className="text-foreground/90">{ch.counter}</span>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardContent className="p-4 space-y-2">
          <h3 className="font-bold text-foreground text-sm border-b border-border pb-1.5 mb-2">סיכום ומסקנות (משוערות)</h3>
          {conclusionOrder.map(label => {
            const value = parsed.conclusion[label];
            if (!value) return null;
            return (
              <div key={label} className="text-sm leading-relaxed">
                <span className="font-semibold text-foreground">{label}: </span>
                <span className="text-foreground/90">{value}</span>
              </div>
            );
          })}
          {Object.entries(parsed.conclusion)
            .filter(([k]) => !conclusionOrder.includes(k))
            .map(([k, v]) => (
              <div key={k} className="text-sm leading-relaxed">
                <span className="font-semibold text-foreground">{k}: </span>
                <span className="text-foreground/90">{v}</span>
              </div>
            ))}
        </CardContent>
      </Card>

      {isEditing ? (
        <OutlineChapterEditor
          initialTitles={parsedBodyTitles}
          onConfirm={(titles) => { setIsEditing(false); onApproveEdited(titles); }}
          onCancel={() => setIsEditing(false)}
        />
      ) : (
        <div className="flex gap-2 pt-1 flex-wrap">
          <Button size="sm" onClick={onApprove}>אשר מתווה והתחל כתיבה</Button>
          <Button variant="outline" size="sm" onClick={() => setIsEditing(true)} className="gap-1">
            <Wand2 className="w-3.5 h-3.5" />
            ערוך רשימת פרקים
          </Button>
          <Button variant="ghost" size="sm" onClick={onBack}>חזרה לעריכה</Button>
        </div>
      )}
    </div>
  );
}

// ─── PDF text extraction ─────────────────────────────────────────────

async function extractPdfText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages && text.length < MAX_DOC_TEXT; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item: any) => item.str).join(" ") + "\n";
  }
  return text.slice(0, MAX_DOC_TEXT);
}

async function extractDocxText(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value.slice(0, MAX_DOC_TEXT);
}

// ─── Main Component ──────────────────────────────────────────────────

interface LegalQAChatProps {
  onResultSaved?: () => void;
  externalResult?:
    | { question: string; result: QAResult; taskMode: "research" | "case_summary" | "academic_writing" }
    | { question: string; sourcesPayload: any; taskMode: "legal_source_search" }
    | { question: string; v1Payload: { answer: string; footnotes: any[] }; taskMode: "research" }
    | null;
  onConsumeExternalResult?: () => void;
  academicResumeSignal?: number;
  academicResumeFallback?: { question: string; result: QAResult } | null;
}

export function LegalQAChat({ onResultSaved, externalResult, onConsumeExternalResult, academicResumeSignal, academicResumeFallback }: LegalQAChatProps = {}) {
  const { currentProject } = useProjects();
  const projectId = currentProject?.id;

  // Stable-identity prop for LegalSourceSearchPanel. Without this, every parent
  // render produces a new object literal and re-triggers the panel's hydration
  // effect, which would re-apply a stale history result after a project switch.
  const sourceSearchExternal = useMemo(
    () =>
      externalResult && externalResult.taskMode === "legal_source_search" && "sourcesPayload" in externalResult
        ? { question: externalResult.question, payload: externalResult.sourcesPayload }
        : null,
    [externalResult],
  );

  // Stable-identity prop for LegalResearchV1Panel history replay.
  const legalResearchV1External = useMemo(
    () =>
      externalResult && "v1Payload" in externalResult
        ? { question: externalResult.question, payload: externalResult.v1Payload }
        : null,
    [externalResult],
  );

  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<QAResult | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const applyCitationReview = (next: { answer: string; footnotes: Footnote[] }) => {
    setResult((prev) =>
      prev ? { ...prev, answer: next.answer, footnotes: next.footnotes } : prev,
    );
    setReviewOpen(false);
  };
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskMode, setTaskMode] = useState<TaskMode>("research");

  // ─── Research depth (Fast / Deep) ─────────────────────────────────
  // Quality control toggle, NOT a billing decision (see modeProfiles.ts on
  // backend). Persisted per-browser so the user's preference sticks across
  // sessions. Only consumed when taskMode === "research".
  type ResearchDepth = "fast" | "deep";
  const DEPTH_STORAGE_KEY = "relex.research.depth";
  const [researchDepth, setResearchDepth] = useState<ResearchDepth>(() => {
    const stored = safeStorage.getItem(DEPTH_STORAGE_KEY);
    return stored === "deep" ? "deep" : "fast";
  });
  useEffect(() => {
    safeStorage.setItem(DEPTH_STORAGE_KEY, researchDepth);
  }, [researchDepth]);

  // Multi-file support
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [extractedTexts, setExtractedTexts] = useState<Array<{ name: string; text: string }>>([]);
  const [extracting, setExtracting] = useState(false);

  // ─── SSE streaming state (Fast/Deep research + academic write_chapter) ───
  const [stageEvents, setStageEvents] = useState<StageEvent[]>([]);
  const [postProcessingLabel, setPostProcessingLabel] = useState<string | null>(null);
  const [streamingDraft, setStreamingDraft] = useState<string>("");
  const [runComplete, setRunComplete] = useState<boolean>(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  // Tracks whether `current_run_id` was successfully persisted to
  // academic_sessions for the current in-flight academic run. Used to decide
  // whether to show a non-blocking info toast (persisted) or a blocking
  // confirm (not yet persisted) when the user tries to navigate away.
  const runPersistedRef = useRef<boolean>(false);
  const activeRunIdRef = useRef<string | null>(null);

  // ─── Academic wizard state ───────────────────────────────────────
  const [wizardStep, setWizardStep] = useState<WizardStep>("init");
  const [maxReachedStep, setMaxReachedStep] = useState<WizardStep>("init");
  const [currentChapter, setCurrentChapter] = useState(0);
  const [chapters, setChapters] = useState<ChapterData[]>([]);
  const [researchQuestion, setResearchQuestion] = useState("");
  const [outline, setOutline] = useState("");
  const [proposedQuestions, setProposedQuestions] = useState<string[]>([]);
  const [suggestionRounds, setSuggestionRounds] = useState<Array<{ questions: string[]; coverage: QAResult["topicCoverage"]; exhausted?: boolean }>>([]);
  const [regenerating, setRegenerating] = useState(false);
  const [lastAcademicAction, setLastAcademicAction] = useState<string | null>(null);
  const [sourceRegistry, setSourceRegistry] = useState<SourceRegistryEntry[]>([]);
  /** Live V2 stage label while a body chapter is being researched and written. */
  const [chapterProgressLabel, setChapterProgressLabel] = useState<string | null>(null);
  const chapterPollRef = useRef<number | null>(null);

  // Restore academic session on mount / project change (DB first, localStorage fallback)
  useEffect(() => {
    let cancelled = false;
    if (taskMode === "academic_writing") {
      (async () => {
        const dbSaved = await loadAcademicSessionFromDB(projectId);
        const saved = dbSaved && dbSaved.wizardStep !== "init"
          ? dbSaved
          : loadAcademicSession(projectId);
        if (!cancelled && saved && saved.wizardStep !== "init") {
          setWizardStep(saved.wizardStep);
          setMaxReachedStep(saved.maxReachedStep || saved.wizardStep);
          setCurrentChapter(saved.currentChapter);
          setChapters(saved.chapters);
          setResearchQuestion(saved.researchQuestion);
          setOutline(saved.outline);
          setProposedQuestions(saved.proposedQuestions || []);
          setLastAcademicAction(saved.lastAcademicAction || null);
          setSourceRegistry(saved.sourceRegistry || []);
        }
      })();
    }
    return () => { cancelled = true; };
  }, [projectId]);

  // ─── D3.1: Background academic resume removed ─────────────────────
  // Previously this effect polled legal-qa-status to recover short-academic
  // results across navigation. legal-qa-status is being deleted; short steps
  // still work in the foreground but no longer auto-resume after navigation.
  // We still clear any stale academic run marker on mount so the wizard
  // does not stay in a fake "loading" state.
  useEffect(() => {
    if (taskMode !== "academic_writing") return;
    let cancelled = false;
    (async () => {
      const marker = await loadAcademicRunMarker(projectId);
      if (cancelled || !marker) return;
      if (marker.step === "v2_chapter" && marker.runId) {
        // A body chapter kept running in the background; pick it back up.
        setLastAcademicAction("write_chapter");
        pollChapterJob(marker.runId, marker.chapterIdx ?? 0);
        return;
      }
      await setAcademicRunMarker(projectId, null);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, taskMode]);


  // ─── D3.1: Deep research resume removed ────────────────────────────
  // Research is offline. The Deep async path against legal-qa-status no
  // longer exists. On mount we wipe any stale `relex_research_run_*` key
  // so users with leftover markers from before the offline switch do not
  // poll a deleted endpoint.
  useEffect(() => {
    clearStaleResearchMarkers();
  }, []);


  // ─── Non-blocking nav warning while an academic run is streaming ───
  // Per plan: NEVER say the run will be cancelled — the backend keeps going
  // and resume-on-mount will pick it up. Just a one-shot info toast when the
  // user clicks any nav target while the chapter is still streaming.
  const navToastShownRef = useRef<boolean>(false);
  useEffect(() => {
    const isLongFormLoading =
      loading &&
      (lastAcademicAction === "write_chapter" ||
        lastAcademicAction === "write_introduction" ||
        lastAcademicAction === "write_conclusion");
    if (!isLongFormLoading) {
      navToastShownRef.current = false;
      return;
    }
    const onClick = (ev: MouseEvent) => {
      if (navToastShownRef.current) return;
      const target = (ev.target as HTMLElement | null)?.closest("a,button");
      if (!target) return;
      // Heuristic: only fire for nav-like elements (anchors with href, or
      // buttons inside the sidebar). Skip the run's own controls.
      const isAnchor = target.tagName === "A" && (target as HTMLAnchorElement).href;
      const inSidebar = !!target.closest("aside");
      if (!isAnchor && !inSidebar) return;
      navToastShownRef.current = true;
      if (runPersistedRef.current) {
        toast.info(
          "הפרק עדיין נכתב ברקע. אם תעבור עמוד, ההתקדמות החיה תיעצר כאן, אבל תוכל לחזור ולטעון את התוצאה כשהכתיבה תסתיים.",
          { duration: 8000 },
        );
      } else {
        toast.warning(
          "הפרק עדיין נכתב, וההפקה לא נשמרה עדיין לשחזור ברקע. אם תעבור עמוד עכשיו, התוצאה עלולה ללכת לאיבוד.",
          { duration: 8000 },
        );
      }
    };
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, [loading, lastAcademicAction]);


  // Save academic session after chapter writes (localStorage immediate + DB sync)
  const persistAcademicSession = useCallback(() => {
    if (taskMode !== "academic_writing" || wizardStep === "init") return;
    const session: AcademicSession = { wizardStep, maxReachedStep, currentChapter, chapters, researchQuestion, outline, proposedQuestions, lastAcademicAction, sourceRegistry };
    saveAcademicSession(session, projectId);
    // Fire-and-forget DB sync; localStorage already has the source of truth for instant reads.
    void saveAcademicSessionToDB(session, projectId);
  }, [taskMode, wizardStep, maxReachedStep, currentChapter, chapters, researchQuestion, outline, proposedQuestions, lastAcademicAction, sourceRegistry, projectId]);



  useEffect(() => {
    persistAcademicSession();
  }, [persistAcademicSession]);

  // Beforeunload guard
  useEffect(() => {
    if (taskMode !== "academic_writing" || wizardStep === "init" || wizardStep === "done") return;
    const hasContent = chapters.some(ch => ch.content);
    if (!hasContent) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [taskMode, wizardStep, chapters]);

  // Load external result from history sidebar
  useEffect(() => {
    if (!externalResult) return;
    if (externalResult.taskMode === "legal_source_search") {
      setQuestion(externalResult.question);
      setTaskMode("legal_source_search");
      return;
    }
    // legal-research-v1 history replay: the V1 panel owns its own `result`
    // state, so we only switch the UI mode and prefill the question. The
    // cached answer is forwarded via `legalResearchV1External` -> panel prop.
    // Never set `result` here (legacy QAResult shape would not match) and
    // never let this path fall through to the legacy legal-qa invoke.
    if ("v1Payload" in externalResult) {
      setQuestion(externalResult.question);
      setTaskMode("research");
      return;
    }
    setQuestion(externalResult.question);
    setResult(externalResult.result);
    setTaskMode(externalResult.taskMode);
  }, [externalResult]);

  // Resume academic session from history sidebar click (DB first, localStorage fallback)
  useEffect(() => {
    if (!academicResumeSignal) return;
    setTaskMode("academic_writing");
    (async () => {
      const dbSaved = await loadAcademicSessionFromDB(projectId);
      const saved = dbSaved && dbSaved.wizardStep !== "init"
        ? dbSaved
        : loadAcademicSession(projectId);
      if (saved && saved.wizardStep !== "init") {
        setWizardStep(saved.wizardStep);
        setMaxReachedStep(saved.maxReachedStep || saved.wizardStep);
        setChapters(saved.chapters);
        setResearchQuestion(saved.researchQuestion);
        setOutline(saved.outline);
        setProposedQuestions(saved.proposedQuestions || []);
        setLastAcademicAction(saved.lastAcademicAction || null);
        setSourceRegistry(saved.sourceRegistry || []);

        // Land on the last chapter with content (or first without — whichever is further)
        const chs = saved.chapters || [];
        let landIdx = saved.currentChapter || 0;
        const lastWritten = (() => {
          for (let i = chs.length - 1; i >= 0; i--) if (chs[i]?.content) return i;
          return -1;
        })();
        const firstEmpty = chs.findIndex(c => !c?.content);
        const candidate = Math.max(landIdx, lastWritten, firstEmpty === -1 ? landIdx : firstEmpty);
        landIdx = Math.min(Math.max(candidate, 0), Math.max(chs.length - 1, 0));
        setCurrentChapter(landIdx);

        setResult(null);
        setError(null);
        setQuestion("");
        const title = chs[landIdx]?.title || "";
        toast.success(title ? `חזרת לעבודה האקדמית — פרק נוכחי: ${title}` : "חזרת לעבודה האקדמית");
      } else if (academicResumeFallback) {
        toast.info("לא נמצאה התקדמות שמורה לפרויקט זה. ההיסטוריה מציגה רק תוצאות פרקים קודמים.");
        setQuestion(academicResumeFallback.question);
        setResult(academicResumeFallback.result);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [academicResumeSignal]);


  useEffect(() => {
    if (result) scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [result]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
    }
  }, [question]);

  // Multi-file extraction
  const handleFileSelect = useCallback(async (files: FileList | File[]) => {
    const fileArr = Array.from(files);
    const validFiles: File[] = [];
    for (const file of fileArr) {
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`"${file.name}" גדול מדי. מקסימום 20MB.`);
        continue;
      }
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (!["pdf", "docx"].includes(ext || "")) {
        toast.error(`"${file.name}" — יש להעלות PDF או DOCX בלבד.`);
        continue;
      }
      validFiles.push(file);
    }
    if (validFiles.length === 0) return;

    setUploadedFiles(prev => [...prev, ...validFiles]);
    setExtracting(true);
    try {
      const newTexts: Array<{ name: string; text: string }> = [];
      await Promise.all(validFiles.map(async (file) => {
        const ext = file.name.split(".").pop()?.toLowerCase();
        const text = ext === "pdf" ? await extractPdfText(file) : await extractDocxText(file);
        newTexts.push({ name: file.name, text });
      }));
      setExtractedTexts(prev => [...prev, ...newTexts]);
      toast.success(`${validFiles.length} קבצים נטענו בהצלחה`);
    } catch (e) {
      console.error("File extraction error:", e);
      toast.error("שגיאה בחילוץ טקסט מקבצים.");
    } finally {
      setExtracting(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files);
  }, [handleFileSelect]);

  const isFileRelevantMode = FILE_RELEVANT_MODES.includes(taskMode);

  const handleModeChange = useCallback((value: string) => {
    if (!value) return;
    const newMode = value as TaskMode;

    // Warn if switching away from academic_writing with progress
    if (taskMode === "academic_writing" && newMode !== "academic_writing" && wizardStep !== "init" && chapters.some(ch => ch.content)) {
      if (!window.confirm("יש לך עבודה אקדמית בתהליך. בטוח שברצונך לעבור מצב?")) return;
    }

    setTaskMode(newMode);

    // Restore wizard state when switching to academic mode (DB first, localStorage fallback)
    if (newMode === "academic_writing") {
      const localSaved = loadAcademicSession(projectId);
      // Apply localStorage immediately so the user sees something fast.
      if (localSaved && localSaved.wizardStep !== "init") {
        setWizardStep(localSaved.wizardStep);
        setMaxReachedStep(localSaved.maxReachedStep || localSaved.wizardStep);
        setCurrentChapter(localSaved.currentChapter);
        setChapters(localSaved.chapters);
        setResearchQuestion(localSaved.researchQuestion);
        setOutline(localSaved.outline);
        setProposedQuestions(localSaved.proposedQuestions || []);
        setLastAcademicAction(localSaved.lastAcademicAction || null);
      } else {
        setWizardStep("init");
        setMaxReachedStep("init");
        setCurrentChapter(0);
        setChapters([]);
        setResearchQuestion("");
        setOutline("");
        setProposedQuestions([]);
        setLastAcademicAction(null);
      }
      // Then upgrade with DB state if it has more progress (cross-device sync).
      (async () => {
        const dbSaved = await loadAcademicSessionFromDB(projectId);
        if (dbSaved && dbSaved.wizardStep !== "init") {
          setWizardStep(dbSaved.wizardStep);
          setMaxReachedStep(dbSaved.maxReachedStep || dbSaved.wizardStep);
          setCurrentChapter(dbSaved.currentChapter);
          setChapters(dbSaved.chapters);
          setResearchQuestion(dbSaved.researchQuestion);
          setOutline(dbSaved.outline);
          setProposedQuestions(dbSaved.proposedQuestions || []);
          setLastAcademicAction(dbSaved.lastAcademicAction || null);
        }
      })();
      setResult(null);
    }

    if (uploadedFiles.length > 0 && !FILE_RELEVANT_MODES.includes(newMode)) {
      toast.warning("שימו לב: הקבצים שהועלו עדיין מצורפים.", {
        action: { label: "הסר קבצים", onClick: () => removeAllFiles() },
        duration: 6000,
      });
    }
  }, [uploadedFiles, taskMode, wizardStep, chapters, projectId]);

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
    setExtractedTexts(prev => prev.filter((_, i) => i !== index));
  };

  const removeAllFiles = () => {
    setUploadedFiles([]);
    setExtractedTexts([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setLoading(false);
    setStageEvents([]);
    setPostProcessingLabel(null);
    setStreamingDraft("");
    setRunComplete(false);
    // Note: we DO NOT clear the academic run marker on stop. The backend keeps
    // running and may produce a result; the user can come back and pick it up.
    // If they truly want to discard, they can start a new run which will
    // overwrite the marker.
    runPersistedRef.current = false;
    activeRunIdRef.current = null;
    // D3.1: Deep research stop-discard removed — research is offline.
    toast.info("העיבוד הופסק");
  };

  /**
   * Consume an SSE response stream from `legal-qa`.
   * The wrapper emits four named event types:
   *   - `stage`           → { stage, status: "running"|"complete", label, detail? }
   *   - `draft_delta`     → { text }
   *   - `post_processing` → { label }
   *   - `final`           → { status, body }   (the canonical answer)
   * We also accept the legacy unnamed `data: <wrapped>` event for back-compat.
   * Returns { data, status } with the final payload (as the JSON-fetch path does).
   */
  const consumeSseStream = async (
    body: ReadableStream<Uint8Array>,
    handlers: {
      onStage: (e: StageEvent) => void;
      onDraftDelta: (chunk: string) => void;
      onPostProcessing: (label: string) => void;
      onRunId?: (runId: string) => void;
    },
  ): Promise<{ data: any; status: number }> => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalPayload: any = null;
    let finalStatus = 200;
    let done = false;

    // Per SSE spec, events are separated by a blank line. We accumulate
    // event-name + data lines until the blank, then dispatch.
    let currentEvent = "message";
    let currentData = "";

    const dispatch = () => {
      if (!currentData) {
        currentEvent = "message";
        return;
      }
      const raw = currentData;
      currentData = "";
      const evt = currentEvent;
      currentEvent = "message";
      if (raw === "[DONE]") { done = true; return; }
      let parsed: any;
      try { parsed = JSON.parse(raw); } catch { return; }
      switch (evt) {
        case "stage":
          handlers.onStage({
            stage: parsed.stage,
            status: parsed.status,
            label: parsed.label ?? parsed.stage,
            detail: parsed.detail,
          });
          break;
        case "draft_delta":
          if (typeof parsed.text === "string") handlers.onDraftDelta(parsed.text);
          break;
        case "post_processing":
          if (typeof parsed.label === "string") handlers.onPostProcessing(parsed.label);
          break;
        case "run_id":
          if (handlers.onRunId && typeof parsed.runId === "string") {
            handlers.onRunId(parsed.runId);
          }
          break;
        case "final":
          finalStatus = parsed.status ?? 200;
          finalPayload = parsed.body ?? parsed;
          done = true;
          break;
        case "message":
        default:
          // Legacy unnamed event: { status, body }
          if (parsed && typeof parsed === "object" && "body" in parsed) {
            finalStatus = parsed.status ?? 200;
            finalPayload = parsed.body;
            done = true;
          }
          break;
      }
    };

    try {
      while (!done) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let nlIdx: number;
        while ((nlIdx = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, nlIdx);
          buffer = buffer.slice(nlIdx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line === "") { dispatch(); continue; }      // blank line ends an event
          if (line.startsWith(":")) continue;             // heartbeat / comment
          if (line.startsWith("event: ")) { currentEvent = line.slice(7).trim(); continue; }
          if (line.startsWith("data: ")) {
            const piece = line.slice(6);
            currentData = currentData ? currentData + "\n" + piece : piece;
            continue;
          }
        }
        if (done) break;
      }
    } finally {
      try { reader.releaseLock(); } catch { /* noop */ }
    }

    return {
      data: finalPayload ?? { error: "לא התקבלה תשובה. נסו שוב." },
      status: finalStatus,
    };
  };


  // ─── Academic wizard helpers ─────────────────────────────────────

  const discardAcademicSession = () => {
    if (chapters.some(ch => ch.content) && !window.confirm("האם לבטל את העבודה האקדמית? כל הפרקים שנכתבו יימחקו.")) return;
    setWizardStep("init");
    setMaxReachedStep("init");
    setCurrentChapter(0);
    setChapters([]);
    setResearchQuestion("");
    setOutline("");
    setProposedQuestions([]);
    setLastAcademicAction(null);
    setResult(null);
    setQuestion("");
    clearAcademicSession(projectId);
    // Also delete the DB-persisted session so it doesn't resurface on another device.
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        let q = supabase.from("academic_sessions").delete().eq("user_id", user.id);
        q = projectId ? q.eq("project_id", projectId) : q.is("project_id", null);
        await q;
      } catch { /* silent */ }
    })();
  };

  // ─── Academic navigation helpers ────────────────────────────────
  const updateWizardStep = (step: WizardStep) => {
    setWizardStep(step);
    if (isStepAfter(step, maxReachedStep)) {
      setMaxReachedStep(step);
    }
  };

  const navigateBack = () => {
    const idx = stepIndex(wizardStep);
    if (idx <= 1) return; // can't go before topic_or_question
    // Map back: writing/checkpoint → outline, outline → topic_or_question
    if (wizardStep === "writing" || wizardStep === "checkpoint") {
      setWizardStep("outline");
      setResult(null);
    } else if (wizardStep === "outline") {
      setWizardStep("topic_or_question");
      setResult(null);
    }
  };

  const navigateForward = () => {
    // Jump to maxReachedStep or next logical step
    if (wizardStep === "topic_or_question" && isStepAfter(maxReachedStep, "topic_or_question")) {
      setWizardStep(outline ? "outline" : maxReachedStep);
      // Restore result for outline view
      if (outline) setResult({ answer: outline, footnotes: [], source_urls: [] });
    } else if (wizardStep === "outline" && isStepAfter(maxReachedStep, "outline")) {
      setWizardStep(chapters.some(ch => ch.content) ? "checkpoint" : "writing");
      setResult(null);
    }
  };

  const canGoBack = wizardStep !== "init" && wizardStep !== "done" && stepIndex(wizardStep) > 1;
  const canGoForward = wizardStep !== "done" && isStepAfter(maxReachedStep, wizardStep);
  const hasWrittenContent = chapters.some(ch => ch.content);

  /** Check if submitting from a previous step would invalidate later data */
  const checkDestructiveEdit = (fromStep: WizardStep): boolean => {
    if (fromStep === "topic_or_question" && (outline || hasWrittenContent)) {
      if (!window.confirm("שים לב: שינוי שאלת המחקר יגרום למחיקת המתווה והפרקים שנכתבו. האם להמשיך?")) return false;
      setOutline("");
      setChapters([]);
      setCurrentChapter(0);
      setMaxReachedStep("topic_or_question");
      setResult(null);
    } else if (fromStep === "outline" && hasWrittenContent) {
      if (!window.confirm("שים לב: שינוי המתווה יגרום למחיקת הפרקים שנכתבו. האם להמשיך?")) return false;
      setChapters([]);
      setCurrentChapter(0);
      setMaxReachedStep("outline");
      setResult(null);
    }
    return true;
  };

  const handleAcademicSubmit = async (academicStep: string, extraBody?: Record<string, unknown>) => {
    const q = question.trim();
    const isLongFormWriteGuard =
      academicStep === "write_chapter" ||
      academicStep === "write_introduction" ||
      academicStep === "write_conclusion";
    if (!q && !isLongFormWriteGuard) {
      toast.error("יש להזין טקסט.");
      return;
    }
    // Defensive: long-form needs *something* to write about. After a navigation
    // round-trip the local `question` input is empty; we fall back to the
    // persisted `researchQuestion`. If both are empty the session is corrupted.
    if (isLongFormWriteGuard && !q && !researchQuestion) {
      toast.error("לא נמצאה שאלת מחקר. חזור לשלב 'שאלה' או הקלד אותה כאן.");
      return;
    }

    setLoading(true);
    setResult(null);
    setError(null);
    setStageEvents([]);
    setPostProcessingLabel(null);
    setStreamingDraft("");
    setRunComplete(false);
    runPersistedRef.current = false;
    activeRunIdRef.current = null;
    // Set last academic action up-front so the live progress panel can pick
    // the right header copy (e.g. "כותב פרק אקדמי (מנוע Deep)…") while the
    // chapter is streaming, not only after it completes.
    setLastAcademicAction(academicStep);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Stream chapter writes (the only academic sub-mode that runs the full
    // research pipeline). All other sub-modes are short single-shot prompts.
    const useSseStream =
      academicStep === "write_chapter" ||
      academicStep === "write_introduction" ||
      academicStep === "write_conclusion";

    // Short academic steps (propose_outline, suggest_topics, validate_question)
    // are recoverable: client mints the runId, persists a marker BEFORE the
    // fetch, and passes the id to the backend so the qa_logs row is created
    // up-front. If navigation kills the fetch, the resume effect polls the
    // same id via legal-qa-status on remount.
    const isResumableShortStep =
      academicStep === "propose_outline" ||
      academicStep === "suggest_topics" ||
      academicStep === "validate_question";
    const shortStepRunId: string | null = isResumableShortStep ? crypto.randomUUID() : null;
    if (shortStepRunId) {
      runPersistedRef.current = true;
      activeRunIdRef.current = shortStepRunId;
      void setAcademicRunMarker(projectId, {
        runId: shortStepRunId,
        step: academicStep,
        chapterIdx: -1,
      });
    }

    try {
      const body: Record<string, unknown> = {
        question: q || researchQuestion,
        taskMode: "academic_writing",
        academicStep,
        ...(shortStepRunId ? { runId: shortStepRunId, projectId: projectId ?? null } : {}),
        ...extraBody,
      };

      // Include multi-file context
      if (extractedTexts.length > 0) {
        body.documentTexts = extractedTexts;
      }

      // Include previous chapters context for writing
      const isLongFormWrite =
        academicStep === "write_chapter" ||
        academicStep === "write_introduction" ||
        academicStep === "write_conclusion";
      if (isLongFormWrite) {
        const isAbstract = !!extraBody?.isAbstract;
        const isIntro = academicStep === "write_introduction";
        const isConclusion = academicStep === "write_conclusion";
        // Cap per chapter:
        //  - abstract: 6,000 — pure synthesis of the whole paper (incl. intro + conclusion).
        //  - conclusion: 3,500 — needs richer recall to synthesize key findings.
        //  - introduction: 2,500 — frames the paper, doesn't re-analyze it.
        //  - body chapter: 2,000 — current behavior, used for cross-chapter coherence.
        const sliceCap = isAbstract ? 6000 : isConclusion ? 3500 : isIntro ? 2500 : 2000;
        // For body chapter writes the abstract chapter is excluded so the
        // model isn't biased by a placeholder synthesis. For intro/conclusion/
        // abstract we want only body-role chapters that have real content.
        body.previousChapters = chapters
          .filter((ch) => {
            if (!ch.content) return false;
            if (isAbstract) {
              // Abstract sees everything except itself.
              return !isAbstractChapter(ch.title);
            }
            if (isIntro || isConclusion) {
              // Intro & conclusion synthesize the body. Skip the other special chapters.
              const role = chapterRole(ch.title);
              return role === "body";
            }
            // Regular body-chapter write: skip the abstract.
            return !isAbstractChapter(ch.title);
          })
          .map((ch) => ({ title: ch.title, content: (ch.content || "").slice(0, sliceCap) }));

        // Global Paper Coherence: ship cumulative PaperMemory deltas from
        // all previously finalized body chapters (excluding the abstract).
        // The backend merges them into the structured prompt block so the
        // new chapter is primed with prior claims/definitions/citations.
        if (!isAbstract) {
          const deltas = chapters
            .filter((ch) => ch.paperMemoryDelta && !isAbstractChapter(ch.title))
            .map((ch) => ch.paperMemoryDelta);
          if (deltas.length > 0) {
            body.paperMemoryDeltas = deltas;
          }
        }

        // Continuous footnote numbering: sum footnotesCount of every chapter
        // that appears BEFORE this one in display order. The chapters array is
        // already stored in display order (תקציר → מבוא → bodies → סיכום).
        // Abstract contributes 0 by rule (no new citations).
        {
          let footnoteOffset = 0;
          for (let i = 0; i < currentChapter; i++) {
            const ch = chapters[i];
            if (ch && typeof ch.footnotesCount === "number" && ch.footnotesCount > 0) {
              footnoteOffset += ch.footnotesCount;
            }
          }
          if (footnoteOffset > 0) {
            body.footnoteOffset = footnoteOffset;
          }
        }


        // so it can frame the actual final thesis, not the planned one.
        if (isIntro) {
          const conclusionCh = chapters.find((ch) => isConclusionChapter(ch.title) && ch.content);
          if (conclusionCh?.content) {
            body.conclusionContent = conclusionCh.content;
          }
        }

        body.chapterTitle = chapters[currentChapter]?.title || "";
        body.chapterIndex = currentChapter;
        body.researchQuestion = researchQuestion;
        body.outline = outline;
      }

      if (academicStep === "propose_outline") {
        body.researchQuestion = researchQuestion;
      }

      if (useSseStream) {
        body.stream = true;
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setError("יש להתחבר כדי להשתמש בעוזר המשפטי.");
        return;
      }

      const res = await fetch(`${supabaseUrl}/functions/v1/legal-qa`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
          "apikey": supabaseKey,
          ...(useSseStream ? { "Accept": "text/event-stream" } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        if (res.status === 401) { setError("פג תוקף ההתחברות. רעננו את הדף והתחברו מחדש."); return; }
        if (res.status === 429) { setError("יותר מדי בקשות. נסו שוב בעוד דקה."); return; }
        if (res.status === 402) { setError("נגמרו הקרדיטים."); return; }
        throw new Error(`HTTP ${res.status}`);
      }

      let data: any;
      let effectiveStatus = res.status;
      const contentType = res.headers.get("content-type") || "";
      if (useSseStream && contentType.includes("text/event-stream") && res.body) {
        const result = await consumeSseStream(res.body, {
          onStage: (e) => setStageEvents((prev) => [...prev, e]),
          onDraftDelta: (chunk) => setStreamingDraft((prev) => prev + chunk),
          onPostProcessing: (label) => setPostProcessingLabel(label),
          // Persist run marker so the result can be recovered if the user
          // navigates away mid-stream. Long-form academic writes only —
          // other steps are fast single-shot and don't need recovery.
          onRunId: (rid) => {
            if (isLongFormWriteGuard) {
              runPersistedRef.current = true;
              activeRunIdRef.current = rid;
              void setAcademicRunMarker(projectId, {
                runId: rid,
                step: academicStep,
                chapterIdx: currentChapter,
              });
            }
          },
        });
        data = result.data;
        effectiveStatus = result.status;
        if (effectiveStatus === 401) { setError("פג תוקף ההתחברות. רעננו את הדף והתחברו מחדש."); return; }
        if (effectiveStatus === 429) { setError("יותר מדי בקשות. נסו שוב בעוד דקה."); return; }
        if (effectiveStatus === 402) { setError("נגמרו הקרדיטים."); return; }
      } else {
        data = await res.json();
      }

      if (data?.error) { setError(data.error); return; }
      if (!data?.answer || data.answer.trim().length < 10) { setError("לא התקבלה תשובה. נסו שוב."); return; }


      const qaResult = data as QAResult;
      setRunComplete(true);
      setResult(qaResult);

      // Track last action for UI rendering
      setLastAcademicAction(academicStep);

      // Handle wizard step transitions
      if (academicStep === "suggest_topics") {
        const parsedQs = parseProposedQuestions(qaResult.answer);
        const isRegen = !!extraBody?.previousQuestions;
        const prevList = (extraBody?.previousQuestions as string[] | undefined) || [];
        // Token-Jaccard dedup vs already-shown questions (only on regenerate).
        const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2);
        const jaccard = (a: string[], b: string[]) => {
          const A = new Set(a); const B = new Set(b);
          const inter = [...A].filter((x) => B.has(x)).length;
          const uni = new Set([...A, ...B]).size;
          return uni === 0 ? 0 : inter / uni;
        };
        const prevTokens = prevList.map(norm);
        const fresh = parsedQs.filter((q) => {
          const t = norm(q);
          return !prevTokens.some((pt) => jaccard(t, pt) >= 0.75);
        });
        const exhausted = isRegen && fresh.length < 2;
        const newRound = {
          questions: exhausted ? [] : fresh,
          coverage: qaResult.topicCoverage,
          exhausted,
        };
        setSuggestionRounds((rounds) => (isRegen ? [...rounds, newRound] : [newRound]));
        setProposedQuestions((isRegen ? [...prevList, ...fresh] : fresh));
        updateWizardStep("topic_or_question");
      } else if (academicStep === "validate_question") {
        setProposedQuestions([]);
        setSuggestionRounds([]);
        updateWizardStep("topic_or_question");
      } else if (academicStep === "propose_outline") {
        setProposedQuestions([]);
        setSuggestionRounds([]);
        setOutline(qaResult.answer);
        updateWizardStep("outline");
      } else if (
        academicStep === "write_chapter" ||
        academicStep === "write_introduction" ||
        academicStep === "write_conclusion"
      ) {
        // Save chapter content (works for body, intro, and conclusion writes)
        const updatedChapters = [...chapters];
        updatedChapters[currentChapter] = {
          ...updatedChapters[currentChapter],
          content: qaResult.answer,
          ...(qaResult.paper_memory_delta
            ? { paperMemoryDelta: qaResult.paper_memory_delta }
            : {}),
          // Continuous footnote numbering: remember how many footnotes this
          // chapter emitted so the next chapter can compute its offset.
          // Prefer the explicit count from the backend; fall back to the
          // footnotes array length.
          footnotesCount:
            typeof qaResult.footnotes_count === "number"
              ? qaResult.footnotes_count
              : (qaResult.footnotes?.length ?? 0),
          footnotes: qaResult.footnotes ?? [],
        };
        setChapters(updatedChapters);
        updateWizardStep("checkpoint");

        // Stage-aware unlock toasts (mirrors the lock chain: body → conclusion → intro → abstract)
        const justWrittenTitle = updatedChapters[currentChapter]?.title || "";
        const justRole = chapterRole(justWrittenTitle);
        const allBodyDone = updatedChapters.filter(ch => chapterRole(ch.title) === "body").every(ch => !!ch.content);
        const conclusionCh = updatedChapters.find(ch => chapterRole(ch.title) === "conclusion");
        const introCh = updatedChapters.find(ch => chapterRole(ch.title) === "introduction");
        const abstractCh = updatedChapters.find(ch => chapterRole(ch.title) === "abstract");

        if (justRole === "body" && allBodyDone && conclusionCh && !conclusionCh.content) {
          toast.success("פרקי הגוף הושלמו — ניתן לכתוב את הסיכום");
        } else if (justRole === "conclusion" && introCh && !introCh.content) {
          toast.success("הסיכום נכתב — ניתן עכשיו לכתוב את המבוא, מבוסס על העבודה כפי שהיא בפועל");
        } else if (justRole === "introduction" && abstractCh && !abstractCh.content) {
          toast.success("כל פרקי העבודה הושלמו — ניתן לייצר תקציר");
        }
      }

      // qa_logs is now written canonically server-side for every academic
      // sub-mode (with metadata.academic_step + is_abstract). Client-side
      // insert removed to avoid duplicates. Just notify the sidebar.
      try {
        onResultSaved?.();
      } catch (saveErr) {
        console.error("onResultSaved hook failed:", saveErr);
      }
    } catch (e: any) {
      if (e.name === "AbortError") return;
      console.error("Academic writing error:", e);
      setError("שגיאה בעיבוד. נסו שוב.");
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
      // Clear the in-progress marker so a future mount doesn't try to resume
      // a run that already terminated (success OR error path).
      if ((isLongFormWriteGuard || isResumableShortStep) && (runPersistedRef.current || activeRunIdRef.current)) {
        void setAcademicRunMarker(projectId, null);
      }
      runPersistedRef.current = false;
      activeRunIdRef.current = null;
    }
  };

  const approveOutline = (editedBodyTitles?: string[]) => {
    let bodyTitles: string[] = [];
    if (editedBodyTitles && editedBodyTitles.length > 0) {
      // User-edited list: trust it, but still filter out any special-chapter
      // names that may have slipped in (those are force-injected below).
      bodyTitles = editedBodyTitles
        .map(t => t.trim())
        .filter(t => t && chapterRole(t) === "body");
    } else {
      const lines = outline.split("\n");
      for (const rawLine of lines) {
        const line = rawLine.replace(/\s+$/, "");
        if (/^\s+/.test(rawLine)) continue;
        const match = line.match(/^\d+\.\s+\*\*(.+?)\*\*(?:\s*[–\-—]\s*.+)?$/) ||
                      line.match(/^\d+\.\s+(.+?)(?:\s*[–\-—]\s*.+)?$/);
        if (match) {
          const title = match[1].trim().replace(/\*\*/g, "");
          if (!title) continue;
          // Strip any model-emitted special chapters; we always force-inject ours.
          const role = chapterRole(title);
          if (role === "body") bodyTitles.push(title);
        }
      }
    }
    if (bodyTitles.length === 0) {
      bodyTitles.push("המסגרת הנורמטיבית", "סקירה פסיקתית ודוקטרינרית", "ניתוח ביקורתי");
    }
    // Canonical display order: תקציר → מבוא → bodies → סיכום ומסקנות.
    // Generation order is enforced separately by the lock chain.
    const chapterTitles = ["תקציר", "מבוא", ...bodyTitles, "סיכום ומסקנות"];
    setChapters(chapterTitles.map(t => ({ title: t, content: null })));
    // Start the user on the first body chapter — the special chapters are locked.
    const firstBodyIdx = chapterTitles.findIndex(t => chapterRole(t) === "body");
    setCurrentChapter(firstBodyIdx >= 0 ? firstBodyIdx : 0);
    updateWizardStep("writing");
  };

  // ─── Lock chain: body → conclusion → introduction → abstract ───────
  const bodyChapters = chapters.filter(ch => chapterRole(ch.title) === "body");
  const allBodyDone = bodyChapters.length > 0 && bodyChapters.every(ch => !!ch.content);
  const conclusionCh = chapters.find(ch => chapterRole(ch.title) === "conclusion");
  const introCh = chapters.find(ch => chapterRole(ch.title) === "introduction");
  const abstractCh = chapters.find(ch => chapterRole(ch.title) === "abstract");

  const conclusionUnlocked = !conclusionCh ? true : allBodyDone;
  const introductionUnlocked = !introCh ? true : (allBodyDone && !!conclusionCh?.content);
  const abstractUnlocked = !abstractCh
    ? true
    : (allBodyDone && !!conclusionCh?.content && !!introCh?.content);

  // Backward-compat aliases used elsewhere in the file
  const nonAbstractChapters = chapters.filter(ch => !isAbstractChapter(ch.title));
  const completedNonAbstract = nonAbstractChapters.filter(ch => !!ch.content).length;
  const totalNonAbstract = nonAbstractChapters.length;
  const missingChapterTitles = nonAbstractChapters.filter(ch => !ch.content).map(ch => ch.title);

  function lockTooltipFor(role: ChapterRole): string {
    if (role === "abstract") return ABSTRACT_LOCKED_TOOLTIP;
    if (role === "conclusion") return CONCLUSION_LOCKED_TOOLTIP;
    if (role === "introduction") return INTRODUCTION_LOCKED_TOOLTIP;
    return "";
  }
  function isChapterLocked(title: string): boolean {
    const role = chapterRole(title);
    if (role === "conclusion") return !conclusionUnlocked;
    if (role === "introduction") return !introductionUnlocked;
    if (role === "abstract") return !abstractUnlocked;
    return false;
  }


  // ─── V2 body-chapter generation ───────────────────────────────────
  // The chapter runs on the unchanged legal-research-v2 pipeline: same job
  // table, same background/resume behaviour, same refunds. Only the intake
  // carries the paper's framing context, and only the drafter receives the
  // academic body-chapter guide.
  const stopChapterPolling = () => {
    if (chapterPollRef.current) {
      window.clearInterval(chapterPollRef.current);
      chapterPollRef.current = null;
    }
  };

  const finishChapterJob = (chapterIdx: number, row: { result: Record<string, unknown> | null }) => {
    const res = (row.result ?? {}) as Record<string, unknown>;
    const answer = String(res.answer ?? "");
    const rawFootnotes = (res.footnotes ?? []) as Array<{ number: number; title: string; url?: string | null }>;
    const academic = (res.academic ?? null) as { chapter_memory?: ChapterMemory } | null;
    const title = chapters[chapterIdx]?.title || "";
    const footnotes: Footnote[] = rawFootnotes.map((f) => ({
      number: f.number,
      citation: f.title,
      source_type: "",
      url: f.url ?? undefined,
    }));

    const updated = [...chapters];
    updated[chapterIdx] = {
      ...updated[chapterIdx],
      title,
      content: answer,
      footnotes,
      footnotesCount: footnotes.length,
      chapterMemory: academic?.chapter_memory ?? null,
    };
    setChapters(updated);
    setSourceRegistry((prev) => mergeRegistry(prev, title, rawFootnotes.map((f) => ({
      citation: f.title,
      url: f.url ?? null,
    }))));
    setResult({ answer, footnotes, source_urls: [] });
    setRunComplete(true);
    setWizardStep("checkpoint");
    setMaxReachedStep((prev) => (prev === "done" ? prev : "checkpoint"));
  };

  const pollChapterJob = (jobId: string, chapterIdx: number) => {
    stopChapterPolling();
    setLoading(true);
    chapterPollRef.current = window.setInterval(async () => {
      const { data } = await supabase
        .from("legal_research_jobs")
        .select(CHAPTER_JOB_SELECT)
        .eq("id", jobId)
        .maybeSingle();
      if (!data) return;
      const row = data as unknown as {
        status: string;
        result: Record<string, unknown> | null;
        error: string | null;
        progress_label_he: string | null;
      };
      if (CHAPTER_ACTIVE_STATUSES.includes(row.status)) {
        setChapterProgressLabel(row.progress_label_he || "מחפש מקורות");
        return;
      }
      stopChapterPolling();
      setLoading(false);
      setChapterProgressLabel(null);
      void setAcademicRunMarker(projectId, null);
      if (row.status === "done" && row.result) {
        finishChapterJob(chapterIdx, row);
      } else {
        setError(row.error || "כתיבת הפרק נכשלה. הקרדיטים הוחזרו.");
      }
    }, 4000);
  };

  const runBodyChapter = async (opts?: { instructions?: string }) => {
    const chapterIdx = currentChapter;
    const title = chapters[chapterIdx]?.title || "";
    const rq = researchQuestion || question.trim();
    if (!title || !rq) {
      toast.error("חסרים שאלת מחקר או שם פרק.");
      return;
    }
    if (chapters[chapterIdx]?.content) {
      const ok = window.confirm(
        `הפרק "${title}" כבר נכתב. כתיבה מחדש תחליף את הנוסח הקיים. להמשיך?`,
      );
      if (!ok) return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setRunComplete(false);
    setChapterProgressLabel("מחפש מקורות");
    setLastAcademicAction("write_chapter");

    let footnoteOffset = 0;
    for (let i = 0; i < chapterIdx; i++) {
      const ch = chapters[i];
      if (ch?.footnotesCount && ch.footnotesCount > 0) footnoteOffset += ch.footnotesCount;
    }

    const outlineTitles = chapters.map((c) => c.title);
    const projectContext = buildProjectContext({
      projectId: projectId ?? null,
      researchQuestion: rq,
      outlineTitles,
      chapterIndex: chapterIdx,
      chapterTitle: title,
      instructions: opts?.instructions ?? null,
      existingText: chapters[chapterIdx]?.content ?? null,
      completedChapters: chapters
        .filter((c, i) => i !== chapterIdx && !!c.content && chapterRole(c.title) === "body")
        .map((c) => ({ title: c.title, memory: c.chapterMemory ?? null, content: c.content })),
      sourceRegistry,
    });

    const started = await startChapterJob({
      question: buildChapterQuestion({ researchQuestion: rq, chapterTitle: title, instructions: opts?.instructions ?? null }),
      projectId: projectId ?? null,
      projectContext,
      footnoteOffset,
      clientRequestId: crypto.randomUUID(),
    });

    if (started.insufficientCredits) {
      setLoading(false);
      setChapterProgressLabel(null);
      setError(`אין מספיק קרדיטים. כתיבת פרק עולה ${started.required ?? CREDIT_COSTS.academicChapter} קרדיטים.`);
      return;
    }
    if (!started.jobId) {
      setLoading(false);
      setChapterProgressLabel(null);
      setError(started.error === "unauthenticated"
        ? "יש להתחבר כדי לכתוב פרק."
        : "לא הצלחנו לפתוח את כתיבת הפרק. נסו שוב.");
      return;
    }

    runPersistedRef.current = true;
    activeRunIdRef.current = started.jobId;
    void setAcademicRunMarker(projectId, { runId: started.jobId, step: "v2_chapter", chapterIdx });

    pollChapterJob(started.jobId, chapterIdx);
  };


  useEffect(() => () => stopChapterPolling(), []);

  const writeCurrentChapter = () => {
    const title = chapters[currentChapter]?.title || "";
    const role = chapterRole(title);
    if (isChapterLocked(title)) {
      toast.info(lockTooltipFor(role));
      return;
    }
    if (role === "abstract") {
      // Abstract is pure synthesis — no retrieval pipeline. Still available.
      handleAcademicSubmit("write_chapter", { isAbstract: true });
      return;
    }
    if (role === "body") {
      void runBodyChapter();
      return;
    }
    // Introduction and conclusion still route through the offline engine.
    toast.info(CHAPTER_OFFLINE_TITLE);
  };

  const advanceToNextChapter = () => {
    if (currentChapter < chapters.length - 1) {
      setCurrentChapter(currentChapter + 1);
      setResult(null);
      updateWizardStep("writing");
    } else {
      updateWizardStep("done");
    }
  };

  const editCurrentChapter = () => {
    setResult(null);
    setWizardStep("writing");
  };

  // ─── Chapter feedback (rewrite with instructions) ───────────────
  const [chapterFeedback, setChapterFeedback] = useState("");
  const [viewingChapterIdx, setViewingChapterIdx] = useState<number | null>(null);

  const rewriteWithFeedback = () => {
    const role = chapterRole(chapters[currentChapter]?.title || "");
    if (role === "body") {
      const instructions = chapterFeedback.trim();
      setChapterFeedback("");
      setViewingChapterIdx(null);
      void runBodyChapter({ instructions });
      return;
    }
    toast.info(CHAPTER_OFFLINE_TITLE);
    setChapterFeedback("");
    setViewingChapterIdx(null);
  };

  const viewChapter = (idx: number) => {
    if (chapters[idx]?.content) {
      setViewingChapterIdx(idx);
      setCurrentChapter(idx);
      setResult({ answer: chapters[idx].content!, footnotes: [], source_urls: [] });
      setWizardStep("checkpoint");
    } else {
      // Jump to write this chapter
      setViewingChapterIdx(null);
      setCurrentChapter(idx);
      setResult(null);
      setWizardStep("writing");
    }
  };

  // ─── Standard (non-academic) submit ──────────────────────────────

  const handleSubmit = async () => {
    // Academic mode has its own submit flow
    if (taskMode === "academic_writing") {
      if (wizardStep === "init" || wizardStep === "topic_or_question") return;
      return;
    }
    // Sources-only mode is owned entirely by its own panel.
    if (taskMode === "legal_source_search") return;
    // D1: Research is offline. Never fire a request — show the maintenance
    // notice and bail before any network call. String cast prevents TS from
    // narrowing `taskMode` and breaking downstream branches we leave in place
    // for the eventual rebuild.
    if ((taskMode as string) === "research") {
      toast.info(RESEARCH_OFFLINE_TITLE);
      return;
    }

    const q = question.trim();
    const hasFile = extractedTexts.length > 0;

    if (!q || q.length < 5) {
      toast.error("השאלה קצרה מדי. נסו לפרט יותר.");
      return;
    }

    setLoading(true);
    setResult(null);
    setError(null);
    setStageEvents([]);
    setPostProcessingLabel(null);
    setStreamingDraft("");
    setRunComplete(false);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const effectiveQuestion = q;


      // D3.1: Deep research async path removed. Research mode is offline
      // (short-circuited to 503 server-side). Fast SSE path is also dead but

      // left intact for any future revival.
      const body: Record<string, unknown> = {
        question: effectiveQuestion,
        taskMode,
        hasDocument: hasFile,
      };
      const useSseStream = false;
      // Send multi-file context
      if (extractedTexts.length === 1) {
        body.documentText = extractedTexts[0].text;
        body.documentName = extractedTexts[0].name;
      } else if (extractedTexts.length > 1) {
        body.documentTexts = extractedTexts;
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setError("יש להתחבר כדי להשתמש בעוזר המשפטי.");
        return;
      }

      const res = await fetch(`${supabaseUrl}/functions/v1/legal-qa`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
          "apikey": supabaseKey,
          ...(useSseStream ? { "Accept": "text/event-stream" } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok && res.status !== 202) {
        if (res.status === 401) { setError("פג תוקף ההתחברות. רעננו את הדף והתחברו מחדש."); return; }
        if (res.status === 429) { setError("יותר מדי בקשות. נסו שוב בעוד דקה."); return; }
        if (res.status === 402) { setError("נגמרו הקרדיטים. יש להוסיף קרדיטים בהגדרות."); return; }
        if (res.status === 503) {
          let msg = "השירות בשדרוג. חוזר בקרוב.";
          try {
            const j = await res.clone().json();
            if (j?.message) msg = j.message;
          } catch { /* ignore */ }
          setError(msg);
          toast.info(msg);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }

      // D3.1: 202 + run_id async polling path removed (legal-qa-status
      // is being deleted). Treat 202 as an error so users do not hang
      // waiting for a poll that will never resolve.
      let data: any;
      let effectiveStatus = res.status;
      const contentType = res.headers.get("content-type") || "";

      if (res.status === 202) {
        setError("מצב מחקר משפטי בשדרוג. נסו שוב מאוחר יותר.");
        return;
      }

      if (useSseStream && contentType.includes("text/event-stream") && res.body) {
        const result = await consumeSseStream(res.body, {
          onStage: (e) => setStageEvents((prev) => [...prev, e]),
          onDraftDelta: (chunk) => setStreamingDraft((prev) => prev + chunk),
          onPostProcessing: (label) => setPostProcessingLabel(label),
        });
        data = result.data;
        effectiveStatus = result.status;
        if (effectiveStatus === 401) { setError("פג תוקף ההתחברות. רעננו את הדף והתחברו מחדש."); return; }
        if (effectiveStatus === 429) { setError("יותר מדי בקשות. נסו שוב בעוד דקה."); return; }
        if (effectiveStatus === 402) { setError("נגמרו הקרדיטים. יש להוסיף קרדיטים בהגדרות."); return; }
      } else {
        data = await res.json();
      }

      if (data?.error) { setError(data.error); return; }
      if (!data?.refusal && (!data?.answer || data.answer.trim().length < 20)) { setError("העוזר המשפטי לא הצליח לייצר תשובה. נסו שוב."); return; }

      const qaResult = data as QAResult;
      setRunComplete(true);
      setResult(qaResult);

      try {
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (currentUser && !qaResult.refusal) {
          const isCaseSummary = taskMode === "case_summary" || qaResult.case_summary;
          // "research" (legal research mode) is logged canonically server-side
          // with internal metadata. Skip the client-side insert for that mode to avoid duplicates.
          if (taskMode !== "research") {
            const footnotesPayload: any = isCaseSummary
              ? {
                  __case_summary: true,
                  verified_source: qaResult.verified_source ?? "none",
                  case_metadata: qaResult.case_metadata ?? null,
                  source_urls: qaResult.source_urls ?? [],
                  items: [],
                }
              : qaResult.footnotes;
            await supabase.from("qa_logs").insert({
              user_id: currentUser.id,
              project_id: currentProject?.id ?? null,
              question: q,
              answer: qaResult.answer,
              footnotes: footnotesPayload,
              task_mode: taskMode,
              local_footnotes_count: isCaseSummary ? 0 : qaResult.footnotes.filter(f => f.source === "local").length,
              perplexity_footnotes_count: isCaseSummary ? 0 : qaResult.footnotes.filter(f => f.source === "perplexity").length,
              total_footnotes: isCaseSummary ? 0 : qaResult.footnotes.length,
            });
          }
          onResultSaved?.();
        }
      } catch (saveErr) {
        console.error("Failed to save QA log:", saveErr);
      }
    } catch (e: any) {
      if (e.name === "AbortError") {
        return;
      }
      console.error("Legal QA error:", e);
      setError("שגיאה בעיבוד השאלה. נסו שוב.");
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!result && taskMode !== "academic_writing") return;

    // For academic mode, copy entire accumulated paper
    if (taskMode === "academic_writing" && chapters.some(ch => ch.content)) {
      const written = chapters.filter(ch => ch.content);

      const bodyPlain = written
        .map(ch => `**${ch.title}**\n\n${ch.content}`)
        .join("\n\n---\n\n");

      // Combine footnotes across chapters (already globally numbered);
      // de-dupe by number as a safety net.
      const seen = new Set<number>();
      const allFootnotes: Footnote[] = [];
      for (const ch of written) {
        for (const fn of ch.footnotes ?? []) {
          if (seen.has(fn.number)) continue;
          seen.add(fn.number);
          allFootnotes.push(fn);
        }
      }
      allFootnotes.sort((a, b) => a.number - b.number);

      const footnotesPlain = allFootnotes.length
        ? `\n\nהערות שוליים:\n` + allFootnotes.map(f => `${f.number}. ${f.citation}`).join("\n")
        : "";

      const fullPaperPlain = bodyPlain + footnotesPlain;

      const bodyHtml = bodyPlain
        .replace(/^#{1,4}\s+(.+)$/gm, "<strong>$1</strong>")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br>");

      const footnotesHtml = allFootnotes.length
        ? `<br><br><div style="font-size: 10pt;"><strong>הערות שוליים:</strong><br>` +
          allFootnotes.map(f => f.url
            ? `<span>${f.number}. <a href="${f.url}" target="_blank" rel="noopener noreferrer">${f.citation}</a></span>`
            : `<span>${f.number}. ${f.citation}</span>`).join("<br>") +
          `</div>`
        : "";

      const richHtml = `<div dir="rtl" style="font-family: ${DAVID_FONT}; font-size: 12pt; line-height: 2; text-align: justify; direction: rtl;">${bodyHtml}${footnotesHtml}</div>`;
      copyRichText(richHtml, fullPaperPlain);
      toast.success(allFootnotes.length ? "העבודה הועתקה ללוח (כולל הערות שוליים)" : "העבודה הועתקה ללוח");
      return;
    }

    if (!result) return;

    const footnotesText = result.footnotes.map((f) => `${f.number}. ${f.citation}`).join("\n");
    const plainText = `${result.answer}\n\nהערות שוליים:\n${footnotesText}`;

    const bodyHtml = result.answer
      .replace(/^#{1,4}\s+(.+)$/gm, "<strong>$1</strong>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\n/g, "<br>");

    const footnotesHtml = result.footnotes
      .map((f) => f.url
        ? `<span>${f.number}. <a href="${f.url}" target="_blank" rel="noopener noreferrer">${f.citation}</a></span>`
        : `<span>${f.number}. ${f.citation}</span>`)
      .join("<br>");

    const richHtml = `<div dir="rtl" style="font-family: ${DAVID_FONT}; font-size: 12pt; line-height: 1.5; text-align: justify; direction: rtl;">
      ${bodyHtml}
      <br><br>
      <div style="font-size: 10pt;"><strong>הערות שוליים:</strong><br>${footnotesHtml}</div>
    </div>`;

    copyRichText(richHtml, plainText);
    toast.success("הועתק ללוח");
  };

  const scrollToFootnote = (num: number) => {
    const el = document.getElementById(`legalqa-footnote-${num}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (taskMode === "academic_writing") return; // academic mode uses buttons
      handleSubmit();
    }
  };

  const getSourceBadge = (source?: string) => {
    if (source === "local") return { color: "hsl(var(--primary))", label: "מאגר מקומי" };
    if (source === "document") return { color: "hsl(var(--accent-foreground))", label: "מתוך הקובץ" };
    return { color: "hsl(var(--muted-foreground))", label: "חיפוש אינטרנט" };
  };

  const activeMode = TASK_MODES.find((m) => m.id === taskMode) ?? TASK_MODES[0];
  const isAcademic = taskMode === "academic_writing";

  return (
    <div className="flex flex-col h-full" style={{ direction: "rtl" }}>
      {/* Top section: Mode Cards */}
      <div className="px-2 sm:px-4 pt-4 pb-2 space-y-3">

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {TASK_MODES.map((m) => {
            const isSelected = taskMode === m.id;
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                onClick={() => handleModeChange(m.id)}
                className={`flex flex-col items-center text-center gap-1.5 rounded-xl border transition-all ${
                  result || isAcademic ? "px-2 py-2.5" : "px-3 py-3.5"
                } ${
                  isSelected
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-card text-card-foreground border-border hover:border-primary/40 hover:bg-muted/50"
                }`}
              >
                <Icon className={result || isAcademic ? "w-4 h-4" : "w-5 h-5"} />
                <span className={`font-semibold leading-tight ${result || isAcademic ? "text-[11px]" : "text-xs sm:text-sm"}`}>
                  {m.label}
                </span>
                <span className={`leading-tight opacity-80 ${result || isAcademic ? "text-[9px] hidden sm:block" : "text-[10px] sm:text-[11px]"}`}>
                  {m.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Middle: scrollable results area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-2 sm:px-4">

        {/* ── Academic Wizard UI ── */}
        {isAcademic && (
          <div className="space-y-4 py-4">
            {/* Progress stepper + nav + copy */}
            {wizardStep !== "init" && (
              <div className="space-y-2">
                {/* Clickable step indicators */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    {canGoBack && (
                      <Button variant="ghost" size="sm" onClick={navigateBack} className="gap-1 text-xs h-7 px-2">
                        <ChevronRight className="w-3.5 h-3.5" />
                        חזרה
                      </Button>
                    )}
                    {canGoForward && (
                      <Button variant="ghost" size="sm" onClick={navigateForward} className="gap-1 text-xs h-7 px-2">
                        קדימה
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>

                  {/* Persistent copy button */}
                  {hasWrittenContent && (
                    <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5 text-xs h-7">
                      <Copy className="w-3 h-3" />
                      העתק טקסט מלא
                    </Button>
                  )}
                </div>

                {/* Visual stepper */}
                <div className="flex items-center justify-center gap-2 text-xs">
                  {([
                    { step: "topic_or_question" as WizardStep, label: "נושא/שאלה" },
                    { step: "outline" as WizardStep, label: "מתווה" },
                    { step: "writing" as WizardStep, label: "כתיבה" },
                  ] as const).map(({ step, label }, i) => {
                    const isCurrent = wizardStep === step || (step === "writing" && (wizardStep === "checkpoint" || wizardStep === "done"));
                    const isCompleted = isStepAfter(maxReachedStep, step) || (step === "writing" && wizardStep === "done");
                    const isClickable = !isCompleted ? false : !isCurrent;
                    return (
                      <div key={step} className="flex items-center gap-2">
                        {i > 0 && <div className={`w-6 h-px ${isCompleted || isCurrent ? "bg-primary" : "bg-border"}`} />}
                        <button
                          onClick={() => {
                            if (!isClickable) return;
                            if (step === "topic_or_question") { setWizardStep("topic_or_question"); setResult(null); }
                            else if (step === "outline") { setWizardStep("outline"); setResult({ answer: outline, footnotes: [], source_urls: [] }); }
                            else if (step === "writing") { setWizardStep(chapters.some(ch => ch.content) ? "checkpoint" : "writing"); setResult(null); }
                          }}
                          disabled={!isClickable}
                          className={`flex items-center gap-1 px-2 py-1 rounded-full transition-colors ${
                            isCurrent
                              ? "bg-primary text-primary-foreground font-semibold"
                              : isCompleted
                                ? "bg-primary/10 text-primary cursor-pointer hover:bg-primary/20"
                                : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {isCompleted && !isCurrent && <Check className="w-3 h-3" />}
                          {label}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Chapter progress bar */}
                {chapters.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>
                        {wizardStep === "done"
                          ? "העבודה הושלמה!"
                          : `פרק ${currentChapter + 1} מתוך ${chapters.length}`}
                      </span>
                      <span>{chapters.filter(ch => ch.content).length}/{chapters.length} פרקים</span>
                    </div>
                    <Progress value={(chapters.filter(ch => ch.content).length / Math.max(chapters.length, 1)) * 100} className="h-1.5" />
                  </div>
                )}
              </div>
            )}

            {/* INIT: Two paths */}
            {wizardStep === "init" && !loading && !result && (
              <div className="flex flex-col items-center justify-center py-12 text-center space-y-6">
                <GraduationCap className="w-12 h-12 text-primary" />
                <div>
                  <h2 className="text-foreground text-lg font-bold mb-2">כתיבה אקדמית</h2>
                  <p className="text-muted-foreground text-sm mb-6">עוזר מחקר אקדמי ליצירת עבודות סמינריון ומאמרים משפטיים בשלבים</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 w-full max-w-md">
                  <Button
                    variant="outline"
                    className="flex-1 h-auto py-4 flex flex-col gap-1"
                    onClick={() => {
                      updateWizardStep("topic_or_question");
                      setQuestion("");
                    }}
                  >
                    <span className="font-semibold">יש לי נושא כללי</span>
                    <span className="text-[10px] text-muted-foreground">המערכת תציע 3 שאלות מחקר</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 h-auto py-4 flex flex-col gap-1"
                    onClick={() => {
                      updateWizardStep("topic_or_question");
                      setQuestion("");
                    }}
                  >
                    <span className="font-semibold">יש לי שאלת מחקר</span>
                    <span className="text-[10px] text-muted-foreground">המערכת תבדוק את כדאיותה</span>
                  </Button>
                </div>
              </div>
            )}

            {/* TOPIC/QUESTION: input + action */}
            {wizardStep === "topic_or_question" && !loading && !result && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">הזינו נושא כללי או שאלת מחקר ספציפית:</p>
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="למשל: השפעת חוק-יסוד: כבוד האדם וחירותו על דיני הנזיקין..."
                  className="w-full rounded-lg border border-border bg-background p-3 text-sm min-h-[80px] resize-none"
                  dir="rtl"
                />
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      if (!checkDestructiveEdit("topic_or_question")) return;
                      handleAcademicSubmit("suggest_topics");
                    }}
                    disabled={question.trim().length < 5}
                    size="sm"
                  >
                    הצע שאלות מחקר
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (!checkDestructiveEdit("topic_or_question")) return;
                      setResearchQuestion(question.trim());
                      handleAcademicSubmit("validate_question");
                    }}
                    disabled={question.trim().length < 10}
                    size="sm"
                  >
                    בדוק כדאיות אקדמית
                  </Button>
                </div>
              </div>
            )}

            {/* No-coverage empty state (round 1 only) */}
            {wizardStep === "topic_or_question" && result && lastAcademicAction === "suggest_topics" && result.noCoverage && suggestionRounds.length === 0 && (
              <Card className="border-destructive/40 bg-destructive/5">
                <CardContent className="p-4 space-y-3" dir="rtl">
                  <p className="text-sm font-semibold text-destructive">⚠️ אין כיסוי מקורות לנושא הזה</p>
                  <p className="text-sm text-foreground leading-relaxed">{result.answer}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setProposedQuestions([]);
                      setSuggestionRounds([]);
                      setResult(null);
                      setLastAcademicAction(null);
                      setQuestion("");
                    }}
                  >
                    נסה נושא אחר
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Multi-round suggestions */}
            {wizardStep === "topic_or_question" && lastAcademicAction === "suggest_topics" && suggestionRounds.length > 0 && (() => {
              const MAX_ROUNDS = 3;
              const lastRound = suggestionRounds[suggestionRounds.length - 1];
              const exhausted = !!lastRound?.exhausted;
              const reachedCap = suggestionRounds.length >= MAX_ROUNDS;
              const canRegen = !exhausted && !reachedCap;
              return (
                <Card className="border-border">
                  <CardContent className="p-4 space-y-4" dir="rtl">
                    {suggestionRounds.map((round, rIdx) => {
                      // Compute global question index across rounds for numbering
                      const offset = suggestionRounds
                        .slice(0, rIdx)
                        .reduce((acc, r) => acc + r.questions.length, 0);
                      return (
                        <div key={rIdx} className="space-y-3">
                          {rIdx > 0 && (
                            <div className="flex items-center gap-2 pt-1">
                              <div className="flex-1 h-px bg-border" />
                              <span className="text-xs text-muted-foreground font-medium">סבב {rIdx + 1}</span>
                              <div className="flex-1 h-px bg-border" />
                            </div>
                          )}
                          {round.coverage && (
                            <div className="flex flex-wrap items-center gap-2">
                              {round.coverage.localHits > 0 && (
                                <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-primary/15 text-primary font-medium">
                                  📚 {round.coverage.localHits} במאגר
                                </span>
                              )}
                              {round.coverage.externalHits > 0 && (
                                <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-accent/40 text-accent-foreground font-medium">
                                  🌐 {round.coverage.externalHits} מהרשת
                                </span>
                              )}
                              {!round.coverage.minCoverageReached && (
                                <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-destructive/10 text-destructive font-medium">
                                  ⚠️ כיסוי דל
                                </span>
                              )}
                              {round.coverage.sources.length > 0 && (
                                <details className="text-xs w-full mt-1">
                                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
                                    ראה מקורות שנמצאו ({round.coverage.sources.length})
                                  </summary>
                                  <ul className="mt-2 space-y-1 pr-3 border-r-2 border-border">
                                    {round.coverage.sources.map((s, i) => (
                                      <li key={i} className="text-muted-foreground leading-relaxed">
                                        {s.url ? (
                                          <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                                            {s.title}
                                          </a>
                                        ) : (
                                          <span>{s.title}</span>
                                        )}
                                        <span className="text-xs opacity-70"> · {s.source_type} · [{s.origin === "local" ? "מאגר" : "חיצוני"}]</span>
                                      </li>
                                    ))}
                                  </ul>
                                </details>
                              )}
                            </div>
                          )}
                          {rIdx === 0 && (
                            <p className="text-sm font-semibold text-foreground">בחרו אחת מהשאלות המוצעות:</p>
                          )}
                          <div className="space-y-2">
                            {round.questions.map((q, idx) => {
                              const globalIdx = offset + idx + 1;
                              return (
                                <button
                                  key={idx}
                                  onClick={() => {
                                    if (!checkDestructiveEdit("topic_or_question")) return;
                                    setResearchQuestion(q);
                                    setQuestion(q);
                                    setProposedQuestions([]);
                                    setSuggestionRounds([]);
                                    setResult(null);
                                    setLastAcademicAction(null);
                                    handleAcademicSubmit("propose_outline", { researchQuestion: q });
                                  }}
                                  className="w-full text-right p-3 rounded-lg border border-border bg-background hover:bg-primary/5 hover:border-primary/40 transition-colors text-sm leading-relaxed"
                                  dir="rtl"
                                >
                                  <span className="font-bold text-primary ml-2">{globalIdx}.</span>
                                  {q}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}

                    {/* Exhausted / cap-reached card */}
                    {(exhausted || reachedCap) && (
                      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 space-y-2">
                        <p className="text-sm font-semibold text-destructive">
                          {exhausted
                            ? "לא הצלחנו למצוא שאלות נוספות על הנושא הזה."
                            : "הגעת למספר הסבבים המרבי."}
                        </p>
                        <p className="text-sm text-foreground leading-relaxed">
                          ניתן לבחור באחת מהשאלות שכבר הוצעו, או לנסות נושא אחר.
                        </p>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                      {canRegen && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={regenerating || loading}
                          onClick={async () => {
                            if (!checkDestructiveEdit("topic_or_question")) return;
                            setRegenerating(true);
                            try {
                              await handleAcademicSubmit("suggest_topics", {
                                previousQuestions: proposedQuestions,
                                round: suggestionRounds.length + 1,
                              });
                            } finally {
                              setRegenerating(false);
                            }
                          }}
                        >
                          {regenerating ? "מחפש שאלות נוספות…" : "+ הצע 3 שאלות נוספות"}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setProposedQuestions([]);
                          setSuggestionRounds([]);
                          setResult(null);
                          setLastAcademicAction(null);
                          setQuestion("");
                        }}
                      >
                        נסה נושא אחר
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setProposedQuestions([]);
                          setSuggestionRounds([]);
                          setResult(null);
                          setLastAcademicAction(null);
                          setQuestion("");
                        }}
                      >
                        יש לי שאלת מחקר משלי
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })()}

            {wizardStep === "topic_or_question" && result && lastAcademicAction !== "suggest_topics" && (
              <Card className="border-border">
                <CardContent className="p-4 space-y-3">
                  <div className="text-foreground text-sm leading-relaxed whitespace-pre-wrap" style={{ lineHeight: 1.8 }}>
                    <AnswerWithFootnotes text={result.answer} onFootnoteClick={scrollToFootnote} />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        if (!checkDestructiveEdit("topic_or_question")) return;
                        const rq = question.trim() || researchQuestion;
                        setResearchQuestion(rq);
                        setResult(null);
                        handleAcademicSubmit("propose_outline", { researchQuestion: rq });
                      }}
                    >
                      אשר ועבור למתווה
                    </Button>
                    <textarea
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder="ניתן לערוך את שאלת המחקר..."
                      className="flex-1 rounded border border-border bg-background p-2 text-xs min-h-[36px] resize-none"
                      dir="rtl"
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* OUTLINE: structured research-proposal report */}
            {wizardStep === "outline" && result && (
              <OutlineReport
                answer={result.answer}
                researchQuestion={researchQuestion}
                onApprove={() => {
                  if (!checkDestructiveEdit("outline")) return;
                  approveOutline();
                }}
                onApproveEdited={(titles) => {
                  if (!checkDestructiveEdit("outline")) return;
                  approveOutline(titles);
                }}
                onBack={() => { setResult(null); setWizardStep("topic_or_question"); }}
              />
            )}

            {/* Clickable chapter list — visible during writing/checkpoint */}
            {(wizardStep === "writing" || wizardStep === "checkpoint") && chapters.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {chapters.map((ch, idx) => {
                  const isWritten = !!ch.content;
                  const isCurrent = idx === currentChapter;
                  const role = chapterRole(ch.title);
                  const isSpecial = role !== "body";
                  const locked = !isWritten && isChapterLocked(ch.title);
                  const tooltip = locked ? lockTooltipFor(role) : null;

                  const baseClass = `flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${
                    locked
                      ? "bg-muted/50 text-muted-foreground border-dashed border-border opacity-70 cursor-not-allowed"
                      : isCurrent
                        ? "bg-primary text-primary-foreground border-primary font-semibold"
                        : isWritten
                          ? "bg-primary/10 text-primary border-primary/30 hover:bg-primary/20 cursor-pointer"
                          : "bg-muted text-muted-foreground border-border hover:bg-muted/80 cursor-pointer"
                  }`;

                  const handleClick = () => {
                    if (locked && tooltip) {
                      toast.info(tooltip);
                      return;
                    }
                    viewChapter(idx);
                  };

                  const iconNode = locked
                    ? <Lock className="w-3 h-3" />
                    : isSpecial && !isWritten
                      ? <Wand2 className="w-3 h-3" />
                      : isWritten && !isCurrent
                        ? <Check className="w-3 h-3" />
                        : null;

                  const btn = (
                    <button
                      key={idx}
                      type="button"
                      onClick={handleClick}
                      aria-disabled={locked}
                      className={baseClass}
                    >
                      {iconNode}
                      <span className="truncate max-w-[120px]">{idx + 1}. {ch.title}</span>
                    </button>
                  );

                  if (locked && tooltip) {
                    return (
                      <Tooltip key={idx}>
                        <TooltipTrigger asChild>{btn}</TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs text-xs">
                          {tooltip}
                        </TooltipContent>
                      </Tooltip>
                    );
                  }
                  return btn;
                })}
              </div>
            )}

            {/* COMPARATIVE-TOPIC BANNER: shown before/during writing of a comparative chapter
                when the user hasn't uploaded any reference PDFs yet. */}
            {(wizardStep === "writing" || wizardStep === "checkpoint") &&
              chapters.length > 0 &&
              uploadedFiles.length === 0 &&
              /משווה|מודלים השוואתיים|ארצות הברית|אנגליה|קנדה|אוסטרליה|גרמניה|comparative|international/i.test(
                chapters[currentChapter]?.title || "",
              ) && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 text-sm">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                    <div className="space-y-2 flex-1">
                      <p className="font-semibold text-foreground">
                        לא מצאתי מספיק מקורות זרים מעמיקים בחיפוש אוטומטי.
                      </p>
                      <p className="text-muted-foreground leading-relaxed">
                        כדי שהניתוח ההשוואתי יהיה ברמה אקדמית גבוהה, מומלץ להעלות כאן מאמרים או פסקי דין ספציפיים.
                        אני אנתח אותם ואשלב אותם בטקסט עם אזכורים מדויקים.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        className="border-amber-500/40 hover:bg-amber-500/20 gap-1.5"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        העלאת מקורות זרים
                      </Button>
                    </div>
                  </div>
                </div>
              )}

            {/* WRITING: show current chapter + write button */}
            {wizardStep === "writing" && !loading && !result && chapters.length > 0 && (() => {
              const currentTitle = chapters[currentChapter]?.title || "";
              const role = chapterRole(currentTitle);
              const isAbstract = role === "abstract";
              const isLocked = isAbstract && !abstractUnlocked;
              const hasContent = !!chapters[currentChapter]?.content;
              // D1: body / introduction / conclusion route to the offline
              // chapter engine — show maintenance card instead of the write CTA.
              const isOfflineChapter = role === "introduction" || role === "conclusion";

              const writeButtonLabel = isAbstract
                ? (hasContent ? "ייצר תקציר מחדש" : "ייצר תקציר")
                : (hasContent ? "כתוב מחדש" : "כתוב פרק זה");

              return (
                <Card className="border-border">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-foreground">
                        {isAbstract ? "כתיבת תקציר" : "כתיבת פרק"}: {currentTitle}
                      </h3>
                      <span className="text-xs text-muted-foreground">פרק {currentChapter + 1} מתוך {chapters.length}</span>
                    </div>

                    {isLocked && (
                      <div className="text-xs text-muted-foreground p-2 bg-muted/40 rounded space-y-1">
                        <p>{ABSTRACT_LOCKED_TOOLTIP}</p>
                        <p>
                          הושלמו {completedNonAbstract}/{totalNonAbstract} פרקים.
                          {missingChapterTitles.length > 0 && (
                            <> נותרו: {missingChapterTitles.join("; ")}.</>
                          )}
                        </p>
                      </div>
                    )}

                    {hasContent && !isLocked && !isOfflineChapter && (
                      <div className="text-xs text-muted-foreground p-2 bg-muted/30 rounded">
                        פרק זה כבר נכתב. לחצו "{writeButtonLabel}" לשכתוב.
                      </div>
                    )}

                    {isOfflineChapter ? (
                      <MaintenanceCard
                        title={CHAPTER_OFFLINE_TITLE}
                        message={CHAPTER_OFFLINE_MESSAGE}
                      />
                    ) : isLocked ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-block">
                            <Button size="sm" disabled className="gap-1.5 cursor-not-allowed">
                              <Lock className="w-3.5 h-3.5" />
                              ייצר תקציר
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs text-xs">
                          {ABSTRACT_LOCKED_TOOLTIP}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <Button onClick={writeCurrentChapter} size="sm" className="gap-1.5">
                        {isAbstract && <Wand2 className="w-3.5 h-3.5" />}
                        {writeButtonLabel}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })()}

            {/* CHECKPOINT: chapter just written */}
            {wizardStep === "checkpoint" && result && (
              <Card className="border-border">
                <div className="flex items-center justify-between px-4 pt-4 pb-2 border-b border-border">
                  <span className="text-xs text-muted-foreground font-medium">
                    פרק {currentChapter + 1}: {chapters[currentChapter]?.title}
                  </span>
                  <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5 text-xs">
                    <Copy className="w-3.5 h-3.5" />
                    העתק
                  </Button>
                </div>
                <CardContent className="p-4">
                  <div className="max-w-none text-foreground leading-relaxed whitespace-pre-wrap" style={{ fontSize: "12pt", textAlign: "right", lineHeight: 1.8 }}>
                    <AnswerWithFootnotes text={result.answer} onFootnoteClick={scrollToFootnote} />
                  </div>
                  {result.footnotes.length > 0 && (
                    <div className="border-t border-border pt-4 mt-6 space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-muted-foreground" style={{ fontSize: "11pt" }}>הערות שוליים</h3>
                        <button
                          onClick={() => setReviewOpen((v) => !v)}
                          className="text-[11px] px-2 py-1 rounded-md bg-secondary/15 text-secondary hover:bg-secondary/25 font-medium"
                        >
                          {reviewOpen ? "סגור בדיקה" : "בדוק ציטוטים"}
                        </button>
                      </div>
                      <ol className="space-y-1.5">
                        {result.footnotes.map((fn) => {
                          const badge = getSourceBadge(fn.source);
                          let host = "";
                          try { host = fn.url ? new URL(fn.url).hostname.replace(/^www\./, "") : ""; } catch { host = ""; }
                          return (
                            <li key={fn.number} id={`legalqa-footnote-${fn.number}`} className="flex gap-2 items-start text-foreground" style={{ fontSize: "10pt" }}>
                              <span className="text-primary font-bold shrink-0 flex items-center gap-1" style={{ fontSize: "10pt" }}>
                                <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: badge.color }} title={badge.label} />
                                {fn.number}.
                              </span>
                              <div className="min-w-0 flex items-baseline gap-1.5 flex-wrap">
                                <RenderBold text={fn.citation} />
                                {fn.url && (
                                  <a
                                    href={fn.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:underline shrink-0"
                                    title={host || fn.url}
                                  >
                                    ↗ {host || "קישור"}
                                  </a>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                      {reviewOpen && (
                        <CitationReviewPanel
                          answer={result.answer}
                          footnotes={result.footnotes}
                          onApply={applyCitationReview}
                          onCancel={() => setReviewOpen(false)}
                        />
                      )}
                    </div>
                  )}
                  {!!result.dropped_footnotes_count && result.dropped_footnotes_count > 0 && (
                    <p className="mt-3 text-xs text-muted-foreground italic">
                      {result.dropped_footnotes_count === 1
                        ? "הערת שוליים אחת הושמטה כי לא עמדה בדרישות הציטוט (למשל חסרים שמות צדדים או פרטי פרסום)."
                        : `${result.dropped_footnotes_count} הערות שוליים הושמטו כי לא עמדו בדרישות הציטוט (למשל חסרים שמות צדדים או פרטי פרסום).`}
                    </p>
                  )}
                </CardContent>
                {/* Feedback textbox for rewrite */}
                <div className="px-4 pb-2 space-y-2">
                  <textarea
                    value={chapterFeedback}
                    onChange={(e) => setChapterFeedback(e.target.value)}
                    placeholder="הנחיות נוספות לשכתוב (למשל: הרחב את סקירת הפסיקה, התמקד בגישה הביקורתית...)"
                    className="w-full rounded-lg border border-border bg-background p-2.5 text-xs min-h-[48px] resize-none"
                    dir="rtl"
                  />
                  {chapterFeedback.trim() && (
                    <Button variant="secondary" size="sm" onClick={rewriteWithFeedback} className="text-xs gap-1">
                      שכתב עם הנחיות
                    </Button>
                  )}
                </div>

                <div className="px-4 pb-4 flex gap-2 border-t border-border pt-3">
                  <Button size="sm" onClick={advanceToNextChapter}>
                    {currentChapter < chapters.length - 1 ? "המשך לפרק הבא" : "סיים עבודה"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={editCurrentChapter}>
                    כתוב מחדש פרק זה
                  </Button>
                </div>
              </Card>
            )}

            {/* DONE: show summary */}
            {wizardStep === "done" && (
              <Card className="border-primary/30 bg-primary/5">
                <CardContent className="p-6 text-center space-y-4">
                  <GraduationCap className="w-10 h-10 text-primary mx-auto" />
                  <h2 className="text-foreground text-lg font-bold">העבודה הושלמה!</h2>
                  <p className="text-sm text-muted-foreground">
                    {chapters.filter(ch => ch.content).length} פרקים נכתבו בהצלחה.
                  </p>
                  <div className="flex gap-2 justify-center">
                    <Button onClick={handleCopy} className="gap-1.5">
                      <Copy className="w-4 h-4" />
                      העתק את כל העבודה
                    </Button>
                    <Button variant="outline" onClick={discardAcademicSession}>
                      עבודה חדשה
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Discard button when in progress */}
            {wizardStep !== "init" && wizardStep !== "done" && !loading && (
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" className="text-xs text-destructive gap-1" onClick={discardAcademicSession}>
                  <Trash2 className="w-3 h-3" />
                  בטל עבודה
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ── Non-academic empty state ── */}
        {!isAcademic && taskMode === "research" && (
          <div className="h-full flex flex-col py-4">
            <LegalResearchV1Panel
              externalResult={legalResearchV1External}
              onConsumeExternalResult={onConsumeExternalResult}
            />
          </div>
        )}

        {!isAcademic && taskMode === "legal_source_search" && (
          <div className="h-full flex flex-col py-4">
            <LegalSourceSearchPanel
              externalResult={sourceSearchExternal}
              onConsumeExternalResult={onConsumeExternalResult}
            />
          </div>
        )}

        {!isAcademic && !result && !loading && !error && taskMode !== "research" && taskMode !== "legal_source_search" && (

          <div className="flex flex-col items-center justify-center h-full py-12 text-center">
            <div className="mb-4"><ReLexLogo size={56} /></div>
            <h2 className="text-foreground text-lg font-bold mb-2">{"\n"}</h2>

            <p className="text-muted-foreground text-sm">
              {uploadedFiles.length > 0
                ? "שאלו שאלה על המסמכים שהועלו – התשובה תתבסס על תוכן הקבצים ועל המאגר הפנימי"
                : "\n"}
            </p>
          </div>
        )}


        {/* Inline error */}
        {!result && !loading && error && (
          <Card className="mt-4 border-destructive/30 bg-destructive/5">
            <CardContent className="p-6 text-center space-y-3">
              <AlertTriangle className="w-8 h-8 text-destructive mx-auto" />
              <p className="text-foreground text-sm font-medium">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setError(null); }}
                className="gap-1.5"
              >
                נסו שוב
              </Button>
            </CardContent>
          </Card>
        )}

        {/* D3.1: Loading indicator — Research / chapter streaming UIs removed.
            Show a minimal spinner for any non-case_summary loading state. */}
        {loading && taskMode !== "case_summary" && (
          <Card className="mt-4 border-border/40">
            <CardContent className="flex items-center gap-3 py-4">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
              <p className="text-sm text-muted-foreground">{chapterProgressLabel ?? "מעבד…"}</p>
            </CardContent>
          </Card>
        )}

        {/* Case-summary refusal card */}
        {!isAcademic && result?.refusal && (
          <Alert className="mt-4 border-amber-500/40 bg-amber-50/40 dark:bg-amber-900/10">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-foreground space-y-3">
              <p className="text-sm leading-relaxed">{result.message}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="gap-1.5"
              >
                <Upload className="w-3.5 h-3.5" />
                העלה קובץ פסק הדין
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Case-summary structured report */}
        {!isAcademic && result && !result.refusal && (result.case_summary || taskMode === "case_summary") && (
          <CaseSummaryReport
            answer={result.answer}
            metadata={result.case_metadata}
            verifiedSource={result.verified_source}
            onClear={() => { setResult(null); setQuestion(""); }}
          />
        )}

        {/* Verifying-source progress (case_summary only) */}
        {!isAcademic && loading && taskMode === "case_summary" && (
          <Card className="mt-4 border-primary/30">
            <CardContent className="p-5">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-sm font-semibold text-foreground">מאמת מקור...</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Non-academic result */}
        {!isAcademic && result && !result.refusal && !result.case_summary && taskMode !== "case_summary" && (
          <Card className="mt-4 border-border">
            <div className="flex items-center justify-between px-4 sm:px-6 pt-4 pb-2 border-b border-border">
              <span className="text-xs text-muted-foreground font-medium">
                {TASK_MODES.find((m) => m.id === taskMode)?.label || "חוות דעת"}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5 text-xs">
                  <Copy className="w-3.5 h-3.5" />
                  העתק
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setResult(null); setQuestion(""); }}
                  className="text-xs text-muted-foreground"
                >
                  נקה
                </Button>
              </div>
            </div>

            <CardContent className="p-4 sm:p-6">
              <div
                className="max-w-none text-foreground leading-relaxed whitespace-pre-wrap"
                style={{ fontSize: "12pt", textAlign: "right", lineHeight: 1.8 }}
              >
                <AnswerWithFootnotes text={result.answer} onFootnoteClick={scrollToFootnote} />
              </div>

              {result.footnotes.length > 0 && (
                <div className="border-t border-border pt-4 mt-6 space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-muted-foreground" style={{ fontSize: "11pt" }}>
                      הערות שוליים
                    </h3>
                    <button
                      onClick={() => setReviewOpen((v) => !v)}
                      className="text-[11px] px-2 py-1 rounded-md bg-secondary/15 text-secondary hover:bg-secondary/25 font-medium"
                    >
                      {reviewOpen ? "סגור בדיקה" : "בדוק ציטוטים"}
                    </button>
                  </div>
                  <ol className="space-y-1.5">
                    {result.footnotes.map((fn) => {
                      const badge = getSourceBadge(fn.source);
                      return (
                        <li
                          key={fn.number}
                          id={`legalqa-footnote-${fn.number}`}
                          className="flex gap-2 items-start text-foreground"
                          style={{ fontSize: "10pt" }}
                        >
                          <span className="text-primary font-bold shrink-0 flex items-center gap-1" style={{ fontSize: "10pt" }}>
                            <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: badge.color }} title={badge.label} />
                            {fn.number}.
                          </span>
                          <div className="min-w-0">
                            <RenderBold text={fn.citation} />
                            {fn.source === "document" && (
                              <span className="text-[9px] text-accent-foreground mr-1">[מתוך הקובץ שהועלה]</span>
                            )}
                            {fn.url && (
                              <a href={fn.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5 mr-1.5" style={{ fontSize: "9pt" }}>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                  {reviewOpen && (
                    <CitationReviewPanel
                      answer={result.answer}
                      footnotes={result.footnotes}
                      onApply={applyCitationReview}
                      onCancel={() => setReviewOpen(false)}
                    />
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Bottom: Input bar pinned */}
      <div className="mt-auto px-2 sm:px-4 pb-2 pt-2 space-y-1.5 border-t border-border bg-background">
        {/* Hide input bar for academic mode (it has its own UI) unless in non-wizard steps */}
        {!isAcademic && taskMode !== "research" && taskMode !== "legal_source_search" && (
          <div className="flex gap-2 items-end">
            {/* File upload zone */}
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className={`flex-shrink-0 w-14 h-14 sm:w-16 sm:h-16 rounded-xl border-2 border-dashed flex items-center justify-center cursor-pointer transition-colors ${
                uploadedFiles.length > 0
                  ? isFileRelevantMode
                    ? "border-primary/40 bg-primary/5"
                    : "border-amber-400/60 bg-amber-50/30 dark:bg-amber-900/10"
                  : "border-border hover:border-primary/30 hover:bg-muted/50"
              }`}
            >
              {extracting ? (
                <div className="w-5 h-5 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
              ) : uploadedFiles.length > 0 ? (
                <div className="relative flex items-center justify-center w-full h-full">
                  <FileText className="w-5 h-5 text-primary" />
                  <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground rounded-full w-4 h-4 flex items-center justify-center text-[9px] font-bold">
                    {uploadedFiles.length}
                  </span>
                </div>
              ) : (
                <Upload className="w-5 h-5 text-muted-foreground" />
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) handleFileSelect(e.target.files);
                }}
              />
            </div>

            {/* Textarea + integrated depth toggle + send */}
            <div className="input-field flex flex-col flex-1 overflow-hidden">
              <div className="flex items-end">
                <textarea
                  ref={textareaRef}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={uploadedFiles.length > 0 ? `שאלו על ${uploadedFiles.length} קבצים...` : activeMode.placeholder}
                  disabled={loading}
                  rows={1}
                  className="flex-1 bg-transparent border-none outline-none focus:outline-none focus:ring-0 px-2.5 sm:px-3.5 py-2.5 sm:py-3 text-foreground text-sm leading-relaxed font-sans resize-none"
                  dir="rtl"
                />
                {loading ? (
                  <button
                    onClick={handleStop}
                    className="btn-send px-4 py-2.5 m-1.5 text-destructive-foreground bg-destructive text-base flex-shrink-0 hover:bg-destructive/90"
                    title="עצור"
                  >
                    <StopCircle className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={handleSubmit}
                    disabled={question.trim().length < 5}
                    className="btn-send px-4 py-2.5 m-1.5 text-primary-foreground text-base flex-shrink-0 disabled:text-muted-foreground"
                  >
                    ⇧
                  </button>

                )}
              </div>

              {/* D1: Fast/Deep depth toggle hidden — Research engine is offline. */}
            </div>
          </div>
        )}

        {/* Academic mode: file upload bar */}
        {isAcademic && wizardStep !== "done" && (
          <div className="flex gap-2 items-center">
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className="flex-shrink-0 h-10 px-3 rounded-lg border border-dashed border-border hover:border-primary/30 flex items-center gap-2 cursor-pointer transition-colors"
            >
              <Plus className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">העלאת קבצים</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) handleFileSelect(e.target.files);
                }}
              />
            </div>
            {loading && (
              <button
                onClick={handleStop}
                className="h-10 px-3 rounded-lg bg-destructive text-destructive-foreground text-xs flex items-center gap-1.5"
              >
                <StopCircle className="w-3.5 h-3.5" />
                עצור
              </button>
            )}
          </div>
        )}

        {/* File list */}
        {uploadedFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {uploadedFiles.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/40 rounded px-1.5 py-0.5">
                📎 {f.name}
                <button onClick={() => removeFile(i)} className="text-destructive hover:text-destructive/80">
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Attribution */}
        <div className="text-center py-1 text-[10px] sm:text-[11px] text-muted-foreground">
          ReLex הוא AI ויכול לעשות טעויות. יש לבדוק שנית את הפלט לפני השימוש בו.
        </div>
      </div>
    </div>
  );
}
